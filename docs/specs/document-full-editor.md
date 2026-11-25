> Agents: read AGENTS.md in the repo root first, and follow it for this whole task.

# Spec — a full-modal editor for a whole-document group's content (v1.14.0)

Owner's request (screenshot, marked at the "Replace document" row): "I want a
button where I drawn a black/yellow one, to edit the content of each item in a
full modal editor."

The item editor got its full-modal view in v1.12.0 (§53) and row launch buttons
in v1.13.0 (§55). The content of a **whole-document group** (MODE 1, §40) never
got one: its only editor is the tight 12-row inline TextArea behind the
"Replace document" heading. This spec gives it the same second home.

## Goal

From the document panel's editing state, one click on a button at the marked
spot (right end of the "Replace document" row) moves the whole editing session
into a full-modal editor (~900px) with a tall mono TextArea — the inline draft
carries over, the inline session closes, saving writes byte-exact through the
unchanged `setGroupDocument` action.

## Scope

1. **`DocumentFullEditor`** — new component
   `frontend/src/components/clavis/group-editor/document-full-editor.tsx`:
   - Props: `group`, `call`, `readOnly`, `initialText: string | null`,
     `onClose`. `initialText != null` seeds the draft (the carried inline
     draft); `null` fetches via `getGroupDocument` (with a "Loading…"
     `role="status"` state).
   - The app's `Modal` shell, `width="min(900px, calc(100vw - var(--space-6)))"`
     (same as the item full editor), `ariaLabel="Edit document <name>"`, title
     = FileText glyph + group name (truncate, dir=auto).
   - Body: a mono `TextArea` (`rows={24}`, `dir="auto"`, `spellCheck={false}`,
     `autoFocus`, `aria-label="Document content — paste the whole file here"`,
     same placeholder as the inline one) plus the byte-exact hint and **live
     draft stats** (`messages.docStats` over the draft — rune count,
     `\n`+1 lines, the backend's rule).
   - Footer: "Save document" (primary, disabled unless dirty && !saving) and
     "Cancel" (ghost). Save refuses an empty draft (`docEmptyWarning`, same as
     inline), calls `setGroupDocument`, toasts `messages.docSaved`, and closes
     on success.
   - Dirty-close guard identical to the item editor's: every close path (Esc,
     scrim, ×, Cancel) → dirty ? "Discard changes?" modal (Keep editing /
     Discard changes) : `onClose`.
2. **Launch button at the marked spot** (`document-panel.tsx`): in the
   "Replace document" row, after the "Loaded/Edited" indicator, a ghost
   `Btn` (glyph `Maximize2`, label "Full editor",
   `aria-label="Open the full document editor"`), rendered when the new
   optional prop `onOpenFullEditor` is provided. Clicking it calls
   `onOpenFullEditor(currentDraft)` — the draft travels up — then closes the
   inline session (`cancelEditing`), so no stale draft can ever overwrite a
   save made in the modal.
3. **Wiring** (`group-editor.tsx`, `manager.tsx`):
   - `GroupEditorProps.onOpenDocumentEditor?: (groupId: string, initialText:
     string | null) => void`, passed to the DocumentPanel as
     `onOpenFullEditor={(text) => onOpenDocumentEditor(group.id, text)}`.
   - The manager owns the open state (like `managingGroupId`/`fullEditId`,
     because `SetGroupDocument` bumps `UpdatedAt` and re-keys the group
     editor): `docEdit: { groupId, initialText } | null`; the modal renders
     keyed by group id only (no `updatedAt` in the key — a save behind it must
     not reset the session; the modal closes itself after saving).
4. **Dev harness** (`dev-harness-entry.tsx`): a FAKE document group in the
   fake vault plus `getGroupDocument`/`setGroupDocument` handlers (docs map,
   live `docChars`/`docLines` updates, `updatedAt` bump) — fake data only.
5. **Tests** (vitest, FAKE-* data only):
   - New `document-full-editor.test.tsx`: fetches when `initialText` is null;
     seeds from `initialText` without fetching; save persists + closes; empty
     draft refused; dirty close asks, clean close does not.
   - `group-editor.test.tsx`: a document group's "Edit document" → the Full
     editor button carries the typed draft up with the group id and closes the
     inline session.
   - `manager.test.tsx`: opening from the panel renders the modal
     (aria-label, carried draft visible), and saving inside persists through
     `setGroupDocument`.
6. **Docs in the same change:** SPEC §5.5 (document panel paragraph), README
   highlights line, DECISIONS §56, BUILD_LOG v1.14.0, CHANGELOG, HANDOFF;
   version bump 1.14.0 in the five places (AGENTS.md §11), tag `v1.14.0`
   after CI is green.

## Out of scope

- The create-mode document flow (a group becomes a document group only at
  creation).
- Items-mode group metadata (name/category/tags) — no full editor for those.
- The popup, the entry list rows (document groups open their own editor on
  click, unchanged), and any backend change (`getGroupDocument` /
  `setGroupDocument` already exist and are untouched).
- A read-only full document view (read-only hides the launch button, same as
  the "Edit document" pencil; the Copy document button remains the read path).

## Done-criteria

- [x] With a whole-document group open, "Edit document" then the "Full editor"
      button on the "Replace document" row opens the full-modal editor with
      the inline draft carried over (unsaved inline edits survive the move).
- [x] The inline editing session is closed by the move; saving in the modal
      persists byte-exact through `setGroupDocument`, toasts, and closes.
- [x] Esc/scrim/×/Cancel on a dirty draft asks "Discard changes?"; a clean
      draft closes directly; an empty draft refuses to save.
- [x] The button does not render in read-only mode or without the handler.
- [x] `bun run build`, `bun run test`, `lint:tokens`, `check:contrast` pass;
      CI green on GitHub after push.
- [x] Harness screenshots (real browser) in `docs/assets/` show the button on
      the marked row and the open modal with a long FAKE document.
- [x] Docs + five-place version bump committed; `v1.14.0` tag pushed; release
      artifacts verified on the releases page (CI green on `fc7a5f7` and
      `bcd54d4`; `Clavis-Setup-1.14.0.exe` + `Clavis-Portable-1.14.0.exe`
      published).
