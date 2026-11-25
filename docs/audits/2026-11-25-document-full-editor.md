> Agents: read AGENTS.md in the repo root first, and follow it for this whole task.

# Audit — a full-modal editor for a whole-document group's content (v1.14.0)

Owner's request (with a screenshot, marked next to the "Replace document"
heading): "I want a button where I drawn a black/yellow one, to edit the content
of each item in a full modal editor." The marked spot is the document panel of a
whole-document group (MODE 1, v1.5.0 §40) — the panel that shows "Copy document",
the size stats, the Secret toggle and, once "Edit document" is pressed, the
"Replace document" heading with a 12-row inline TextArea.

## What exists today

1. **The document panel** (`frontend/src/components/clavis/group-editor/document-panel.tsx`,
   208 lines): renders for `mode: "document"` groups in the group editor's edit
   mode. "Edit document" (pencil) starts an inline editing session — it fetches
   the stored document via `getGroupDocument` on demand (documents never travel
   in the state snapshot, §40), shows a mono `TextArea rows={12}` under the
   "Replace document" heading, and "Save document" writes it back byte-exact via
   `setGroupDocument`. An empty draft is refused (`messages.docEmptyWarning`).
   Right of the heading sits a disabled "Loaded/Edited" indicator
   (`RefreshCw`). This is the ONLY editor for a document group's content, and
   it is tight: 12 rows inside the detail column (~360px wide).
2. **The full-modal ITEM editor** (v1.12.0, DECISIONS §53, `item-editor.tsx`
   `variant: "modal"`): the complete item form in the app's `Modal` shell at
   `min(900px, …)`, dirty-close guard, manager-owned open state (`fullEditId`).
   Entry points: the inline editor's header expand button + footer "Full
   editor" button, and — since v1.13.0 (§55) — the Maximize2 button on
   entry-list item rows and group member rows. **It is an item editor only.**
   Group rows deliberately have no launch button (groups open their own editor
   on click), and nothing ever opens a *document group's content* in a modal.
3. **Why the modal must be manager-owned:** `Store.SetGroupDocument`
   (`internal/store/store.go:1163`) bumps the group's `UpdatedAt`, and the
   manager re-keys the group editor on every `UpdatedAt` change
   (`key={group-${id}-${updatedAt}}`) — a save inside a document-panel-owned
   modal would remount the panel and yank the modal away mid-session. The same
   reasoning already placed `managingGroupId` (Manage items modal) and
   `fullEditId` (item full editor) in `manager.tsx` — the document full editor
   follows the exact same pattern.
4. **Draft continuity:** the inline panel holds its draft in local state. If a
   full editor opened by *fetching the stored document*, the user's unsaved
   inline edits would be silently dropped — and after a modal save, the stale
   inline draft would still be sitting behind it (pressing its "Save document"
   would revert the modal's save). The full editor must **carry the inline
   draft over** and the inline session must close when the full one opens —
   one editing session, moved into the bigger editor (mirroring §53's "same
   editor, two presentations").
5. **The Modal shell** (`ui/modal.tsx`): focus starts inside (an `autoFocus`
   field grabs it during commit, before the shell's effect), Tab is trapped,
   Esc runs through `useEscStack`, every close path funnels through `onClose`,
   focus returns to the opener. `ariaLabel` supports rich titles. The item
   editor's modal is the reference implementation.
6. **Dev harness** (`vite.harness.config.ts`, `dev-harness-entry.tsx`,
   `dev-harness/wails-runtime-mock.ts`): the real Manager against an in-memory
   fake vault, for browser verification without Windows/Wails. It has **no
   document group and no `getGroupDocument`/`setGroupDocument` handlers yet** —
   both are needed to verify this feature visually.
7. **Tests:** `manager.test.tsx` covers the item full editor's open+save paths
   (v1.12.0/v1.13.0 patterns to mirror); `group-editor.test.tsx` covers
   items-mode groups only. `ApiResult.document` already exists in
   `client.ts` (used by the panel's fetch), so the transport type is ready.

## The gap

A whole-document group's content — often a long pasted file — can only be
worked on in a 12-row inline TextArea. The owner marked exactly where the
launch button belongs: on the "Replace document" row, where the tight editor
announces itself.

## Plan shape (spec follows)

- A new `DocumentFullEditor` component (Modal, 900px, tall mono TextArea, live
  draft stats, Save/Cancel, dirty-close guard) owned by the manager like the
  other two modals.
- A "Full editor" button (Maximize2, same glyph as every other launch point)
  at the marked spot: right end of the "Replace document" row. It hands the
  current inline draft up and closes the inline session.
- Read-only: the button does not render (the pencil it replaces is also
  hidden in read-only; there is no read-only document viewer to open).

Out of scope: the create-mode document flow, items-mode group metadata, the
popup, backend changes (the two actions already exist), and a read-only full
document view.
