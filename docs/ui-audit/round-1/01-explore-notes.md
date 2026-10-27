# 01 — Explore notes (UI/UX audit round 1)

Written: 2026-01-27/28 · Auditor session 1 · **No product code was changed in this session.**
Everything below was verified by reading the repository and by running the web front end (see `01b-baseline.md` for what was actually run).

## 1. What Clavis is (verified, not guessed)

A Windows 10/11 tray app: press a global hotkey (default **Ctrl+Shift+Space**), a quick-search popup appears near the cursor, type a few letters, press Enter — the item is on the clipboard. Copied secrets are excluded from Windows clipboard history (Win+V) and cloud sync. A second window ("manager") manages items, groups, categories, tags, trash, settings.

The core loop (hotkey → popup → type → Enter → clipboard) is the product. Every UI judgment in this audit is weighed against that loop.

## 2. The real stack (verified)

| Layer | What | Where verified |
|---|---|---|
| Desktop framework | **Wails v3.0.0-beta.33** (pinned) — Go backend + WebView2 front end | `go.mod:8`, `frontend/package.json:19` |
| Backend | Go 1.27 (`go.mod:3`), pure-Go core in `internal/` (store, service, search, exchange, clipboard, system, updater, popupmath); Windows shell in `main.go`, `app.go`, `app_exports.go`, `app_update.go` | files read |
| Frontend | **React 19 + TypeScript 5 + Vite 6 + Tailwind CSS 4** (CSS-config, no `tailwind.config`), two HTML entries: `popup.html` and `manager.html` | `frontend/vite.config.ts`, `frontend/package.json` |
| Icons | `lucide-react` | `frontend/package.json:20` |
| Fonts | Inter Variable + JetBrains Mono, **inlined into the build** (offline single origin) | `frontend/package.json:17-18`, `vite.config.ts:25` |
| Design system | "Bitwarden design system edition" tokens: brand blue `#175DDC`, white surfaces, 1px borders, flat; dark mode = `html.solid` class | `frontend/src/design-tokens.css:1-8` |
| Installer | NSIS (`build/windows/installer/clavis.nsi`) + Microsoft WebView2 bootstrapper | `docs/DEVELOPMENT.md:94-98` |
| Data | `%APPDATA%\Clavis\clavis-data.json` (JSON on disk), backups in `%APPDATA%\Clavis\backups` | `main.go:37-44`, `internal/store/store.go` |

The earlier guess "Go desktop app with a web front end and NSIS installer" is confirmed.

## 3. Windows and screens (verified)

- **Popup** ("quick search"): 640 DIP wide, height auto-grows with result rows (frontend measures itself and calls `SetPopupSize`; `main.go:32-35,101-124`, `app.go:98-107`). Frameless, always-on-top, hidden from taskbar and Alt-Tab, hides on focus loss. Default height constant is **208** (`main.go:34`) but the placement fallback uses **200** (`app.go:308`) — small inconsistency.
- **Manager**: 1000×680 default, **min 800×520**, frameless (app draws its own title bar), remembers bounds, close button hides to tray. `main.go:70,126-153`.
- Screens: popup palette (recent list, search results, group drill-down, empty vault, no-match), popup load-error retry panel; manager 3-column view (sidebar / entry list / detail), item editor, group editor (create mode has a paste-`.env` flow), manage-items modal, settings (Shortcut / Appearance / Data / About + update card), trash view, import-backup modal, resolve-conflicts modal, shared-item edit/delete modals, category add/rename modal, read-only / recovered / shortcut-conflict banners.
- Tray menu: Open Clavis, Quick search, Check for updates…, Pause/Resume shortcut, Quit. Tray tooltip shows the current shortcut. `main.go:202-247`.

## 4. How to run and build (verified)

```bash
# Frontend only (what this Linux sandbox can run):
cd frontend && bun install && bun run dev     # vite; serves /popup.html and /manager.html
cd frontend && bun run build                  # tsc --noEmit + vite build (CI runs this)
cd frontend && bun run test                   # vitest (6 test files)

# Full app (Windows only — NOT runnable in this sandbox):
wails dev                                     # per BUILD_LOG/DEVELOPMENT docs
go test ./...                                 # on Windows; on Linux: go test ./internal/...
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -tags production \
  -ldflags "-s -w -H windowsgui" -o dist/Clavis.exe .
```

`-tags production` is mandatory for shipped builds (otherwise WebView2 DevTools stay enabled — wrong for a secrets app). `docs/DEVELOPMENT.md:49-51`.

## 5. Conditional lens decisions (Stage 1 requirement)

| Lens | Applies? | Reason |
|---|---|---|
| **Farsi / RTL** | **No** | Exhaustive search found no Farsi/Arabic UI strings, no `dir="rtl"`, no `lang="fa"`, no RTL CSS. Persian appears only as a unicode-subsequence *test fixture* (`frontend/src/lib/clavis/search.test.ts:131,134`). All user-content fields already use `dir="auto"` (20 occurrences), so Persian *data* renders correctly. The Farsi lens is therefore documented as N/A — but see finding F-031 (fake data placeholder "Sedanama") and the note that the owner (timezone Asia/Tehran) may store Persian entry names: search/fuzzy matching handles them by design and test. |
| **Desktop app** | **Yes** | Wails desktop framework. Window/tray/hotkey behavior, high-DPI, frameless chrome are all core. |
| **Forms and wizards** | **Yes** | Item editor, group editor (+ `.env` paste flow), manage-items modal, category modal, settings, import flows. |
| **Tray / background apps** | **Yes** | Tray menu, hotkey pause/resume, hide-on-close, autostart (`--hidden`), single-instance, self-update. |

