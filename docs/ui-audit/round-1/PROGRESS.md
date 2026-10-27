# PROGRESS — UI/UX upgrade round 1 (implementation tracker)

This file is the single source of truth for the upgrade session's progress.
The audit session (round 1, documents only) is **complete**. The implementation session follows `05-session2-prompt.md`, executing `04-fix-plan.md` (phase order, milestones) with `04b-implementation-plan.md` as the code-level companion (exact files, anchors, data shapes, test matrices).

## Upgrade session record

- Implementation session started 2026-10-28 on Linux (Debian 13). Windows-only behavior remains static-analysis-only, exactly as in the audit session.
- Toolchain: Go 1.27.3 (matches go.mod) installed locally; bun 1.3.14.
- Restore point tag **`pre-ui-upgrade-round-1`** created at `e0bf65b` and pushed to origin before the first change.
- `git status` was clean at session start (no owner uncommitted changes to protect).
- Baseline before any change: `bun run build` ✓ · `bun run test` 41/41 in 6 files ✓ · `go vet ./internal/...` ✓ · `go test ./internal/...` all ok ✓ · `gofmt -l .` empty ✓ · `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go vet ./...` ✓.

## Audit session record (done)

- Restore point `pre-ui-audit-round-1` created at `8edcecc` and pushed (2026-01-27/28).
- All audit documents written (`01` … `05`, this file, `README.md`, `00-TASK.md`).
- 34 before-screenshots in `evidence/before/`.
- **No product code was changed by the audit session.**

## Upgrade phases

| Phase | Goal | Status | Commit | Notes |
|---|---|---|---|---|
| 1 | Screen smoke tests (safety net) | **done** | `15cc4a7` | 6 new vitest files, 19 new tests; 60/60 in 12 files; only `*.test.tsx` touched |
| 2 | Manager load-failure retry panel (F-001) | **done** | `2fffee7` | shared `LoadErrorPanel` in both windows; verified live; after-screenshots saved |
| 3 | Modal focus trap (F-004) | **done** | `eff44ee` | ui/modal.tsx only (+ new test); verified live on 3 modals |
| 4 | Per-group/per-item JSON export + fragment import (F-017, F-018, F-019, F-003) | **done** | 4a `0634d42` + 4b (this commit) | owner-requested feature; 11 Go tests + 3 frontend tests; folder-import cap added (task 6) |
| 5 | A11y batch (F-002, F-005, F-006, F-007, F-008) | **done** | `aaa0fbf` | see Phase 5 detail below |
| 6 | Manager list-column budget + button alignment (F-009, F-010) | **done** | `2643aa7` | see Phase 6 detail below |
| 7 | Feedback & copy consistency (F-012, F-013, F-020, F-023, F-024) | **done** | `bb7fe2b` | see Phase 7 detail below |
| 8 | Single token source + lint (F-011, F-015) | **done** | `78af109` | see Phase 8 detail below |
| 9 | Dead code sweep + mobile decision (F-025, F-021) | **done** | `81bc400` | see Phase 9 detail below |
| 10 | De-duplication + popup height constant (F-014, F-022, F-027) | **done** | `a900bf7` | see Phase 10 detail below |
| 11 | Split monoliths, move-only (F-026) | **done** | 11a `4d0a6d1` + 11b `24655b7` + 11c `430f673` + 11d `5e94a44` | 5 files split (by a parallel session — same plan, same outcome); 4 remain over ~350 (popup, item-editor, group-editor, manager) |
| 12 | UI quality gates: axe + contrast (F-016) | **done** | `8973238` (cherry-picked onto remote) | 7 tests in `a11y.test.tsx`; 12 WCAG AA pairs; both gates proven to bite |
| R1 | Final re-audit: lenses + full baseline + after screenshots + `07-before-after.md` + `06-next-focus.md` | not started | — | before release |
| R2 | Release v1.3.0 (bump ×5, tag, push, verify live) | not started | — | rollback plan below must be filled before deploying |

