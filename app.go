/**
 * CLAVIS — the Wails shell (SPEC §3, §5): windows, tray, hotkey,
 * dialogs and self-update. The pure action dispatcher lives in
 * internal/service and is delegated to (GetState/Dispatch).
 *
 * Exposes the store to the frontend through Call.ByName("main.Clavis.*"):
 *   GetState()                         → full snapshot (+ osTransparency)
 *   Dispatch(action, payloadJSON)      → the action dispatcher (mirrors the
 *                                         reference API one-to-one)
 *   WriteClipboard(text, secret)       → clipboard with privacy formats
 *   ExportSave(what, id)               → save-dialog export
 *   ExportAllMarkdown()                → folder-picker export
 *   PickImportFolder()                 → folder-picker import (.md/.txt)
 *   OpenDataFolder()                   → Explorer
 *   HidePopup/ShowManager/…            → window controls
 *   PauseShortcut/ResumeShortcut       → tray parity
 *   CheckUpdate/InstallUpdate          → self-update (DECISIONS.md §34)
 * SECURITY: item values are never logged; dialogs carry file names only.
 */
package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"clavis/internal/clipboard"
	"clavis/internal/service"
	"clavis/internal/store"
	"clavis/internal/system"
	"clavis/internal/updater"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// AppVersion is embedded in the exe and written into the data file.
const AppVersion = "1.1.4"

// shortcutTakenMessage is the §3.3 conflict message.
const shortcutTakenMessage = "This shortcut is used by another app. Choose a different one."

// stateEnvelope is the state snapshot plus the OS transparency flag (§5.9).
type stateEnvelope struct {
	store.State
	OSTransparency bool `json:"osTransparency"`
}

// Clavis is the bound service. Runtime pieces are wired by main().
type Clavis struct {
	app     *application.App
	core    *service.Service
	popup   *application.WebviewWindow
	manager *application.WebviewWindow
	tray    *application.SystemTray

	hkMu         sync.Mutex
	hkPaused     bool
	currentCombo string

	popupMu   sync.Mutex
	popupSize [2]int

	upMu       sync.Mutex
	upStatus   *updater.Status
	upBusy     bool
	upLastAt   time.Time
	upLastOK   bool
	upNextAuto time.Time
}

// SetRuntime wires the Wails objects (called from main before Run).
func (c *Clavis) SetRuntime(app *application.App, popup, manager *application.WebviewWindow, tray *application.SystemTray) {
	c.app = app
	c.popup = popup
	c.manager = manager
	c.tray = tray
}

/* ------------------------- dispatcher (pure core) ------------------------- */

// GetState returns the full snapshot for the frontend (delegates to the
// pure core so the whole action surface stays testable without Windows).
func (c *Clavis) GetState() service.StateEnvelope {
	return c.core.GetState()
}

// Dispatch is the single frontend entry point: action + JSON payload.
func (c *Clavis) Dispatch(action, payloadJSON string) map[string]any {
	return c.core.Dispatch(action, payloadJSON)
}

/* ------------------------- clipboard ------------------------- */

// WriteClipboard puts text on the Windows clipboard; secret payloads also
// set the privacy formats (§5.2).
func (c *Clavis) WriteClipboard(text string, containsSecret bool) bool {
	return clipboard.WriteText(text, containsSecret)
}

/* ------------------------- exports ------------------------- */

