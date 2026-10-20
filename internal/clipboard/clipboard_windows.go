//go:build windows

/**
 * CLAVIS — Win32 clipboard implementation (SPEC §5.2).
 *
 * Pure syscalls: OpenClipboard → EmptyClipboard → SetClipboardData for
 * CF_UNICODETEXT plus the three privacy formats when the payload is secret.
 */
package clipboard

import (
	"fmt"
	"time"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	cfUnicodeText = 13
	gmemMoveable  = 0x0002
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
)

// privacyFormats are registered formats that keep secrets out of clipboard
// history, cloud sync and monitor processing.
var privacyFormats = []string{
	"ExcludeClipboardContentFromMonitorProcessing",
	"CanIncludeInClipboardHistory",
	"CanUploadToCloudClipboard",
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

func globalAllocDword(value uint32) (windows.Handle, error) {
	h, _, _ := procGlobalAlloc.Call(gmemMoveable, unsafe.Sizeof(value))
	if h == 0 {
		return 0, fmt.Errorf("GlobalAlloc failed")
	}
	p, _, _ := procGlobalLock.Call(h)
	if p == 0 {
		return 0, fmt.Errorf("GlobalLock failed")
	}
	*(*uint32)(unsafe.Pointer(p)) = value
	procGlobalUnlock.Call(h)
	return windows.Handle(h), nil
}

func globalAllocText(text string) (windows.Handle, error) {
	utf16Units := utf16.Encode([]rune(text))
	byteLen := (len(utf16Units) + 1) * 2
	h, _, _ := procGlobalAlloc.Call(gmemMoveable, uintptr(byteLen))
	if h == 0 {
		return 0, fmt.Errorf("GlobalAlloc failed")
	}
	p, _, _ := procGlobalLock.Call(h)
	if p == 0 {
		return 0, fmt.Errorf("GlobalLock failed")
	}
	dst := (*[1 << 28]uint16)(unsafe.Pointer(p))
	copy(dst[:], utf16Units)
	dst[len(utf16Units)] = 0
	procGlobalUnlock.Call(h)
	return windows.Handle(h), nil
}

func writeText(text string, excludeFromHistory bool) bool {
	hText, err := globalAllocText(text)
	if err != nil {
		return false
	}
	if !openClipboardWithRetry() {
		return false
	}
	defer procCloseClipboard.Call()

	ret, _, _ := procEmptyClipboard.Call()
	if ret == 0 {
		return false
	}
	r, _, _ := procSetClipboardData.Call(cfUnicodeText, uintptr(hText))
	if r == 0 {
		return false
	}
	if excludeFromHistory {
		// "ExcludeClipboardContentFromMonitorProcessing" is presence/value
		// based → 1. The two "Can*" formats opt out with the value 0.
		values := []uint32{1, 0, 0}
		for i, name := range privacyFormats {
			format := registerFormat(name)
			if format == 0 {
				continue
			}
			hVal, err := globalAllocDword(values[i])
			if err != nil {
				continue
			}
			procSetClipboardData.Call(uintptr(format), uintptr(hVal))
		}
	}
	return true
}
