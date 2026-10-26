/**
 * CLAVIS — self-update shell (DECISIONS.md §34): check, download,
 * hand-off script, relaunch. Data in %APPDATA%\Clavis is never touched.
 */
package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"clavis/internal/service"
	"clavis/internal/system"
	"clavis/internal/updater"
)

/* ------------------------- self-update (DECISIONS.md §34) ------------------------- */

const (
	updateCheckTimeout    = 15 * time.Second
	updateDownloadTimeout = 10 * time.Minute
	updateCacheTTL        = 30 * time.Minute // successful check reuse window
	updateAutoInterval    = 12 * time.Hour   // background auto-check cadence
)

// updateEnvelope is what the frontend receives for a check.
type updateEnvelope struct {
	Ok          bool   `json:"ok"`
	Error       string `json:"error,omitempty"`
	Current     string `json:"current"`
	Latest      string `json:"latest"`
	Available   bool   `json:"available"`
	Notes       string `json:"notes"`
	URL         string `json:"url"`
	Mode        string `json:"mode"`
	Installable bool   `json:"installable"`
	CheckedAt   string `json:"checkedAt"`
}

// exePath returns the running executable path ("" when unknown).
func exePath() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		return resolved
	}
	return exe
}

// updateMode classifies this run as installed vs portable.
func updateMode() updater.Mode {
	if runtime.GOOS != "windows" {
		return updater.ModePortable // dev/server mode: never registry-match
	}
	return updater.DetectMode(exePath(), system.InstallDir())
}

// updateInstallable says whether the silent swap can run here.
func updateInstallable() bool {
	return runtime.GOOS == "windows"
}

// checkUpdateLocked runs a live check (no cache). Caller holds upMu.
func (c *Clavis) checkUpdateLocked() (updater.Status, error) {
	st, err := updater.Check(updater.HTTPGetter(updateCheckTimeout), AppVersion)
	if err != nil {
		c.upLastAt, c.upLastOK = time.Now(), false
		return st, err
	}
	c.upLastAt, c.upLastOK = time.Now(), true
	c.upStatus = &st
	return st, nil
}

// CheckUpdate is the frontend entry point. Serves the cached status when
// fresh (< 30 min) so re-opening Settings is instant and offline-friendly.
func (c *Clavis) CheckUpdate(force bool) updateEnvelope {
	c.upMu.Lock()
	defer c.upMu.Unlock()

	if !force && c.upStatus != nil && c.upLastOK && time.Since(c.upLastAt) < updateCacheTTL {
		return envelopeOf(*c.upStatus, updateMode(), updateInstallable())
	}

	st, err := c.checkUpdateLocked()
	if err != nil {
		return updateEnvelope{
			Ok:      false,
			Error:   "Could not reach GitHub right now. Try again in a minute, or open the releases page.",
			Current: AppVersion,
			Mode:    string(updateMode()),
		}
	}
	return envelopeOf(st, updateMode(), updateInstallable())
}

// envelopeOf converts a Status for the frontend.
func envelopeOf(s updater.Status, mode updater.Mode, installable bool) updateEnvelope {
	return updateEnvelope{
		Ok:          true,
		Current:     s.Current,
		Latest:      s.Latest,
		Available:   s.Available,
		Notes:       s.Release.Notes,
		URL:         s.Release.URL,
		Mode:        string(mode),
		Installable: installable,
		CheckedAt:   time.Now().UTC().Format(time.RFC3339),
	}
}

// AutoCheckIfDue runs the background auto-check at most once per 12h and
// notifies the Manager when a newer release exists (DECISIONS.md §34:
// explicit user opt-in feature; pull-only network use).
func (c *Clavis) AutoCheckIfDue() {
	c.upMu.Lock()
	if c.upBusy || time.Now().Before(c.upNextAuto) {
		c.upMu.Unlock()
		return
	}
	c.upNextAuto = time.Now().Add(updateAutoInterval)
	_, err := c.checkUpdateLocked()
	status := c.upStatus
	c.upMu.Unlock()

	if err != nil {
		return // silent: background checks never nag on network hiccups
	}
	if status != nil && status.Available && c.app != nil {
		c.app.Event.Emit("clavis:update-available", map[string]any{
			"current": status.Current,
			"latest":  status.Latest,
			"url":     status.Release.URL,
			"notes":   status.Release.Notes,
		})
	}
}

