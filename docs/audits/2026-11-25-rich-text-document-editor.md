> Agents: read AGENTS.md in the repo root first, and follow it for this whole task.

# Audit — basic text formatting in the document editors (v1.15.0)

Owner's request (2026-11-25): "I want the editor to have some basic text
editing options, like Bold Italic Emoji (full pack), Alignment etc (just the
basic ones)."

## Which editor

Clavis has three editing surfaces today:

1. **Item editors** (inline detail form + v1.12.0 full modal, one shared tree
   in `item-editor.tsx`). The **value** field is a secret: masked in the UI
   (§5.4), copied byte-exact by the backend with the §5.2 privacy formats,
   paired as `NAME=value` in dotenv group copies and exports, and fetched
   one-at-a-time so it never lingers in the webview. The **note** field is
   indexed by the Go search (`internal/search`: Name/Key/Note/Category/Tags).
   Rich text here would break masking, dotenv pairing, note search and the
   privacy copy path — it does not belong on items.
2. **Document group inline editor** (`document-panel.tsx`, 12-row mono
   TextArea behind "Replace document", §40).
3. **Document full-modal editor** (`document-full-editor.tsx`, 24-row mono
   TextArea, v1.14.0 §56).

The document editors hold the long-form content (a whole pasted file), are the
editers the owner just received a launch button + big modal for, and are the
only surface where Bold / Italic / Alignment read as formatting rather than
data corruption. **Rich text lands on the document editors (both
presentations). Item values and notes stay plain.**

## Every consumer of a stored document (the ripple map)

| Consumer | Path today | Rich-text impact |
|---|---|---|
| Inline editor | `document-panel.tsx` TextArea | dual-mode (plain ↔ rich) |
| Full editor | `document-full-editor.tsx` TextArea | dual-mode (plain ↔ rich) |
| Draft carry (panel → modal) | `onOpenFullEditor(initialText)` | format travels inside the string (sentinel) — unchanged plumbing |
| Copy, every window | backend `copy` kind=group → `Store.Copy`: verbatim doc, privacy formats | must hand back clean **plain text** for rich docs (Go) |
| Manual-copy fallback | `getGroupCopyText` → `Store.GroupCopyText` | same plain-text strip (Go) |
| Stats (`docChars`/`docLines`) | `service.go redactState`: rune/newline count of the raw doc | count the plain text for rich docs (Go) |
| Markdown export + import round-trip | `ExportEntryMarkdown`: verbatim doc under a `mode: document` header | **unchanged** — the sentinel is an HTML comment (invisible to markdown renderers, HTML renders as formatting), and stripping it would break the import round-trip |
| Search | `internal/search` indexes name/key/note/tags only — documents are never searched | none |
| Popup display | shows `docChars` text only | none once stats are fixed |

## Format decision

- **Sentinel-prefixed HTML**: a rich document is stored as
  `<!--clavis-rich-->` + the editor's HTML. Detection is a prefix check; every
  existing plain document stays byte-identical until the owner deliberately
  flips it to rich; the vault stays a JSON of plain strings (no schema
  change, no migration).
- **WYSIWYG via `document.execCommand`** (bold/italic/underline/strike,
  justify left/center/right, lists, undo/redo, removeFormat). The only render
  target is WebView2/Chromium; execCommand is deprecated-but-shipped there
  and needs zero dependencies.
- **Emoji "full pack"**: `unicode-emoji-json` (MIT) — 1,914 emojis, 9
  categories, English names, offline JSON. Lazy-loaded as its own Vite chunk
  (~400 KB) so it costs nothing until the picker opens. A hand-rolled list
  could not honestly claim "full pack"; this is the one new dependency and
  the reason is exactly that.

## Privacy decision (the important one)

Backend-side copies stay THE copy path — §5.2 exclusion formats, payload
never crossing to the webview. A rich document therefore copies as **clean
plain text** (sentinel + markup stripped in Go). The formatting-keeping copy
is a separate, explicit **"Copy formatted"** button inside the editors: it
writes `text/html` + `text/plain` through the standard webview clipboard
(`navigator.clipboard.write`), so pasting into Word/Gmail/Slack keeps the
styling. The editor hint says plainly that formatted copies use the standard
clipboard; for secret documents the plain backend copy remains the safe path.

## Reuse inventory

`Modal`, `Btn` (ghost variant, `aria-pressed` needs a small active style),
`useDismiss` (outside-click/Esc for the emoji popover), `.clavis-scroll`,
`.glass-*` surfaces and the token system (token lint bans raw hex/px — all
new styles go through tokens). Tests follow the FAKE-* + mocked-Wails
patterns of `document-full-editor.test.tsx`.
