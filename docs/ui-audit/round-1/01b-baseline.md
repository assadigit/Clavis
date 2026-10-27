# 01b — Baseline: what works today (re-run after every upgrade phase)

Written: 2026-01-27/28 · Round 1 · **No product code was changed.**

## How this baseline was produced (honesty section)

This session runs on **Linux**. The Windows-only parts (tray, global hotkey, real clipboard with privacy formats, Win32 window chrome, self-update) **cannot run here** — those rows are marked **"static analysis only"** and were verified by reading code, never by running.

The web front end **was really run**, two ways:

1. **Real, unmodified frontend** (`bun run dev` on the repo's own `frontend/`, served at `http://localhost:5188`): in a plain browser the Wails backend is absent, so this exercises the genuine *error* paths — exactly what a user sees if the backend dies or the data folder is unreadable.
2. **Mocked-backend copy** (a *copy* of the frontend at `/home/z/my-project/clavis-audit-mock`, outside the repo, where `@wailsio/runtime` is aliased to a fake runtime that serves obviously-fake data like `FAKE-TOKEN-123`): this exercises the real UI components, real styling, real keyboard handling, real states — with a working "backend". The UI code is byte-identical to the repo; only the runtime bridge is fake. All populated screenshots come from this.

Evidence: `evidence/before/*.png` (34 images). Mock-driven rows are marked **(mocked backend, real UI)**.

The core loop itself (hotkey → popup → type → Enter → clipboard) is **static analysis only** end-to-end: the hotkey, the Win32 focus forcing, and the clipboard write live in Go/Win32. The *frontend half* of the loop (popup palette, search-as-you-type, keyboard driving, copy feedback) **was exercised for real** in the mocked copy.

## Baseline checklist

Legend: ✅ works · ⚠️ works with problems (see 02-findings) · ❌ broken · 👁 static analysis only (could not run here)

### A. The core loop (popup)

| # | Task / check | Result | Evidence / notes |
|---|---|---|---|
| A1 | Hotkey Ctrl+Shift+Space shows popup at cursor's monitor, upper third | 👁 | `main.go:184-188`, `app.go:244-261,278-312`, `internal/popupmath/popupmath.go:20-40` — cursor-monitor aware, work-area aware, DIP-corrected. Cannot run on Linux. |
| A2 | Popup shows recent + pinned entries on open (empty query) | ✅ (mocked backend, real UI) | `popup-recent-640.png` — "Recent" and "Pinned & frequent" sections render with masked previews |
| A3 | Search-as-you-type narrows results; fuzzy works (`ghtk` → "GitHub token") | ✅ (mocked) | `popup-search-640.png` |
| A4 | `#tag` / `@category` filters | ✅ | Code + unit tests (`search.test.ts`, `internal/search/search_test.go`); exercised in code review. Not separately screenshotted. |
| A5 | Arrow keys navigate, wrap; Enter copies; result list fully keyboard-driven | ✅ (mocked) | Driven with real key presses during evidence collection; ARIA combobox pattern present (`popup.tsx:414-436`) |
| A6 | Group drill-down: → opens group, ← / Backspace-on-empty / Esc goes back; Ctrl+Enter copies whole group | ✅ (mocked) | `popup-group-640.png` |
| A7 | Copy feedback: row flips to ✓ "Copied" / "Copied N lines", popup auto-hides after 500 ms; secret copies toast "kept out of clipboard history" | ✅ (mocked) | `popup-copied-640.png` (auto-hide frozen to capture it) |
| A8 | No matches: "Nothing found. Press Enter to create …" — Enter opens manager prefilled | ✅ (mocked) | `popup-nomatch-640.png` |
| A9 | Empty vault: "Nothing here yet. Press Ctrl+N to add your first item." | ✅ (mocked) | `popup-empty-vault-640.png` |
| A10 | Popup load failure: retry panel instead of blank window; Esc closes | ✅ (real, unmodified frontend) | `popup-loaderror-640.png` |
| A11 | Focus lands in the search box on show; typing always reaches the box | ✅ (mocked) + 👁 for the Win32 force-foreground half | autofocus + window-focus refocus (`popup-root.tsx:100-108`); Go `ForceForeground` via AttachThreadInput (`app.go:251-257`) is static-analysis-only |
| A12 | Secret values never rendered/searched in the popup; masked preview + last-4 only | ✅ (mocked + code) | State redaction verified in `internal/service/service.go:49-81`; unit-tested. Note: non-secret items also show a masked preview — see F-012. |
| A13 | Esc at top level hides popup; popup hides on focus loss | ✅ (frontend) + 👁 (Win32 focus loss) | `popup.tsx:278-283`; `HideOnFocusLost` in `main.go:114` |

### B. Manager — everyday tasks

| # | Task / check | Result | Evidence |
|---|---|---|---|
| B1 | Manager opens (tray / "Open Clavis" / second launch) | 👁 tray half; ✅ webview half | `main.go:86-93,149-153` |
| B2 | 3-column layout renders: sidebar, entry list, detail | ✅ (mocked) | `manager-all-1280.png` |
| B3 | Views: All / Recent / Pinned / Categories / Tags / Trash / Settings | ✅ (mocked) | `manager-all-1280.png`, `manager-tag-view-1280.png`, `manager-trash-1280.png`, `manager-settings-1280.png` |
| B4 | Row actions: instant-copy button (✓ feedback 1400 ms), pin toggle | ✅ (mocked) | exercised during navigation; icons + aria-labels verified |
| B5 | Item editor: create, edit, reveal value, tags, category, secret/pinned toggles, "used in N groups" | ✅ (mocked) | `manager-item-editor-1280.png`, `manager-item-editor-revealed-1280.png` (FAKE value shown) |
| B6 | Save button appears only when dirty; Enter saves; Ctrl+Enter newline | ✅ (mocked) | verified during shared-modal flow (Save appears after edit) |
| B7 | Group editor: create with `.env` paste + live preview ("+ N credentials", skipped-line warning) | ✅ (mocked) | `manager-group-create-env-1280.png` — "Create group + 2 credentials" with a non-KEY=value line present |
| B8 | Manage-items modal: drag reorder, up/down, remove, multi-add, create-here | ✅ (mocked) | `manager-manage-items-modal-1280.png`; keyboard sensor present (dnd-kit) |
| B9 | Shared item (used in ≥2 groups): edit asks "Update everywhere / Only for this group"; delete asks "Delete everywhere" | ✅ (mocked) | `manager-shared-modal-1280.png` (built live: item added to 2 groups, then renamed) |
| B10 | Delete → toast with **Undo** (8 s); trash keeps 30 days; restore / delete forever / empty trash | ✅ (mocked) | `manager-trash-1280.png`; undo ring cap 50 verified in code |
| B11 | Search the list; "Nothing found." empty state | ✅ (mocked) | `manager-no-results-1280.png` |
| B12 | Empty vault welcome ("Add your first item" / "Import") | ✅ (mocked) | `manager-empty-vault-1280.png` |
| B13 | Category add / rename / delete (entries become uncategorized, toast explains) | ✅ (mocked) | exercised in code + snapshot; modal in `sidebar.tsx:263-294` |
| B14 | Manager load failure: full-screen message | ⚠️ works but is a **dead end — no retry button** (F-001) | `manager-loaderror-1280.png` (real, unmodified frontend) |
| B15 | Read-only mode (newer-schema data): banner "Read-only … Editing is disabled.", mutations blocked | ✅ (mocked) | `manager-readonly-1280.png` |
| B16 | Data-recovery banner after corrupt-file auto-restore | ✅ (mocked) | `manager-recovered-1280.png` |
| B17 | Window chrome: custom title bar, minimize/maximize/close (close = hide to tray), maximized state styling | ✅ (webview half, mocked) + 👁 (Win32 half) | title bar visible in every manager screenshot |
| B18 | Dark mode toggle (Settings → Appearance) | ✅ (mocked) | `manager-settings-dark-1280.png`, `manager-all-dark-1280.png` — full token swap, no broken contrast observed |

### C. Settings, import/export, update

| # | Task / check | Result | Evidence |
|---|---|---|---|
| C1 | Shortcut change: capture field, validation, conflict error + rollback | ✅ (frontend half, mocked) / 👁 (real registration) | conflict text verified in code (`app.go:38-39`, `service.go:669-677`); browser-reserved combos blocked client-side (`hotkey.ts:87-105`) |
| C2 | Appearance toggles: dark mode, show last-4, start with Windows | ✅ (mocked) | `manager-settings-1280.png` |
| C3 | Export everything (full JSON backup via native save dialog) | ✅ (frontend half) / 👁 (dialog half) | `settings-view.tsx:352`; filename `clavis-backup-YYYYMMDD-HHMM.json` (`app_exports.go:32`); success toast "Saved: <path>" |
| C4 | Import backup: preview counts → Merge or Replace modal → summary toast | ✅ (mocked) | `manager-import-modal-1280.png` (triggered with a synthetic file event) |
| C5 | Per-item / per-group Markdown + TXT export (editors' More menu) | ✅ (frontend half) / 👁 (dialog half) | menu items verified in both editors; **round-trip is lossy — F-016/F-017** |
| C6 | Import Markdown/TXT + folder import with conflict resolution | ✅ (frontend half, mocked) | code + `settings-view.tsx:468-544`; conflicts modal not screenshotted (needs real Go parsing to be meaningful) |
| C7 | Backups list + Restore | ✅ (mocked) | `manager-settings-1280.png` / `manager-settings-scrolled-1280.png` — note three identical "Restore" buttons (F-010) |
| C8 | "Check for updates" → up-to-date message; update card states | ✅ (mocked) | `manager-update-card-1280.png` |
| C9 | Self-update install (download, progress, restart) | 👁 | `app_update.go`, `internal/updater` — cannot run on Linux; CI + past releases verified the chain per BUILD_LOG |
| C10 | Open data folder in Explorer | 👁 | `app_exports.go:153-158` |

### D. Tray / hotkey / clipboard (Windows-only — all static analysis)

| # | Check | Result | Notes |
|---|---|---|---|
| D1 | Tray icon + tooltip "Clavis — press <shortcut> for quick search"; left-click toggles popup | 👁 | `main.go:157-159` |
| D2 | Tray menu items and dynamic Pause/Resume shortcut | 👁 | `main.go:202-247` |
| D3 | Hotkey conflict handling at launch and change (event banner in manager) | 👁 | `main.go:184-188`, banner `manager-entry.tsx:69-92` |
| D4 | Clipboard privacy formats on secret copies (Win+V / cloud exclusion), fail-closed | 👁 | `internal/clipboard/clipboard_windows.go:20-23,171-196`; real Win32 e2e test exists and runs in CI |
| D5 | Close behavior (hide to tray), single instance, autostart hidden | 👁 | `main.go:86-96,149-153,191-194` |

### E. Cross-cutting checks (all lens areas)

| # | Check | Result | Evidence |
|---|---|---|---|
| E1 | Keyboard-only use of popup and manager (Tab/arrows/Enter/Esc) | ✅ (mocked) | focus ring captured: `manager-focus-ring-1280.png`; esc-stack modal dismissal; see findings for gaps (focus trap — F-008) |
| E2 | Visible focus states | ✅ with gaps | `--focus-ring` token + `:focus-visible` on most controls; inputs use `:focus` (F-009) |
| E3 | Loading / empty / error states present per screen | ✅ mostly | verified per screen above; gaps: group editor has no load state (metadata-only, by design), update status not announced to screen readers (F-011) |
| E4 | Responsiveness at 375 / 768 / 800 / 1280 | ✅ (browser widths) | `manager-375.png`, `manager-768.png`, `manager-800.png`, `manager-all-1280.png`; popup `popup-375.png`. Note: manager min width 800 makes 375/768 unreachable in production (F-023) |
| E5 | Console errors while running | ✅ clean | No console errors in the mocked UI; the unmodified frontend in a browser shows only the expected Wails "browser environment" warning |
| E6 | Dark mode across screens | ✅ (mocked) | popup + manager + settings dark screenshots; no token leaks observed |
| E7 | Tests | ✅ 6 frontend test files (popup golden path, popup-root load-failure, hotkey, derive, dotenv, search) + Go unit tests incl. Win32 clipboard e2e | `bun run test` passes (run in the audit copy); CI runs the full set on Windows |

## What could NOT be checked in this session (plain list)

1. Real hotkey latency/popup show time (needs Windows).
2. Real clipboard behavior incl. Win+V exclusion (needs Windows; unit-tested in CI though).
3. Tray icon rendering, menu, tooltip (needs Windows).
4. Native file save/open dialogs (Go side).
5. Self-update chain end-to-end (needs Windows; previously verified live per BUILD_LOG/DECISIONS).
6. High-DPI/multi-monitor popup placement for real (needs Windows; math is unit-tested).
7. The resolve-conflicts import modal with real parsed data (needs the real Go parser to produce conflicts).

---

## Appendix — how to reproduce this evidence (for the implementation session)

The 34 before-screenshots must pair with after-screenshots of the **same screens, same sizes, same fake data**. Reproduce the environment like this:

1. **Real error states** (popup-loaderror, manager-loaderror): run the repo's own frontend with no backend — `cd frontend && bun install && bun run dev` (defaults to port 5173), open `/popup.html` and `/manager.html` in a browser. The Wails runtime rejects every call in a plain browser, which triggers the genuine error UI. Screenshot widths: popup 640, manager 1280.
2. **Populated states** (everything else): make a *copy* of `frontend/` outside the repo, add a `mock-runtime.ts` that exports `Call.ByName` + `Events.On` and serves a fake `ClavisState` (the audit used 9 items + 3 groups with values like `FAKE-GITHUB-TOKEN-1234567890abcdef`, categories Work/Personal, 3 backups; fake values only — never real secrets), alias `"@wailsio/runtime"` to it in the copy's `vite.config.ts`, run `bun run dev` there. Drive states with browser automation (the audit used agent-browser: fill the search, press Enter/ArrowRight, screenshot). Special states were toggled by a `window.__clavisMock` helper (empty / rich / readOnly / recovered modes persisted in localStorage) and an "Open Clavis"-style theme class (`document.documentElement.classList.add('solid')`) for dark mode. The popup's 500 ms auto-hide after copy was frozen (`window.setTimeout` wrapper) to capture the "Copied" state.
3. **Viewport sizes used**: popup 640×760 (production popup width; window auto-grows to content — a short viewport clips the footer), manager 1280×800 (default-ish), 800×520 (min), 768×520 and 375×640 (unreachable in production — documents the dead mobile layout). File names encode the width; keep them identical for the after set.
4. **Popup detail**: the popup page auto-opens in a visible browser tab (`popup-root.tsx:88-89` uses document visibility), so no extra trigger is needed.
5. **CI note**: the "go test (incl. the real Win32 clipboard e2e)" step has flaked on windows-latest before (run 40323427941 failed on commit 8edcecc while run 40323429795 passed on the same commit — clipboard contention on shared runners). A red clipboard e2e on an otherwise-green run is usually a flake: re-run the job before diagnosing.
