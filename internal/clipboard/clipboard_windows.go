//go:build windows

/**
 * CLAVIS — Win32 clipboard implementation (SPEC §5.2).
 *
 * Pure syscalls: OpenClipboard → EmptyClipboard → SetClipboardData for
 * CF_UNICODETEXT plus the three privacy formats when the payload is secret.
 *
 * The locked GlobalAlloc block is filled through MultiByteToWideChar, which
 * takes the destination as a raw pointer ARGUMENT — the Win32 pointer stays
 * a uintptr end to end and is never converted to unsafe.Pointer. (That
 * conversion is exactly what go vet's unsafeptr check flags, and it has no
 * provably-safe spelling for syscall results; see unsafe's rule (4).)
 *
 * Privacy values per Microsoft Learn, "Clipboard Formats":
 *   ExcludeClipboardContentFromMonitorProcessing — any data present;
 *   CanIncludeInClipboardHistory  = 0 (exclude from Win+V history);
 *   CanUploadToCloudClipboard     = 0 (exclude from cloud sync).
 *
 * Fail-closed (SC-10): if a secret payload is placed but a privacy format
 * cannot be set, the clipboard is emptied again and the copy reports
 * failure — a secret must never land in history unprotected.
 */
package clipboard

import (
	"errors"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	cfUnicodeText = 13
	gmemMoveable  = 0x0002
	cpUtf8        = 65001
)

var (
	user32               = windows.NewLazySystemDLL("user32.dll")
	kernel32             = windows.NewLazySystemDLL("kernel32.dll")
	procOpenClipboard    = user32.NewProc("OpenClipboard")
	procCloseClipboard   = user32.NewProc("CloseClipboard")
	procEmptyClipboard   = user32.NewProc("EmptyClipboard")
	procSetClipboardData = user32.NewProc("SetClipboardData")
	procRegisterFormat   = user32.NewProc("RegisterClipboardFormatW")
	procGlobalAlloc      = kernel32.NewProc("GlobalAlloc")
	procGlobalLock       = kernel32.NewProc("GlobalLock")
	procGlobalUnlock     = kernel32.NewProc("GlobalUnlock")
	procGlobalFree       = kernel32.NewProc("GlobalFree")
	procMBToWC           = kernel32.NewProc("MultiByteToWideChar")
)

// privacyFormats are the registered formats that keep secrets out of
// clipboard history, cloud sync and monitor processing (values verified
// against Microsoft Learn — see the file header).
var privacyFormats = []struct {
	name  string
	value uint32
}{
	{"ExcludeClipboardContentFromMonitorProcessing", 1},
	{"CanIncludeInClipboardHistory", 0},
	{"CanUploadToCloudClipboard", 0},
}

func openClipboardWithRetry() bool {
	// Another app may briefly hold the clipboard; retry for ~100 ms.
	for i := 0; i < 10; i++ {
		ret, _, _ := procOpenClipboard.Call(0)
		if ret != 0 {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return false
}

func registerFormat(name string) uint32 {
	p, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return 0
	}
	ret, _, _ := procRegisterFormat.Call(uintptr(unsafe.Pointer(p)))
	return uint32(ret)
}

// utf16IntoBlock converts src (UTF-8, NUL-terminated by the caller) into the
// locked block at p and reports whether exactly cch units were written.
// p remains a uintptr throughout; the source pointer follows unsafe rule
// (4): unsafe.Pointer → uintptr directly inside the call arguments.
func utf16IntoBlock(p uintptr, src []byte, cch int) bool {
	written, _, _ := procMBToWC.Call(
		cpUtf8,
		0, // invalid sequences become U+FFFD; the call never fails on them
		uintptr(unsafe.Pointer(&src[0])),
		uintptr(len(src)),
		p,
		uintptr(cch),
	)
	return int(written) == cch
}

// allocBlock allocates a GMEM_MOVEABLE block, locks it, fills it with the
// UTF-16 rendering of src, and unlocks it. It returns the handle the
// clipboard takes ownership of. On any failure the block is freed again.
func allocBlock(src []byte) (windows.Handle, error) {
	// First pass: ask the API how many UTF-16 units the source needs
	// (cchWideChar = 0). The API is the single source of truth for the size.
	need, _, _ := procMBToWC.Call(
		cpUtf8, 0,
		uintptr(unsafe.Pointer(&src[0])), uintptr(len(src)),
		0, 0,
	)
	if need == 0 {
		return 0, errors.New("MultiByteToWideChar sizing failed")
	}
	h, _, _ := procGlobalAlloc.Call(gmemMoveable, need*2)
	if h == 0 {
		return 0, errors.New("GlobalAlloc failed")
	}
	p, _, _ := procGlobalLock.Call(h)
	if p == 0 {
		procGlobalFree.Call(h)
		return 0, errors.New("GlobalLock failed")
	}
	ok := utf16IntoBlock(p, src, int(need))
	procGlobalUnlock.Call(h)
	if !ok {
		procGlobalFree.Call(h)
		return 0, errors.New("MultiByteToWideChar failed")
	}
	return windows.Handle(h), nil
}

// allocTextBlock builds the CF_UNICODETEXT block for text (trailing NUL
// included), byte-identical to the old utf16.Encode + terminator layout.
func allocTextBlock(text string) (windows.Handle, error) {
	src := make([]byte, 0, len(text)+1)
	src = append(src, text...)
	src = append(src, 0)
	return allocBlock(src)
}

// allocDwordBlock builds a 4-byte block holding the DWORD value v. The two
// UTF-16 units {v, 0} are exactly the little-endian bytes of v (v is 0 or 1).
func allocDwordBlock(v uint32) (windows.Handle, error) {
	return allocBlock([]byte{byte(v), 0})
}

func writeText(text string, excludeFromHistory bool) bool {
	hText, err := allocTextBlock(text)
	if err != nil {
		return false
	}
	if !openClipboardWithRetry() {
		procGlobalFree.Call(uintptr(hText))
		return false
	}
	defer procCloseClipboard.Call()

	if ret, _, _ := procEmptyClipboard.Call(); ret == 0 {
		procGlobalFree.Call(uintptr(hText))
		return false
	}
	r, _, _ := procSetClipboardData.Call(cfUnicodeText, uintptr(hText))
	if r == 0 {
		procGlobalFree.Call(uintptr(hText)) // the system owns it only on success
		return false
	}
	if !excludeFromHistory {
		return true
	}

	// Secret payload: every privacy format must be set. If any of them
	// fails, empty the clipboard again and report failure — the secret must
	// not sit in the history unprotected (SC-10 fail closed).
	for _, f := range privacyFormats {
		format := registerFormat(f.name)
		if format == 0 {
			procEmptyClipboard.Call()
			return false
		}
		hVal, err := allocDwordBlock(f.value)
		if err != nil {
			procEmptyClipboard.Call()
			return false
		}
		r, _, _ := procSetClipboardData.Call(uintptr(format), uintptr(hVal))
		if r == 0 {
			procGlobalFree.Call(uintptr(hVal))
			procEmptyClipboard.Call()
			return false
		}
	}
	return true
}
