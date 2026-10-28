# Clavis

**Your keys, one shortcut away.** A tiny, ultra-fast Windows 10/11 tray app for
people who copy the same credentials, prompts and notes all day long.

Press **Ctrl + Shift + Space** anywhere in Windows, type a few letters
(`ghtk` finds *GitHub token*), press **Enter** — and it's on your clipboard.
Copied secrets are automatically kept out of the Windows clipboard history
(Win+V) and out of cloud clipboard sync.

![Clavis manager](docs/screenshots/manager.png)

## Highlights

- **Keyboard-first quick search** — fuzzy matching, `#tag` and `@category`
  filters, groups open with `→`, whole-group copy as `KEY=value` lines with
  dotenv quoting.
- **Two group modes** — "Add items one by one" (named credentials, each with
  its own Copy button, added inside the open group) or "Paste whole document"
  (an entire markdown/text file stored byte-exact, one prominent Copy button
  that hands back the identical bytes, re-paste to replace it later). Classic
  groups can still be built by pasting a whole project's `.env`; "Copy all as
  markdown" exports any group.
- **Safe by design** — atomic writes, automatic daily backups (plus backups
  before every import/migration), corrupt-file auto-recovery, a read-only
  guard for files from newer versions.
- **Import / export** — full JSON backups (replace or merge), per-item/group
  Markdown and TXT, whole-folder import, "export all as Markdown".
- **Bitwarden design system** — a clean, flat, light interface built from
  Bitwarden's own published design tokens (brand blue `#175DDC`, white
  surfaces, 1px borders), with a built-in dark mode. Token-driven styling,
  AA contrast.
- **Recent-first quick search** — the popup opens with the 10 most recently used/copied entries (whole groups included), a clear **Open Clavis** button to reach the main window, and instant search as you type.
- **Tidy editors** — clean action bars (Save left, Copy/Duplicate/menu right, Delete tucked safely in the menu), contextual keyboard hints under the value field, aligned toggles.
- **Manage items screen** — a group's items sit in one faint, bounded, scrollable well of two-line cards; the blue Add item button opens a dedicated bigger dialog to drag-reorder, add, and remove items comfortably.
- **In-app self-update** — Settings → About checks GitHub for a newer release; one click downloads and installs it (installed and portable editions), relaunches Clavis, and never touches your data. Pull-only network use: two GETs to github.com when you check (or once per 12 h in the background). No telemetry, no analytics, no accounts.

Data lives in `%APPDATA%\Clavis` (shared by the installed and portable
builds), with automatic backups in `%APPDATA%\Clavis\backups`.

## Install

Download from [Releases](../../releases):

| File | What it is |
| --- | --- |
| `Clavis-Setup-1.1.4.exe` | The installer (per-user, no admin needed) |
| `Clavis-Portable-1.1.4.exe` | The portable single file (no install) |

## Build from source

Requires Go 1.26+ and Node/bun.

```
cd frontend && bun install && bun run build
cd .. && go test ./internal/...
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -tags production -ldflags "-s -w -H windowsgui" -o dist/Clavis.exe .
```

`-tags production` is required for release builds: without it Wails v3
leaves WebView2 DevTools enabled in the shipped exe (fine for local
debugging, not for a secrets app).

The Go core (store, exchange, search) is pure and fully unit-tested on any
platform; `go run ./tools/syso …` embeds the icon/version/manifest, and
`build/windows/installer/clavis.nsi` builds the installer with NSIS.

## Structure

```
main.go                app bootstrap: windows, tray, hotkey, single instance
app.go                 Windows shell: window controls, hotkey, autostart
app_exports.go         export/import dialogs (bodies built by the store)
app_update.go          self-update shell (check, download, hand-off)
internal/service/      the pure dispatcher (GetState/Dispatch), no Wails types
internal/store         data model, atomic writes, backups, trash, undo
internal/exchange      dotenv, Markdown/TXT import+export
internal/search        the documented search/ranking algorithm
internal/clipboard     Windows clipboard with privacy formats
internal/system        registry transparency, cursor, explorer
internal/updater       self-update from GitHub releases
internal/popupmath     popup placement math (physical → DIP, any scale)
frontend/              React + TypeScript + Vite (popup + manager entries)
                       components/clavis/: ui-bits.tsx re-exports the ui/ kit;
                       settings/ + popup-root + popup/manager trees
build/                 icons, manifest, version info, NSIS script
SPEC.md, frontend/src/design-tokens.css   the product spec and the single (live) source of style
```

See `docs/DEVELOPMENT.md` for build/test/release and
`docs/ENGINEERING_NOTES.md` for the engineering log.

Wails **v3.0.0-beta.33** (pinned in `go.mod`), React 19, TypeScript 5.