### Phase 1 detail (done)

- New files: `manager.test.tsx`, `item-editor.test.tsx`, `group-editor.test.tsx`, `settings-view.test.tsx`, `trash-view.test.tsx`, `manage-items-modal.test.tsx` (all under `frontend/src/components/clavis/`).
- Pins current behavior, including the two findings that later phases change deliberately: Save-button-hidden-until-dirty (F-020, updated in Phase 7) and the three identical "Restore" accessible names (F-005, updated in Phase 5).
- Baseline re-run after phase: `bun run build` ✓, `bun run test` 60/60 ✓ (canary coverage: A2/A5/A7 via the popup tests, B2 via the new manager smoke test; B18 dark mode has no rendering-path change in this phase and gets its visual check in R1 screenshots).
- Nothing skipped.

### Phase 2 detail (done) — F-001 fixed

- New shared component `ui/load-error.tsx` (`LoadErrorPanel`), re-exported from `ui-bits.tsx`; body extracted move-only from `popup-root.tsx`'s `PopupLoadError` (identical panel pixels; popup keeps its own Esc-to-hide effect).
- `manager-entry.tsx`: the error `FullMessage` dead end is replaced by `LoadErrorPanel` with a `reload` callback that re-runs `fetchState` (loading state "Loading your keys…" untouched; no Esc handler in the manager by design).
- Tests: `popup-root.test.tsx` extended with the manager variant (2 new tests) — 62/62 green; `bun run build` ✓.
- Verified live (frontend without backend, real browser): `/popup.html` and `/manager.html` both show the panel with "Try again"; clicking Retry re-attempts and the panel persists on re-failure; console clean apart from the expected Wails browser-environment warning. After-screenshots: `evidence/after/popup-loaderror-640.png`, `evidence/after/manager-loaderror-1280.png`.
- Baseline re-run: A10 ✓ (popup retry), B14 ✓ (manager now has retry — was the finding), canaries A2/A5/A7 (popup tests) and B2 (manager smoke) ✓, B18 unchanged rendering path ✓.

### Phase 3 detail (done) — F-004 fixed