// ExportSave generates then saves one export through the Windows dialog.
func (c *Clavis) ExportSave(what, id string) map[string]any {
	var body, filename, filterName, pattern string
	switch what {
	case "backup":
		b, err := c.core.Store.ExportBackupString()
		if err != nil {
			return service.Fail("Could not build the backup.", 400)
		}
		body = b
		filename = "clavis-backup-" + time.Now().Format("20060102-1504") + ".json"
		filterName, pattern = "Clavis backup", "*.json"
	case "item-md", "group-md":
		target, err := c.core.Store.ExportEntryMarkdown(store.EntryKind(kindOf(what)), id)
		if err != nil {
			return service.FailErr(err)
		}
		body, filename = target.Body, target.Filename
		filterName, pattern = "Markdown", "*.md"
	case "item-txt", "group-txt":
		target, err := c.core.Store.ExportEntryText(store.EntryKind(kindOf(what)), id)
		if err != nil {
			return service.FailErr(err)
		}
		body, filename = target.Body, target.Filename
		filterName, pattern = "Text", "*.txt"
	default:
		return service.Fail("Unknown export type.", 400)
	}

	dlg := c.app.Dialog.SaveFile().
		SetFilename(filename).
		AddFilter(filterName, pattern).
		CanCreateDirectories(true)
	if c.manager != nil && c.manager.IsVisible() {
		dlg = dlg.AttachToWindow(c.manager)
	}
	path, _ := dlg.PromptForSingleSelection()
	if path == "" {
		return map[string]any{"ok": false, "canceled": true}
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		return service.Fail("Clavis could not write the file.", 400)
	}
	return map[string]any{"ok": true, "savedPath": path}
}

func kindOf(what string) string {
	if strings.HasPrefix(what, "item") {
		return string(store.KindItem)
	}
	return string(store.KindGroup)
}

// ExportAllMarkdown writes one .md per entry into a picked folder (§5.8B).
func (c *Clavis) ExportAllMarkdown() map[string]any {
	files, err := c.core.Store.ExportAllMarkdown()
	if err != nil {
		return service.FailErr(err)
	}
	if len(files) == 0 {
		return service.Fail("There is nothing to export yet.", 400)
	}
	dlg := c.app.Dialog.OpenFile().
		CanChooseDirectories(true).
		CanChooseFiles(false).
		CanCreateDirectories(true)
	if c.manager != nil && c.manager.IsVisible() {
		dlg = dlg.AttachToWindow(c.manager)
	}
	folder, _ := dlg.PromptForSingleSelection()
	if folder == "" {
		return map[string]any{"ok": false, "canceled": true}
	}
	written := 0
	for _, f := range files {
		if err := os.WriteFile(filepath.Join(folder, f.Filename), []byte(f.Body), 0o644); err == nil {
			written++
		}
	}
	if written == 0 {
		return service.Fail("Clavis could not write the files.", 400)
	}
	return map[string]any{"ok": true, "count": written, "folder": folder}
}

// ImportedFileDTO mirrors the frontend shape for picked import files.
type ImportedFileDTO struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

// PickImportFolder picks a folder and reads its .md/.txt files (§5.8).
func (c *Clavis) PickImportFolder() map[string]any {
	dlg := c.app.Dialog.OpenFile().
		CanChooseDirectories(true).
		CanChooseFiles(false)
	if c.manager != nil && c.manager.IsVisible() {
		dlg = dlg.AttachToWindow(c.manager)
	}
	folder, _ := dlg.PromptForSingleSelection()
	if folder == "" {
		return map[string]any{"ok": false, "canceled": true}
	}
	var files []ImportedFileDTO
	entries, err := os.ReadDir(folder)
	if err != nil {
		return service.Fail("Clavis could not read that folder.", 400)
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		lower := strings.ToLower(name)
		if !strings.HasSuffix(lower, ".md") && !strings.HasSuffix(lower, ".txt") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(folder, name))
		if err != nil {
			continue
		}
		files = append(files, ImportedFileDTO{Name: name, Content: string(b)})
	}
	if len(files) == 0 {
		return service.Fail("No .md or .txt files were found in that folder.", 400)
	}
	return map[string]any{"ok": true, "files": files}
}

// OpenDataFolder opens %APPDATA%\Clavis in Explorer (§5.9).
func (c *Clavis) OpenDataFolder() map[string]any {
	if err := system.OpenFolder(c.core.Store.DataDir()); err != nil {
		return service.Fail("Clavis could not open the data folder.", 400)
	}
	return map[string]any{"ok": true}
}

