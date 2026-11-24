# CHANGELOG

What changed, per session, newest first. Started 2026-11-24 during the AGENTS.md §12 first-time setup — deeper engineering history for earlier versions lives in `docs/BUILD_LOG.md` and `docs/DECISIONS.md` (decision log, add-only).

## 2026-11-24 — session: full-modal item editor (v1.12.0)

- AGENTS.md §12 first-time setup: this CHANGELOG, `docs/HANDOFF.md`, `docs/specs/`, `docs/audits/`, `docs/archive/`, `docs/assets/`, Project facts filled into AGENTS.md §11; `.gitignore` now covers `.env` and `backups/`.
- New feature (owner request + spec `docs/specs/item-full-modal-editor.md`): the item editor's full-modal view — the inline editor stays as-is; a "Full editor" button opens the complete editor (all fields, key field visible by default, taller value area, Copy/Duplicate/Delete) in a large centered ~900px modal with a dirty-close guard. Details in DECISIONS §53.
