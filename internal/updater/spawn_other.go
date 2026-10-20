//go:build !windows

/**
 * CLAVIS — detached spawn stub (non-Windows build hosts / server mode).
 * The self-update swap itself only exists on Windows; other platforms
 * get an explicit, honest error from InstallUpdate.
 */
package updater

import "errors"

// SpawnDetached is a Windows-only facility.
func SpawnDetached(path string, args ...string) error {
	return errors.New("self-update only runs in the packaged Windows app")
}
