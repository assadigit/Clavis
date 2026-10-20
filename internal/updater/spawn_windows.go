//go:build windows

/**
 * CLAVIS — detached process spawn (update hand-off). DETACHED_PROCESS so
 * no console window flashes; CREATE_NEW_PROCESS_GROUP + breakaway so the
 * helper survives when Clavis quits right after.
 */
package updater

import (
	"fmt"
	"os/exec"
	"syscall"
)

const (
	detachedProcess        = 0x00000008
	createNewProcessGrp    = 0x00000200
	createBreakawayFromJob = 0x01000000
)

// SpawnDetached launches a command that keeps running after this process
// exits (used for the .clavis-update.cmd hand-off). The child's handle is
// released immediately — never Wait() on it.
func SpawnDetached(path string, args ...string) error {
	cmd := exec.Command(path, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: detachedProcess | createNewProcessGrp | createBreakawayFromJob,
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("spawn %s: %w", path, err)
	}
	if cmd.Process != nil {
		_ = cmd.Process.Release()
	}
	return nil
}
