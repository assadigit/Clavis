/**
 * CLAVIS — OS integration helpers (transparency detection, cursor, folder
 * opening, install-dir lookup). Windows implementations live in the _windows.go files; other
 * platforms get safe stubs so the core stays testable on any host.
 */
package system

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