/* ------------------------- windows ------------------------- */

// HidePopup hides the popup window.
func (c *Clavis) HidePopup() {
	c.hidePopup()
}

// SetPopupSize is driven by the popup content (the window IS the panel;
// height grows with rows, §3.3b).
func (c *Clavis) SetPopupSize(w, h int) {
	c.popupMu.Lock()
	c.popupSize = [2]int{w, h}
	c.popupMu.Unlock()
	if c.popup != nil {
		c.popup.SetSize(w, h)
	}
}

// ShowManager shows + focuses the Manager.
func (c *Clavis) ShowManager() {
	if c.manager != nil {
		c.manager.Show()
		c.manager.Focus()
	}
}

// HideManager hides the Manager to the tray (§3.2).
func (c *Clavis) HideManager() {
	c.saveManagerBounds()
	if c.manager != nil {
		c.manager.Hide()
	}
}

// MinimiseManager minimizes the Manager.
func (c *Clavis) MinimiseManager() {
	c.saveManagerBounds()
	if c.manager != nil {
		c.manager.Minimise()
	}
}

// ToggleMaximiseManager toggles maximize/restore.
func (c *Clavis) ToggleMaximiseManager() {
	if c.manager != nil {
		c.manager.ToggleMaximise()
	}
}

// SaveManagerBounds persists the Manager geometry now.
func (c *Clavis) SaveManagerBounds() {
	c.saveManagerBounds()
}

func (c *Clavis) saveManagerBounds() {
	if c.manager == nil || c.core == nil {
		return
	}
	if c.manager.IsMaximised() {
		return // keep the last normal bounds
	}
	x, y := c.manager.Position()
	w, h := c.manager.Size()
	if w <= 0 || h <= 0 {
		return
	}
	bounds := &store.ManagerBounds{X: x, Y: y, W: w, H: h}
	_ = c.core.Store.UpdateSettings(store.SettingsPatch{ManagerBounds: bounds, ManagerBoundsSet: true})
}

/* ------------------------- hotkey ------------------------- */

// RegisterShortcut swaps the global shortcut (§3.3).
func (c *Clavis) RegisterShortcut(combo string) error {
	c.hkMu.Lock()
	defer c.hkMu.Unlock()
	return c.swapShortcutLocked(combo)
}

func (c *Clavis) tryRegisterCombo(combo string) error {
	c.hkMu.Lock()
	defer c.hkMu.Unlock()
	return c.swapShortcutLocked(combo)
}

func (c *Clavis) swapShortcutLocked(combo string) error {
	if c.app == nil {
		return nil
	}
	combo = strings.TrimSpace(combo)
	if combo == "" {
		return fmt.Errorf("empty shortcut")
	}
	if c.hkPaused {
		// Paused: remember it, register nothing.
		c.currentCombo = combo
		return nil
	}
	if c.currentCombo != "" {
		_ = c.app.GlobalShortcut.Unregister(c.currentCombo)
		c.currentCombo = ""
	}
	if err := c.app.GlobalShortcut.Register(combo, c.onHotkey); err != nil {
		return err
	}
	c.currentCombo = combo
	return nil
}

// PauseShortcut unregisters the combo (tray parity, §3.2).
func (c *Clavis) PauseShortcut() {
	c.hkMu.Lock()
	defer c.hkMu.Unlock()
	if c.currentCombo != "" && c.app != nil {
		_ = c.app.GlobalShortcut.Unregister(c.currentCombo)
	}
	c.hkPaused = true
}

// ResumeShortcut re-registers the combo.
func (c *Clavis) ResumeShortcut() {
	c.hkMu.Lock()
	defer c.hkMu.Unlock()
	c.hkPaused = false
	if c.currentCombo != "" && c.app != nil {
		_ = c.app.GlobalShortcut.Register(c.currentCombo, c.onHotkey)
	}
}

// ShortcutPaused reports the pause state.
func (c *Clavis) ShortcutPaused() bool {
	c.hkMu.Lock()
	defer c.hkMu.Unlock()
	return c.hkPaused
}

