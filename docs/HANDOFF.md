# HANDOFF — current state and next steps

Rewritten at the end of each session (AGENTS.md §10). Newest session at the top.

## Session 2026-11-24 — full-modal item editor (v1.12.0)

**Goal:** give the item editor a second, bigger home — the inline editor stays as-is, and a "Full editor" button opens the complete editor in a large centered modal (~900px), for more control and visibility on an item's data. Owner's answers: open via button on the inline view (B), large centered dialog (B), the whole editor inside (A).

**Milestones:**
- ⬜ M1 AGENTS.md §12 first-time setup (this file, CHANGELOG, specs/audits/archive/assets folders, §11 project facts, .gitignore).
- ⬜ M2 Audit + spec: `docs/audits/2026-11-24-item-full-modal-editor.md`, `docs/specs/item-full-modal-editor.md`.
- ⬜ M3 Build: ItemEditor gains a `variant` ("inline" | "modal"); Manager owns the modal open state (survives editor remounts); ValueField gets a taller rows option; dirty-close guard in the modal.
- ⬜ M4 Docs + version bump to 1.12.0 (app.go, build/winres/info.json), DECISIONS §53, BUILD_LOG, CHANGELOG, SPEC §5.4, README.

**Known facts for this session:**
- Owner's GitHub token was used for clone/push only, never stored in any tracked file. Rotate when work ends.
- Go toolchain is NOT available in the dev sandbox: Go-side changes (none planned) and `go test ./internal/...` must go through CI (`.github/workflows/ci.yml`). Frontend (bun: build, vitest, lint:tokens, check:contrast) runs locally.
- False alarm resolved: `group-member-row.tsx` line 48 is correct on disk (`const [manual, setManual]`). An earlier tool-display glitch swallowed the `[m` byte pair and made a healthy line look mangled. Verified with `od -c`; build + tsc + full test suite pass on main.

**Repo state at session start:** clean tree on `main` at `9bd21f5` (v1.11.1). No uncommitted changes, no unfinished migrations, no leftover TODOs found.

**Spec hunt (§12 step 6, honest scope):** `docs/SPEC.md` was spot-checked against the code for the editor surfaces this session touches (§5.4 item editor, §5.5 group editor + manage-items modal, §5.6 shared-item modals) — they match the code. The `docs/ui-audit/round-1/` material is a completed audit round (its F-numbers are referenced throughout the code) and stays where it is; `docs/audits/` is created for future audits. Minor drift noticed (not blocking, not touched this session): SPEC §5.4's field list predates the v1.6.0 Shared toggle (DECISIONS §44) — the code and DECISIONS are the truth. A full line-by-line SPEC audit has NOT been done; only the sections above were verified.

**Standing limits:** none. Standing approval (AGENTS.md §5) applies: commit, push, tag releases.
