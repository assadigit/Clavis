//go:build windows

/**
 * CLAVIS — exclusive data-folder lock, Windows (v1.4.1, DECISIONS.md §42).
 *
 * LockFileEx over <dir>\clavis.lock (one byte at offset 0 is enough — the
 * file has no content), held for the store's lifetime. Windows releases the
 * lock when the process dies, so a crashed Clavis can never leave a stale
 * lock behind. A second store on the same folder gets a clear error after
 * the retry window.
 */
package store

import (
	"fmt"
	"os"
	"syscall"
	"time"
	"unsafe"
)

// lockRetryWait is how long acquireDirLock keeps retrying before giving up:
// long enough to cover an update hand-off (old process exiting while the new
// one starts), short enough that a real double-launch fails fast.
const lockRetryWait = 5 * time.Second

const (
	lockfileFailImmediately = 0x00000001
	lockfileExclusive       = 0x00000002
)

var (
	kernel32         = syscall.NewLazyDLL("kernel32.dll")
	procLockFileEx   = kernel32.NewProc("LockFileEx")
	procUnlockFileEx = kernel32.NewProc("UnlockFileEx")
)

func acquireDirLock(path string) (func(), error) {
	deadline := time.Now().Add(lockRetryWait)
	for {
		f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o644)
		if err != nil {
			return nil, fmt.Errorf("cannot create lock file: %w", err)
		}
		h := syscall.Handle(f.Fd())
		var ov syscall.Overlapped
		r1, _, _ := procLockFileEx.Call(
			uintptr(h),
			lockfileFailImmediately|lockfileExclusive,
			0,
			1, 0, // lock 1 byte at offset 0
			uintptr(unsafe.Pointer(&ov)),
		)
		if r1 != 0 {
			return func() {
				var uov syscall.Overlapped
				procUnlockFileEx.Call(uintptr(h), 0, 1, 0, uintptr(unsafe.Pointer(&uov)))
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
