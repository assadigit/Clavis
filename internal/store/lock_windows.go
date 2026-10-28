//go:build windows

/**
 * CLAVIS — exclusive data-folder lock, Windows (v1.4.1, DECISIONS.md §42).
 *
 * LockFileEx over <dir>\clavis.lock (one byte at offset 0 is enough — the
 * file has no content), held for the store's lifetime. Windows releases the
 * lock when the process dies, so a crashed Clavis can never leave a stale
 * lock behind. A second store on the same folder gets a clear error after
 * the retry window.
 *
 * The handle is opened with FILE_SHARE_DELETE so the lock file can be
 * deleted while held (tests run inside t.TempDir() folders that Go removes
 * at test end; without delete-sharing every Windows test failed cleanup).
 * Mutual exclusion itself comes from the byte-range lock, which keeps
 * working on a deleted-but-open stream; if something ever removes the lock
 * file mid-run, Wails' single-instance mutex (checked before the store is
 * even opened) is still the first line of defense.
 */
package store

import (
	"fmt"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
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
	path16, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, fmt.Errorf("cannot create lock file: %w", err)
	}
	for {
		h, err := windows.CreateFile(
			path16,
			windows.GENERIC_READ|windows.GENERIC_WRITE,
			windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
			nil,
			windows.OPEN_ALWAYS,
			windows.FILE_ATTRIBUTE_NORMAL,
			0,
		)
		if err != nil {
			return nil, fmt.Errorf("cannot create lock file: %w", err)
		}
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
				_ = windows.CloseHandle(h)
			}, nil
		}
		_ = windows.CloseHandle(h)
		if time.Now().After(deadline) {
			return nil, errDataFolderInUse
		}
		time.Sleep(200 * time.Millisecond)
	}
}
