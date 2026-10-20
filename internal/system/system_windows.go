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
	user32           = windows.NewLazySystemDLL("user32.dll")
	procGetCursorPos = user32.NewProc("GetCursorPos")
)

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