// InstallUpdate downloads the matching artifact and performs the in-place
// swap. Data in %APPDATA%\Clavis is never touched. The frontend polls
// CheckUpdate during the download for progress events.
func (c *Clavis) InstallUpdate() map[string]any {
	if runtime.GOOS != "windows" {
		return service.Fail("Self-update only works in the packaged Windows app. Use the download buttons instead.", 400)
	}

	c.upMu.Lock()
	if c.upBusy {
		c.upMu.Unlock()
		return service.Fail("An update is already in progress.", 409)
	}
	st := c.upStatus
	if st == nil {
		fresh, err := c.checkUpdateLocked()
		if err != nil {
			c.upMu.Unlock()
			return service.Fail("Could not reach GitHub for the download.", 502)
		}
		st = &fresh
	}
	if !st.Available {
		c.upMu.Unlock()
		return service.Fail("You already have the latest version.", 400)
	}
	c.upBusy = true
	c.upMu.Unlock()

	defer func() {
		c.upMu.Lock()
		c.upBusy = false
		c.upMu.Unlock()
	}()

	exe := exePath()
	if exe == "" {
		return service.Fail("Could not locate the running Clavis.exe.", 500)
	}
	mode := updateMode()
	emit := func(stage string, pct float64) {
		if c.app != nil {
			c.app.Event.Emit("clavis:update-progress", map[string]any{
				"stage": stage,
				"pct":   pct,
			})
		}
	}
	emit("starting", 0)

	client := &http.Client{Timeout: updateDownloadTimeout}
	var url, dest string
	var size int64

	if mode == updater.ModeInstalled {
		url, size = st.Release.SetupURL, st.Release.SetupSize
		if url == "" {
			return service.Fail("The release has no installer asset. Use the release page instead.", 400)
		}
		dest = filepath.Join(os.TempDir(), fmt.Sprintf("Clavis-Setup-%s.exe", st.Latest))
	} else {
		url, size = st.Release.PortableURL, st.Release.PortableSize
		if url == "" {
			return service.Fail("The release has no portable asset. Use the release page instead.", 400)
		}
		dest = exe + ".new"
	}

	if err := updater.DownloadToFile(client, url, dest, size, func(r, total int64) {
		pct := 0.0
		if total > 0 {
			pct = float64(r) / float64(total) * 100
		}
		emit("downloading", pct)
	}); err != nil {
		os.Remove(dest)
		emit("failed", 0)
		return service.Fail("The download did not complete: "+err.Error(), 502)
	}
	emit("downloaded", 100)

	script := updater.ScriptPath(exe)
	if mode == updater.ModeInstalled {
		target := exe // setup installs to the registry dir; relaunch it
		if reg := system.InstallDir(); reg != "" {
			target = filepath.Join(reg, "Clavis.exe")
		}
		if err := os.WriteFile(script, []byte(updater.InstallerScript(dest, target)), 0o755); err != nil {
			os.Remove(dest)
			emit("failed", 0)
			return service.Fail("Could not write the updater script: "+err.Error(), 500)
		}
	} else {
		if err := os.WriteFile(script, []byte(updater.PortableScript(exe, exe+".new", updater.OldPath(exe))), 0o755); err != nil {
			os.Remove(dest)
			emit("failed", 0)
			return service.Fail("Could not write the updater script: "+err.Error(), 500)
		}
	}
	emit("installing", 100)

	// The hand-off: script waits for this process to exit, swaps, restarts.
	if err := updater.SpawnDetached("cmd.exe", "/c", script); err != nil {
		os.Remove(dest)
		os.Remove(script)
		emit("failed", 0)
		return service.Fail("Could not start the updater: "+err.Error(), 500)
	}

	// Give the frontend a beat to receive the final event, then quit.
	go func() {
		time.Sleep(1200 * time.Millisecond)
		c.QuitApp()
	}()
	return map[string]any{"ok": true, "restarting": true, "mode": string(mode)}
}

// OpenReleasePage opens the given URL in the default browser (fallback
// for non-Windows / manual downloads).
func (c *Clavis) OpenReleasePage(url string) bool {
	if c.app != nil {
		if err := c.app.Browser.OpenURL(url); err != nil {
			return false
		}
		return true
	}
	return false
}
