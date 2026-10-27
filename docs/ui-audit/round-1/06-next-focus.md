# 06 — Next focus (UI/UX audit round 2)

Written: 2026-10-28 (Phase R1, after round-1 implementation session).
Round 1 implementation is **complete**: 25 of 28 findings fixed, 2 mitigated, 0 open. This document is the labelled, honest recommendation for where round 2 should spend its time. Confidence labels are mine (high / medium / low); "I am not sure" appears where true.

## Top 3–5 areas, ranked

### 1. Real Windows run + smoke test the released v1.3.0 — confidence **high**
Round 1 ran on Linux. The tray, the global hotkey, the real Win32 clipboard privacy formats, the high-DPI popup math, the self-update chain, the NSIS installer — all of that was static analysis only. The release workflow will build v1.3.0 on `windows-latest` (Phase R2 ships it); the owner's 5-minute Windows smoke-test (the one in the v1.3.0 release notes) is the **first** thing round 2 should look at. Anything that smoke-test catches is the real round-2 backlog.
Round-1 fixes most likely to surface on Windows:
- The app.go popup-height fallback constant unification (Phase 10, F-022) — pure constant move; should be a no-op, but the *first popup show* on a new monitor is the one place a regression would be invisible on Linux.
- The Phase 4 fragment JSON import — folder-import cap (200 files / 10 MB), the merge semantics. Round 1 tested with fake data and the new Go unit tests; a real Windows import of a real group JSON is the proof that matters.
- The Phase 7 unified copy-feedback strings + the non-secret preview change — verify the popup's 500 ms auto-hide and the secret-copy "kept out of clipboard history" toast still fire correctly.

### 2. Pre-existing a11y debt that Phase 12 surfaced but did not fix — confidence **high**
Phase 12 added the axe gate and discovered **5** pre-existing violations. They are disabled with comments in `frontend/src/test/a11y.ts` (`A11Y_DISABLED_RULES`). Each is a real a11y fix waiting for round 2:
- **`region`** — the manager does not wrap its central content area in a `<main>` / `role="main"` landmark. Add a `<main>` around the manager's detail column (or convert the existing `<section>` containers). One-line structural fix.
- **`nested-interactive`** — the entry-list row has `role="option"` with nested copy/pin `<button>`s inside. Fix: drop `role="option"` from the row (the arrow-key handler still works via `aria-activedescendant` on the listbox), OR move the buttons out as siblings. The latter is a layout change; the former is a behavior change worth measuring first.
- **`aria-required-children`** + **`aria-allowed-role`** — the sidebar's `<aside role="tree">` is technically invalid: `role="tree"` on `<aside>` is not allowed, and the tree mixes treeitems with spacers / section titles / grouping divs that don't carry `role="treeitem"` or `role="group"`. The clean fix is to wrap an inner `<div role="tree">` inside the `<aside>` (or switch the outer to `<nav>`) and group the categories inside `role="group"`. Phase 5 already added `aria-level` — the rest of the tree semantics are the unfinished half.

### 3. Markdown / TXT export is still lossy — confidence **high**
F-018 (Markdown drops the item Note) and F-019 (Markdown/TXT round-trip loses per-item metadata and shared references) are **mitigated** in round 1: the lossless JSON fragment path now exists (Phase 4) and is the recommended way to move credentials between machines. The Markdown exporter itself is untouched. Two options for round 2:
- **Fix the Markdown exporter** to render the `note:` field in front-matter and parse it back (a small Go change; pure-Go, fully unit-tested module).
- **Or document the lossiness in the UI** — the export menu already warns about plaintext; add a "Markdown export is for reading, not backups — use Export JSON for that" sentence.

The first is the real fix; the second is the honest stopgap. Round 2 should pick one.

### 4. The remaining monoliths — confidence **medium**
Phase 11 split 5 files; 2 remain over the ~350-line milestone the plan set:
- `popup.tsx` (434) — the plan explicitly allowed this ("stays the palette controller"); the keyboard handler + search input + listbox + drill-down + footer are intrinsic.
- `item-editor.tsx` (532) — only "value field + reveal/copy logic" was specified to move; the remaining 532 lines are save / delete / share / duplicate / footer logic that the plan did not ask to extract.
Round 2 could extract the item-editor's footer (Save / Cancel / Copy / Duplicate / More menu) as `<ItemEditorFooter>` and the popup's footer / drill-down header / empty-state JSX as separate presentational components — all move-only. ~150 lines saved between them. Not high-value unless round 2 is also touching those files for other reasons (which would be the trigger to do it).

