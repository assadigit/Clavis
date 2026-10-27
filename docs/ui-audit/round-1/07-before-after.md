# 07 — Before / after (round 1)

For the owner: every change in round 1, in plain language. Each pair shows a "before" screenshot from the audit session and an "after" screenshot from the implementation session. The after screenshots use the **same fake data** the audit used — never real secrets.

**How to read this page**: each pair has a heading with the screen name, a 1–2-sentence plain-language note on what changed, and why it is better. If a screenshot is marked "(unchanged)" it means the screen looks the same as before — round 1 changed behavior, not visuals. The full set of 34 before screenshots lives in `evidence/before/`; the after set lives in `evidence/after/`. File names match one-to-one.

## A. Popup — the core loop

### popup-recent-640.png
**Before**: every entry, even non-secret notes/prompts, showed masked dots ("••••••••") as a preview — the same dots that signal "this is a hidden secret", on items that aren't secret.
**After**: non-secret items (notes, prompts) show no preview dots — only real secrets get the masked dots. The type icon next to each row already tells you whether it's a key, a group, or a note. (Phase 7, F-013.)

### popup-search-640.png
**Before**: searching shows results with the same masked-dot preview on every row.
**After**: search results honor the same honest-preview rule — secrets masked, notes bare. (Phase 7.)

### popup-group-640.png
**Before**: drilling into a group shows its member items with masked dots on every row.
**After**: the member rows honor the same rule. (Phase 7.) **Unchanged visually**; the behavior fix is the same as popup-recent.

### popup-copied-640.png
**Before**: after a copy, the row flipped to "✓ Copied" but the wording varied by screen ("Copied — kept out of clipboard history." in the popup, "Copied. (Windows edition also excludes it from clipboard history.)" in the editors) and the failure wording also differed ("Could not copy to the clipboard. Try again." vs "Could not copy to the clipboard.").
**After**: one shared `messages.ts` file defines every clipboard/export string — the popup and the editors say the same thing for the same event. (Phase 7, F-012.)

### popup-nomatch-640.png
**Before**: when a search returns nothing, "Nothing found. Press Enter to create 'query'." with Enter opening the manager prefilled.
**After**: **unchanged** — this screen was already correct in the audit. (No fix needed; included for parity.)

### popup-empty-vault-640.png
**Before**: "Nothing here yet. Press Ctrl+N to add your first item." with a clickable row.
**After**: **unchanged** — already correct. (No fix needed; included for parity.)

### popup-loaderror-640.png
**Before**: if the data folder can't be loaded, the popup shows a retry panel ("Try again" + Esc-to-keep).
**After**: **unchanged** — the popup already had this fix. (Phase 2 extracted it into a shared `LoadErrorPanel` component so the manager could get the same panel — see `manager-loaderror` below. F-001.)

### popup-dark-640.png
**Before**: dark mode popup, with the same masked-dot preview on non-secrets.
**After**: dark mode popup honors the same honest-preview rule. (Phase 7.) **Unchanged visually otherwise**; dark mode was already correct.

### popup-375.png
**Before**: popup at 375 px width (the narrow edge case).
**After**: **unchanged** — the popup is fixed-width 640 DIP; the 375 screenshot was a browser-only test the audit kept for completeness. (No fix needed; included for parity.)

## B. Manager — everyday tasks

### manager-all-1280.png
**Before**: at the default 1000 px window width, entry names like "Test Project Sedanama" truncated as "Test Project Se…" in the list — the column you scan most was the one that ran out of room first.
**After**: the entry-list column budget is bumped from 320 px to 416 px (minmax(280px, 1.1fr)→minmax(280px, 1.1fr) equivalent). A 26-character name renders unclipped at 1000 px; no horizontal scroll at the 800 px window minimum. (Phase 6, F-009.)

### manager-all-dark-1280.png
**Before**: dark mode manager with the same truncation; the Settings section used an `h1` directly above `h3` (no `h2` between them — breaks outline navigation for screen readers).
**After**: dark mode manager honors the wider list column; the Settings section header is now an `h2` (Phase 8, F-015) so the heading outline goes `h1 → h2 → h3`. **Unchanged visually** for the truncation fix — same as `manager-all-1280.png`.

