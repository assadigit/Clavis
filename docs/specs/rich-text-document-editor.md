> Agents: read AGENTS.md in the repo root first, and follow it for this whole task.

# Spec — basic text formatting in the document editors (v1.15.0)

Owner's request: "I want the editor to have some basic text editing options,
like Bold Italic Emoji (full pack), Alignment etc (just the basic ones)."

Audit: `docs/audits/2026-11-25-rich-text-document-editor.md`. Target: the
document group editors (inline panel + full modal). Item values/notes stay
plain (privacy architecture — see audit).

## Goal

Both document editors become dual-mode. **Plain mode** is exactly today's
byte-exact mono TextArea. **Rich mode** is a WYSIWYG editor with a basic
toolbar: **Bold, Italic, Underline, Strikethrough · Align Left / Center /
Right · Bullet list, Numbered list · Emoji picker (full pack) · Undo, Redo,
Clear formatting**. The mode is per-document, stored in the document itself
(`<!--clavis-rich-->` sentinel + HTML), and switchable in either editor with
the draft carried along.

## Scope

1. **`editors/rich-text.ts`** — the format layer (pure, fully tested):
   - `RICH_SENTINEL = "<!--clavis-rich-->"`, `isRichDoc`,
     `htmlFromRichDoc`, `richDocFromHtml`.
   - `plainToRich(text)`: HTML-escape, one `<div>` per line (empty line →
     `<div><br></div>`), so alignment works per paragraph and the plain →
     rich → plain round-trip is exact for clean input.
   - `richToPlain(html)`: DOMParser walk; block closes and `<br>` become
     newlines; entities unescaped by `textContent`; collapse 3+ newlines;
     trim.
   - `sanitizeRich(html)`: tag allowlist (div, p, br, b, strong, i, em, u,
     s, strike, ul, ol, li, span); the only kept attribute is `style`, the
     only kept properties `text-align`, `font-weight`, `font-style`,
     `text-decoration*` with keyword-only values; scripts/iframes/objects
     dropped with content; everything else unwrapped to text.
   - `richHasFormatting(html)`: true when anything beyond div/br survives.
   - `richStats(html)`: rune count + newline+1 lines **of the plain text**
     (the backend's stats rule, applied to the converted text).
2. **`editors/rich-text-editor.tsx`** — the WYSIWYG component:
   - contentEditable area (`role="textbox"`, `aria-multiline`,
     `aria-label`, `dir="auto"`, `spellCheck={false}`, token-styled,
     `--rows`-based min-height, placeholder via `:empty::before`).
   - Toolbar of ghost `Btn`s with `aria-pressed` from
     `document.queryCommandState` (guarded; refreshed on `selectionchange`),
     `onMouseDown={e => e.preventDefault()}` so the selection survives.
   - Emoji picker popover: category tabs (9 groups), live search by name,
     lazy `import("unicode-emoji-json/data-by-group.json")` chunk, recent
     emojis (localStorage, guarded), inserts via
     `execCommand("insertText")`, closes on outside click / Esc
     (`useDismiss`).
   - Controlled-contentEditable contract: innerHTML is only rewritten when
     the incoming value differs from the last emitted one (caret safety).
3. **`document-full-editor.tsx`** — dual-mode:
   - Mode detected from the draft (`isRichDoc`), a compact
     "Plain text / Rich text" segmented control above the editor.
   - Plain → rich converts silently (lossless); rich → plain with any
     surviving formatting asks "Remove formatting?" first (the §53/§56
     guard pattern), then converts.
   - Save: rich mode saves `sanitizeRich` + sentinel, refuses an editor
     whose plain text is empty (same `docEmptyWarning`); plain mode is
     byte-exact as today. Stats + hint switch per mode (rich hint explains
     plain vs formatted copies).
   - **"Copy formatted"** ghost button (rich mode only): drafts the current
     HTML + plain text to the clipboard via
     `navigator.clipboard.write(ClipboardItem{text/html, text/plain})`;
     on failure falls back to plain `writeText` with an honest toast.
4. **`document-panel.tsx`** — the same dual-mode treatment for the inline
   editor (12-row height), the same segmented control, same conversions;
   the "Full editor" carry keeps passing the canonical string (the mode
   travels inside it). "Copy document" stays the backend copy.
5. **Go — plain text for copies + stats (stdlib only):**
   - New `internal/store/richdoc.go`: `RichSentinel`, `IsRichDocument`,
     `DocumentPlainText(doc)` (sentinel strip, `br`/block-closes → newline,
     tags stripped, `html.UnescapeString`, collapse, trim; plain documents
     returned verbatim).
   - `Store.Copy` document path and `GroupCopyText` return
     `DocumentPlainText(doc)` (privacy verdicts unchanged); `redactState`
     computes `DocChars`/`DocLines` on the plain text.
   - Markdown export/import round-trip deliberately untouched.
   - `internal/store/richdoc_test.go` mirrors the frontend conversions
     (round-trips, entity/emoji cases, sentinel passthrough).
6. **Dev harness**: a FAKE **rich** document group (bold/italic/centered
   heading/emoji/list) in the fake vault; `setGroupDocument` already stores
   any string. Screenshots: inline rich editor + toolbar, emoji picker open,
   full-modal rich editor, after save.
7. **Tests** (vitest, FAKE-* only): `rich-text.test.ts` (conversions,
   sanitize XSS cases, stats, sentinel), `rich-text-editor.test.tsx`
   (toolbar → execCommand mocked, picker open/search/insert, change
   contract), extended `document-full-editor.test.tsx` (rich open from
   sentinel, toggle both ways incl. the formatting guard, canonical save,
   empty refusal, stats) and `group-editor.test.tsx` (inline toggle + carry
   keeps the mode).
8. **Docs + version 1.15.0** (five places, AGENTS.md §11): SPEC §5.5
   paragraph, DECISIONS §57, CHANGELOG, HANDOFF, BUILD_LOG, README
   highlights; tag `v1.15.0` after CI is green.

## Out of scope

- Item value/note rich text (secrets + dotenv pairing + note search — see
  audit). The item editors are untouched.
- Font family/size/color pickers, images, links, tables ("just the basic
  ones").
- Backend `text/html` clipboard format (CF_HTML) — the formatted copy is
  the webview clipboard path by design.
- The popup (backend copy already strips after this change; stats fixed in
  `redactState`).
- Markdown export changes (round-trip integrity — see audit).

## Done-criteria

- [x] A plain document group opens exactly as today (mono TextArea, no
      toolbar, byte-exact save). Flipping to rich converts the text visibly
      (one paragraph per line) without confirmation; flipping back asks
      when formatting would be lost.
- [x] The toolbar applies Bold/Italic/Underline/Strikethrough, the three
      alignments and both list kinds; Undo/Redo/Clear formatting work;
      active states reflect the selection.
- [x] The emoji picker shows the full 1,914-emoji pack in 9 categories with
      working search and recents, and inserts at the caret, offline.
- [x] Saving a rich document stores sentinel + sanitized HTML; the editor
      refuses an empty (plain-text-empty) rich draft; stats show plain-text
      counts; the carry between inline and modal keeps the mode and draft.
- [x] "Copy document" (every window) and the manual-copy fallback hand back
      clean plain text for rich documents (Go tests pin the conversion);
      "Copy formatted" puts styled text on the clipboard in the harness
      browser.
- [x] `bun run build`, `bun run test`, `lint:tokens`, `check:contrast` pass
      locally; Go tests + vet pass in CI; harness screenshots in
      `docs/assets/`.
- [x] Docs + five-place version bump committed; `v1.15.0` tagged after CI
      green; release artifacts verified.
