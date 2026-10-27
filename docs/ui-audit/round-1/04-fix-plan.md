# 04 — Phased fix plan (UI/UX upgrade round 1)

Written: 2026-01-27/28 · Round 1 · To be executed by a **later session** (see `05-session2-prompt.md`).

Rules used to build this plan: severity first, then number of screens touched, then effort — except where dependencies force an order (safety nets and foundations before the screens they protect). Every phase fits one working block and ends with a commit that is the rollback point.

**Standing rules for every phase**
- Off-limits (never edited in any phase): secret-protection logic, clipboard privacy formats + clipboard-writing code, hotkey registration, the owner's real stored entries. See `03-diagnosis.md` "Risks" for the full must-not-break list.
- The baseline checklist `01b-baseline.md` is **re-run after every phase** (at minimum the sections the phase touches, plus A2/A5/A7/B2/B18 as canaries). If anything that used to work stops working, fix or revert before moving on.
- Frontend phases must keep `bun run build` and `bun run test` green; Go phases must keep `go test ./internal/...` (and `go vet ./...` where possible) green.
- One commit per phase: `phase N: <goal>`, staged by explicit path only.

---

## Phase 1 — Safety net: screen smoke tests

- **Goal**: pin today's behavior of every screen the later phases will touch, so regressions are caught by `bun run test`, not by the owner.
- **Findings**: F-028 (partial: manager, item editor, group editor, settings, trash, one modal)
- **Tasks**:
  1. Add one vitest file per screen (jsdom, existing setup): renders with a fake state; one key interaction each (row click opens editor; settings renders 4 sections + 5 data buttons; trash restore calls `call("restoreEntry")`; modal opens/closes via Esc-stack). Mock `client.ts`/`platform.ts` the way `popup.test.tsx` already mocks the runtime.
  2. No visual or behavior changes — tests only.
- **Milestone**: `bun run test` runs ≥ 12 tests (6 existing + ≥ 6 new) and passes; every screen file under `components/clavis/` is imported by at least one test.
- **Verification**: full `bun run test` green; baseline sections B, C re-run in the running app; `git diff` touches only `frontend/src/**/*.test.tsx` (and `vitest.config.ts` if needed).
- **Do not touch**: any non-test file; the 6 existing tests' assertions (may extend, not weaken).
- **Rollback point**: commit `phase 1: screen smoke tests`.

## Phase 2 — Manager load-failure gets the popup's retry pattern (P1)

- **Goal**: no dead ends; both windows offer "Try again" on load failure.
- **Findings**: F-001 (RC-1)
- **Tasks**:
  1. Extract the popup's retry panel body (`popup-root.tsx:217-246`) into a shared `LoadErrorPanel` (in `components/clavis/ui/` or a small shared file) with props for title/text/onRetry/onHide.
  2. Use it in `popup-root.tsx` (identical look) and in `manager-entry.tsx:229-235` (replace `FullMessage` for the *error* case only; keep "Loading your keys…" as-is). Manager's panel: Esc does nothing (window hides to tray normally), retry re-runs `fetchState`.
  3. Extend the popup-root load-failure test to cover the manager variant.
- **Milestone**: with the backend failing, both windows show a retry panel; the word "Try again" appears in both; searching `frontend/src` finds one `LoadErrorPanel` definition used twice.
- **Verification**: run frontend without backend (plain browser) → both `/popup.html` and `/manager.html` show retry (screenshot `after/manager-loaderror-1280.png`); with backend → normal load; baseline A10, B14 re-run; smoke tests green.
- **Do not touch**: `FullMessage` loading state; any Go code; popup's Esc-to-hide behavior.
- **Rollback point**: commit `phase 2: manager retry panel`.

## Phase 3 — Modals own the keyboard (P1)

