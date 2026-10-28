//go:build !windows

/**
 * CLAVIS — non-Windows stubs (development builds only).
 */
package system

import "unsafe"

func transparencyEnabled() bool { return true }

func cursorPoint() (int, int) { return 0, 0 }

func openFolder(path string) error {
	return errUnsupported
}

func installDir() string { return "" }

func forceForeground(hwnd unsafe.Pointer) { _ = hwnd /* development builds only */ }

type sysErr string

func (e sysErr) Error() string { return string(e) }

const errUnsupported sysErr = "not supported outside Windows"

func openURL(rawURL string) error {
	_ = rawURL
	return errUnsupported
}
