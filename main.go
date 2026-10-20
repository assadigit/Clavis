/**
 * CLAVIS — main: app setup, windows, tray, single instance, hotkey
 * (SPEC §3). Two windows are created up front and kept hidden so showing
 * the popup is instant (§3.1). Never create the popup on demand.
 */
package main

import (
	"embed"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"clavis/internal/store"
	"clavis/internal/updater"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.ico
var appIcon []byte

//go:embed build/trayicon.ico
var trayIcon []byte

const (
	popupWidthDefault  = 640 // the window IS the panel (solid window, no pad)
	popupHeightDefault = 208
)

func dataDir() string {
	base, err := os.UserConfigDir() // %APPDATA% on Windows
	if err != nil || base == "" {
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "Clavis")
}

func hasHiddenFlag() bool {
	for _, arg := range os.Args[1:] {
		if arg == "--hidden" || arg == "-hidden" {
			return true
		}
	}
	return false
}

func main() {
	st, err := store.New(dataDir(), AppVersion)
	if err != nil {
		log.Fatal("Clavis could not open its data folder: ", err)
		return
	}
	svc := &Clavis{store: st}
	settings := st.State().Data.Settings

	hidden := hasHiddenFlag()

	// Manager bounds (§3.4: remembers its size and position).
	mgrW, mgrH := 1000, 680
	mgrX, mgrY := -1, -1
	if b := settings.ManagerBounds; b != nil && b.W >= 520 && b.H >= 360 {
		mgrW, mgrH, mgrX, mgrY = b.W, b.H, b.X, b.Y
	}

	app := application.New(application.Options{
		Name:        "Clavis",
		Description: "Your keys, one shortcut away.",
		Icon:        appIcon,
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Services: []application.Service{
			application.NewService(svc),
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "f7d3a9c2-Clavis-4e1b-9a7c-6b8e2f0d5a31",
			OnSecondInstanceLaunch: func(_ application.SecondInstanceData) {
				// A second copy must not run: signal the first, open the
				// Manager (§3.1).
				svc.ShowManager()
			},
		},
		Windows: application.WindowsOptions{
			DisableQuitOnLastWindowClosed: true, // the tray owns quitting
		},
	})

	// The Popup (§3.3b): frameless, transparent, always on top, no taskbar
	// entry, hidden until the shortcut/tray shows it.
	popup := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "popup",
		Title:            "Clavis",
		Width:            popupWidthDefault,
		Height:           popupHeightDefault,
		MinWidth:         popupWidthDefault,
		Frameless:        true,
		Hidden:           true,
		AlwaysOnTop:      true,
		DisableResize:    true,
		URL:              "/popup.html",
		BackgroundType:   application.BackgroundTypeSolid,
		BackgroundColour: application.NewRGBA(0xFF, 0xFF, 0xFF, 0xFF), /* popup panel: white (Bitwarden light) */
		HideOnFocusLost:  true,                                        // §3.3b: hides when it loses focus
		Windows: application.WindowsWindow{
			HiddenOnTaskbar:                   true,       // no taskbar entry
			ExStyle:                           0x00000080, // WS_EX_TOOLWINDOW — skip Alt-Tab
			DisableFramelessWindowDecorations: true,
		},
	})
	popup.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		popup.Hide()
		e.Cancel()
	})

	// The Manager (§3.4): normal resizable window, frameless with the app's
	// own title bar, remembers its bounds.
	managerOpts := application.WebviewWindowOptions{
		Name:             "manager",
		Title:            "Clavis",
		Width:            mgrW,
		Height:           mgrH,
		MinWidth:         800, /* >= 48rem: the 3-column desktop layout must always fit */
		MinHeight:        520,
		Frameless:        true,
		URL:              "/manager.html",
		BackgroundType:   application.BackgroundTypeSolid,
		BackgroundColour: application.NewRGBA(0xF3, 0xF6, 0xF9, 0xFF), /* --backdrop-base (Bitwarden canvas) */
		Hidden:           hidden,                                      // --hidden (autostart): tray only (§3.1)
		Windows: application.WindowsWindow{
			DisableFramelessWindowDecorations: true,
		},
	}
	if mgrX >= 0 || mgrY >= 0 {
		managerOpts.X = mgrX
		managerOpts.Y = mgrY
	}
	manager := app.Window.NewWithOptions(managerOpts)
	manager.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		// Closing the Manager hides it to the tray (§3.2).
		svc.HideManager()
		e.Cancel()
	})

	// Tray (§3.2): left click → Popup; right click → the menu.
	tray := app.SystemTray.New()
	tray.SetIcon(trayIcon)
	tray.SetTooltip("Clavis — press " + settings.Shortcut + " for quick search")
	tray.OnClick(func() { svc.togglePopup() })
	tray.SetMenu(buildTrayMenu(app, svc))

	svc.SetRuntime(app, popup, manager, tray)

	// Self-update housekeeping (DECISIONS.md §34): clear any leftover swap
	// file from a previous portable update, then run the background check.
	if exe, err := os.Executable(); err == nil {
		updater.CleanupOld(exe)
	}
	go func() {
		time.Sleep(30 * time.Second) // let the UI settle first
		svc.AutoCheckIfDue()
	}()

	// Global shortcut (§3.3). A failure is surfaced to the Manager UI.
	if err := svc.RegisterShortcut(settings.Shortcut); err != nil {
		log.Printf("shortcut registration failed: %v", err)
		app.Event.Emit("clavis:shortcut-conflict", shortcutTakenMessage)
	}

	// Start with Windows (§3.1): on by default after the first run; the
	// registry is synced to the setting on every launch.
	if err := svc.syncAutostart(settings.StartWithWindows); err != nil {
		log.Printf("autostart sync failed: %v", err)
	}

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

// buildTrayMenu creates the right-click menu (§3.2).
func buildTrayMenu(app *application.App, svc *Clavis) *application.Menu {
	menu := app.NewMenu()
	menu.Add("Open Clavis").OnClick(func(*application.Context) { svc.ShowManager() })
	menu.Add("Quick search").OnClick(func(*application.Context) { svc.showPopup() })
	menu.Add("Check for updates…").OnClick(func(*application.Context) {
		st := svc.CheckUpdate(true)
		if !st.Ok {
			svc.ShowManager()
			if svc.app != nil {
				svc.app.Event.Emit("clavis:update-progress", map[string]any{
					"stage": "failed",
					"error": st.Error,
				})
			}
			return
		}
		if st.Available {
			svc.ShowManager()
			if svc.app != nil {
				svc.app.Event.Emit("clavis:update-available", map[string]any{
					"current": st.Current,
					"latest":  st.Latest,
					"url":     st.URL,
					"notes":   st.Notes,
				})
			}
		} else if svc.app != nil {
			svc.app.Event.Emit("clavis:update-uptodate", map[string]any{
				"latest": st.Latest,
			})
		}
	})
	if svc.ShortcutPaused() {
		menu.Add("Resume shortcut").OnClick(func(*application.Context) {
			svc.ResumeShortcut()
			svc.tray.SetMenu(buildTrayMenu(app, svc))
		})
	} else {
		menu.Add("Pause shortcut").OnClick(func(*application.Context) {
			svc.PauseShortcut()
			svc.tray.SetMenu(buildTrayMenu(app, svc))
		})
	}
	menu.Add("Quit").OnClick(func(*application.Context) { svc.QuitApp() })
	return menu
}

var _ = strings.TrimSpace // keep strings imported for future tweaks