- **Goal**: every dialog traps focus, starts focused, and returns focus on close.
- **Findings**: F-004 (RC-2)
- **Tasks**:
  1. In `ui/modal.tsx`: on open, focus the panel (or first focusable); Tab/Shift+Tab cycle within; on close (any path — Esc, scrim, X, Done), restore focus to the opener element (capture `document.activeElement` at open).
  2. Verify all six modals still behave: import backup, resolve conflicts, manage items (careful: its search input has `autoFocus` — initial focus should land there, which the "first focusable" rule already achieves), shared edit, shared delete, category.
  3. Add a keyboard test: open modal → Tab × 5 stays inside → Esc → focus returns to opener.
- **Milestone**: no Tab sequence can leave an open modal (verified by test); all modals close via Esc and restore focus.
- **Verification**: manual Tab pass in the running app on 2 modals + automated test; baseline B8, C4 re-run; smoke tests green.
- **Do not touch**: esc-stack dismissal logic (`ui/dismiss.ts`) — it already works; menu/popover behavior (separate component).
- **Rollback point**: commit `phase 3: modal focus trap`.

## Phase 4 — Per-group / per-item JSON export + fragment import (owner-requested feature, P1)

- **Goal**: the owner can export one group (or one item) to a JSON file and import it later (or on another machine) without losing anything. Full export stays as-is.
- **Findings**: F-017 (primary), F-018, F-019 (mitigated by giving a lossless path), plus the export-warning gap F-003 (task 5)
- **Tasks**:
  1. **Go — export**: new `what` kinds `group-json` / `item-json` in `app_exports.go` (`ExportSave`), body built by the store: a *Clavis fragment* — same field shapes as the full backup but scoped: `{ kind: "clavis-fragment", fragmentVersion: 1, exportedAt, groups: [group], items: [referenced items...], categories: [referenced category names] }`. File names `clavis-group-<SafeFilename(name)>-YYYYMMDD.json` / `clavis-item-<…>.json`. Reuse: `internal/store/import.go:55-66` granularity, `groupMembersLocked` (`store.go:1395-1420`), `SafeFilename`.
  2. **Go — import**: extend the backup import path (`importBackupPreview`/`importBackup`) to detect a fragment (new `kind` field; absence of full-vault arrays = not a full backup) and apply the **existing merge semantics** (id + newer `updatedAt` wins) to the fragment's items/groups/categories. Add a guard so **old full backups and old Clavis versions' files behave exactly as today**. Pre-import backup is taken automatically (existing hook `store.go:577-600`).
  3. **Go — tests**: unit tests: fragment export contains group + member items incl. `note`, `tags`, `isSecret`, `pinned`, `key`; round-trip: export → import into a fresh store → group restored with same membership order; import into a store with newer data → skipped, not downgraded; old full backup still imports.
  4. **UI**: item/group editor "More actions" menu gains "Export JSON (backup-safe)" above the Markdown/TXT items; Settings "Export everything" unchanged. Import modal copy gains one sentence when a fragment is detected: "This is a partial export (1 group, 4 items). Merging adds anything you don't already have."
  5. **Warning**: add the existing plaintext warning sentence (from `settings-view.tsx:360-363`) as a hint inside the editors' export menu (F-003).
  6. Optional hardening if time allows: cap `PickImportFolder` payload (e.g. 200 files / 10 MB total) with a friendly error — currently unbounded (`app_exports.go:126-149`). If skipped, record in PROGRESS.
- **Milestone**: in the running app, a group of 4 items exports to one JSON file; importing that file into an empty vault restores the group with all item notes/tags/secrets/pins and the same copy order; a second import of the same file merges as "0 added, 0 updated, 4 skipped" (or equivalent); full backup export/import still works identically; `go test ./internal/...` green.
- **Verification**: new Go tests green; manual run in the mocked copy + (if available) real app; baseline C3–C6 re-run; fake data only (`FAKE-*` values).
- **Do not touch**: encryption-at-rest decisions, clipboard code, hotkey code, the full-backup JSON format for full vaults (fragment is a *new* shape), `NormalizeVault`'s handling of full vaults.
- **Rollback point**: commits `phase 4a: fragment export (go)` and `phase 4b: fragment import + ui` (two commits are fine inside this phase).

