//go:build !windows

/**
 * CLAVIS — exclusive data-folder lock, non-Windows (v1.4.1, DECISIONS.md §42).
 *
 * flock(2) on <dir>/clavis.lock, held for the store's lifetime. The OS
 * releases it when the process dies, so a crashed Clavis can never leave a
 * stale lock behind. A second store on the same folder — a second process,
 * or a test — gets a clear error after the retry window.
 */
package store

import (
	"fmt"
	"os"
	"syscall"
	"time"
)

// lockRetryWait is how long acquireDirLock keeps retrying before giving up:
// long enough to cover an update hand-off (old process exiting while the new
// one starts), short enough that a real double-launch fails fast.
const lockRetryWait = 5 * time.Second

func acquireDirLock(path string) (func(), error) {
	deadline := time.Now().Add(lockRetryWait)
	for {
		f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o644)
		if err != nil {
			return nil, fmt.Errorf("cannot create lock file: %w", err)
		}
		if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err == nil {
			return func() {
				_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
				_ = f.Close()
			}, nil
		}
		f.Close()
		if time.Now().After(deadline) {
			return nil, errDataFolderInUse
		}
		time.Sleep(200 * time.Millisecond)
	}
}
