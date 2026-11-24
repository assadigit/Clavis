> Agents: read AGENTS.md in the repo root first, and follow it for this whole task.

# Audit — a full-editor button on the rows where items are listed (2026-11-24)

Owner's report: "It still doesn't have the manual edit. SEE, when you have items showing in sidebar, I want a button so u can edit/work on them in a bigger editor."

## What the owner means

v1.12.0 shipped the full-modal item editor (DECISIONS §53) — but its only two entry
points live on the **inline editor** (header expand button + footer "Full editor"
button), i.e. AFTER the owner has clicked a row and the item is already open in the
tight detail-column editor. Scanning the list column, the rows' visible actions are
Copy and Pin only — nothing says "edit this in the big editor". The owner reads the
manager's middle column (the entry list) as "the sidebar"; they want the launch
button **on the row itself**, one click from the list.

## Surfaces where items are listed (findings)

1. **`entry-list/entry-list-row.tsx`** — the manager's list column. Row = EntryTile +
   name/meta + shared-count + [Copy] [Pin]. Click selects → inline editor in the
   detail column. **No full-editor affordance.** ← the surface the owner described.
2. **`group-editor/group-member-row.tsx`** — the member well of an open ITEMS group.
   Row body click → inline item editor (with `groupContextId`). Actions:
   open-link (conditional), Copy, Reveal, Delete. **No full-editor affordance.**
   Same pattern, same gap — items listed in a row-list where the only edit path is
   the tight inline editor.
3. **`manage-items/sortable-member-row.tsx`** — inside the Manage items modal:
   reorder (up/down/drag) + remove. Membership management, not editing; opening a
   second modal from inside this modal would stack modals. **Out of scope.**
4. **`popup/rows.tsx`** — the quick palette is copy-first and never shows values;
   adding an editor there fights its purpose (SPEC §3.3b). **Out of scope.**

## How the modal opens today (v1.12.0 wiring)

- `manager.tsx` owns `fullEditId` (+ `closeFullEditor`); the modal `ItemEditor` is
  rendered when `fullEditItem` exists; `groupContextId` is derived from `selection`
  when it matches the edited item; `followFullEdit` re-points the modal after
  Duplicate / "Only for this group".
- The inline editor's header expand button: `onOpenFullEditor` prop, glyph
  `Maximize2`, title "Open the full editor — every field, more room", visible in
  read-only too (opens the read-only full view).
- The modal itself needs nothing new — it already works from any selection state;
  opening it for an unselected item just needs `setSelection` + `setFullEditId`.

## Decisions (recorded in DECISIONS §55)

- **Glyph `Maximize2`**, same as the inline editor's affordances — one action, one
  glyph everywhere; the row click already opens the inline editor, so a pencil
  would promise the wrong thing.
- **Item rows only.** The full-modal editor is an item editor; group rows keep
  Copy + Pin (clicking a group opens the full-height group editor).
- **Always visible, not hover-revealed** — matches Copy/Pin; the owner asked for a
  visible button.
- **Selection follows the open** (like every other open path) so the inline editor
  behind the modal matches, keyboard focus returns somewhere sane, and the shared
  split flow (§5.6 `groupContextId`, wired through the member rows) keeps working.
- **Member rows carry `groupContextId`** into the open, exactly like their
  click-to-select path.
- **Not disabled in read-only** — same as the v1.12.0 affordances (read-only opens
  a read-only full view).

## Risks

- Row button noise: three icons per row (Edit, Copy, Pin) — accepted; the row is
  416px wide and the buttons are 24px ghost icons with tooltips.
- No new logic is introduced: the handler reuses the existing modal-open state
  (`fullEditId`); a11y stays clean (sibling buttons, no nesting — the row pattern
  already axe-passes with two buttons).
