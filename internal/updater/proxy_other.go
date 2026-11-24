//go:build !windows

/**
 * CLAVIS — system-proxy stub for non-Windows build hosts / server mode.
 * Overridable in tests (proxy_test.go).
 */
package updater

// systemProxyURL: there is no Windows registry off Windows.
var systemProxyURL = func() string { return "" }
