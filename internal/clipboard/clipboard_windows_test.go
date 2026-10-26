//go:build windows

/**
 * CLAVIS — Win32 clipboard end-to-end tests.
 *
 * These run ONLY on Windows (CI: windows-latest) and verify the app's core
 * security promise for real: a secret write puts CF_UNICODETEXT on the
 * clipboard AND sets the three §5.2 privacy formats with the documented
 * values; a non-secret write sets none of them.
 *
 * Reading back uses the mirror image of the writer (GetClipboardData +
 * GlobalLock + WideCharToMultiByte), so these tests contain no
 * uintptr→unsafe.Pointer conversions either — go vet stays clean.
 *
 * NOTE: every LazyProc.Call passes the FULL argument list of the Win32
 * function — a short argument list leaves the callee reading (and possibly
 * writing) an uninitialized stack slot, which crashed the first CI run.
 */
package clipboard

import (
	"strings"
	"testing"
	"unsafe"
)

var (
	procGetClipboardData  = user32.NewProc("GetClipboardData")
	procIsClipboardFormat = user32.NewProc("IsClipboardFormatAvailable")
	procWC2MB             = kernel32.NewProc("WideCharToMultiByte")
)

// clipboardText opens the clipboard and returns the current CF_UNICODETEXT
// content as a Go string (closing the clipboard again).
func clipboardText(t *testing.T) string {
	t.Helper()
	if !openClipboardWithRetry() {
		t.Fatal("could not open the clipboard")
	}
	defer procCloseClipboard.Call()

	h, _, _ := procGetClipboardData.Call(cfUnicodeText)
	if h == 0 {
		t.Fatal("no CF_UNICODETEXT on the clipboard")
	}
	p, _, _ := procGlobalLock.Call(h)
	if p == 0 {
		t.Fatal("GlobalLock failed")
	}
	defer procGlobalUnlock.Call(h)

	// Sizing pass (cbMultiByte = 0). WideCharToMultiByte has EIGHT
	// parameters; every one is passed, the last two as NULL.
	need, _, _ := procWC2MB.Call(cpUtf8, 0, p, ^uintptr(0), 0, 0, 0, 0)
	if need == 0 {
		t.Fatal("WideCharToMultiByte sizing failed")
	}
	buf := make([]byte, need)
	written, _, _ := procWC2MB.Call(cpUtf8, 0, p, ^uintptr(0),
		uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)), 0, 0)
	if written == 0 {
		t.Fatal("WideCharToMultiByte failed")
	}
	return string(buf[:written-1]) // strip the terminating NUL
}

// formatValue opens the clipboard and reads the DWORD stored for a
// registered format. The writer stores the two UTF-16 units {v, 0};
// converting them back yields the bytes {v, 0}.
func formatValue(t *testing.T, format uint32) byte {
	t.Helper()
	if !openClipboardWithRetry() {
		t.Fatal("could not open the clipboard")
	}
	defer procCloseClipboard.Call()

	h, _, _ := procGetClipboardData.Call(uintptr(format))
	if h == 0 {
		t.Fatal("format not on the clipboard")
	}
	p, _, _ := procGlobalLock.Call(h)
	if p == 0 {
		t.Fatal("GlobalLock failed")
	}
	defer procGlobalUnlock.Call(h)

	buf := make([]byte, 4)
	written, _, _ := procWC2MB.Call(cpUtf8, 0, p, 2,
		uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)), 0, 0)
	if written < 2 {
		t.Fatal("WideCharToMultiByte failed")
	}
	return buf[0]
}

// formatAvailable reports whether a registered format is on the clipboard.
func formatAvailable(format uint32) (available bool) {
	if !openClipboardWithRetry() {
		return false
	}
	defer procCloseClipboard.Call()
	ret, _, _ := procIsClipboardFormat.Call(uintptr(format))
	return ret != 0
}

func TestWriteTextRoundTrip(t *testing.T) {
	cases := []string{
		"hello world",
		"", // empty
		"ghp_secret_with \"quotes\" \\ and\nnewlines\r\nCRLF", // dotenv-hostile
		"توکن فارسی",                 // Farsi (RTL)
		"emoji 🎉🚀 astral pair",       // surrogate pairs
		strings.Repeat("x", 100_000), // large payload
	}
	for _, want := range cases {
		if !WriteText(want, false) {
			t.Fatalf("WriteText(%q) failed", truncate(want))
		}
		if got := clipboardText(t); got != want {
			t.Fatalf("round trip: got %q, want %q", truncate(got), truncate(want))
		}
		// A non-secret write must NOT carry any privacy format.
		for _, f := range privacyFormats {
			if format := registerFormat(f.name); format != 0 && formatAvailable(format) {
				t.Fatalf("non-secret write must not set %s", f.name)
			}
		}
	}
}

func TestWriteTextSecretSetsPrivacyFormats(t *testing.T) {
	if !WriteText("ghp_supersecret", true) {
		t.Fatal("secret WriteText failed")
	}
	if got := clipboardText(t); got != "ghp_supersecret" {
		t.Fatalf("text = %q", got)
	}
	for _, f := range privacyFormats {
		format := registerFormat(f.name)
		if format == 0 {
			t.Fatalf("RegisterClipboardFormat(%s) failed", f.name)
		}
		if !formatAvailable(format) {
			t.Fatalf("%s missing after a secret write", f.name)
		}
		if got, want := formatValue(t, format), byte(f.value); got != want {
			t.Fatalf("%s value = %d, want %d", f.name, got, want)
		}
	}
}

func truncate(s string) string {
	if len(s) > 40 {
		return s[:40] + "…"
	}
	return s
}
