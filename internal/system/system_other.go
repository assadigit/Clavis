//go:build !windows

/**
 * CLAVIS — non-Windows stubs (development builds only).
 */
package system

func transparencyEnabled() bool { return true }

func cursorPoint() (int, int) { return 0, 0 }

func openFolder(path string) error {
	return errUnsupported
}

func installDir() string { return "" }

type sysErr string

func (e sysErr) Error() string { return string(e) }

const errUnsupported sysErr = "not supported outside Windows"