### 5. Keyboard shortcut help overlay (`?`) — confidence **low**
U-07 from the original findings: a `?` overlay listing every shortcut (popup + manager). The hints exist piecemeal (the popup's footer has `↵ Copy`, `→ Open group`, `Esc Close`; the item editor has `Enter saves · Ctrl+Enter adds a line`; Ctrl+N / Ctrl+E live in the manager). Surfacing them in one overlay is a small new feature. Not a fix; an upgrade. Defer unless the owner asks.

## Anything only checkable by reading code that needs a real Windows run

- The popup's `ForceForeground` via `AttachThreadInput` (`app.go:251-257`) — the focus-grab that makes the popup appear above whatever you were typing in. Unit-testable in spirit but the real proof is on Windows.
- The clipboard privacy formats on secret copies (Win+V exclusion, cloud-sync exclusion) — `internal/clipboard/clipboard_windows.go:20-23,171-196`. CI runs a real Win32 clipboard e2e on `windows-latest` (the known flake is documented in `01b-baseline.md`); a red clipboard e2e on an otherwise-green run is usually a flake — re-run before believing.
- The high-DPI popup placement math — `internal/popupmath/popupmath_test.go` is unit-tested, but the real multi-monitor behavior (cursor on a different monitor than the primary, work-area edges) needs Windows.
- The self-update chain — `app_update.go`, `internal/updater`. Verified end-to-end in past releases per BUILD_LOG / DECISIONS; round 1 didn't re-verify.
- The NSIS installer + Microsoft WebView2 bootstrapper — only the release workflow exercises this for real.

## Deferred findings and why

- **Tray menu separators + default (bold) item** — P3 polish, tiny value, and the Go tray code sits near hotkey logic (off-limits by the owner's standing rule). Not worth the risk this round.
- **Generated Wails TS bindings (U-02)** — replaces the hand-written `client.ts`/`platform.ts` wholesale; high regression surface; better as its own round with tests around it. The stale `WriteClipboard` doc comment in `app.go` (noted in `03-diagnosis.md` RC-6) is the kind of drift that would be prevented, but round 2 should adopt the bindings for new code first.
- **Full i18n / Farsi UI** — no Farsi UI exists today; `dir="auto"` already covers Persian *data*. Only if the owner asks.
- **Import payload size cap beyond the folder picker** — Phase 4 added a 200-files / 10 MB cap to `PickImportFolder`; the per-file backup import is unbounded (a single JSON file), but that's the existing backup path and changing it would be a behavior change. Defer.
- **Popup window behavior changes (position preference, size memory)** — current behavior is spec'd and unit-tested; no user complaint; don't churn the core loop.
- **Contrast failures beyond token swaps** — Phase 12 measured; all 12 pairs pass AA. The tightest is `--color-danger-text` on `--glass-bg` in dark theme (4.66:1). If a future design change tightens it further, the contrast gate will fail loudly.

## New problems noticed while implementing

- **Phase 11b**: extracting `useCopyState` out of `popup.tsx` revealed that the hook needs `onHide` to fire the 500 ms auto-hide. The hook is correct, but a future refactor that lifts the popup's "did the hide get cancelled" state up would need to thread that through too — recorded in `popup/rows.tsx`'s docstring.
- **Phase 11c**: the `useRevealState` hook had to be called *after* `effectiveSecret` is computed, not before (the original inline `useState(false)` was declared early but the derivation was late). The hook now sits between `effectiveSecret` and `dirty` in `item-editor.tsx`. A future split that pulls the editor's "loaded value" effect out will need to respect that ordering.
- **Phase 12**: axe-core's `region` rule firing on every screen is a real signal — the manager's central content area genuinely has no landmark. This is the highest-impact pre-existing a11y fix to do in round 2; it would also let the axe gate drop one of its disabled rules.
- **Phase 12 environment note**: the Phase 9 "display-channel artifact" note (the `[m` SGR-reset stripping) did not recur in this session — the `git diff` output for Phase 11/12 reads cleanly. Recorded as "did not reproduce"; if it does recur, the diagnosis is in PROGRESS.md.

## Upgrade opportunities not done

- **U-03** screen smoke tests — done in Phase 1 (this round). Not a round-2 item.
- **U-04** focus-trap utility + axe pass — done in Phases 3 + 12. Round 2's job is the *fixes* the axe pass surfaced (item 2 above).
- **U-05** contrast CI job — done in Phase 12. Round 2's job is to keep the pair list updated as new text/bg combinations land.
- **U-06** toast copy single-source — done in Phase 7.
- **U-07** keyboard shortcut help overlay — see item 5 above.
- **U-08** motion token audit — partially done in Phase 7 (F-024). Round 2 could sweep the sonner config and dnd-kit transitions through the motion tokens.

## Ready-to-paste focus line for starting round 2

> Run the v1.3.0 Windows smoke-test (release notes have the 5-minute checklist); fix whatever it finds. Then add a `<main>` landmark to the manager's central content area and a `<div role="tree">` inside the sidebar's `<aside>` — that removes two of the five axe-disabled rules and is the highest-impact pre-existing a11y debt. After that, fix the Markdown exporter to round-trip the `note` field (F-018) — it's a small Go change with unit tests, and it removes the last "mitigated" finding from round 1.

## "I am not sure"

- Whether the Phase 4 fragment import handles a fragment exported from a *future* Clavis version (the plan rejects `fragmentVersion > 1`); real-world: nobody has hit this yet, so the rejection path is untested in production.
- Whether the popup's 500 ms auto-hide (Phase 7, after copy) fires correctly when the OS refuses to bring the popup back to the foreground (a Windows-only behavior; can only verify on Windows).
- Whether the Phase 9 mobile-layout removal broke anything for users who happened to have OS DPI scaling that pushed the CSS viewport below 768 px — the audit called this "an edge case: high-DPI small screens maximized" and Phase 9 chose removal over keep-and-test. A user report would tell us; without one, I am not sure.
- Whether the Phase 8 typography tokens (`--leading-*`, `--tracking-*`) match the previous hardcoded values exactly. The audit verified the grep replacement; a pixel-diff against the before-screenshots would catch any drift. (Round 1 didn't pixel-diff; the screenshots are a visual sanity check, not a pixel diff.)