## Phase 5 — Accessibility batch (screen-reader and keyboard polish)

- **Goal**: repeated actions are distinguishable, async status is announced, focus rings are consistent.
- **Findings**: F-002, F-003 (if not done in Phase 4), F-005, F-006, F-007, F-008
- **Tasks**:
  1. Backup Restore buttons get `ariaLabel={`Restore ${b.name}`}` (F-005).
  2. Update card: `role="status"` on the status line; `aria-valuenow/min/max` on the progressbar (F-002).
  3. `.glass-input:focus` → `:focus-visible` (F-006).
  4. Member rows: explicit `aria-label` (`{name}, used {n}×, key {key}` or visually-hidden separators) in group editor + manage-items modal (F-007).
  5. Sidebar tree items: `aria-level={1}` (+ `aria-expanded` on the Categories group if applicable); use or remove `.clavis-sr-only` (F-008).
- **Milestone**: accessibility tree shows three distinct Restore names, clean member-row sentences, levelled sidebar; tabbing into inputs shows no ring on mouse click but a ring on keyboard focus.
- **Verification**: axe browser extension or `agent-browser` a11y snapshot on Settings + group editor + manage-items; baseline B8, C7, C8 re-run; smoke tests green.
- **Do not touch**: visual styling (this phase is names/roles/attributes only).
- **Rollback point**: commit `phase 5: a11y names, roles, live regions`.

## Phase 6 — Manager layout: give the list column room

- **Goal**: entry names stop truncating at normal widths; empty-state buttons align.
- **Findings**: F-009, F-010 (RC-4)
- **Tasks**:
  1. Rebalance the 3-column grid in `manager.tsx` (min-width contract for the list column, e.g. `minmax(280px, 1.1fr)`; verify 800/1000/1280 px).
  2. Align "New item"/"New group" buttons in the nothing-selected panel (`manager.tsx:205-217`).
- **Milestone**: a 26-character entry name renders unclipped at 1000 px window width (the default); buttons share a center line; no horizontal scroll at 800 px.
- **Verification**: screenshots at 800/1000/1280 (before/after pair for `manager-all`); baseline B2, B11, E4 re-run.
- **Do not touch**: sidebar contents; popup layout; window min size (800×520 stays).
- **Rollback point**: commit `phase 6: list column budget + button alignment`.

## Phase 7 — Feedback & copy consistency

- **Goal**: one voice for clipboard/export feedback; honest previews; always-visible save affordance; token-true motion.
- **Findings**: F-012, F-013, F-020, F-023, F-024
- **Tasks**:
  1. New `frontend/src/lib/clavis/messages.ts` with the clipboard/export strings; all four call sites use it (F-012). One punctuation rule (toast sentences end with ".").
  2. Non-secret items: text preview (first ~24 chars, `dir="auto"`) or nothing + note icon instead of dots; secrets keep dots (F-013). Update `derive.test.ts` expectations.
  3. Item/group editor: render disabled "Saved"/"Save" affordance from the start instead of nothing (F-020).
  4. Placeholder "Sedanama credentials" → "Acme API credentials" (F-023) + test fixtures.
  5. Update-card transition → `var(--motion-toast) var(--ease)` (F-024).
- **Milestone**: `rg "Could not copy" frontend/src` finds one definition; popup shows a text preview for a non-secret note; editor footer shows a (disabled) Save on open; reduced-motion emulation kills the progress-bar animation.
- **Verification**: baseline A7, A12, B5, B6, C8 re-run; popup unit tests updated and green; screenshots `after/popup-recent-640.png`, `after/manager-item-editor-1280.png`.
- **Do not touch**: masking of secret values (state redaction, last-4 logic — backend stays).
- **Rollback point**: commit `phase 7: feedback and copy consistency`.

## Phase 8 — One token file, enforced

