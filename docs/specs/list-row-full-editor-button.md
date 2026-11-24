> Agents: read AGENTS.md in the repo root first, and follow it for this whole task.

# Spec — a full-editor button on the rows where items are listed (v1.13.0)

Owner's request: "when you have items showing in sidebar, I want a button so u can
edit/work on them in a bigger editor."

The full-modal item editor exists since v1.12.0 (spec `item-full-modal-editor.md`,
DECISIONS §53). This spec adds the missing entry points: the rows themselves.

## Goal

One click from any list where items are shown opens that item directly in the
full-modal editor — no detour through the tight inline editor first.

## Scope

1. **Entry list rows** (`entry-list/entry-list-row.tsx`): a new ghost action button
   (glyph `Maximize2`, `aria-label`/title "Open <name> in the full editor") on
   **item rows only**, placed as the first row action (before Copy and Pin). It
   stops propagation (the row itself must keep its select-on-click). Not disabled
   in read-only (opens the read-only full view, same as v1.12.0's affordances).
   New optional prop `onOpenEditor?: () => void`; the button renders only when the
   prop is provided.
2. **Group member rows** (`group-editor/group-member-row.tsx`): the same button
   (glyph `Maximize2`, "Open <name> in the full editor"), first action before the
   conditional open-link / Copy / Reveal / Delete. New optional prop
   `onOpenFull?: () => void`.
3. **Wiring** (`entry-list.tsx`, `group-editor.tsx`, `manager.tsx`):
   - `EntryListProps.onOpenEditor?: (sel: { kind: "item"; id: string }) => void`,
     passed to item rows only (group rows never see it).
   - `GroupEditorProps.onOpenFullEditor?: (sel: Selection) => void`, called with
     `{ kind: "item", id, groupContextId: group.id }` (the member's select path,
     so the SPEC §5.6 shared-split flow works from the modal).
   - `manager.tsx` gains one `openFullEditor(sel)` handler: select the entry, clear
     any create form, `setFullEditId(sel.id)`. Passed to both surfaces. The modal,
     its dirty-close guard, and `followFullEdit` stay exactly as they are.
4. **Tests** (vitest, fake data only): the entry-list row button opens the full
   editor (dialog appears, key field visible by default) and hands the selection
   up; the group member row button calls back with the group context; existing
   suites stay green untouched.
5. **Docs in the same change:** SPEC §5.3/§5.4 note the row affordance, README
   highlights line, DECISIONS §55, BUILD_LOG v1.13.0, CHANGELOG, HANDOFF; version
   bump 1.13.0 in the five places (AGENTS.md §11), tag `v1.13.0` after CI is green.

## Out of scope

- The Manage items modal rows (membership management — no modal stacking).
- The popup quick palette (copy-first by design).
- Group rows in the entry list (the full editor is an item editor; groups already
  open their own full-height editor on click).
- Any change to the modal itself, the inline editor, or the backend.

## Done-criteria

- [x] Item rows in the manager's list column show the full-editor button; clicking
      it opens the item in the full-modal editor (dialog with all fields, key
      visible) and selects the item behind it.
- [x] Group rows show no new button; Copy/Pin behave exactly as before.
- [x] Member rows of an open group show the button; it opens the full editor with
      the group context (shared-item save still offers the §5.6 choices).
- [x] The button works in read-only mode (read-only full view) and is keyboard
      reachable with correct labels (axe clean).
- [x] `bun run build`, `bun run test`, `lint:tokens`, `check:contrast` pass; CI
      green on GitHub after push.
- [x] Docs + five-place version bump committed; `v1.13.0` tag pushed; release
      artifacts verified on the releases page.
