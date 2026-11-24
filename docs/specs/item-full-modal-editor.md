> Agents: read AGENTS.md in the repo root first, and follow it for this whole task.

# Spec — the item editor's full-modal view (v1.12.0)

Owner's request: "when I have items, I need a full-modal editor if I wanted to edit the content, currently it's inline and tight."

Owner's answers (2026-11-24): **(Q1) B** — inline editing stays exactly as it is, plus a "Full editor" button on the inline view; **(Q2) B** — a large centered dialog, a bigger sibling of the Manage items modal (~900px); **(Q3) A** — the whole item editor lives in the modal: name, key, value, note, category, tags, Secret/Shared/Pinned toggles, Copy/Duplicate/Delete.

## Goal

One item editor, two presentations. The inline editor in the detail column stays byte-for-byte in behavior; a new full-modal presentation gives comfortable room and full visibility over the same fields, opened on demand.

## Scope

1. **One component, two variants.** `ItemEditor` gains `variant: "inline" | "modal"` (default `"inline"`). All logic (draft, dirty, `getValue` fetch, save, shared-split save, delete, copy, duplicate, exports) stays in the single component — no duplication.
2. **"Full editor" button on the inline editor** (edit mode only, also visible in read-only mode where it opens a read-only full view): footer actions row, `Btn variant="glass"` with the `Maximize2` icon, label "Full editor", title "Open the full editor".
3. **The modal** (`variant="modal"`), rendered inside the app's `Modal` shell:
   - `width="min(900px, calc(100vw - var(--space-6)))"`, the shell's existing maxHeight.
   - Title: the item's EntryTile + the live draft name; body starts with the context chips + meta line ("Secret · used N× · updated …"), then every field: name, Advanced toggle (expanded by default in the modal), key, value, category, tags, note, the three toggles, the Used-in list.
   - Value area gets a taller textarea (`rows={12}`) via a new optional `rows` prop on `ValueField` (default 6 — inline behavior unchanged).
   - Footer (pinned by the Modal shell): Save/Saved left; Cancel-close; Copy, Duplicate, and the ⋯ menu (Export JSON/Markdown/Text, Delete) right — same content and order as the inline footer, minus the "Full editor" button itself.
   - Keyboard: Enter saves, Ctrl+Enter/Shift+Enter newlines (same handler); Esc closes via the shell's Esc stack.
4. **Dirty-close guard.** Closing the modal (Esc, scrim, ×) with a dirty draft asks first: a small confirm dialog ("Discard changes?" / Keep editing / Discard). Clean draft or read-only closes directly.
5. **Modal state lives in `manager.tsx`** (`fullEditId`), like `managingGroupId`, so a save inside the modal (which bumps `updatedAt` and re-keys the editor) does not close it. The modal's item lookup filters `!deletedAt`, so deleting the item closes the modal naturally. After Duplicate, the modal follows the new copy (`fullEditId` follows the selection). `groupContextId` is passed through so the shared-item split flow (SPEC §5.6) works identically inside the modal.
6. **Tests** (vitest, same style as `item-editor.test.tsx`, fake data only): inline button calls the open callback; modal renders all fields with the key field visible by default; save flow calls `updateItem` with the right patch and stays open; Enter saves; dirty close asks, Discard closes, Keep editing doesn't; clean close doesn't ask; shared-item save still routes through SharedEditModal inside the modal; read-only disables the fields; the existing inline suites stay green untouched.
7. **Docs in the same change:** SPEC §5.4 (document both presentations), README highlights line, DECISIONS §53, BUILD_LOG v1.12.0, CHANGELOG, HANDOFF; version bump 1.12.0 in `app.go` + `build/winres/info.json` (tag `v1.12.0` pushed after CI is green).

## Out of scope

- Create mode stays inline-only (the request is about editing existing items; noted as a possible follow-up).
- The group editor, member rows, popup, and any backend/Go change.
- Two-column field layout inside the modal (single column, consistent with the app).

## Done-criteria

- [ ] Inline editor behaves exactly as before (existing suites green, no visual change except the new button).
- [ ] "Full editor" opens the modal; modal shows every field incl. key by default; taller value area.
- [ ] Save inside the modal persists via `updateItem`, shows the Saved state, and the modal stays open for further edits.
- [ ] Shared item (≥2 groups) saved from the modal offers the same three choices as inline; the split flow selects the new copy.
- [ ] Dirty close asks; clean close and read-only close don't; Esc closes (via guard when dirty).
- [ ] Delete from the modal deletes with the Undo toast and closes the modal; Duplicate follows the copy.
- [ ] `bun run build`, `bun run test` (all suites incl. axe), `lint:tokens`, `check:contrast` pass locally; CI green on GitHub (Go jobs included).
- [ ] Visual check of the modal in a browser harness with mocked runtime (untracked dev tool), desktop width; screenshot filed in `docs/assets/`.
- [ ] Docs + version bump committed; `v1.12.0` tag pushed; HANDOFF/CHANGELOG/DECISIONS/BUILD_LOG updated.