func (c *Clavis) onHotkey() {
	c.togglePopup()
}

/* ------------------------- popup ------------------------- */

func (c *Clavis) togglePopup() {
	if c.popup == nil {
		return
	}
	if c.popup.IsVisible() {
		c.hidePopup()
	} else {
		c.showPopup()
	}
}

func (c *Clavis) showPopup() {
	if c.popup == nil {
		return
	}
	c.positionPopup()
	c.popup.Show()
	c.popup.Focus()
	/* Wails' Focus() is a plain SetForegroundWindow, which Windows silently
	   denies when Clavis is not the foreground process (the usual case after
	   a tray click) — the popup would show but never receive keystrokes.
	   Force it with the AttachThreadInput recipe so the search box is live. */
	if hwnd := c.popup.NativeWindow(); hwnd != nil {
		system.ForceForeground(hwnd)
	}
	if c.app != nil {
		c.app.Event.Emit("clavis:popup-shown")
	}
}

func (c *Clavis) hidePopup() {
	if c.popup == nil || !c.popup.IsVisible() {
		return
	}
	c.popup.Hide()
	if c.app != nil {
		c.app.Event.Emit("clavis:popup-hidden")
	}
}

// positionPopup centers the panel horizontally and places it in the upper
// third of the screen the mouse cursor is on (§3.3b).
func (c *Clavis) positionPopup() {
	if c.app == nil {
		return
	}
	cx, cy := system.CursorPoint() // physical
	screens := c.app.Screen.GetAll()
	if len(screens) == 0 {
		return
	}
	target := screens[0]
	for _, sc := range screens {
		pb := sc.PhysicalBounds
		if cx >= pb.X && cx < pb.X+pb.Width && cy >= pb.Y && cy < pb.Y+pb.Height {
			target = sc
			break
		}
	}
	wa := target.WorkArea // DIP
	c.popupMu.Lock()
	pw, ph := c.popupSize[0], c.popupSize[1]
	c.popupMu.Unlock()
	if pw <= 0 {
		pw = 640 // the window IS the panel (solid window, no pad)
	}
	if ph <= 0 {
		ph = 200
	}
	x := wa.X + (wa.Width-pw)/2
	y := wa.Y + int(float64(wa.Height)*0.18)
	// Keep the whole panel inside the work area.
	if x < wa.X {
		x = wa.X
	}
	if y+ph > wa.Y+wa.Height {
		y = wa.Y + wa.Height - ph
	}
	if y < wa.Y {
		y = wa.Y
	}
	c.popup.SetPosition(x, y)
}

/* ------------------------- autostart ------------------------- */

func (c *Clavis) syncAutostart(enabled bool) error {
	if c.app == nil {
		return nil
	}
	if enabled {
		return c.app.Autostart.EnableWithOptions(application.AutostartOptions{
			Identifier: "Clavis",
			Arguments:  []string{"--hidden"},
		})
	}
	return c.app.Autostart.Disable()
}

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

/* ------------------------- quit ------------------------- */

// QuitApp exits Clavis (tray Quit, §3.2).
func (c *Clavis) QuitApp() {
	c.saveManagerBounds()
	if c.app != nil {
		c.app.Quit()
	}
}

// ManagerNewItem tells the Manager to open the new-item form, optionally
// prefilled (Ctrl+N from the popup, §5.2).
func (c *Clavis) ManagerNewItem(prefill string) {
	if c.app != nil {
		c.app.Event.Emit("clavis:manager-new-item", prefill)
	}
	c.ShowManager()
}

// ManagerOpenEntry tells the Manager to open a specific row (Ctrl+E from
// the popup, §5.2).
func (c *Clavis) ManagerOpenEntry(kind, id string) {
	if c.app != nil {
		c.app.Event.Emit("clavis:manager-open-entry", map[string]string{"kind": kind, "id": id})
	}
	c.ShowManager()
}
