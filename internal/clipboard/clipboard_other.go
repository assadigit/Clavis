//go:build !windows

/**
 * CLAVIS — clipboard stub for non-Windows development builds.
 * The real implementation lives in clipboard_windows.go.
 */
package clipboard

func writeText(text string, excludeFromHistory bool) bool {
	return false // not supported outside Windows
}
