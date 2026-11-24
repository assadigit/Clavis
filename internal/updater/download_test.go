/**
 * CLAVIS — download retry/resume tests (spec: self-update-download-
 * resilience). All against local httptest servers; no real network.
 */
package updater

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// noBackoff removes the pause between attempts for the test run.
func noBackoff(t *testing.T) {
	t.Helper()
	orig := waitBackoff
	waitBackoff = func(context.Context, time.Duration) {}
	t.Cleanup(func() { waitBackoff = orig })
}

// fixedProxy returns a transport-level proxy resolver pinned to one URL.
func fixedProxy(raw string) func(*http.Request) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		panic(err)
	}
	return func(*http.Request) (*url.URL, error) { return u, nil }
}

// deadPortAddr returns an address that refuses connections (a listener that
// was opened and closed — nothing is listening there anymore).
func deadPortAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close()
	return addr
}

func sampleCheck(t *testing.T, got, want []byte) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("downloaded %d bytes, want %d", len(got), len(want))
	}
	for i := 0; i < len(got); i += 9973 {
		if got[i] != want[i] {
			t.Fatalf("byte %d differs", i)
		}
	}
}

// A mid-body cut (server dies half way through the body) must be retried and
// RESUMED: the second request carries a Range header starting at the .part
// offset, and the final file is byte-identical to the payload.
func TestDownloadResumesAfterBodyCut(t *testing.T) {
	noBackoff(t)
	payload := make([]byte, 600<<10)
	for i := range payload {
		payload[i] = byte(i)
	}
	half := int64(len(payload)) / 2
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(payload)))
			w.WriteHeader(http.StatusOK)
			w.Write(payload[:half])
			panic(http.ErrAbortHandler) // hard cut mid-body
		}
		if rng := r.Header.Get("Range"); rng != fmt.Sprintf("bytes=%d-", half) {
			t.Errorf("retry Range = %q, want bytes=%d-", rng, half)
		}
		w.Header().Set("Content-Length", fmt.Sprintf("%d", int64(len(payload))-half))
		w.WriteHeader(http.StatusPartialContent)
		w.Write(payload[half:])
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "Clavis.exe")
	var lastR, lastT int64
	err := DownloadWithRetries(context.Background(), []*http.Client{srv.Client()}, srv.URL, dest, int64(len(payload)),
		func(r, total int64) { lastR, lastT = r, total })
	if err != nil {
		t.Fatal(err)
	}
	if n := requests.Load(); n != 2 {
		t.Fatalf("server saw %d requests, want 2 (cut + resume)", n)
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	sampleCheck(t, got, payload)
	if lastR != int64(len(payload)) || lastT != int64(len(payload)) {
		t.Errorf("progress ended at %d/%d", lastR, lastT)
	}
}

// Client rotation: the first client dials through a dead proxy (connection
// refused), the second is direct — the update must still complete, and the
// server must only ever see the direct attempt.
func TestDownloadWithRetriesFallsBackToDirect(t *testing.T) {
	noBackoff(t)
	payload := []byte("the new Clavis exe, tiny edition")
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.Write(payload)
	}))
	defer srv.Close()

	deadProxy := &http.Client{Transport: &http.Transport{Proxy: fixedProxy("http://" + deadPortAddr(t))}}
	dest := filepath.Join(t.TempDir(), "Clavis.exe")
	err := DownloadWithRetries(context.Background(),
		[]*http.Client{deadProxy, srv.Client()}, srv.URL, dest, int64(len(payload)), nil)
	if err != nil {
		t.Fatal(err)
	}
	if n := requests.Load(); n != 1 {
		t.Fatalf("server saw %d requests, want 1 (only the direct attempt)", n)
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) {
		t.Error("downloaded content differs")
	}
}

// Persistent 5xx answers are retried exactly downloadAttempts times, then
// give up with the attempt count in the error — and leave no .part behind.
func TestDownloadWithRetriesGivesUp(t *testing.T) {
	noBackoff(t)
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "Clavis.exe")
	err := DownloadWithRetries(context.Background(), []*http.Client{srv.Client()}, srv.URL, dest, 128, nil)
	if err == nil || !strings.Contains(err.Error(), "after 4 tries") || !strings.Contains(err.Error(), "500") {
		t.Fatalf("want give-up error with attempt count and status, got %v", err)
	}
	if n := requests.Load(); n != downloadAttempts {
		t.Errorf("server saw %d requests, want %d", n, downloadAttempts)
	}
	if _, err := os.Stat(partPath(dest)); !os.IsNotExist(err) {
		t.Error(".part left behind after give-up")
	}
	if _, err := os.Stat(metaPath(dest)); !os.IsNotExist(err) {
		t.Error(".part.meta left behind after give-up")
	}
}