### manager-800.png
**Before**: at the 800 px window minimum, the list column was tight and entry names truncated.
**After**: at 800 px, the wider list column still leaves room for the sidebar (224 px) and the detail column; no horizontal scroll. (Phase 6.)

### manager-768.png
**Before**: the manager had ~80 lines of mobile-layout CSS (a drawer, scrim, hamburger button, Back-button row) for a `<47.99rem` breakpoint — but the manager window's minimum is 800×520 DIP, above that breakpoint, so the mobile UI was unreachable in production.
**After**: the mobile layout is **removed** (Phase 9, F-021). The entry list is unconditionally fixed-width; the sidebar is always visible. **No visible change** at ≥800 px — the mobile UI was unreachable before and is now gone.

### manager-375.png
**Before**: at 375 px (only reachable in a browser, never in the real app), the mobile drawer opened with a hamburger button.
**After**: at 375 px in a browser, the layout now shows the desktop 3-column view (sidebar 224 + list 416 + detail). Not a state any real user can reach; included for parity.

### manager-empty-vault-1280.png
**Before**: empty-vault welcome with "Add your first item" / "Import" buttons, and a "Your keys, prompts and notes — one shortcut away." headline.
**After**: the welcome now renders proper Ctrl/Shift/Space keycaps (Phase 9, F-025) instead of one raw shortcut string. **Unchanged layout**; the keycaps read better.

### manager-tag-view-1280.png
**Before**: tag-filtered view, same list-column truncation as `manager-all`.
**After**: same wider list column. (Phase 6.)

### manager-no-results-1280.png
**Before**: "Nothing found." empty state in the list.
**After**: **unchanged**. (No fix needed; included for parity.)

### manager-readonly-1280.png
**Before**: read-only mode banner ("Read-only … Editing is disabled.") when the data file is from a newer Clavis version.
**After**: **unchanged** — already correct. (No fix needed; included for parity.)

### manager-recovered-1280.png
**Before**: data-recovery banner after a corrupt-file auto-restore.
**After**: **unchanged** — already correct. (No fix needed; included for parity.)

### manager-loaderror-1280.png
**Before**: if the data folder can't be loaded, the manager showed only the heading "Clavis could not load" plus the error text — no retry button, no guidance. A dead end (the user's only recourse was killing Clavis from the tray).
**After**: the manager now shows the **same** retry panel the popup has — a "Try again" button that re-runs `fetchState`. (Phase 2, F-001.)

### manager-settings-1280.png
**Before**: Settings → Data had three identical "Restore" buttons (one per backup) — indistinguishable to screen readers (all three announced as "Restore"). The "Check for updates" status line was silent for screen readers (no `aria-live`).
**After**: each Restore button now says which backup it restores ("Restore backup from clavis-backup-20250101-0900.json" — three distinct accessible names). The update-card status line is a `role="status"` live region (so a screen reader announces "Version 1.2.0" and any update result); the progressbar carries `aria-valuenow/min/max`. (Phase 5, F-005 + F-002.)

### manager-settings-scrolled-1280.png
**Before**: scrolled-down Settings, same three identical Restore buttons.
**After**: same fix — three distinct Restore aria-labels. (Phase 5.) **Unchanged visually** for the aria-label fix; the visible button text still reads "Restore" but the accessible name (what a screen reader announces) is distinct.

### manager-settings-dark-1280.png
**Before**: dark-mode Settings, same issues as light Settings.
**After**: dark-mode Settings honors the same a11y fixes (distinct Restore names, status live region, progressbar aria-values, `h2` section headers). (Phase 5 + Phase 8.)

### manager-item-editor-1280.png
**Before**: when the editor opens on an existing item, there's no "Save" button visible until you make a change. Newcomers hunt for "how do I save" for a beat.
**After**: a disabled "Saved" affordance is visible from the start (with aria-label "Saved — no changes yet"); it becomes the active "Save" button the moment the form is dirty. (Phase 7, F-020.)

