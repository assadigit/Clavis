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
| 5 | A11y batch (F-002, F-005, F-006, F-007, F-008) | not started | — | |
| 6 | Manager list-column budget + button alignment (F-009, F-010) | not started | — | |
| 7 | Feedback & copy consistency (F-012, F-013, F-020, F-023, F-024) | not started | — | |
| 8 | Single token source + lint (F-011, F-015) | not started | — | |
| 9 | Dead code sweep + mobile decision (F-025, F-021) | not started | — | |
| 10 | De-duplication + popup height constant (F-014, F-022, F-027) | not started | — | app.go change is constant-only |
| 11 | Split monoliths, move-only (F-026) | not started | — | one commit per file |
| 12 | UI quality gates: axe + contrast (F-016) | not started | — | |
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