- **Goal**: a single, live design-token file that the docs point to; literals gone; drift prevented.
- **Findings**: F-011, F-015 (+ the `#ffffff` literals; upgrade opportunity U-01)
- **Tasks**:
  1. Delete root `design-tokens.css`; replace with a 3-line comment file pointing to `frontend/src/design-tokens.css` (keeps README links alive), update README.md:85 and SPEC.md:4 references.
  2. Swap the two `#ffffff` in `globals.css:208,432` → `var(--text-on-primary)`.
  3. Add typography tokens (`--tracking-label: 0.05em`, `--tracking-input: 0.02em`, `--leading-tight: 1.3`, `--leading-normal: 1.5`, `--leading-relaxed: 1.6`) and replace the hardcoded values (F-015); SectionHeader → `h2`.
  4. Add a CI lint step (in `ci.yml` frontend job or a tiny script): fail if a hex color or `px`/`ms` literal appears in `frontend/src/**/*.{tsx,css}` outside `design-tokens.css` (allowlist: `globals.css` scrollbar width, focus-ring already a token). Keep it small and documented.
- **Milestone**: `rg "#[0-9a-fA-F]{3,8}" frontend/src` returns only `design-tokens.css`; docs reference the live file; CI lint runs on every push and passes.
- **Verification**: full build + tests + baseline E6 re-run; visual parity at 800/1280 (screenshots should be pixel-near-identical — this phase changes sources, not looks).
- **Do not touch**: token *values* (no re-theming); Tailwind utilities usage.
- **Rollback point**: commit `phase 8: single token source + lint`.

## Phase 9 — Dead code sweep + mobile decision

