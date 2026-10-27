# 03 — Diagnosis: root causes (UI/UX audit round 1)

Written: 2026-01-27/28 · Round 1 · **No product code was changed.**

Each root cause below explains multiple findings. "One change removes it" is the test a root cause had to pass to be listed. Findings that don't share a cause (single-site issues) are listed at the end as one-offs.

## RC-1 · Fixes were applied screen-by-screen, not pattern-by-pattern

**Explains**: F-001 (manager load-error dead end while the popup has a retry panel — the code comment in `popup-root.tsx:11-14` literally describes fixing it for the popup only), F-012 (clipboard feedback written independently in 4 places), F-003 (export warning written for Settings only).

The codebase repeatedly solves the same UX problem well in one window and never propagates it. There is no shared "load failed → retry" component, no shared feedback-string module, so each screen's author reinvented (or forgot) the pattern.

**Single change that removes it**: three small shared pieces — a `LoadErrorPanel` used by both windows, a `messages.ts` for clipboard/export feedback strings, one export-warning string reused in Settings and editors. The fixes are additive and frontend-only.

## RC-2 · The modal primitive never learned focus management, and naming conventions for repeated actions were never written down

**Explains**: F-004 (no focus trap / initial focus in `ui/modal.tsx`), F-005 (three "Restore" buttons with identical names), F-007 (member rows concatenating their accessible name), F-002 (status changes not announced — same family: the app talks visually but not programmatically).

The UI kit (`components/clavis/ui/`) is well-built visually but has no a11y *contract*: dialogs don't own the keyboard, buttons don't require distinguishing names when repeated, async status has no live region. Each screen therefore behaves slightly differently for non-visual users.