- Only `ui/modal.tsx` changed (+ new `ui/modal-focus.test.tsx`): on open, focus lands inside the dialog (autoFocus children are respected — the manage-items search input keeps its focus); Tab/Shift+Tab cycle within the panel; any close path (Esc via the untouched esc-stack, scrim, X, Done, parent unmount) restores focus to the opener.
- Implementation notes (mechanics within the plan's sketch): the opener is captured during the *render* that flips `open` true — an effect runs too late (autoFocus inputs grab focus during commit and the panel would capture itself as its own opener; found live in the browser, then fixed). The visibility filter probes once whether the host has layout (jsdom does not; `offsetParent` is null for everything there) so the trap works in both jsdom and the real browser.
- Verified live (mocked backend, real browser): category modal (focus starts in the input, 4× Tab inside, Esc → focus back on "Add category"), manage-items modal (autoFocus search keeps focus, 5× Tab + Shift+Tab inside, Done → focus back on "Add item"), import-backup modal (4× Tab inside, Esc → focus back on "Import backup").
- Automated: `ui/modal-focus.test.tsx` 4 tests (initial focus, 5-Tab trap, Shift+Tab wrap, Esc restore). 66/66 in 13 files; `bun run build` ✓.
- Baseline re-run: B8 ✓ (manage-items modal — smoke test + live), C4 ✓ (import-backup modal live), canaries A2/A5/A7 (popup tests) ✓, B2 (manager smoke) ✓, B18 unchanged ✓. esc-stack (`ui/dismiss.ts`) untouched as required.

### Phase 4 detail (done) — F-017 fixed, F-018/F-019 mitigated, F-003 fixed

The owner's requested feature: export one group (or item) to JSON, import it later or on another machine, lose nothing.

- **4a (Go, commit `0634d42`)**: new `internal/store/fragment.go` — `clavis-fragment` envelope (kind, fragmentVersion 1, scope, categories, groups, items; row shapes byte-compatible with the full backup). `ImportBackupPreview`/`ImportBackup` detect fragments first; fragments always merge with the exact full-backup merge semantics (id + newer `updatedAt` wins); the pre-import backup hook applies; future versions are rejected. `BackupPreview.Fragment` threads through the service; `ExportSave` accepts `item-json`/`group-json`. 11 Go tests: lossless export, item export, soft-delete exclusion, not-found, round-trip into an empty vault, newer-local-wins, older-local-wins, double-import = all skipped, preview discrimination, future-version rejection, pre-import-backup proof, plus the full-backup regression test. (The plan's `offsetParent`-style visibility filter from 04b was not needed here; the service-threading detail was adjusted so a missing fragment key is omitted, not JSON-null.)
- **4b (frontend, this commit)**: `client.ts` gains the two `ExportWhat` kinds and the optional `fragment` on `BackupPreview`; both editors get "Export JSON (backup-safe)" as the first More-actions item with the F-003 plaintext warning (`MenuItem` grew an optional `hint` line); the import modal explains partial exports ("This is a partial export of the group "X" (4 items, 1 group). Merging adds anything you don't already have."), hides "Replace everything" and makes Merge primary for fragments. Full backups keep all three buttons.
- **Task 6 (folder-import cap)**: `PickImportFolder` now refuses over 200 files or 10 MB with a friendly error (was unbounded).
- Verified live in the mocked copy: group editor → More actions → Export JSON → "Saved: …" toast; fragment upload → partial-export sentence + only Cancel/Merge; Merge → "Imported — added 2, updated 1, skipped 1." toast; full-backup upload still shows Cancel/Merge/Replace everything.
- For the record (F-018/F-019): Markdown export still drops the Note field — the lossless JSON path now exists (the plan's mitigation); fixing the Markdown exporter itself stays round-2 material and is recorded in `06-next-focus.md` at R1.
- Baseline re-run: C3 ✓ (Export everything unchanged), C4 ✓ (import modal live, both variants), C5 ✓ (More-menu exports verified live + pinned in tests), C6 unchanged code path, canaries A2/A5/B2 via tests ✓, B18 untouched ✓. `bun run test` 69/69 in 13 files, `bun run build` ✓, `go test ./internal/...` ✓, `gofmt -l .` empty, windows-target `go vet` ✓.
- Nothing skipped.

## Findings status

Interim (final statuses recorded at Phase R1): F-001 **fixed** (Phase 2) · F-003 **fixed** (Phase 4) · F-004 **fixed** (Phase 3) · F-017 **fixed** (Phase 4) · F-018 **mitigated** (lossless JSON path; exporter itself untouched) · F-019 **mitigated** (same) · all others open.

## Scope additions (record any deviation here, with reason)

- (none)

## Skipped / blocked (with reason)

- (none)

## Rollback plan

(Fill this in **before** deploying — Phase R2 task 1. What is live, the exact undo steps, the restore tags.)

### Phase 5 detail (done) — F-002, F-005, F-006, F-007, F-008 fixed

- F-005: every backup Restore button now says which backup it restores — `ariaLabel="Restore backup from <name>"` (live a11y tree shows three distinct names; the Phase-1 smoke test was updated to pin the new names).
- F-002: the update-card status line is a `role="status"` live region; the progressbar carries `aria-valuenow/min/max`. Verified live: the region reads "Version 1.2.0" and updates would be announced.
- F-006: `.glass-input:focus` → `.glass-input:focus-visible` — the CSS asymmetry is gone. Honesty note: in Chromium/WebView2, text inputs **always** match `:focus-visible` (typing follows mouse focus, per spec), so the audit's verify recipe "click → no ring" does not and should not apply to text inputs; the fix is the consistency itself (one selector family for every control, verified: the ring renders identically for programmatic and keyboard focus).
- F-007: explicit accessible names everywhere text used to concatenate — group-editor member rows ("GitHub token, used in 2 groups, key GITHUB_TOKEN"), manage-items sortable rows (role="group" + the same sentence), and candidate rows (name only; aria-pressed already carries selection). Verified live: clean sentences in the a11y tree.
- F-008: sidebar treeitems carry `aria-level={1}` explicitly (live tree shows [level=1] from the attribute now, not DOM inference); `.clavis-sr-only` deleted (zero usages remained after choosing aria-labels over visually-hidden separators — grep-proven).
- No styling changes. Tests updated/extended (3 assertion changes, all strengthening): 70/70 green in 13 files; `bun run build` ✓.
- Baseline re-run: B8 ✓, C7 ✓ (three distinct Restores, live), C8 ✓ (status region live), canaries A2/A5/B2 via tests ✓, B18 unchanged ✓.
- Nothing skipped.

### Phase 6 detail (done) — F-009, F-010 fixed

- F-009: the entry-list column cap rises from `calc(var(--space-6) * 10)` (320px) to `calc(var(--space-6) * 13)` (416px) — the smaller of the plan's two options. The sidebar and the right-side row meta are untouched; the window min stays 800×520.
- F-010: the nothing-selected "New item"/"New group" row gets `alignItems: "center"` so both variants share one center line.
- Verified live in the mocked copy with a 32-character entry name (harder than the milestone's 26): unclipped at the 1000px default window width (name box = content = 257px, clipped=false) and at 1280px; **no horizontal scroll at 800px** (scrollWidth exactly 800 — the detail column owns overflow: hidden). Button centers at 1280px: 476.3 / 476.3 — aligned.
- Evidence: `evidence/after/manager-all-1280.png`, `evidence/after/manager-800.png` (the same screens the before set pairs against; fake data only, incl. the FAKE 32-char test entry).
- Baseline re-run: B2 ✓ (live at all three widths), B11 ✓ (tests), E4 ✓ (800/1000/1280 checked live), canaries A2/A5/A7/B2/B18 via the suite ✓ (70/70), `bun run build` ✓.
- Nothing skipped.

### Phase 7 detail (done) — F-012, F-013, F-020, F-023, F-024 fixed

- F-012: new `frontend/src/lib/clavis/messages.ts` is the single voice for clipboard/export feedback; popup, manager rows, both editors and the export path all use it ("Could not copy that value. Try again." ×1, one secret note "Copied — kept out of clipboard history.", export toasts shared). Verified by grep: exactly one "Could not copy" definition, one clipboard-history note.
- Scope addition (small, within the finding's own rule "same event, same words"): the manager's list-row copy toast read "Copied 1 lines — <name>." for *items* (pre-existing — the real backend reports LineCount 1 for items); items now say "Copied <name>." and the line counters pluralize correctly ("1 line", "2 lines"). Found live while verifying; the audit's F-012 fix direction covers it.
- F-013: `derive.ts` gains `rowPreview({isSecret, valueLast4})` — secrets keep the masked dots; **non-secret prompts/notes show nothing instead of lying dots** (04's explicitly-allowed "nothing + note icon" variant; every row's type icon already distinguishes key vs note). Honest deviation from 04b's sketch: `previewText(value, isSecret)` on raw values is impossible for rows — the state snapshot is redacted and Phase 7's do-not-touch list pins the backend redaction; recorded here rather than silently diverging. Verified live: the OpenAI prompt row shows no dots; every secret row still shows dots; `derive.test.ts` pins both.
- F-020: both editors render a disabled "Saved" affordance when the form is clean (create mode is always dirty → unchanged); live-checked (`disabled=true` on open).
- F-023: "Sedanama credentials" → "Acme API credentials" — placeholder, popup/search test fixtures, `#sedanama` → `#acme`; grep finds zero "Sedanama".
- F-024: the update progress bar transition uses `var(--motion-toast) var(--ease)` — the existing reduced-motion block zeroes it (static-verified: `@media (prefers-reduced-motion: reduce) { --motion-toast: 0ms }`).
- Verified live in the mocked copy + evidence: `popup-recent-640.png` (honest previews), `popup-copied-640.png` (frozen auto-hide; unified secret note), `manager-item-editor-1280.png` (disabled Saved).
- Baseline re-run: A7 ✓ (copy feedback live), A12 ✓ (masking unchanged for secrets; honest for non-secrets), B5/B6 ✓ (editor tests), C8 ✓; canaries A2/A5/B2/B18 via the suite (72/72), `bun run build` ✓.
- Nothing skipped.

### Phase 8 detail (done) — F-011, F-015 fixed; U-01 lint live

- Root `design-tokens.css` (the stale v1.0.0 "white + blue, dark glass" theme with old `--blue-*/--navy-*` names) is now a 3-line pointer to `frontend/src/design-tokens.css`; README.md and all five SPEC.md references point to the live file.
- The two `#ffffff` literals in globals.css → `var(--text-on-primary)`; grep proves zero hex colors outside the token file.
- Typography tokens added (`--leading-tight/normal/relaxed`, `--tracking-label/input`) and all eight hardcoded line-height/letter-spacing literals replaced (manager, inputs, menu hint, load-error, update-card, entry-list ×2, sidebar); SectionHeader is now an `h2` (Settings goes h1→h2→h3).
- Also removed while here: the redundant `@media (prefers-reduced-motion) { .clavis-pop-in { animation-duration: 0ms } }` override in globals.css — the token file already zeroes `--motion-popup-in` in that context (the only ms literal outside tokens; zero behavior change).
- New gate: `frontend/scripts/check-tokens.mjs` (node, zero deps) — fails on hex colors anywhere outside `src/design-tokens.css` and on px/ms literals outside a documented allowlist (hairline `1px solid` borders, the selected-row `inset 3px` bar, scrollbar widths, modal/popup width caps, the 170px grid floor). Wired as `bun run lint:tokens` and as a CI step in the frontend job (after tests). Proven to bite: injected `#123456` → exit 1 → removed. (One self-inflicted detour: removing the injected test color with sed ate the `} /* end @layer components */` line — the build caught it instantly, brace restored, build green. No product change was affected.)
- Honesty note on the allowlist: hairline borders (22× `1px` in CSS + many inline) are allowlisted rather than tokenized — the plan's token list didn't include a border-width token, and swapping ~50 sites is churn best left to round 2 (recorded for 06-next-focus.md).
- Verified: 72/72 tests, `bun run build` ✓, `lint:tokens` clean, hex grep clean, Settings headings [level=2] in the live a11y tree, dark mode + 1px row borders unchanged live (E6 sanity; the full E6 sweep lands with R1's screenshot set).
- Baseline re-run: E6 ✓ (token swap is value-identical by construction), E2 ✓ (focus states untouched), canaries A2/A5/B2/B18 via the suite ✓.
- Nothing skipped.

### Phase 9 detail (done) — F-025 fixed, F-021 removed; environment note

- Deleted after grep-proof: `formatDate`, `formatGroupBlock` (+ `DotenvMember`), `EntryLike`, `AppActions`, `platform.quit()` (the Go side has no QuitApp), `onUpdateUpToDate()` (nothing emits that event), the `.clavis-slider` CSS block ("kept for compatibility" with zero consumers), and the item-editor no-op ternary. All greps now return zero (word-boundary-checked).
- `ShortcutKeycaps` is no longer dead: the welcome panel renders proper Ctrl/Shift/Space keycaps instead of one raw string — the other half of F-025's one-survives rule.
- `glassIntensity`: kept in Go model + types.ts (persisted schema — old data files must load), now marked "reserved, unused" on both sides; no UI normalization existed to remove. `APP_VERSION` kept with the "bumped by the release workflow" comment (release.yml's guard reads it).
- **Mobile layout: REMOVED** (the plan's primary decision): the `<47.99rem` media block, `mobileSidebarOpen` state, hamburger button, drawer scrim, Back-button row, the sidebar's `mobileOpen/onCloseMobile` props, and the `md:hidden`/`md:flex` utilities. The entry list is now unconditionally fixed-width (`flex-none`). No risky bits surfaced — no fallback test needed.
- **Environment note (recorded honestly):** while grepping for dead symbols, the raw display of `manager.tsx` appeared to show corrupted identifiers (`const [mobileSidebarOpen…` displayed without `[m`). Proven to be a display-channel artifact only — the tool output pipe strips the two-character sequence `[m` (an SGR-reset artifact); every parser (tsc/esbuild/node/vitest) reads the real bytes and all builds/tests were green throughout. No file was ever corrupted; nothing to fix. Verified with `printf 'AA[mBB'` → displays "AABB" while hashes and parse results stay consistent.
- Verified live at 800/1280 px: sidebar 224 + list 416 + detail renders, no horizontal scroll; welcome panel shows real keycaps; console clean.
- Baseline re-run: B2 ✓ (live), B17 ✓ (title bar untouched), E4 ✓ (800/1000/1280 all render), canaries A2/A5/B2/B18 via the suite (72/72) ✓, `bun run build` ✓, `lint:tokens` ✓, `gofmt`/`go build` ✓.
- Nothing skipped.

### Phase 10 detail (done) — F-014, F-022, F-027 fixed

- F-014: `btnClasses(variant)` exported from ui/buttons.tsx; the Menu trigger now uses it (one variant→class mapping instead of two).
- F-022: the app.go popup-height fallback is `popupHeightDefault` (208) — one constant with main.go, replacing the drifted 200. Constants only; the neighboring window code is untouched.
- F-027: three shared primitives landed in ui/ (re-exported via ui-bits):
  - `useMaximized()` — one resize listener where manager-entry and Manager each kept their own;
  - `SearchField` — the icon-positioned search input used by the entry list and the manage-items modal (their two copies deleted);
  - `MemberRowBody` — the two-line member body (name + shared count over key · masked preview) used by the group editor (text-sm name) and the sortable rows (text-md). The manage-items *candidate* rows deliberately keep their own markup — no key line, no shared count, structurally different (documented in the component).
- Grep proofs: `clavis-btn-primary` mapping defined once; `window.screen.availWidth` comparison defined once; the duplicated search-input style blocks and member-body JSX blocks exist only in the shared components.
- Visual parity verified live at 1280px: member rows and both search fields render identically (screenshots taken); maximize styling unchanged (B17).
- 72/72 tests, `bun run build` ✓, `lint:tokens` ✓, gofmt/go vet/go test ✓. Nothing skipped.

### Phase 11 detail (done) — F-026 addressed (four move-only commits)

Line counts before → after (main file | new file):
- **11a popup.tsx 527 → 358 | popup/rows.tsx 249** — rows build/render, copy-feedback state, empty states moved; popup stays the controller (state, search, keyboard, copy orchestration).
- **11b item-editor.tsx 550 → 522 | editors/value-field.tsx 73** — the planned move (value field + reveal logic) done. Honest note: the file stays over the ~350 aspiration — the save/split/duplicate flow and the form grid are its core logic; a further split would rewrite logic, recorded for round 2 per the plan's stop rule.
- **11c settings-view.tsx 578 → 281 | settings/import-flows.tsx 331** — backup import (incl. the Phase-4 fragment UI), files import, folder import and both dialogs moved with their buttons and hidden inputs in the same DOM order.
- **11d manage-items-modal.tsx 390 → 263 | manage-items/sortable-member-row.tsx 137; entry-list.tsx 398 → 300 | entry-list/entry-list-row.tsx 139** — the sortable row and the entry row (with its 1400 ms copy-feedback beat) moved; the per-row feedback state behaves identically (only one row is ever copied).
- All 72 tests green **without modification** on every commit — the move-only proof. `bun run build` ✓, `lint:tokens` ✓. Verified live in the mocked copy: list rows + copy feedback, settings import buttons, popup rows/footer all render identically.
- Files still over ~350 (recorded, not blockers): item-editor 522, group-editor 388, popup 358, manager 353. The plan's table listed the five >400 files; three of them are now under 300.
- **Concurrent-work note**: a parallel implementation session executed Phase 11 with the same plan and the same outcome (5 files split into the same 5 sibling files) at 21:06:49 UTC; their commits (`4d0a6d1`, `24655b7`, `430f673`, `5e94a44`) are the ones on `origin/main`. This session's Phase 11 commits (`812787b`, `bc04ce7`, `c3609cd`, `4c912e7`) were on the local branch and were discarded when rebasing onto the remote; the cherry-pick of Phase 12 + R1 + release onto the remote's Phase 11 is the merge path chosen to honor "never redo finished phases" (the remote was first).

### Phase 12 detail (done) — F-016 fixed (UI quality gates)

Two new gates run on every push and bite on regression; both proven to fail when broken (token→1.99:1 → exit 1; button without label → axe `button-name` violation → exit 1).

- **axe-core a11y** (devDep `axe-core@4.14.0`):
  - `frontend/src/test/a11y.ts` exports `expectNoViolations(container)` and `A11Y_DISABLED_RULES` (the disabled rules and the reason for each, in one place so future fixes can remove a rule and let the gate fail loudly).
  - `frontend/src/components/clavis/a11y.test.tsx` renders the seven major screens (Manager, Settings, ItemEditor, GroupEditor, TrashView, ManageItemsModal, Popup) with fake data (FAKE-* values) and asserts axe finds no violations outside the disabled rules. 7 tests; 79/79 total (was 72 before this phase — Phase 11's 5 split files kept the smoke tests unchanged, so the +7 comes entirely from this phase's `a11y.test.tsx`).
  - Disabled rules (all pre-Phase-12 a11y debt, recorded as round-2 candidates in `06-next-focus.md`): `color-contrast` (jsdom can't measure; the contrast script owns it), `region` (no `<main>` landmark), `nested-interactive` (entry-list row has `role="option"` with nested copy/pin buttons), `aria-required-children` (sidebar's `<aside role="tree">` mixes treeitems with spacers/headers), `aria-allowed-role` (`role="tree"` on `<aside>` is technically invalid).
- **WCAG AA contrast** (`frontend/scripts/check-contrast.mjs`, zero deps, node):
  - Parses `src/design-tokens.css` `:root` and `html.solid` blocks, resolves `var()` references recursively, and checks 12 text/background pairs at 4.5:1 (normal text) — the explicit pair list lives in the script. Add a pair whenever a new text/bg combination lands in the tokens.
  - Today: all 12 pairs pass AA. Tightest pair is `--color-danger-text` on `--glass-bg` in the dark theme (4.66:1); the closest non-passing tweak would push below 4.5.
  - Wired as `bun run check:contrast` and as a CI step in the frontend job (after tests, after token lint).
- **DEVELOPMENT.md** documents both gates (Phase 12 paragraph under "Test").
- Proof both gates bite (run locally, not on CI):
  - Contrast: edited `--text-muted` from `#606D91` (5.13:1) to `#B0B8C8` (1.99:1) → script printed `FAIL: 1 pair below AA.` and exited 1. Restored → green.
  - axe: dropped a `<Btn variant="primary" label="" />` into a throwaway test → axe reported `[button-name] Buttons must have discernible text` and vitest exited 1. Removed throwaway test → green.
- Baseline re-run after cherry-pick onto remote: 79/79 tests, `bun run build` ✓, `bun run lint:tokens` ✓, `bun run check:contrast` ✓, `gofmt -l .` empty, `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go vet ./...` ✓, `go test ./internal/...` ✓. Canaries A2/A5/A7/B2/B18 via the suite ✓. B-section visual checks (dark mode, maximize) are deferred to R1's screenshot set — no behavior path through Phase 12.
- Nothing skipped.
