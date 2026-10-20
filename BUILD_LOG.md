# BUILD_LOG.md — Clavis

Short running entries. (Newest last.)

- Re-cloned the repo; read SPEC.md and design-tokens.css in full before any code.
- Pinned Wails `v3.0.0-beta.33` (Go) + `@wailsio/runtime@3.0.0-beta.33` (npm); studied the exact beta.33 API from the official module source (windows options, tray, global shortcuts, dialogs, autostart, single instance, clipboard, DIP sizing).
- Installed prerequisites user-space: Go 1.27.3 (tarball), NSIS 3.11 (deb extract, no root needed).
- Go core (pure, OS-independent, unit-tested on Linux):
  - `internal/store` — model/normalize/loader, atomic write (tmp+fsync+rename), backups (daily once/day, pre-migration/pre-import/pre-restore, retention 10 daily + 30-day pre-*), trash purge (30 d), undo ring with memberships, CRUD incl. split-for-group, categories, settings, copy semantics (useCount/lastUsedAt), import/export (backup replace/merge, md/txt with reuse/keepBoth conflict resolution).
  - `internal/exchange` — dotenv quoting/escaping/dedupe/autoKey, byte-exact Markdown/TXT export + parsers, Windows-safe filenames.
  - `internal/search` — the documented §5.1 algorithm (prefix + fuzzy subsequence, #tag/@category, tier ranking, pinned/use/lastUsed ordering).
  - Tests: **68 tests, all green** (`go test ./internal/... -count=2 -race`), covering every SPEC §10 automated item incl. crash-safety, retention, migration, read-only guard, corrupt-file recovery (newest valid backup), byte-exact round-trips (newlines, quotes, backslashes, edge spaces, Farsi).
- Desktop app:
  - `app.go` — the `Clavis` service: `Dispatch` action dispatcher (1:1 with the reference API), `GetState` (+ osTransparency), Windows clipboard with the three privacy formats, save/folder dialogs for all exports, folder import, open-data-folder, window controls, popup positioning (cursor's screen, centered, upper third, DIP), hotkey register/swap/pause/resume, autostart sync, cross-window events.
  - `main.go` — two pre-created windows (popup: frameless/transparent/always-on-top/no taskbar/toolwindow; manager: frameless/transparent with remembered bounds), tray (left click → popup; menu: Open Clavis / Quick search / Pause–Resume shortcut / Quit), global shortcut `Ctrl+Shift+Space`, single instance (second launch opens the Manager), `--hidden` autostart mode.
  - Frontend: the verified reference UI (popup + manager + settings) on Vite, transport swapped to the Wails runtime; desktop additions: real title-bar buttons, transparent-window glass frames with the token shadow pad, popup auto-sizing (ResizeObserver → Go), Ctrl+N/Ctrl+E cross-window requests, Settings gains "Import folder", "Export all as Markdown" and "Open data folder".
- Icons: hand-drawn SVG key glyphs → PNG (16–256 px, headless Chromium) → `appicon.ico` (9 sizes; ≤48 px as 32-bpp DIB entries for maximum Win10 shell compatibility) + `trayicon.ico`; `rsrc_windows_amd64.syso` with icon + PerMonitorV2 manifest + version info (ProductName "Clavis", 1.0.0.0).
- Builds:
  - `dist/Clavis.exe` — `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-s -w -H windowsgui"` (13.8 MB single file; icon/version/manifest embedded and byte-verified).
  - `Clavis-Setup-1.0.0.exe` — NSIS 3.11: per-user install to `%LOCALAPPDATA\Programs\Clavis`, Start Menu shortcuts, WebView2 check + embedded Microsoft bootstrapper, uninstaller that preserves `%APPDATA%\Clavis`. 7.7 MB.
  - `Clavis-Portable-1.0.0.exe` — the same single file, no install.
- End-to-end verification (real browser against the real Go backend via Wails' official `-tags server` mode):
  - Manager renders: custom title bar, starter categories with counts, empty state (Add your first item / Import).
  - Item created through the real UI → real store → `clavis-data.json` on disk; isSecret defaulted true from the Credentials category; masked preview `••••••••1234`.
  - Popup: empty query shows most-used; **"ghtk" → "GitHub token"** (spec fuzzy example); Enter runs the copy action (useCount/lastUsedAt persisted) — the ✓ row state needs the native clipboard, which server mode stubs (Windows-only).
  - Settings: shortcut capture field, glass slider, solid mode persisted to the file AND applied (`html.solid`), Start-with-Windows toggle, all Data buttons incl. the three desktop additions.
  - Console: zero page errors; WebSocket event transport connected.
- **Popup-open time (§10)**: the popup window is pre-created and its page pre-loaded (never on demand, §3.1); the same UI measured **26.3 ms** from key event to first paint in the browser harness (budget 150 ms). Could not be re-measured on real Windows hardware from this host — logged as a limit in DECISIONS.md.
- No secret value is logged anywhere (grep-verified across Go + logs); the app performs no network access at runtime.
