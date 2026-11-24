# CHANGELOG

What changed, per session, newest first. Started 2026-11-24 during the AGENTS.md §12 first-time setup — deeper engineering history for earlier versions lives in `docs/BUILD_LOG.md` and `docs/DECISIONS.md` (decision log, add-only).

## 2026-11-24 — session: full-modal item editor (v1.12.0)

- AGENTS.md §12 first-time setup: this CHANGELOG, `docs/HANDOFF.md`, `docs/specs/`, `docs/audits/`, `docs/archive/`, `docs/assets/`, Project facts filled into AGENTS.md §11; `.gitignore` now covers `.env` and `backups/`.
- New feature (owner request + spec `docs/specs/item-full-modal-editor.md`, DECISIONS §53): the item editor's full-modal view — the inline editor stays as-is; a header expand button and a footer "Full editor" button open the complete editor (all fields, key visible by default, 12-row value area, Copy/Duplicate/Delete) in a large centered ~900px modal with a dirty-close guard ("Discard changes?"). Saves inside the modal keep it open; delete closes it; Duplicate/"Only for this group" follow the new copy; the SPEC §5.6 shared-item flow works identically inside.
- Fixed on the way (caught by the new tests): the two simultaneously mounted editors shared field ids — labels could point at the other editor's inputs; ids are now variant-unique (`clavis-item-name-full` etc.).
- Dev harness (unshipped dev tool): `frontend/vite.harness.config.ts` + `dev-harness.html` + `src/dev-harness-entry.tsx` — the real Manager in a plain browser with an in-memory FAKE-* store and a mocked Wails runtime, for visual verification without Windows. Verification screenshots: `docs/assets/2026-11-24-harness-*.png`.
- Tests: 136 → 145 (+9), all green; tsc clean; token lint + AA contrast gates pass; Go side untouched (CI runs it on Windows). Version 1.12.0 (`app.go`, `build/winres/info.json`).
- False alarm resolved during the session: `group-member-row.tsx` was never broken — a tool-display glitch swallowed the `[m` byte pair (`const [manual,` displayed as `const anual,`); verified against the raw bytes with `od -c` and a clean build before touching anything.
