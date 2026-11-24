> Agents: read AGENTS.md in the repo root first, and follow it for this whole task.

# Audit — the item editor's full-modal view (2026-11-24)

Scope of this audit: every surface where an item's content is edited today, and every mechanism the new full-modal editor will touch. Fake data only; no user data was read.

## 1. Where item editing happens today

| Surface | File | What it is |
| --- | --- | --- |
| Item editor (inline) | `frontend/src/components/clavis/item-editor.tsx` (~535 lines) | Renders in the manager's detail column (SPEC §5.4). Two modes: `create` (from the list's +, the popup's Ctrl+N, or "Create new item here" in the manage-items modal → `Creating.forGroupId`) and `edit` (clicking a row in the entry list, or a member card in a group editor → `Selection` with optional `groupContextId`). |
| Value field | `frontend/src/components/clavis/editors/value-field.tsx` | Masked preview + Reveal for secrets; plain `TextArea rows={6}` otherwise. Reveal state resets on remount. |
| Group member row | `frontend/src/components/clavis/group-editor/group-member-row.tsx` | Read-only row (copy/reveal/open-link/delete); clicking the row body selects the item → the inline editor opens in the detail column. Not an editor itself. |
| Shared-item modals | `frontend/src/components/clavis/shared-modals.tsx` | When an item lives in ≥2 groups, saving/deleting from the item editor routes through SharedEditModal / SharedDeleteModal (SPEC §5.6). |

The manager window is ~1000×680 DIP with three columns; the detail column is the right third — this tightness is the owner's report.

## 2. How the editor is mounted and refreshed

- `manager.tsx` renders `ItemEditor` with `key={item-${id}-${updatedAt}}` — every save (or any mutation to the item) remounts the editor with a fresh draft. Draft state intentionally lives only in the component.
- Edit mode fetches the value once on mount via `getValue` (the state snapshot is redacted; SPEC §5.2 — values cross to the webview only on demand, one item at a time).
- The Manage items modal is owned by `manager.tsx` (`managingGroupId` state, key without `updatedAt`) precisely so it survives editor remounts. **Lesson for the new modal: its open state must live in `manager.tsx` too**, or a save inside it would remount it away.
- `deleteEntry` (manager-entry) soft-deletes with an Undo toast and does not clear the selection; the Manager's `selItem` lookup filters `!deletedAt`, so a deleted item's editor falls through to empty states. A modal keyed on a live-item lookup closes itself on delete the same way.

## 3. Reusable parts the feature should build on

- `ui/modal.tsx` — the app's modal shell: `width` prop, `maxHeight: calc(var(--clavis-modal-vh, 100dvh) - var(--space-6))`, scrollable body, optional pinned footer, focus trap + Esc stack + opener-refocus (F-004), scrim click = close. The Manage items modal already uses it at `min(720px, …)`.
- `ui-bits.tsx` re-exports the whole kit (Btn, TextInput, TextArea, FieldLabel, Toggle, Menu…).
- `SharedEditModal` / `SharedDeleteModal` are self-contained and can render inside any container.

## 4. Constraints that shape the design

- **No duplicated editor logic.** The save/dirty/shared-split/delete flows are subtle (SPEC §5.6). One component must serve both the inline and the modal presentation, or the two will drift.
- **Keyboard:** Enter saves, Ctrl+Enter adds a newline in the value, Shift+Enter newline — the handler lives on the editor's root div and must work in the modal too; Esc is owned by the modal's Esc stack (nested modals: shared-edit/delete confirm, and a new dirty-close guard must stack correctly).
- **Read-only mode:** the inline editor hides Save and disables Copy/Duplicate; the modal must behave identically (a read-only full view is still useful for visibility).
- **Styling:** token-driven inline styles only (`lint:tokens` and `check:contrast` gates in CI). No indigo/blue beyond the existing Bitwarden brand system.
- **Tests:** vitest + axe (a11y.test.tsx runs axe on views). Existing suites: `item-editor.test.tsx` (renders ItemEditor directly with mocked `call`), `manager.test.tsx`, `manage-items-modal.test.tsx`, `ui/modal-focus.test.tsx`. New behavior needs tests in the same style.

## 5. Risks

- **Focus management across remounts:** after a save inside the modal, the `key` changes → remount → the modal's opener-refocus logic re-captures focus. Must verify focus lands somewhere sensible inside the modal, not on `body`.
- **Two mounted editors for the same item** (inline behind + modal): both fetch `getValue` once on mount; independent drafts; after a modal save the inline editor remounts fresh. Acceptable — but the inline editor must not also render its own SharedEditModal in a conflicting way (modals stack by z-index; only one is open at a time in practice since focus is trapped).
- **Dirty-close guard vs. Esc stack:** the guard itself is a modal on top; its own Esc must close the guard, not the editor under it (useEscStack handles nesting — verify with a test).

## 6. What I did NOT audit (not touched by this feature)

Popup (quick search) UI, settings view, trash view, import/export dialogs, the Go backend (no backend change is needed — the feature is purely frontend), and the whole `internal/` tree.