// A 404 is a definite answer: one attempt, no retry, parts cleaned.
func TestDownloadWithRetriesFatal404(t *testing.T) {
	noBackoff(t)
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "Clavis.exe")
	err := DownloadWithRetries(context.Background(), []*http.Client{srv.Client()}, srv.URL, dest, 128, nil)
	if err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("want 404 error, got %v", err)
	}
	if n := requests.Load(); n != 1 {
		t.Errorf("server saw %d requests, want 1 (404 is not retried)", n)
	}
	if _, err := os.Stat(partPath(dest)); !os.IsNotExist(err) {
		t.Error(".part left behind after a fatal status")
	}
}

// A .part guarded by a meta for a DIFFERENT artifact must be discarded, never
// resumed: the request goes out without a Range header and the file is served
// whole.
func TestDownloadDiscardsStalePart(t *testing.T) {
	noBackoff(t)
	payload := make([]byte, 300<<10)
	for i := range payload {
		payload[i] = byte(i * 7)
	}
	var sawRange atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Range") != "" {
			sawRange.Store(true)
		}
		w.Write(payload)
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "Clavis.exe")
	os.WriteFile(partPath(dest), make([]byte, 4096), 0o644) // junk from another version
	writePartMeta(dest, "https://github.com/assadigit/Clavis/releases/download/v9.9.9/Clavis-Portable-9.9.9.exe", 4096)

	if err := DownloadWithRetries(context.Background(), []*http.Client{srv.Client()}, srv.URL, dest, int64(len(payload)), nil); err != nil {
		t.Fatal(err)
	}
	if sawRange.Load() {
		t.Error("stale .part must not produce a Range request")
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	sampleCheck(t, got, payload)
}

// A complete .part (download finished, swap previously blocked) is finished
// without touching the network again.
func TestDownloadCompletesWithoutRefetch(t *testing.T) {
	noBackoff(t)
	payload := []byte("a fully downloaded update that never got renamed")
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusInternalServerError) // any request would fail
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "Clavis.exe")
	os.WriteFile(partPath(dest), payload, 0o644)
	writePartMeta(dest, srv.URL, int64(len(payload)))

	if err := DownloadWithRetries(context.Background(), []*http.Client{srv.Client()}, srv.URL, dest, int64(len(payload)), nil); err != nil {
		t.Fatal(err)
	}
	if n := requests.Load(); n != 0 {
		t.Errorf("server saw %d requests, want 0 (part was already complete)", n)
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) {
		t.Error("content differs")
	}
}

// A server that ignores Range (answers 200 to everything) forces a clean
// restart: the final file is the whole payload, not a stitched mix.
func TestDownloadRestartsWhenServerIgnoresRange(t *testing.T) {
	noBackoff(t)
	payload := make([]byte, 300<<10)
	for i := range payload {
		payload[i] = byte(i * 3)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(payload) // 200, full body, Range ignored
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "Clavis.exe")
	os.WriteFile(partPath(dest), payload[:100_000], 0o644) // compatible partial
	writePartMeta(dest, srv.URL, int64(len(payload)))

	if err := DownloadWithRetries(context.Background(), []*http.Client{srv.Client()}, srv.URL, dest, int64(len(payload)), nil); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	sampleCheck(t, got, payload)
}

func TestRetryableClassification(t *testing.T) {
	cases := []struct {
		err  error
		want bool
	}{
		{&statusError{code: 500}, true},
		{&statusError{code: 503}, true},
		{&statusError{code: 429}, true},
		{&statusError{code: 408}, true},
		{&statusError{code: 404}, false},
		{&statusError{code: 403}, false},
		{fmt.Errorf("wrap: %w", errSizeMismatch), true},
		{fmt.Errorf("swap: %w", errRenameBlocked), true},
		{&fs.PathError{Op: "open", Path: "x", Err: errors.New("disk")}, false},
		{context.Canceled, false},
		// The per-attempt budget expiring inside the transport is retryable
		// (the overall budget is checked by the retry loop itself).
		{fmt.Errorf("Get %q: %w", "https://x", context.DeadlineExceeded), true},
		{errors.New("net/http: TLS handshake timeout"), true},
		{errors.New("unexpected EOF"), true},
	}
	for _, c := range cases {
		if got := retryable(c.err); got != c.want {
			t.Errorf("retryable(%v) = %v, want %v", c.err, got, c.want)
		}
	}
}

// The overall budget expiring mid-flight stops the loop without another
// attempt and without the "after N tries" wrapper.
func TestDownloadWithRetriesStopsOnOverallDeadline(t *testing.T) {
	noBackoff(t)
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		time.Sleep(300 * time.Millisecond) // slower than the budget below
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()
	dest := filepath.Join(t.TempDir(), "Clavis.exe")
	err := DownloadWithRetries(ctx, []*http.Client{srv.Client()}, srv.URL, dest, 128, nil)
	if err == nil || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("want overall-deadline error, got %v", err)
	}
	if n := requests.Load(); n != 1 {
		t.Errorf("server saw %d requests, want 1 (the budget stops the loop)", n)
	}
}