- **Goal**: the repository stops asking questions it already answered.
- **Findings**: F-025, F-021 (RC-6)
- **Tasks**:
  1. Delete (after grep-proving unused): `ShortcutKeycaps`, `formatDate`, `formatGroupBlock`, `EntryLike`, `AppActions`, `platform.quit`, `onUpdateUpToDate`, `.clavis-slider` CSS, the no-op ternary `item-editor.tsx:296`. Update `manager.tsx:199` to use `ShortcutKeycaps` (the proper fix — it exists!) or keep raw string if keycaps feel wrong; pick one, delete the other.
  2. `glassIntensity`: stop referencing it in the frontend beyond the type (it's part of the persisted schema — **keep the field in `types.ts` and Go model**, just remove any UI-facing normalization that suggests a live feature); document as "reserved, unused" in a comment.
  3. `APP_VERSION` in `types.ts`: align with `package.json`/release process or delete if truly unused (it's written by the release guard — check `release.yml:40` uses it! Keep it, add the comment "bumped by release process").
  4. Mobile layout: **decision = remove** (recommended: unreachable at min-width 800, and the manager is a desktop window). Delete the `<47.99rem` breakpoint block, drawer/scrim/Back-button code, and now-unneeded `md:` utilities. If the session finds this risky, the fallback decision is keep + add a 375 px render test — record which one was taken in PROGRESS.md.
- **Milestone**: every symbol in the deletion list returns zero grep hits; `bun run build` + tests + token lint green; the mobile CSS block is gone (or tested, if fallback chosen); no visible change at 800–1280 px.
- **Verification**: baseline B2, B17, E4 re-run; screenshots at 800/1280 unchanged vs Phase 8.
- **Do not touch**: `Settings.glassIntensity` in the Go data model; `APP_VERSION` (release guard depends on it).
- **Rollback point**: commit `phase 9: dead code sweep`.

## Phase 10 — De-duplicate the small stuff + one Go constant

- **Goal**: one definition per behavior.
- **Findings**: F-014, F-022, F-027 (RC-3 tail + RC-6)
- **Tasks**:
  1. Export `btnClasses(variant)` (or equivalent) from `ui/buttons.tsx`; `ui/menu.tsx` uses it (F-014).
  2. Unify the popup height constant: `main.go:34` `popupHeightDefault = 208` vs `app.go:308` fallback `200` → one shared constant (move to a tiny shared file or pass at construction). **Constants only — do not refactor surrounding hotkey/window code.**
  3. Extract `SearchField` (input + icon + hover positioning) and `MemberRow`; replace the duplicated blocks in `entry-list.tsx`, `manage-items-modal.tsx`, `group-editor.tsx` (F-027).
  4. Deduplicate the two maximized-state listeners (`manager-entry.tsx:107-112` / `manager.tsx:47-52`) — one `useMaximized` hook or lift state.
- **Milestone**: grep finds single definitions; `go vet` + `gofmt -l .` clean; visual parity at 800/1280 (before/after screenshots identical to the eye).
- **Verification**: build + tests green; baseline B17 (maximize styling) re-run; popup placement unchanged on Windows (owner smoke test in Phase R2 covers it).
- **Do not touch**: hotkey registration, clipboard, tray code in the same files — the `app.go` change is a one-line constant swap.
- **Rollback point**: commit `phase 10: dedupe + constant unification`.

## Phase 11 — Split the monoliths (move-only)

- **Goal**: the three biggest files become reviewable; RC-7 retired.
- **Findings**: F-026
- **Tasks** (one move-only commit each — `git diff --stat` should show mostly moves):
  1. `settings-view.tsx` (547) → move the import flows (backup + files + conflicts) into `settings/import-flows.tsx`.
  2. `popup.tsx` (526) → move the row rendering + copy-state logic into `popup/rows.tsx` (keep `popup.tsx` as the palette controller).
  3. `item-editor.tsx` (525) → move the value field + reveal logic into `editors/value-field.tsx`.
  4. `manage-items-modal.tsx` (426) and `entry-list.tsx` (410): extract `MemberRow`-related pieces landed in Phase 10; if still > ~350 lines, split similarly.
- **Milestone**: no component file over ~350 lines; `git diff --stat` per commit shows move-shaped diffs; zero behavior change (all smoke tests green without modification).
- **Verification**: full baseline re-run (this phase touches everything); screenshots at 640/1280 identical pre/post.
- **Do not touch**: logic, strings, styles — moves only. If a split would require rewriting logic, stop and record it for the next round instead.
- **Rollback point**: commits `phase 11a/11b/11c: split <file> (move-only)`.

## Phase 12 — Automated UI quality gates

- **Goal**: RC-8 closed — contrast and a11y measured on every push, not by hand.
- **Findings**: F-016 (+ locks in Phases 3–8)
- **Tasks**:
  1. Add a CI job (or extend the frontend job): build the two pages, load them in a headless browser (the repo already uses Playwright-style tooling nowhere — add a minimal `@axe-core/playwright` or `axe-core` + jsdom pass; install dev-only), run axe on `/popup.html` and `/manager.html` (mocked runtime), fail on serious violations.
  2. Run a one-off contrast measurement of the token pairs (light + dark) with a small script; fix any AA failures found (token values only, via `design-tokens.css`).
  3. Document the gates in `docs/DEVELOPMENT.md` (one paragraph).
- **Milestone**: CI runs axe + token lint + unit + smoke tests on every push and is green; a written contrast report (or green job) exists for light and dark themes.
- **Verification**: CI green on the phase commit; intentionally introduce a bad contrast token in a scratch branch → job fails → discard branch.
- **Do not touch**: token *system* (only values that fail AA).
- **Rollback point**: commit `phase 12: ui quality gates`.

## Phase R1 — Final re-audit (required before release)

- **Goal**: prove the upgrade worked and nothing regressed; produce the after-evidence and the next-round focus.
- **Findings**: all (verification pass)
- **Tasks**:
  1. Re-run **every** lens from `02-findings.md` on the changed areas; mark each finding fixed / partially fixed / not fixed in `PROGRESS.md`.
  2. Re-run the **full** baseline `01b-baseline.md` (all sections, including a real run of both windows in the mocked copy and the unmodified-frontend error paths).
  3. Save `evidence/after/*.png` with the **same names and sizes** as the before set (34 images).
  4. Write `07-before-after.md`: each before/after pair + 1–2 plain-language sentences on what changed and why it's better.
  5. Write `06-next-focus.md` (top 3–5 remaining areas, ranked, with confidence; deferred items; new problems noticed during implementation; one ready-to-paste focus line).
- **Milestone**: every finding has a status; every baseline row passes (or has a written explanation); after-screenshots exist 1:1 with before.
- **Verification**: this *is* the verification.
- **Do not touch**: product code (fix-backs happen as new micro-commits referencing the finding ID, or are recorded for round 2).
- **Rollback point**: commit `phase R1: final re-audit evidence`.

## Phase R2 — Release (v1.3.0)

- **Goal**: the upgraded UI is live for all users via the existing tag-driven release flow.
- **Tasks**:
  1. Write the rollback plan into `PROGRESS.md` **before** deploying: what is live now (v1.2.0, tag `v1.2.0`), exact undo steps (see below), restore tags `pre-ui-audit-round-1` / `pre-ui-upgrade-round-1`.
  2. Bump the version in **five** places (release guard enforces): `app.go` AppVersion, `build/windows/installer/clavis.nsi` VERSION, `build/winres/info.json` file/product version, `frontend/src/lib/clavis/types.ts` APP_VERSION, and the new tag `v1.3.0`.
  3. Run everything CI runs locally where possible: `bun run build`, `bun run test`, `gofmt -l .`, `go vet ./...` (or `GOOS=windows … go vet`), `go test ./internal/...`.
  4. Commit `release: v1.3.0`, push `main`, push tag `v1.3.0` → `release.yml` builds both artifacts and publishes the GitHub Release.
  5. Verify live: the release exists with `Clavis-Setup-1.3.0.exe` + `Clavis-Portable-1.3.0.exe`; download page reachable; release notes describe the upgrade (write them in the GitHub Release body).
  6. Windows-only checks the session cannot do: write the owner's 5-minute smoke-test checklist at the top of the release notes (hotkey popup, copy → Win+V exclusion, group JSON export/import round-trip, dark mode, manager resize).
  7. **Undo if anything fails**: `git revert` the release commit on `main`, bump to `v1.3.1` with the revert, tag + push (every client self-updates forward — releases are append-only); optionally delete the bad release's assets via GitHub. Never force-push tags.
- **Milestone**: the deployed v1.3.0 release shows the upgraded UI and the main tasks still work (baseline A/B/C re-checked against the released portable build where possible).
- **Verification**: live release URL checked; asset names exact; release notes present; `PROGRESS.md` records the result with links.
- **Do not touch**: user data, the v1.2.0 release, tag history.
- **Rollback point**: tag `v1.3.0` itself; restore tags `pre-ui-upgrade-round-1` and `pre-ui-audit-round-1`.

---

## Deferred and out of scope (for the next round to consider)

| Item | Why deferred |
|---|---|
| Tray menu separators + default (bold) item | Tiny value; needs Windows visual verification; Go tray code sits near hotkey logic — not worth the risk this round. |
| Keyboard shortcut help overlay (`?`) | Nice-to-have (U-07); new surface, new design decisions — a next-round feature. |
| Generated Wails TS bindings (U-02) | Replaces the hand-written client wholesale; high regression surface; better as its own round with tests around it. |
| Full i18n / Farsi UI | No Farsi UI exists today; `dir="auto"` covers Persian *data*. Only if the owner asks. |
| Import payload size cap | Folded as optional into Phase 4 task 6; if skipped there, it stays here (robustness, low likelihood). |
| Popup window behavior changes (position preference, size memory) | Current behavior is spec'd and unit-tested; no user complaint; don't churn the core loop. |
| Contrast failures beyond token swaps | Phase 12 measures; if failures need component redesign, that's next-round material. |
| Any change to encryption-at-rest / clipboard / hotkey internals | Off-limits by the owner's standing rule. |
