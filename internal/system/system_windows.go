//go:build windows

/**
 * CLAVIS — Windows registry / cursor / shell integration.
 */
package system

import (
	"fmt"
	"os/exec"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// transparencyEnabled reads HKCU\…\Themes\Personalize\EnableTransparency.
// Missing value → assume enabled (the Windows default).
func transparencyEnabled() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER,
		`Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`,
		registry.QUERY_VALUE)
	if err != nil {
		return true
	}
	defer k.Close()
	v, _, err := k.GetIntegerValue("EnableTransparency")
	if err != nil {
		return true
	}
	return v != 0
}

type point struct{ X, Y int32 }

var (
	user32                    = windows.NewLazySystemDLL("user32.dll")
	kernel32                  = windows.NewLazySystemDLL("kernel32.dll")
	procGetCursorPos          = user32.NewProc("GetCursorPos")
	procGetForegroundWindow   = user32.NewProc("GetForegroundWindow")
	procGetWindowThreadProcId = user32.NewProc("GetWindowThreadProcessId")
	procGetCurrentThreadId    = kernel32.NewProc("GetCurrentThreadId")
	procAttachThreadInput     = user32.NewProc("AttachThreadInput")
	procSetForegroundWindow   = user32.NewProc("SetForegroundWindow")
	procBringWindowToTop      = user32.NewProc("BringWindowToTop")
	procSetFocus              = user32.NewProc("SetFocus")
)

// forceForeground elevates hwnd to the foreground window. Windows denies
// SetForegroundWindow when the caller is not the foreground process (the
// usual case after a tray click), which leaves the popup visible but deaf:
// no keyboard input ever reaches it. Attaching our thread to the current
// foreground thread's input queue satisfies the foreground-lock rules —
// the recipe used by tray quick-launchers such as PowerToys Run. Safe
// no-op for nil or when the window is already front.
func forceForeground(hwnd unsafe.Pointer) {
	if hwnd == nil {
		return
	}
	h := uintptr(hwnd)
	fore, _, _ := procGetForegroundWindow.Call()
	if fore == h {
		return
	}
	var pid uintptr
	foreThread, _, _ := procGetWindowThreadProcId.Call(fore, uintptr(unsafe.Pointer(&pid)))
	curThread, _, _ := procGetCurrentThreadId.Call()
	attached := false
	if foreThread != 0 && foreThread != curThread {
		ret, _, _ := procAttachThreadInput.Call(curThread, foreThread, 1)
		attached = ret != 0
	}
	_, _, _ = procSetForegroundWindow.Call(h)
	_, _, _ = procBringWindowToTop.Call(h)
	_, _, _ = procSetFocus.Call(h)
	if attached {
		_, _, _ = procAttachThreadInput.Call(curThread, foreThread, 0)
	}
}

func cursorPoint() (int, int) {
	var pt point
	ret, _, _ := procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	if ret == 0 {
		return 0, 0
	}
	return int(pt.X), int(pt.Y)
}

func openFolder(path string) error {
	cmd := exec.Command("explorer.exe", path)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("could not open the folder: %w", err)
	}
	return nil
}

// installDir reads HKCU\Software\Clavis\InstallDir (written by the NSIS
// installer). Empty string = portable run / fresh machine.
func installDir() string {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Clavis`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	v, _, err := k.GetStringValue("InstallDir")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(v)
}

// openURL hands an http(s) link to the default browser through the shell.
// rundll32's FileProtocolHandler is the classic, dependency-free way to
// open a URL with zero quoting pitfalls (no cmd.exe involved).
func openURL(rawURL string) error {
	cmd := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", rawURL)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("could not open the link: %w", err)
	}
	return nil
}
