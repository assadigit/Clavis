/**
 * CLAVIS — OS integration helpers (transparency detection, cursor, folder
 * opening, install-dir lookup). Windows implementations live in the _windows.go files; other
 * platforms get safe stubs so the core stays testable on any host.
 */
package system

import "unsafe"

// TransparencyEnabled reports whether Windows "Transparency effects" is on
// (§5.9: solid mode switches on automatically when it is off).
func TransparencyEnabled() bool { return transparencyEnabled() }

// CursorPoint returns the physical (pixel) cursor position.
func CursorPoint() (x, y int) { return cursorPoint() }

// OpenFolder opens a folder in Windows Explorer.
func OpenFolder(path string) error { return openFolder(path) }

// InstallDir returns the per-user install directory recorded by the NSIS
// installer (HKCU\Software\Clavis\InstallDir), or "" when Clavis was not
// installed (portable run).
func InstallDir() string { return installDir() }

// ForceForeground brings a window to the foreground even when Windows would
// normally refuse the switch (tray-click context). Wails' Focus() only calls
// SetForegroundWindow, which the foreground lock silently denies; this uses
// the classic AttachThreadInput recipe used by tray quick-launchers.
// hwnd is the native window handle (WebviewWindow.NativeWindow()); nil is a
// safe no-op. Non-Windows builds stub it out.
func ForceForeground(hwnd unsafe.Pointer) { forceForeground(hwnd) }
