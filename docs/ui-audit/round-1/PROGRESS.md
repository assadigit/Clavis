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
| 1 | Screen smoke tests (safety net) | **done** | `15cc4a7` | 6 new vitest files, 19 new tests; `bun run test` 60/60 in 12 files; build green; only `*.test.tsx` touched |
| 2 | Manager load-failure retry panel (F-001) | not started | — | |
| 3 | Modal focus trap (F-004) | not started | — | |
| 4 | Per-group/per-item JSON export + fragment import (F-017, F-018, F-019, F-003) | not started | — | owner-requested feature; two commits allowed (4a Go, 4b UI) |
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

## Findings status

All 28 findings (F-001 … F-028): **open**. Track each one's final status (fixed / partially fixed / not fixed / blocked-off-limits) here during Phase R1.

## Scope additions (record any deviation here, with reason)

- (none yet)

## Skipped / blocked (with reason)

- (none yet)

## Rollback plan

(Fill this in **before** deploying — Phase R2 task 1. What is live, the exact undo steps, the restore tags.)
