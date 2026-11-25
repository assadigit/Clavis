> Agents: read AGENTS.md in the repo root first, and follow it for this whole task.

# Spec — window chrome fixes (v1.16.0): movable window, quieter document editor, overlaying "⋯" menu, rounded edges

Audit: `docs/audits/2026-11-25-window-chrome-fixes.md`.

## Goal

Four owner-requested fixes to the desktop window chrome and the document
editor, shipped together as v1.16.0:

1. The Manager window can be **dragged** around the monitor by its title
   bar (it was locked: no `--wails-draggable` drag region existed).
2. The document panel's inline editor loses the bold "Replace document"
   label and the disabled "Loaded"/"Edited" status chip.
3. The "⋯ More actions" menu **floats over the content** (portal +
   fixed positioning) instead of growing the scroll area.
4. Both windows get **rounded corners on Windows 11** via the explicit
   DWM corner preference (square on Windows 10 — no native support).

## Scope

- Manager title bar drag: the header row (icon + title + empty space) is
  the drag region; the three window buttons are excluded so a click can
  never become a drag.
- The popup window stays auto-centered (no drag handle) — it re-centers
  at every show by design (DECISIONS §50).
- The "⋯" fix covers both call sites (item editor + group editor
  footers, inline and modal variants) by fixing the shared `Menu`.
- Rounded corners: manager + popup, applied once per window on first
  show; failure (Windows 10) is silently ignored.

## Out of scope

- Double-click-on-title-bar maximize toggle (native nicety, not asked).
- Windows 10 rounded corners (would need the transparent-window approach
  abandoned in v1.9.0 — gray-slab artifacts).
- Any popup-window positioning change.
- Any change to the full-modal document editor's header (it shows the
  group name + stats, not the removed texts).

## Decisions

1. **Drag CSS lives in `globals.css`** (`.clavis-titlebar` /
   `.clavis-titlebar-btn`), not inline styles — one place, and the token
   lint stays clean (no color/px literals involved). The Wails runtime
   contract (`--wails-draggable: drag`) is cited in the CSS comment.
2. **The title span becomes `inline-block`** so pressing directly on the
   "Clavis" text also arms the drag (inline elements report clientWidth 0
   and would be skipped by the runtime's bounds check).
3. **The "⋯" menu portals to `document.body`** with `position: fixed`
   anchored to the trigger rect; it flips up when the space below is
   insufficient (the footers' common case), clamps 8px inside the
   viewport horizontally, and **closes on scroll/resize** while open (a
   fixed panel must never detach from its anchor). `z-index` 100 — above
   the modal layer (80), so it also works from the full editors' pinned
   footers.
4. **`useDismiss` gains an optional second ref** (the portaled panel)
   counted as "inside" — clicks on menu items must never be treated as
   outside-dismissals. Existing consumers are unaffected (optional
   parameter).
5. **Rounded corners: `internal/system.RoundWindowCorners(hwnd)`** wraps
   `w32.DwmSetWindowAttribute(hwnd, 33, DWMWCP_ROUND)`; `system_other.go`
   stubs it. `main.go` registers a per-window `Common.WindowShow` hook
   (sync.Once) for popup and manager — the HWND only exists after
   `app.Run()` starts the deferred native creation.
6. Version 1.16.0 (four places: `app.go`, `build/windows/installer/*.nsi`,
   `build/winres/info.json`, `frontend/src/lib/clavis/types.ts`) + tag
   `v1.16.0` after CI is green.

## Step-by-step plan

1. `globals.css`: `.clavis-titlebar { --wails-draggable: drag; }` and
   `.clavis-titlebar-btn { --wails-draggable: no-drag; }` with the
   contract documented.
2. `manager.tsx`: add `clavis-titlebar` to the header; `inline-block` on
   the title span.
3. `document-panel.tsx`: remove the "Replace document" span and the
   "Edited/Loaded" chip; the row keeps only the right-aligned "Full
   editor" button and renders nothing without `onOpenFullEditor`.
4. `dismiss.ts`: optional `extra` ref in `useDismiss`.
5. `menu.tsx`: trigger ref + rect capture on open; portal + fixed panel;
   post-mount measure → flip/clamp; scroll/resize close; z-index 100.
6. `internal/system`: `RoundWindowCorners` (windows + other).
7. `main.go`: WindowShow hooks on both windows.
8. Tests: update/add vitest cases — the document panel row (no "Replace
   document"/"Loaded" text, Full editor still there, nothing rendered
   without the handler) and the portaled menu (opens above the trigger
   when anchored low, stays open through item clicks, closes on outside
   click). Existing menu tests must keep passing unmodified.
9. Verify: `bun run build` + `bun run test` + `lint:tokens` +
   `check:contrast` locally; real-browser harness round (menu overlay,
   removed texts, title bar present); push → CI green on windows-latest
   (go vet + tests + release build cover the Go side).
10. Docs: DECISIONS §58, CHANGELOG, HANDOFF, BUILD_LOG; version bump in
    the four files; tag `v1.16.0`.

## Done criteria

- [ ] The Manager window can be moved by dragging its title bar (the
      three buttons still click normally).
- [ ] The document panel's inline editor shows neither "Replace
      document" nor "Loaded"/"Edited"; "Full editor" remains and still
      carries the draft up.
- [ ] The "⋯" menu overlays the content near the bottom of both editors
      and inside both full-editor modals; no scrollbar growth when it
      opens; clicking an item still fires its action; Esc/outside click
      closes it; scrolling closes it.
- [ ] On Windows 11 both windows render with the system rounded corners
      (DWM attribute set); on Windows 10 nothing changes.
- [ ] vitest green (updated count), tsc/build clean, token + contrast
      lints pass, CI green, harness screenshots recorded.
- [ ] Docs + version bump + tag as decided above.
