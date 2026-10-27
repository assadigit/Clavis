# 02 — Findings (UI/UX audit round 1)

Written: 2026-01-27/28 · Round 1 · **No product code was changed.**

How to read this: every finding has an ID, a lens, a severity, a location, evidence (and how it was observed), why it matters, a suggested fix direction, an effort estimate, and a verification recipe for the session that fixes it.

**Severity scale**: P0 breaks a main task or blocks users · P1 clearly hurts a common path · P2 noticeable friction · P3 polish.
**Observation modes**: "observed" = seen while really running the UI (mocked-backend copy with the real UI code, or the real unmodified frontend in a browser); "static analysis only" = read in code, not run (Linux sandbox — Windows-only behavior).
**Effort**: S ≤ 1 h · M ≤ half a day · L > half a day.

## Priority-lens findings

None — the owner gave no priority lenses this round. Standard lens order used.

## Design-reference deviations

None — no design reference was given; the project's own internal consistency is the yardstick.

---

## Lens 1 — States

### F-001 · Manager load-failure is a dead end (no retry) — **P1**
- **Lens**: States
- **Where**: `frontend/src/manager-entry.tsx:229-235` (`FullMessage title="Clavis could not load"`), vs the popup's retry panel `popup-root.tsx:217-246`
- **Evidence**: observed. With the real, unmodified frontend in a browser (no backend), the manager shows only the heading "Clavis could not load" plus the error text — no "Try again", no guidance. Screenshot `manager-loaderror-1280.png`. The popup got a retry panel for the identical failure (an earlier fix, per the code comment at `popup-root.tsx:11-14`); the manager never did.
- **Why it matters**: if the data folder is briefly unreadable (antivirus lock, sync tool, permissions), the user's only recourse is killing and restarting Clavis from the tray — for a non-programmer owner, a dead end.
- **Suggested fix**: mirror the popup's pattern — a "Try again" button that re-runs `fetchState`, plus Esc-to-keep message; keep it visually identical to the popup's panel.
- **Effort**: S
- **Verify**: run the frontend without a backend (browser), confirm the retry button appears and recovers when the backend returns; screenshot before/after.
- **Status**: open

### F-002 · Async status changes are silent for screen readers (update card, toasts) — **P2**
- **Lens**: States / Accessibility
- **Where**: `frontend/src/components/clavis/settings/update-card.tsx:105-133` (status line), `:166-181` (progressbar)
- **Evidence**: static analysis only. The status text ("Checking GitHub…", "You're up to date — 1.2.0", "Downloading — 42%") is a plain `<span>` with no `aria-live`; the progress bar has `role="progressbar"` but no `aria-valuenow/min/max`. Sonner toasts are announced by the library's own regions, but app-level status lines are not.
- **Why it matters**: a keyboard/screen-reader user presses "Check for updates" and hears nothing back.
- **Suggested fix**: wrap the status in a polite live region (`role="status"`), add the aria-value* attributes to the progressbar.
- **Effort**: S
- **Verify**: with a screen reader or an aria-live inspector, confirm the check result is announced; axe/Lighthouse flag on the progressbar disappears.
- **Status**: open

### F-003 · Editor exports give no plaintext warning (Settings does) — **P3**
- **Lens**: States / Copy
- **Where**: Settings warning `settings-view.tsx:360-363` ("Exported files contain your real secrets in plain text…"); per-item/per-group export menu items `item-editor.tsx:494-495`, `group-editor.tsx:362-363` have no warning
- **Evidence**: static analysis only (menu labels read in code; export dialogs are Win32, not runnable here). Go side writes values verbatim (`internal/exchange/markdown.go:91-116`).
- **Why it matters**: the one screen where a secret is about to leave the app in cleartext is exactly where the warning is missing.
- **Suggested fix**: one shared hint line inside the editors' "More actions" menu (or a one-time toast on first editor export), reusing the existing Settings sentence.
- **Effort**: S
- **Verify**: open an item editor → More actions → warning visible before "Export Markdown/Text".
- **Status**: open

---

## Lens 2 — Accessibility

