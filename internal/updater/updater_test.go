/**
 * CLAVIS — self-update unit tests (pure logic; no network, no Windows).
 */
package updater

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseVersion(t *testing.T) {
	cases := []struct {
		in   string
		want [3]int
	}{
		{"1.0.0", [3]int{1, 0, 0}},
		{"v1.2.10", [3]int{1, 2, 10}},
		{"1.2", [3]int{1, 2, 0}},
		{" 2.0.1 ", [3]int{2, 0, 1}},
		{"1.0.2-beta", [3]int{1, 0, 2}},
		{"garbage", [3]int{0, 0, 0}},
	}
	for _, c := range cases {
		if got := ParseVersion(c.in); got != c.want {
			t.Errorf("ParseVersion(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestIsNewer(t *testing.T) {
	cases := []struct {
		current, latest string
		want            bool
	}{
		{"1.0.2", "1.0.3", true},
		{"1.0.2", "1.1", true},
		{"1.0.2", "2.0.0", true},
		{"1.0.2", "1.0.2", false},
		{"1.0.3", "1.0.2", false},
		{"1.0.2", "v1.0.10", true},
		{"1.10.0", "1.9.0", false},
	}
	for _, c := range cases {
		if got := IsNewer(c.current, c.latest); got != c.want {
			t.Errorf("IsNewer(%q, %q) = %v, want %v", c.current, c.latest, got, c.want)
		}
	}
}

const apiFixture = `{
  "tag_name": "v1.0.3",
  "html_url": "https://github.com/assadigit/Clavis/releases/tag/v1.0.3",
  "body": "## What's new\r\n\r\nSelf-update arrived.",
  "assets": [
    {"name": "BUILD_LOG.md", "size": 9919, "browser_download_url": "https://github.com/assadigit/Clavis/releases/download/v1.0.3/BUILD_LOG.md"},
    {"name": "Clavis-Portable-1.0.3.exe", "size": 13850112, "browser_download_url": "https://github.com/assadigit/Clavis/releases/download/v1.0.3/Clavis-Portable-1.0.3.exe"},
    {"name": "Clavis-Setup-1.0.3.exe", "size": 7662535, "browser_download_url": "https://github.com/assadigit/Clavis/releases/download/v1.0.3/Clavis-Setup-1.0.3.exe"}
  ]
}`

const atomFixture = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Release notes from Clavis</title>
  <entry>
    <title>Clavis 1.0.3 — self-update</title>
    <id>tag:github.com,2008:repository/999999999/v1.0.3</id>
    <link rel="alternate" type="text/html" href="https://github.com/assadigit/Clavis/releases/tag/v1.0.3"/>
    <content type="html">&lt;h2&gt;What&amp;#39;s new&lt;/h2&gt;&lt;p&gt;Self-update arrived&lt;/p&gt;</content>
  </entry>
</feed>`

func fixtureGetter(apiStatus int, apiBody string, atomStatus int, atomBody string) Getter {
	return func(url string) (int, []byte, error) {
		if strings.Contains(url, "api.github.com") {
			return apiStatus, []byte(apiBody), nil
		}
		return atomStatus, []byte(atomBody), nil
	}
}

func TestFetchLatestFromAPI(t *testing.T) {
	rel, err := FetchLatest(fixtureGetter(200, apiFixture, 500, ""))
	if err != nil {
		t.Fatal(err)
	}
	if rel.Tag != "v1.0.3" {
		t.Errorf("tag = %q", rel.Tag)
	}
	if rel.SetupURL == "" || !strings.Contains(rel.SetupURL, "Clavis-Setup-1.0.3.exe") {
		t.Errorf("setup url = %q", rel.SetupURL)
	}
	if rel.SetupSize != 7662535 {
		t.Errorf("setup size = %d", rel.SetupSize)
	}
	if rel.PortableURL == "" || rel.PortableSize != 13850112 {
		t.Errorf("portable = %q / %d", rel.PortableURL, rel.PortableSize)
	}
	if !strings.Contains(rel.Notes, "Self-update") {
		t.Errorf("notes = %q", rel.Notes)
	}
}

func TestFetchLatestAtomFallback(t *testing.T) {
	get := fixtureGetter(403, `{"message":"rate limit"}`, 200, atomFixture)
	rel, err := FetchLatest(get)
	if err != nil {
		t.Fatal(err)
	}
	if rel.Tag != "v1.0.3" {
		t.Errorf("tag = %q", rel.Tag)
	}
	if !strings.Contains(rel.SetupURL, "Clavis-Setup-1.0.3.exe") {
		t.Errorf("setup url = %q", rel.SetupURL)
	}
	if !strings.Contains(rel.PortableURL, "Clavis-Portable-1.0.3.exe") {
		t.Errorf("portable url = %q", rel.PortableURL)
	}
	if !strings.Contains(rel.Notes, "Self-update arrived") {
		t.Errorf("notes = %q (want html unescaped + tags stripped)", rel.Notes)
	}
	if !strings.Contains(rel.URL, "releases/tag/v1.0.3") {
		t.Errorf("url = %q", rel.URL)
	}
}

func TestFetchLatestBothFail(t *testing.T) {
	if _, err := FetchLatest(fixtureGetter(403, "", 404, "")); err == nil {
		t.Fatal("want error when both endpoints fail")
	}
}

func TestCheck(t *testing.T) {
	st, err := Check(fixtureGetter(200, apiFixture, 500, ""), "1.0.2")
	if err != nil {
		t.Fatal(err)
	}
	if !st.Available || st.Latest != "1.0.3" || st.Current != "1.0.2" {
		t.Errorf("status = %+v", st)
	}
	st, err = Check(fixtureGetter(200, apiFixture, 500, ""), "1.0.3")
	if err != nil {
		t.Fatal(err)
	}
	if st.Available {
		t.Errorf("same version must not be 'available': %+v", st)
	}
}

func TestDetectMode(t *testing.T) {
	// Built with filepath.Join so the suite runs on any build host while
	// exercising the production comparison semantics (Clean + EqualFold).
	install := filepath.Join("C", "Users", "a", "AppData", "Local", "Programs", "Clavis")
	exe := filepath.Join(install, "Clavis.exe")
	cases := []struct {
		exe, install string
		want         Mode
	}{
		{exe, install, ModeInstalled},
		{exe, install + string(os.PathSeparator), ModeInstalled},
		{filepath.Join("C", "Users", "a", "Downloads", "Clavis.exe"), install, ModePortable},
		{filepath.Join("C", "Users", "a", "Downloads", "Clavis.exe"), "", ModePortable},
	}
	for _, c := range cases {
		if got := DetectMode(c.exe, c.install); got != c.want {
			t.Errorf("DetectMode(%q, %q) = %v, want %v", c.exe, c.install, got, c.want)
		}
	}
}

func TestDownloadToFile(t *testing.T) {
	payload := make([]byte, 700<<10) // 700 KiB → exercises the 256 KiB progress gate
	for i := range payload {
		payload[i] = byte(i)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(payload) // chunked: no Content-Length → unknown total in the response
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "Clavis.exe")
	var calls int
	var lastR, lastT int64
	err := DownloadToFile(srv.Client(), srv.URL, dest, int64(len(payload)), func(r, total int64) {
		calls++
		lastR, lastT = r, total
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(payload) {
		t.Fatalf("downloaded %d bytes, want %d", len(got), len(payload))
	}
	for i := 0; i < len(got); i += 9973 {
		if got[i] != payload[i] {
			t.Fatalf("byte %d differs", i)
		}
	}
	if calls == 0 || lastR != int64(len(payload)) || lastT != int64(len(payload)) {
		t.Errorf("progress = %d calls, last %d/%d", calls, lastR, lastT)
	}
	if _, err := os.Stat(dest + ".part"); !os.IsNotExist(err) {
		t.Error(".part file left behind")
	}
}

func TestDownloadToFileSizeMismatch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("short"))
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "Clavis.exe")
	err := DownloadToFile(srv.Client(), srv.URL, dest, 4096, nil)
	if err == nil || !strings.Contains(err.Error(), "incomplete") {
		t.Fatalf("want size-mismatch error, got %v", err)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Error("mismatched download must not be renamed into place")
	}
}

func TestPortableScript(t *testing.T) {
	s := PortableScript(`C:\Apps\Clavis.exe`, `C:\Apps\Clavis.exe.new`, `C:\Apps\Clavis.exe.old`)
	for _, want := range []string{
		`move /y "C:\Apps\Clavis.exe" "C:\Apps\Clavis.exe.old"`,
		`move /y "C:\Apps\Clavis.exe.new" "C:\Apps\Clavis.exe"`,
		`start "" "C:\Apps\Clavis.exe"`,
		"tasklist",
		`del /f /q "%~f0"`,
	} {
		if !strings.Contains(s, want) {
			t.Errorf("script missing %q", want)
		}
	}
	if !strings.Contains(s, "\r\n") {
		t.Error("script must use CRLF line endings")
	}
}

func TestInstallerScript(t *testing.T) {
	s := InstallerScript(`C:\Users\a\AppData\Local\Temp\Clavis-Setup-1.0.3.exe`,
		`C:\Users\a\AppData\Local\Programs\Clavis\Clavis.exe`)
	for _, want := range []string{
		`start "" /wait "C:\Users\a\AppData\Local\Temp\Clavis-Setup-1.0.3.exe" /S`,
		`start "" "C:\Users\a\AppData\Local\Programs\Clavis\Clavis.exe"`,
		"tasklist",
	} {
		if !strings.Contains(s, want) {
			t.Errorf("script missing %q", want)
		}
	}
}

func TestCleanupOld(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "Clavis.exe")
	if err := os.WriteFile(exe, []byte("cur"), 0o755); err != nil {
		t.Fatal(err)
	}
	old := OldPath(exe)
	if err := os.WriteFile(old, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	CleanupOld(exe)
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatal(".old not cleaned")
	}
	if _, err := os.Stat(exe); err != nil {
		t.Fatal("CleanupOld must never touch the live exe")
	}
}