**Single change that removes it**: harden `ui/modal.tsx` once (initial focus + trap + restore) and adopt two conventions enforced in review — repeated action buttons get `ariaLabel` with context (trash view already does this; Settings backups don't), async status lines live in `role="status"` regions. One utility + one convention sheet fixes every dialog and list at once.

## RC-3 · Tokens exist but nothing enforces them; a second token file drifted into the repo

**Explains**: F-011 (root `design-tokens.css` is the stale v1.0.0 theme while README/SPEC call it the source of truth), F-006 (`:focus` vs `:focus-visible` asymmetry), F-015 (hardcoded letter-spacing/line-heights), F-024 (hardcoded 200 ms transition), the two `#ffffff` literals in `globals.css`.

The token discipline in TSX is genuinely excellent (zero hex colors in components). But CSS-level and inline literals slip through, the *old* token file survived a theme migration, and CI has no check — so every exception is permanent by default.

**Single change that removes it**: one cleanup commit (delete stale file, fix README/SPEC pointers, swap the ~10 literals to tokens/`:focus-visible`) **plus** a tiny CI lint that fails on hex colors or px/ms literals outside `design-tokens.css` (upgrade opportunity U-01). Without the lint, the drift returns.

## RC-4 · The manager's 3-column layout has no width budget for its most-scanned column

**Explains**: F-009 (entry names truncate at default width), F-010 (detail-panel action buttons misaligned — same layout block).

The sidebar is fixed-width, the detail column is flexible and greedy, and the entry list gets what's left. Nothing in the grid enforces a minimum for the list, so names — the thing users scan — truncate first.

**Single change that removes it**: rebalance the column grid (min-width contract for the list column, e.g. `minmax(280px, 1.1fr)`) and align the empty-state action buttons. One CSS-level change verified at 800/1000/1280 px.

## RC-5 · Per-entry export was built on lossy formats; no structured fragment format exists

**Explains**: F-017 (owner's per-group export/re-import is impossible), F-018 (Markdown export drops the Note field), F-019 (round-trip loses per-item metadata and shared references).

Markdown/TXT were chosen for human-readable sharing, then gradually asked to serve as backup ("Export all as Markdown") — a job they can't do. The full JSON backup can't do it either because it is all-or-nothing.

**Single change that removes it**: add a **group/item JSON fragment** export (reusing the backup's schema fields and the existing merge-import logic) and let "Import backup" accept fragments. This is the owner's requested feature and the single highest-value functional change in this round; it is also carefully scoped to avoid off-limits code (no crypto/storage changes — values ride the same path the full backup already uses).

## RC-6 · Removed features left their skeletons; nothing sweeps dead code

**Explains**: F-021 (unreachable mobile layout), F-025 (dead components, zombie `glassIntensity` setting, no-op ternary), F-014/F-027 partially (menu variant mapping + duplicated blocks from incremental edits), the stale `WriteClipboard` doc comment in `app.go:10`.

Features were removed (glass intensity slider, mobile ambitions, quit button) by deleting the visible part only. The repository accumulates questions.

**Single change that removes it**: one **deletion pass** with a rule: "unused = deleted in the same commit that proves it's unused (grep + tests)". Pair with F-028 smoke tests so remaining surfaces are pinned. Decide the mobile layout's fate explicitly (keep-and-test or remove).

## RC-7 · Screens grew into monoliths; the split refactor started but stalled

**Explains**: F-026 (5 files over ~400-550 lines), and it *amplifies* RC-1 and RC-6 (big files discourage the small propagating fixes and hide dead code).

The repo itself started the cure ("move-only" split comments in `settings/update-card.tsx:3-4`, `choice-pair.tsx:3-4`) — the diagnosis is simply: finish what was started, move-only.

**Single change that removes it**: complete the split pattern for the top 3 files (settings import flows, popup copy/state, editor footers), one move-only commit each.

## RC-8 · CI has build/type/test gates but zero UI-quality gates

**Explains**: F-016 (contrast never measured), F-028 (screens untested), and it's *why* RC-3's lint and RC-2's focus rules would regress without support.

CI (`.github/workflows/ci.yml`) is unusually strong on the Go side (fmt/vet/tests/real clipboard e2e/vulncheck/audit) — but the *UI* has only "it builds and its 6 unit tests pass". Every quality dimension this audit measured (contrast, a11y tree, focus behavior, visual states) is manually enforced, i.e. not enforced.

**Single change that removes it**: one CI job that builds the two pages headless and runs axe-core + the new smoke tests + the token lint. Catches RC-2/RC-3 regressions forever.

---

## One-off findings (no shared root cause)

- **F-013** non-secret items show masked previews — a deliberate-looking choice in `derive.ts:107-119` that miscommunicates; single-site fix.
- **F-020** Save button hidden until dirty — deliberate; make the affordance persistent-but-disabled instead.
- **F-022** popup height 208 vs 200 — two constants for one fact; unify (constant-only change in Go, no hotkey/clipboard code involved).
- **F-023** "Sedanama" placeholder — copy polish.

## Risks and must-not-break list (for the upgrade session)

1. **Off-limits code** (owner's rule): secret-protection logic, clipboard privacy formats, hotkey registration, clipboard writing. The planned changes touch none of it; F-022's constant move grazes `main.go`/`app.go` — constants only, no neighbors.
2. **Data schema compatibility**: the vault JSON format (`schemaVersion: 1`) and backup merge semantics (id + `updatedAt`) must keep working with v1.0–v1.2 backups. The fragment export (RC-5) must be additive: old Clavis must be able to *ignore* (not crash on) a fragment file, and new Clavis must still import old full backups byte-identically in behavior.
3. **The popup golden path**: the 6 existing popup/hotkey/search/dotenv tests are the heart's guard — any phase that touches `popup.tsx`/`derive.ts` must keep them green (F-013 will legitimately change `derive` behavior — update the test with the new expected output, don't weaken it).
4. **The release version guard**: tag, `AppVersion`, NSIS `VERSION`, `APP_VERSION` (types.ts), winres must all agree at release time (`release.yml:34-48`). Any UI-only release still bumps all five.
5. **Windows-only verification gap**: this audit could not run tray/hotkey/clipboard. Phases touching window behavior (F-022) or copy feedback need the owner's Windows smoke test before release — that's why Phase R exists in the plan.
6. **The owner's real data**: never opened, never exported, never screenshotted. The upgrade session tests with fake entries only.
