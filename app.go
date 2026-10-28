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
 *   ExportSave/ExportAllMarkdown/
 *   PickImportFolder/OpenDataFolder    → dialogs (app_exports.go)
 *   HidePopup/ShowManager/…            → window controls
 *   PauseShortcut/ResumeShortcut       → tray parity
 *   CheckUpdate/InstallUpdate          → self-update (DECISIONS.md §34)
 * SECURITY: item values are never logged; dialogs carry file names only.
 */
package main

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"clavis/internal/popupmath"
	"clavis/internal/service"
	"clavis/internal/store"
	"clavis/internal/system"
	"clavis/internal/updater"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// AppVersion is embedded in the exe and written into the data file.
const AppVersion = "1.4.0"

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
	before := c.core.Store.Version()
	res := c.core.Dispatch(action, payloadJSON)
	/* Cross-window sync (v1.3.2): the Manager and the popup are separate
	   webviews, each with its own snapshot. A delete made in the Manager
	   used to keep showing up in the popup's "Recent" / "Pinned & frequent"
	   sections, and popup copies never refreshed the Manager's Recent view —
	   each window only updated from its own actions. Any successful action
	   that moved the store's snapshot generation now broadcasts
	   clavis:data-changed so every window (hidden ones included — their
	   webviews stay alive) can re-fetch. Read-only actions (getValue, …)
	   don't move the version and emit nothing. */
	if ok, _ := res["ok"].(bool); ok && c.core.Store.Version() != before && c.app != nil {
		c.app.Event.Emit("clavis:data-changed")
	}
	return res
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
	/* Mirrors clavis:popup-shown (v1.3.2): the Manager webview re-fetches
	   its snapshot when it comes back, so changes made through the popup
	   while it was hidden (copies → Recent/use counters) are visible. */
	if c.app != nil {
		c.app.Event.Emit("clavis:manager-shown")
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
// third of the screen the mouse cursor is on (§3.3b). All coordinates are
// converted explicitly: the screen pick compares the PHYSICAL cursor point
// against PhysicalBounds, and the final origin is DIP — the unit
// SetPosition expects.
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
	/* Wails beta.33 fills WorkArea in PHYSICAL pixels on Windows (identical
	   to PhysicalWorkArea — DPI scaling is not applied there yet), while
	   SetPosition/SetSize and the panel size reported by the webview are
	   DIP. The old math mixed the two spaces, which only lined up at 100%
	   scaling; popupmath.Origin converts the one physical input. */
	wa := target.PhysicalWorkArea
	c.popupMu.Lock()
	pw, ph := c.popupSize[0], c.popupSize[1]
	c.popupMu.Unlock()
	if pw <= 0 {
		pw = 640 // the window IS the panel (solid window, no pad)
	}
	if ph <= 0 {
		ph = popupHeightDefault // F-022 (UI-audit round 1 Phase 10): one constant, was a 200 drift
	}
	x, y := popupmath.Origin(wa.X, wa.Y, wa.Width, wa.Height, float64(target.ScaleFactor), pw, ph)
	c.popup.SetPosition(x, y)
}

// refreshTrayTooltip syncs the tray tooltip with the current shortcut
// setting (§3.2). It used to be set once at startup, so changing the
// shortcut left the tray advertising the old combo forever.
func (c *Clavis) refreshTrayTooltip() {
	if c.tray == nil || c.core == nil {
		return
	}
	shortcut := c.core.Store.State().Data.Settings.Shortcut
	c.tray.SetTooltip("Clavis — press " + shortcut + " for quick search")
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