## 6. How this project ships ("How this project ships" section)

- **Remote**: `https://github.com/assadigit/Clavis` (verified with `git remote -v`; access via owner-provided credentials, kept out of all files).
- **Branch**: `main` (default; an `engineering/hardening-pass` branch also exists on the remote).
- **CI**: `.github/workflows/ci.yml` — every push, on `windows-latest`: frontend build + vitest, gofmt gate, `go vet`, `go test` (includes a real Win32 clipboard e2e), production build, govulncheck, npm audit.
- **Build**: as in §4; the release pipeline also embeds icon/version/manifest via `go run ./tools/syso …` and builds the NSIS installer with Microsoft's WebView2 bootstrapper.
- **Deploy method**: **tag-driven GitHub Releases**. Push a `vX.Y.Z` tag → `.github/workflows/release.yml` builds `Clavis-Portable-X.Y.Z.exe` + `Clavis-Setup-X.Y.Z.exe` on a windows-latest runner and publishes them to the GitHub Release for that tag. A version guard first checks that the tag, `AppVersion` (app.go), NSIS `VERSION`, `APP_VERSION` (types.ts) and winres `product_version` all agree. The in-app self-updater downloads exactly these asset names from the repo's releases.
- **What is live right now**: **v1.2.0** (tag `v1.2.0`; latest commit on `main` is `8edcecc` "docs: self-update end-to-end audit…"). Users on older versions self-update to it.
- **How to undo a deploy**: GitHub Releases are additive — a bad release is undone by (1) fixing `main`, (2) bumping all five version places, (3) tagging `vX.Y.Z+1` and pushing the tag, which ships a corrected release that every client self-updates to. Optionally delete/roll back the bad GitHub Release (its URL stays but assets can be removed). The repo-level restore point is the tag `pre-ui-audit-round-1` (this audit) / `pre-ui-upgrade-round-1` (the upgrade session).
- **Release smoke test**: DEVELOPMENT.md step 5 requires a human smoke test on a clean Windows VM before announcing (popup hotkey, copy privacy check, edit round-trip, self-update). CI cannot do this step; the upgrade session must honor it — see `04-fix-plan.md` Phase R.

## 7. Things that constrain the audit and the upgrade

- **Off-limits (owner's rule, never changed)**: secret-protection logic (storage/encryption/unlock), the clipboard-history/cloud-exclusion code (`internal/clipboard/*`), global hotkey registration and clipboard-writing code, and the owner's real stored entries. UI/UX problems *around* them are reported; fixes that would need to touch them are marked "report only (off-limits)".
- **This session ran on Linux** — no tray, no hotkey, no real clipboard, no Win32 window chrome. Everything about those is **static analysis only** and is labeled as such in `02-findings.md`. The web front end was really run (two ways — see `01b-baseline.md`).
- **The owner is not a programmer.** Documents are written in plain language; every change in the plan is reversible via git tags; every phase has a checkable milestone.
- **No real secrets were ever loaded.** The running UI used a fake dataset in a copied frontend folder outside the repo (`/home/z/my-project/clavis-audit-mock`), with values like `FAKE-TOKEN-123`. Screenshots show only fake data.

## 8. Existing docs worth knowing (all read)

`README.md` (product + build), `SPEC.md` (30 KB product spec), `docs/DEVELOPMENT.md` (build/test/release), `docs/ENGINEERING_NOTES.md` (engineering log), `BUILD_LOG.md`, `DECISIONS.md` (design decisions, e.g. §34 self-update). Two design-token files exist and have **diverged** — see finding F-021.

## 9. Export/import today (context for the owner's feature request)

The owner asked (outside the audit brief): *"full export + per-group export, so I can easily import my credentials later."*

What exists today (verified in code):
- **Full JSON backup** (whole vault, everything incl. settings) — Settings → "Export everything"; re-importable via "Import backup" with **Merge** (by id + newer `updatedAt` wins) or **Replace**. `app_exports.go:23-67`, `internal/store/import.go:169-233`.
- **Per-item and per-group Markdown and TXT exports** — in the item/group editor "More actions" menu. **Not losslessly re-importable**: the Markdown exporter drops the item `Note` field, per-item tags/isSecret, pinned, and turns shared items into standalone copies; TXT loses even more. `internal/exchange/markdown.go`, `internal/store/import.go:289-478`.
- **Folder import** of `.md`/`.txt` files with a conflict-resolution modal; JSON files are explicitly rejected in that path.

**What the owner wants does not exist**: a per-group (or per-selection) **JSON** export that can be merged back later without data loss. The plan includes it as a feature phase — see `04-fix-plan.md` Phase 6.
