> Agents: read AGENTS.md in the repo root first, and follow it for this whole task.

# Audit — window chrome fixes (movable window, title texts, ".." menu overlay, rounded edges)

Owner request (2026-11-25, four points):

1. "the clavis windows is not moveable … it sticks and locked" — you cannot
   drag the window around the monitor.
2. Remove the bold **"Replace document"** text and the lower-opacity
   **"Loaded"** text in the document panel's inline editor.
3. Clicking the **"⋯" More actions** menu does not overlay — it grows the
   scroll area and creates dead space instead of floating on top.
4. "make the program edges rounded if possible."

## Finding 1 — the frameless windows have no drag region (root cause)

Both windows are created `Frameless: true` (`main.go`: popup line 117,
manager line 145). Wails v3 frameless windows are moved by the **runtime's
drag contract**: `@wailsio/runtime` (v3.0.0-beta.33, `dist/drag.js`) arms a
native window drag when the primary mouse button goes down on an element
whose computed CSS custom property `--wails-draggable` is `"drag"` (and
stays inside that element's box), then a mouse move invokes the backend
`wails:drag` message → `WebviewWindow.startDrag()` → the native move loop.

**Nothing in the frontend ever sets `--wails-draggable`** — grepped across
`src/`: zero matches. The manager's custom title bar
(`manager.tsx` `<header>`, lines 289–327) is a plain flex row: icon, the
"Clavis" title, three window buttons (`clavis-titlebar-btn`). That is why
the window is locked in place: no element qualifies as a drag handle.

Details that matter for the fix:

- Custom properties **inherit**, so setting the property on the header
  would also make the *buttons* draggable — a jittered click on Minimize
  would start a drag and swallow the click. The buttons must explicitly
  opt out (`--wails-draggable: no-drag`).
- The runtime checks `offsetX/offsetY` against the target's
  `clientWidth/clientHeight`. Inline elements (the "Clavis" `<span>`)
  report `clientWidth 0`, so the title text itself would not arm the drag;
  the span needs `display: inline-block`.
- The drag runtime is already active in both webviews: `platform.ts`
  imports `@wailsio/runtime`, whose index side-effect-imports `drag.js`.

The popup window is deliberately **not** given a drag handle: it is the
Spotlight-style quick palette that `positionPopup()` re-centers on the
cursor's screen at every show (`app.go`, DECISIONS §50) — a dragged
position would be silently discarded on the next show. The complaint is
about the long-lived Manager window.

## Finding 2 — the two texts live in `document-panel.tsx`

`group-editor/document-panel.tsx` inline editor header (lines 210–219):
the bold "Replace document" `<span>` (fontWeight semibold) and a disabled
ghost `Btn` labeled `dirty ? "Edited" : "Loaded"` (disabled = the lower
opacity the owner sees). The owner wants both gone. The row's remaining
control is the "Full editor" launch button (v1.14.0 §56) — it stays, now
right-aligned alone; when `onOpenFullEditor` is not wired the row renders
nothing. No test references either string (checked
`group-editor.test.tsx`); the pencil's aria-label "Replace the stored
document" is a different element and stays.

## Finding 3 — the "⋯" menu participates in layout instead of overlaying

`ui/menu.tsx` renders the dropdown `absolute` inside a `relative
inline-flex` wrapper around the trigger. Both call sites
(`item-editor.tsx` footer line 527, `group-editor.tsx` footer line 540)
sit at the **bottom of a scroll container**:

- inline editors: the editor root is the scroller (`overflowY: auto`,
  `item-editor.tsx` line 631) and the footer is its last content. Opening
  **downward** (`direction: "down"` default) extends the scroller's
  scrollable overflow — the scrollbar suddenly grows, the menu is below
  the fold, and scrolling down reveals it floating over nothing: exactly
  the owner's "more scroll and dead space instead of overlaying".
- the item full editor modal: the footer rides in the Modal shell's
  pinned footer (`modal.tsx`), so a downward menu renders *below the
  modal panel*, over the scrim.

Root fix: render the open menu through a **React portal into
`document.body`** with `position: fixed` anchored to the trigger's
`getBoundingClientRect()`. Fixed positioning never contributes to any
scroller's overflow and escapes every `overflow` clip; measured after
mount, it flips up/down by available space and clamps to the viewport.
House precedents: the emoji picker already anchors to a trigger rect and
flips (v1.15.0 `ab565d3`); modals already portal-like float at the root.

Two integration points to respect:

- `useDismiss` (`ui/dismiss.ts`) closes on any pointer-down **outside the
  ref'd wrapper** — a portaled menu would be "outside". It needs an
  optional second ref (the menu panel) counted as inside. Three other
  consumers (tag-input, category-select, rich-text-editor) are untouched
  by the optional parameter.
- While open, a scroll or resize under a fixed-position menu detaches it
  from its anchor. Standard remedy (and the simplest correct one): close
  on scroll (capture) and resize.

Existing menu tests (`group-editor.test.tsx`) query by title/menuitem
role through `screen` — portal-safe.

## Finding 4 — rounded edges: rely on the explicit DWM attribute, not the style heuristic

`main.go` comments (v1.10.0) claim Windows 11 rounds the corners because
the DWM frame decorations stay on (`DisableFramelessWindowDecorations`
unset → `DwmExtendFrameIntoClientArea` keeps the Aero shadow). In
practice DWM auto-rounding follows style *heuristics* (caption/thickframe
visibility) and Wails' `WM_NCCALCSIZE`-zeroed frameless windows do not
reliably qualify — the owner reports square edges.

The reliable, documented way on Windows 11 is
`DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE = 33,
&DWMWCP_ROUND = 2, …)`:

- `w32.DwmSetWindowAttribute` is already exported by
  `wails/v3/pkg/w32` (beta.33); the `33` constant is not defined there
  yet, so Clavis defines it locally.
- **Windows 10**: the attribute does not exist; the call returns an
  error and is ignored — Windows 10 has no native rounded-corner support
  for solid windows (only transparent-window CSS tricks, which v1.9.0
  explicitly moved away from after the gray-slab artifacts). Square on
  Win10 is the OS standard; the owner asked "if possible".
- Timing: the native HWND exists only once `app.Run()` has processed the
  deferred window creation, so the attribute is applied on the window's
  first `Common.WindowShow` (per-window `RegisterHook`, the exact pattern
  main.go already uses for `WindowClosing`; `Windows.WindowShow` →
  `Common.WindowShow` is Wails' default event mapping). Both windows get
  it: the manager shows at launch (or from tray), the popup on every
  quick search — a `sync.Once` per window keeps it to one call.

## Files this touches

- `frontend/src/globals.css` — title-bar drag CSS.
- `frontend/src/components/clavis/manager.tsx` — drag class + inline-block
  title span.
- `frontend/src/components/clavis/group-editor/document-panel.tsx` —
  remove the two texts.
- `frontend/src/components/clavis/ui/menu.tsx` — portal + fixed anchoring.
- `frontend/src/components/clavis/ui/dismiss.ts` — optional extra ref.
- `internal/system/system.go` + `system_windows.go` + `system_other.go` —
  `RoundWindowCorners(hwnd)`.
- `main.go` — the two `WindowShow` hooks.