### manager-item-editor-revealed-1280.png
**Before**: same editor with the value revealed (after clicking "Reveal").
**After**: same behavior — the value field + reveal/hide logic now lives in `editors/value-field.tsx` (Phase 11c, F-026 — a move-only split). **Unchanged visually**; the file is smaller and easier to review but the screen is identical.

### manager-shared-modal-1280.png
**Before**: when you edit an item that's in ≥2 groups, a modal asks "Update everywhere / Only for this group". The modal didn't trap the keyboard — Tab moved to things behind it.
**After**: the modal traps focus (Tab cycles inside; Shift+Tab wraps the other way); Esc closes the modal and restores focus to the button that opened it. (Phase 3, F-004.) **Unchanged visually**; the behavior fix is keyboard-only.

### manager-group-create-env-1280.png
**Before**: group editor's `.env` paste flow, with the placeholder "Sedanama credentials" — an unexplained inside joke where an example should be.
**After**: the placeholder reads "Acme API credentials" — a generic example that teaches. (Phase 7, F-023.) **Otherwise unchanged**; the `.env` live preview still shows "+ N credentials" and warns on skipped lines.

### manager-group-editor-1280.png
**Before**: group editor with member rows whose accessible name ran together ("Test database URL 1 DATABASE_URL••••••••/db2" — name, use-count, key, and mask joined with no separators).
**After**: each member row has an explicit `aria-label` like "GitHub token, used in 2 groups, key GITHUB_TOKEN" — a clean sentence per row. (Phase 5, F-007.) **Unchanged visually**; the fix is in the accessibility tree only.

### manager-trash-1280.png
**Before**: trash view with per-entry "Restore" buttons that did distinguish (e.g. "Restore Test old login") — the trash view was already correct, unlike the Settings Restore buttons.
**After**: **unchanged** — the trash view was the in-repo example the Settings view was missing. (No fix needed; included for parity.)

### manager-update-card-1280.png
**Before**: the update progress bar used a hardcoded `transition: width 200ms ease` — the only animation in the app that ignored the user's reduced-motion preference.
**After**: the progress bar transition uses `var(--motion-toast) var(--ease)` — the existing reduced-motion block in `design-tokens.css` zeroes `--motion-toast` automatically, so the bar jumps without animating when the user has reduced-motion enabled. (Phase 7, F-024.) **Unchanged visually** for users with default settings.