### F-004 · Modals have no focus trap and no initial focus — **P1**
- **Lens**: Accessibility
- **Where**: `frontend/src/components/clavis/ui/modal.tsx:29-41`
- **Evidence**: static analysis only (verified against the running UI's DOM too). `Modal` renders a scrim + panel but never moves focus into the dialog and never traps Tab; keyboard focus stays on the button behind the scrim. Escape-closing works (esc-stack, `ui/dismiss.ts:8-32`), so only Tab/Shift+Tab escape the dialog.
- **Why it matters**: keyboard-only and screen-reader users can tab into content hidden behind the modal, "lose" the dialog, and save/act on the wrong thing. This affects every modal: import backup, resolve conflicts, manage items, shared edit/delete, category, and (via Menu) dropdowns are separate.
- **Suggested fix**: on open, focus the first focusable (or the panel); trap Tab within the panel; on close, restore focus to the opener. A ~30-line `useFocusTrap` in `ui/modal.tsx` fixes all dialogs at once.
- **Effort**: M
- **Verify**: open any modal, press Tab repeatedly — focus must cycle inside the dialog; press Esc — focus returns to the invoking button.
- **Status**: open

### F-005 · Backup "Restore" buttons are three identical accessible names — **P2**
- **Lens**: Accessibility / Consistency
- **Where**: `frontend/src/components/clavis/settings-view.tsx:394-401`; name rule in `ui/buttons.tsx:53`
- **Evidence**: static analysis only, confirmed in the running UI's accessibility tree ("button 'Restore'" ×3). The trash view does it right ("Restore Test old login" — `trash-view.tsx`), so the pattern exists in-repo.
- **Why it matters**: a screen-reader user cannot tell which of the three backups a "Restore" activates; keyboard users tab through three unnamed buttons.
- **Suggested fix**: pass `ariaLabel={`Restore ${b.name}`}` (Btn supports `ariaLabel`).
- **Effort**: S
- **Verify**: accessibility tree shows three distinct names; tab order unchanged.
- **Status**: open

### F-006 · Text inputs show a focus ring on mouse click — **P3**
- **Lens**: Accessibility
- **Where**: `frontend/src/globals.css:144-148` (`.glass-input:focus`) — buttons/menus already use `:focus-visible` (`globals.css:183,316-317,347,431`)
- **Evidence**: static analysis only; the CSS asymmetry is plain (inputs `:focus`, buttons `:focus-visible`).
- **Why it matters**: cosmetic noise for mouse users; inconsistent with the rest of the focus system.
- **Suggested fix**: switch to `:focus-visible` for inputs too (one line).
- **Effort**: S
- **Verify**: click into the search box — no ring; Tab to it — ring appears.
- **Status**: open

### F-007 · Group member rows concatenate their accessible name — **P3**
- **Lens**: Accessibility
- **Where**: member rows `group-editor.tsx:240-273`, `manage-items-modal.tsx` (SortableMemberRow/candidates); text pieces joined without separators
- **Evidence**: observed in the running UI's accessibility tree: `"Test database URL 1 DATABASE_URL••••••••/db2"` — name, use-count, key and mask run together.
- **Why it matters**: screen-reader announcements are gibberish at worst, ambiguous at best ("1" floats between name and key).
- **Suggested fix**: give the row button an explicit `aria-label` like `{name}, used {n}, key {key}` or insert visually-hidden separators.
- **Effort**: S
- **Verify**: accessibility tree reads a clean sentence per member row.
- **Status**: open

### F-008 · `.clavis-sr-only` exists but is never used; sidebar tree lacks levels — **P3**
- **Lens**: Accessibility
- **Where**: `globals.css:301-308` (class defined, zero usages); sidebar `role="tree"/"treeitem"` without `aria-level`/`aria-expanded` grouping (`sidebar.tsx:52,133`)
- **Evidence**: static analysis only (grep: no usages).
- **Why it matters**: half-built a11y scaffolding invites incomplete patterns later; a flat tree without levels is technically invalid ARIA.
- **Suggested fix**: either use the utility where needed (F-007's separators) or remove it; add `aria-level={1}` (+ group semantics for categories) to sidebar items.
- **Effort**: S
- **Verify**: axe reports no "required ARIA children/attributes" violations on the sidebar.
- **Status**: open

---

## Lens 3 — Visual hierarchy & alignment

### F-009 · Entry names truncate hard in the list at default width — **P2**
- **Lens**: Visual hierarchy / Responsiveness
- **Where**: entry list column `frontend/src/components/clavis/manager.tsx` (3-column split), rows use `truncate` (`entry-list.tsx`)
- **Evidence**: observed. At 1280 px viewport (default window is 1000 px — narrower still), names like "Test Project Sedanama" render as "Test Project Se…" (VLM-verified on `manager-all-dark-1280.png`). The sidebar (fixed) and detail column (wide) squeeze the list, which is the column users scan most.
- **Why it matters**: the manager's primary job is "find the right entry fast"; truncated names force clicks/hovers to disambiguate ("GitHub token (old)" vs "(new)").
- **Suggested fix**: rebalance the 3-column grid (e.g. `minmax(260px, 1.1fr)` for the list), or make the sidebar collapsible, or drop the secondary meta line before truncating the name.
- **Effort**: M
- **Verify**: at 1000 px and 1280 px window widths, a 24-character entry name renders unclipped; baseline B2/B11 still pass.
- **Status**: open

### F-010 · "Nothing selected" panel: primary/secondary buttons not baseline-aligned — **P3**
- **Lens**: Alignment
- **Where**: `frontend/src/components/clavis/manager.tsx:205-217` ("New item" primary + "New group" side by side)
- **Evidence**: observed — VLM-verified on `manager-all-dark-1280.png` ("+ New Item button and New group text button are misaligned; not vertically centered relative to each other"). Different button variants (primary vs glass) with different paddings sit on one row without shared baseline.
- **Why it matters**: small misalignments read as "cheap" even when everything else is tidy.
- **Suggested fix**: `items-center` on the row + matching heights (or stack them in a column with equal widths).
- **Effort**: S
- **Verify**: visual check at 1280 px; both buttons share a center line.
- **Status**: open

---

## Lens 4 — Consistency & tokens

### F-011 · Two diverged "single source of truth" token files — **P2**
- **Lens**: Consistency / UI code health
- **Where**: root `design-tokens.css` (stale v1.0.0 "white + blue, dark glass" theme, old token names `--blue-*/--navy-*`, translucent surfaces) vs `frontend/src/design-tokens.css` (current Bitwarden edition); README.md:85 and SPEC.md:4 still call the **root** file "the single source of style"
- **Evidence**: static analysis only — the two files' headers and contents compared; nothing imports the root file (`globals.css:2` imports the frontend one).
- **Why it matters**: a future session (or the owner) following the README edits the dead file and sees no effect — a trap exactly where the docs point. Also 2 stray `#ffffff` literals live in `globals.css:208,432` instead of `var(--text-on-primary)`.
- **Suggested fix**: delete the root file (or replace with a 3-line pointer comment to `frontend/src/design-tokens.css`), fix the README/SPEC references, swap the two literals to tokens.
- **Effort**: S
- **Verify**: `rg "design-tokens" README.md SPEC.md` points to the live file; no `#fff` literals outside the token file; build + tests green.
- **Status**: open

### F-012 · Three clipboard-failure strings, two secret-copy notes, mixed punctuation — **P3**
- **Lens**: Consistency / Copy
- **Where**: "Could not copy to the clipboard. Try again." (`popup.tsx:193`, `manager.tsx:90`) vs "Could not copy to the clipboard." (`item-editor.tsx:256`, `group-editor.tsx:145`); "Copied — kept out of clipboard history." (popup) vs "Copied. (Windows edition also excludes it from clipboard history.)" (editors); some toasts end with ".", others don't
- **Evidence**: static analysis only (all strings read in code; several also observed live).
- **Why it matters**: same event, different words — erodes trust and makes future copy edits error-prone.
- **Suggested fix**: one shared `messages.ts` (or exported constants) for clipboard feedback; pick one punctuation rule for toasts.
- **Effort**: S
- **Verify**: `rg "Could not copy" frontend/src` returns a single definition referenced everywhere.
- **Status**: open

### F-013 · Non-secret items show a masked value preview — **P3**
- **Lens**: Consistency / Visual hierarchy
- **Where**: `frontend/src/components/clavis/derive.ts:107-119` (`maskFromLast4` returns "••••••••" even with no last-4) used by popup and list rows
- **Evidence**: observed — "Test OpenAI prompt" (isSecret=false) shows "••••••••" in the popup list (`popup-recent-640.png`, visible in the accessibility tree too).
- **Why it matters**: dots signal "hidden secret"; on a plain note/prompt it implies protection that isn't there and wastes the affordance. (Masking values is good default; the issue is *non-secret* items being indistinguishable from secret ones.)
- **Suggested fix**: for `isSecret=false` show a one-line text preview (like "Summarize the following…") or nothing + a note icon; keep dots for secrets.
- **Effort**: S
- **Verify**: popup shows text preview for a non-secret note item; secrets still masked; unit test in `derive.test.ts` updated.
- **Status**: open

### F-014 · Menu trigger duplicates the Btn variant mapping — **P3**
- **Lens**: Consistency / UI code health
- **Where**: `ui/menu.tsx:49-56` re-implements variant→classes mapping that exists in `ui/buttons.tsx:38-45`
- **Evidence**: static analysis only.
- **Why it matters**: a future variant change (e.g. new focus style) silently misses menu triggers.
- **Suggested fix**: export the mapping (or a `btnClasses(variant)` helper) from `buttons.tsx` and reuse.
- **Effort**: S
- **Verify**: single definition found by grep; menus still styled correctly.
- **Status**: open

---

## Lens 5 — Typography

### F-015 · Hardcoded letter-spacings, line-heights and one heading-level skip — **P3**
- **Lens**: Typography
- **Where**: `sidebar.tsx:75` `letterSpacing: "0.05em"`, `inputs.tsx:63` `"0.02em"`; unitless lineHeights `manager.tsx:197` 1.6, `update-card.tsx:194` 1.5, `popup-root.tsx:237` 1.5, `entry-list.tsx:305,317` 1.3, `inputs.tsx:51` 1.5; Settings sections jump h1→h3 with no h2 (`settings-view.tsx` SectionHeader)
- **Evidence**: static analysis only.
- **Why it matters**: type rhythm is token-driven everywhere else; these literals are invisible one-offs that drift. The h-skip matters little in a desktop app but breaks outline/AT navigation.
- **Suggested fix**: add `--tracking-label`, `--leading-*` tokens (or Tailwind utilities) and use them; make SectionHeader an h2.
- **Effort**: S
- **Verify**: grep for `letterSpacing:` and `lineHeight:` in tsx returns only token references; headings h1→h2→h3 in Settings.
- **Status**: open

---

## Lens 6 — Color & contrast

**What was checked**: every TSX file for hex colors (0 found — all `var(--*)`, excellent); the two `#ffffff` literals in `globals.css` (see F-011); dark-mode token block; toast/menu/scrollbar styling. No numeric WCAG audit was run this round — **contrast ratios were not measured** (unknown, not "passing"). Spot visual checks of light and dark screenshots found no obvious unreadable text.

### F-016 · Contrast not measured anywhere (no automated check) — **P3, opportunity**
- **Lens**: Color & contrast
- **Where**: whole frontend; CI has no contrast check
- **Evidence**: n/a (absence)
- **Why it matters**: the token file claims AA ("Contrast values below were verified with a WCAG script" — root `design-tokens.css:6`), but that script isn't in the repo and the claim belongs to the *stale* file (F-011). Muted grays on dark surfaces are the usual risk.
- **Suggested fix**: add a tiny CI step (axe-core on the built pages in a headless browser) or at minimum a documented manual contrast pass over the token pairs.
- **Effort**: M
- **Verify**: CI job runs and reports; any AA failures listed and fixed.
- **Status**: open

---

## Lens 7 — Flow & clarity

### F-017 · Export/import surface is fragmented; per-group JSON round-trip is impossible — **P1 (feature gap)**
- **Lens**: Flow & clarity (+ owner feature request)
- **Where**: full backup in Settings (`settings-view.tsx:352`); per-item/group Markdown/TXT in editors' "More actions" (`item-editor.tsx:494-495`, `group-editor.tsx:362-363`); folder import rejects JSON (`internal/store/import.go:246-248`)
- **Evidence**: static analysis only for the Go half; UI half observed. The owner's use case — "20 passwords under a group, export that group, import it later" — today produces a `.md`/`.txt` file that **cannot** restore what was exported (see F-018) or a full-vault JSON that is all-or-nothing.
- **Why it matters**: the owner explicitly asked for per-group export + easy re-import. It is also the natural "move a project's credentials between machines" flow for any user.
- **Suggested fix**: new export kind `group-json` (and optionally `item-json`) writing a **Clavis backup fragment** (same schema fields the backup already uses), plus import that accepts fragments via the existing "Import backup" path (detect fragment vs full vault). Reuse: body builder `internal/store/import.go:55-66` granularity, merge logic `import.go:202-233`, pre-import backup hook `store.go:577-600`. Mind: `NormalizeVault` requires full-vault shape (`normalize.go:52-69`) — the fragment needs its own validator. No changes to secret-protection logic are needed (values ride the same plaintext-as-backup path that already exists).
- **Effort**: L (Go + UI + tests)
- **Verify**: export a group → JSON file contains that group + its items with notes/tags/isSecret; import into a fresh vault with Merge → group + items restored incl. shared references kept as items; existing full-backup import still passes its tests; baseline C3–C6 pass.
- **Status**: open (owner-requested feature; planned as its own phase)

### F-018 · Markdown export silently drops the item Note (data loss) — **P2**
- **Lens**: Flow & clarity / Data integrity
- **Where**: `internal/exchange/markdown.go:91-103` (exporter omits `note` though `MdItem` carries it, `markdown.go:59-67`); parser never reads it back
- **Evidence**: static analysis only.
- **Why it matters**: "Export all as Markdown" is advertised as a vault dump; losing notes makes it a lie as a backup path and a trap for re-import.
- **Suggested fix**: render `note:` in the front-matter and parse it back (it's a pure-Go, fully unit-tested module — no off-limits code involved).
- **Effort**: S–M
- **Verify**: round-trip unit test: item with note → export → import → note survives.
- **Status**: open

### F-019 · Markdown/TXT round-trip loses per-item metadata and shared references — **P2**
- **Lens**: Flow & clarity / Data integrity
- **Where**: `internal/store/import.go:289-478` — imported items take the group's tags and secret flag (`:435,469`), lose pinned/useCount, and shared items (one item in 2 groups) export twice and re-import as two copies; group TXT loses name/category/tags
- **Evidence**: static analysis only.
- **Why it matters**: users who "back up" a group via Markdown and restore it get silently different data (double items, unmasked-by-default secrets inverted, pins gone).
- **Suggested fix**: mostly mitigated by F-017 (JSON fragments). For Markdown, keep it honestly lossy: document it in the UI ("Markdown export is for reading/sharing, not backups — use JSON").
- **Effort**: S (copy) / covered by F-017 (real fix)
- **Verify**: export menu shows the guidance sentence; docs updated.
- **Status**: open

### F-020 · Save button hidden until dirty — **P3**
- **Lens**: Flow & clarity
- **Where**: `item-editor.tsx:484-486` (Save only when dirty)
- **Evidence**: observed — editor opens with no Save anywhere; it appears only after editing.
- **Why it matters**: newcomers hunt for "how do I save" for a beat; the convention (Ctrl+S/Enter) is only discoverable via the hint under the value field.
- **Suggested fix**: keep the behavior but render a disabled "Saved" state in the same slot, so the affordance exists from the start.
- **Effort**: S
- **Verify**: editor shows a disabled save affordance on open; becomes active on change.
- **Status**: open

---

## Lens 8 — Responsiveness & window behavior

**What was checked**: browser widths 375/768/800/1280 (screenshots), popup at 640/375; window min sizes, remembered bounds, maximize styling, high-DPI math in Go (static). Browser results: no overflow, no horizontal scroll, mobile drawer works at 375 (but see F-021).

### F-021 · Mobile layout code is unreachable in production — **P2 (dead surface)**
- **Lens**: Responsiveness / UI code health
- **Where**: `globals.css:492-507` (47.99rem breakpoint), mobile drawer + scrim + Back button `manager.tsx:44,106-110,309-311,347-350`, `md:` utilities
- **Evidence**: static analysis + observed. The manager window's minimum is **800×520 DIP** (`main.go:133-134`), above the 768 px breakpoint — the mobile UI can only appear if OS DPI scaling shrinks the CSS viewport below 768 px (edge case: high-DPI small screens maximized).
- **Why it matters**: ~80 lines of layout logic that no user can reliably reach — untested, will rot, and confuses future work ("is Clavis mobile-ready?").
- **Suggested fix**: decide — either (a) drop the breakpoint + drawer code and keep desktop-only (smaller CSS), or (b) keep it and add one vitest that renders the manager at 375 px so it can't rot. Do **not** change the window min size (that's fine).
- **Effort**: S (a) / M (b)
- **Verify**: chosen option applied; `rg "md:hidden" frontend/src` matches only intentional uses or none.
- **Status**: open

### F-022 · Popup default height 208 vs fallback 200 — **P3**
- **Lens**: Window behavior
- **Where**: `main.go:34` (`popupHeightDefault = 208`) vs `app.go:308` (`ph = 200` fallback)
- **Evidence**: static analysis only (both constants read).
- **Why it matters**: 8 DIP of inconsistent placement on first show before the frontend measures itself — harmless but sloppy; two constants for one fact invites drift.
- **Suggested fix**: share one constant (export from a small package or pass through). **Careful**: `main.go`/`app.go` also contain hotkey/window code — the change is a constant move only; the upgrade session must not refactor neighbors while there.
- **Effort**: S
- **Verify**: grep finds one definition; popup first-show placement unchanged (owner smoke test on Windows).
- **Status**: open

---

## Lens 9 — Keyboard & keyboard-only use (checked with real Tab/arrow/Enter/Esc passes)

**What was checked**: popup combobox pattern (complete, ARIA-correct — `popup.tsx:414-436`), arrow wrap, Enter/Esc/Backspace behaviors, Ctrl+N/Ctrl+E cross-window shortcuts with capture-guard, editor Enter-to-save with target guards, tag-input keys, dnd-kit keyboard sensor in manage-items, esc-stack topmost-only closing, focus refocus on window focus. Overall strong. Gaps found:

- **F-004** (focus trap — above) is the one real keyboard gap.
- **F-006** (focus ring on click) — above.
- No skip-links/landmarks beyond `aside`/`section` — acceptable in a 3-pane desktop app; noted, no finding.

---

## Lens 10 — Copy & microcopy

**What was checked**: full string inventory (~120 user-visible strings) gathered during exploration. Tone is consistently calm, specific, and plain-language — genuinely good ("Close Clavis (it keeps running in the background)"). Issues found: F-012 (inconsistent clipboard strings), F-003 (missing export warning), plus:

### F-023 · Placeholder uses unexplained codename "Sedanama credentials" — **P3**
- **Lens**: Copy
- **Where**: `group-editor.tsx:176`
- **Evidence**: static analysis only; also present in test fixtures.
- **Why it matters**: users see an inside joke where an example should be ("Project API credentials" teaches; "Sedanama" puzzles).
- **Suggested fix**: swap to a generic example ("Acme API credentials").
- **Effort**: S · **Verify**: placeholder reads generically; tests updated. · **Status**: open

---

## Lens 11 — Performance feel

**What was checked**: popup entrance animation (100 ms token, reduced-motion respected), toast durations, ResizeObserver→SetPopupSize loop, scroll containment, font inlining (single origin, offline), no layout thrash observed while driving the UI, dev console free of warnings. One gap:

### F-024 · Update progress bar hardcodes its transition — **P3**
- **Lens**: Performance feel / Motion
- **Where**: `update-card.tsx:178` `transition: "width 200ms ease"` — motion tokens (`--motion-toast`, `--ease`) and the reduced-motion zeroing (`design-tokens.css:111-113`) don't apply
- **Evidence**: static analysis only.
- **Why it matters**: the one animation that ignores the user's reduced-motion preference.
- **Suggested fix**: use `transition: width var(--motion-toast) var(--ease)` (the reduced-motion block already zeroes `--motion-*`).
- **Effort**: S · **Verify**: with reduced-motion emulated, the bar jumps without animating. · **Status**: open

---

## Lens 12 — UI code health

### F-025 · Dead code and zombie settings — **P2**
- **Lens**: UI code health
- **Where** (all verified unused by grep): `ShortcutKeycaps` (`icons.tsx:75-86` — while `manager.tsx:199` renders the raw shortcut string instead), `formatDate` (`derive.ts:135-139`), `formatGroupBlock` (`dotenv.ts:65-67`), `EntryLike`/`AppActions` (`app-types.ts:31-43`), `platform.quit` (`platform.ts:56-58`), `onUpdateUpToDate` (`platform.ts:133-137`), `.clavis-slider` CSS "kept for compatibility" (`globals.css:385-415`, no slider exists), `Settings.glassIntensity` persisted+normalized but no UI consumes it (`types.ts:69`; Go `store.go:1362-1371` still clamps it), no-op ternary `item-editor.tsx:296`, `APP_VERSION` in `types.ts` drifts from `package.json` (displayed version actually comes from Go — cosmetic)
- **Evidence**: static analysis only.
- **Why it matters**: every dead line is a question a future session must answer again; `glassIntensity` especially looks like a real setting that does nothing.
- **Suggested fix**: one deletion pass (frontend-only pieces); leave the Go `glassIntensity` field untouched in the data model (schema compatibility) but stop normalizing it in the UI layer, or document it as reserved.
- **Effort**: M
- **Verify**: `tsc --noEmit` and vitest pass; grep for each symbol returns zero; UI behavior unchanged (baseline re-run).
- **Status**: open

### F-026 · Monolithic screen files — **P2**
- **Lens**: UI code health
- **Where**: `settings-view.tsx` 547 lines, `popup.tsx` 526, `item-editor.tsx` 525, `manage-items-modal.tsx` 426, `entry-list.tsx` 410 — the repo already began this refactor (`settings/update-card.tsx`, `settings/choice-pair.tsx` are "move-only" splits)
- **Evidence**: static analysis only (line counts).
- **Why it matters**: harder reviews, riskier edits, and the reason small fixes touch big diffs.
- **Suggested fix**: continue the started pattern — move the import flows out of `settings-view.tsx`, the copy/env logic out of `group-editor.tsx`, the row components out of `entry-list.tsx`. Move-only, no behavior change, one file per commit.
- **Effort**: M (per file)
- **Verify**: per-file line count < ~300; baseline re-run; `git diff --stat` shows moves.
- **Status**: open

### F-027 · Duplicated blocks across components — **P3**
- **Lens**: UI code health
- **Where**: two maximized-state listeners (`manager-entry.tsx:107-112` vs `manager.tsx:47-52`); search-icon hover-positioning duplicated (`entry-list.tsx:262-273` ≈ `manage-items-modal.tsx:178-189`); search-input styling duplicated (`entry-list.tsx:274-290` ≈ `manage-items-modal.tsx:190-212`); member-row markup ×3 (`group-editor.tsx:240-273`, `manage-items-modal.tsx:226-269,321-425`)
- **Evidence**: static analysis only.
- **Why it matters**: fix-one-miss-one defects (some already diverged slightly).
- **Suggested fix**: extract `SearchField`, `MemberRow`, `useMaximized` into `components/clavis/ui/` — small, mechanical.
- **Effort**: M · **Verify**: grep shows single definitions; visual parity at 800/1280 px. · **Status**: open

### F-028 · Most screens have no frontend tests — **P3**
- **Lens**: UI code health
- **Where**: tests exist only for popup flow, popup-root load failure, hotkey parse, derive, dotenv, search — nothing covers manager layout, editors, settings, trash, modals, ui primitives
- **Evidence**: static analysis only (test file list).
- **Why it matters**: the upgrade phases will edit exactly those untested screens; without tests, the baseline checklist is the only safety net.
- **Suggested fix**: add a smoke test per major screen (renders, key interactions) before/alongside the upgrade phases — jsdom + the existing vitest setup makes each ~30 lines.
- **Effort**: M
- **Verify**: `bun run test` covers each screen file at least once.
- **Status**: open

---

## Desktop / tray lens (conditional — applies)

- Tray menu structure is simple and sane; **no separators and no default (bold) item** (`main.go:202-247`) — P3 polish, noted here rather than as a numbered finding (needs Windows to verify visually; the code is Go but *not* hotkey/clipboard logic, so a separator/default-item tweak is allowed if ever desired).
- Hotkey conflict handling (banner + rollback) verified in code — good. **Static analysis only.**
- Window close = hide-to-tray, single-instance, autostart `--hidden` — all correct patterns. **Static analysis only.**
- High-DPI popup math is unit-tested (`internal/popupmath/popupmath_test.go`) — good sign.

## Forms lens (conditional — applies)

- Field order, validation timing (on-save), inline group chips ("editing within 'X'"), `.env` live preview with skipped-line warning — all good, observed live.
- Enter-to-save with Ctrl+Enter-newline is well-guarded (`item-editor.tsx:139-163`).
- Gap: **F-020** (hidden save affordance) and **F-004** (modal focus) are the form-flow findings.

## Farsi/RTL lens (conditional — does **not** apply; decision + reason in `01-explore-notes.md` §5)

- No Farsi/Arabic UI content, no RTL CSS. `dir="auto"` already used on all user-content fields (20 occurrences), and Farsi search is unit-tested (`search.test.ts:128-136`). If the owner stores Persian entry names, they will render and search correctly. Nothing to fix.

---

## Upgrade opportunities (ranked, beyond defect fixes)

1. **U-01 Token unification** — after F-011, add a CI lint that fails on hex colors or px literals outside `design-tokens.css` (the codebase is already 99% clean; lock it in). Effort S.
2. **U-02 Generated API bindings** — the hand-written `client.ts`/`platform.ts` duplicate Go shapes and drift (the stale `WriteClipboard` doc comment at `app.go:10` proves the risk). Wails v3 can generate TS bindings; adopt them for new code at least. Effort M.
3. **U-03 Screen smoke tests** — see F-028; do it as a foundation phase, not an afterthought.
4. **U-04 Focus-trap utility + axe pass** — F-004's fix plus one axe run in CI catches regressions (ties into F-016).
5. **U-05 Contrast CI job** — see F-016.
6. **U-06 Toast copy single-source** — pairs with F-012; one `messages.ts` also gives translators (if ever) a single file.
7. **U-07 Keyboard shortcut help overlay** — `?` overlay listing all shortcuts (popup + manager); the hints exist piecemeal (footer, editor hint line); one overlay would surface the keyboard-first design. Effort M.
8. **U-08 Motion token audit** — after F-024, sweep remaining transitions (sonner config, dnd-kit) through tokens. Effort S.

---

## Findings that are report-only (off-limits)

- **Clipboard privacy UX**: the copy flow writes the clipboard in Go with privacy formats and only then returns success (fail-closed, `clipboard_windows.go:171-196`) — excellent design. Any UI change to copy feedback (F-012 wording) must stay in the frontend; the Go side stays untouched. **No off-limits fix is proposed; nothing to report beyond this note.**
- **Hotkey registration flow** (`main.go`, `app.go:163-225`): conflict messaging and rollback are already good; no change proposed.
- **Owner's real vault**: never opened, never read, never screenshotted. All evidence uses fake values.