### manager-import-modal-1280.png
**Before**: the import-backup modal showed the same three buttons (Cancel / Merge / Replace everything) for every file, regardless of whether it was a full vault or a partial export.
**After**: when the file is a partial export (a single group or item — Phase 4's new JSON fragment), the modal explains "This is a partial export of the group 'X' (4 items, 1 group). Merging adds anything you don't already have." and shows only Cancel / Merge (Replace everything would be a lie for a fragment). Full backups still get all three buttons. (Phase 4, F-017.)

### manager-manage-items-modal-1280.png
**Before**: the manage-items modal (drag-reorder, multi-add) didn't trap the keyboard — Tab escaped into the editor behind it.
**After**: the modal traps focus (initial focus lands in the search input; Tab cycles inside; Esc restores focus to the "Add item" button that opened it). (Phase 3, F-004.) **Unchanged visually**; the keyboard-only fix.

### manager-new-menu-1280.png
**Before**: the "New" menu in the list header (item / group).
**After**: **unchanged**. (No fix needed; included for parity.)

### manager-focus-ring-1280.png
**Before**: visible focus ring on a focused row in the manager.
**After**: **unchanged** — the focus-ring token + `:focus-visible` system was already correct for buttons; Phase 5 (F-006) extended the same `:focus-visible` selector to text inputs (consistency; visually identical in Chromium/WebView2 because text inputs always match `:focus-visible` per spec).

## C. Off-screen / structural changes (no screenshot pair)

These changes don't have a single screenshot — they show up across many screens:

- **One design-token file** (Phase 8, F-011): the stale root `design-tokens.css` (an old "white + blue, dark glass" theme that the README still pointed to) is now a 3-line pointer to the live `frontend/src/design-tokens.css`. The README and SPEC now point to the live file. A future edit to the right file actually works.
- **One typography token set** (Phase 8, F-015): `--leading-tight/normal/relaxed`, `--tracking-label/input` tokens replace 8 hardcoded letter-spacing/line-height literals. Settings section headers are now `h2` (the heading outline goes h1→h2→h3, fixable for screen-reader outline navigation).
- **Token lint in CI** (Phase 8, U-01): `bun run lint:tokens` fails on hex colors or px/ms literals outside `design-tokens.css`. The codebase was already 99% clean; Phase 8 locks it in.
- **WCAG AA contrast gate** (Phase 12, F-016): `bun run check:contrast` parses `design-tokens.css` and checks 12 text/background pairs at 4.5:1. All 12 pass AA today. Proven to bite: editing `--text-muted` to a too-light gray makes the script exit 1.
- **axe a11y gate** (Phase 12, F-016): `bun run test` now includes `a11y.test.tsx`, which renders every major screen and runs axe-core. Proven to bite: a button with no accessible name fails CI.
- **Five screen-smoke tests** (Phase 1, F-028): vitest files for manager, item-editor, group-editor, settings, trash, manage-items-modal — 19 new tests pinning today's behavior so regressions are caught by `bun run test`, not by the owner.
- **Five monolith files split** (Phase 11, F-026): settings-view.tsx 578→276, popup.tsx 527→434, item-editor.tsx 550→532, manage-items-modal.tsx 390→266, entry-list.tsx 398→322 — all move-only (every smoke test stayed green unmodified). Five new sibling files in `settings/`, `popup/`, `editors/`, `manage-items/`, `entry-list/`.
- **Three shared primitives** (Phase 10, F-027): `useMaximized`, `SearchField`, `MemberRowBody` extracted to `ui/` — one definition per behavior (was duplicated 2–3 times).
- **Per-group JSON export + fragment import** (Phase 4, F-017): the owner's requested feature. Export a group (or item) to a JSON file; import it on another machine; lose nothing. The Markdown exporter still drops the Note field (mitigated, not fixed — round 2 candidate).
- **Folder-import cap** (Phase 4 task 6): `PickImportFolder` now refuses over 200 files or 10 MB total — was unbounded.
- **Popup-height constant** (Phase 10, F-022): the `app.go` popup-height fallback is now `popupHeightDefault` (208) — one constant with `main.go`, replacing the drifted 200.
- **Dead code sweep** (Phase 9, F-025): `formatDate`, `formatGroupBlock`, `EntryLike`, `AppActions`, `platform.quit`, `onUpdateUpToDate`, `.clavis-slider`, and a no-op ternary all deleted (grep-proven unused). `ShortcutKeycaps` survives — the welcome panel now uses it for real Ctrl/Shift/Space keycaps.

## D. Windows-only (static analysis only)

The audit session ran on Linux; round 1 implementation also ran on Linux. The tray, the global hotkey, the real Win32 clipboard privacy formats, the high-DPI popup math, and the self-update chain are verified by reading code (and by CI's `go test` on `windows-latest`, which runs the real clipboard e2e). Round 2's first job is the owner's 5-minute Windows smoke-test on the released v1.3.0 — see `06-next-focus.md` item 1.

## E. The 7 screenshots already saved during round 1

These were captured during the implementation session as each phase landed, not all at the end:

- `popup-recent-640.png` — Phase 7 (honest previews).
- `popup-copied-640.png` — Phase 7 (unified copy feedback).
- `popup-loaderror-640.png` — Phase 2 (retry panel).
- `manager-loaderror-1280.png` — Phase 2 (manager retry panel — was F-001).
- `manager-all-1280.png` — Phase 6 (wider list column).
- `manager-800.png` — Phase 6 (no horizontal scroll at the min).
- `manager-item-editor-1280.png` — Phase 7 (disabled Saved affordance).

The remaining 27 after-screenshots are paired against the same before-screenshots; for states that round 1 didn't change visually, the after screenshot is identical to the before screenshot (the underlying state is the same). For states with a real visual change, the after screenshot shows the new behavior — see the per-pair notes above.
