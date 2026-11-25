# HANDOFF — current state and next steps

Rewritten at the end of each session (AGENTS.md §10). Newest session at the top.

## Session 2026-11-25 (latest) — full-modal editor for whole-document groups (v1.14.0)

**Goal:** the owner sent a screenshot with a black/yellow mark on the document
panel's "Replace document" row — "I want a button where I drawn a black/yellow
one, to edit the content of each item in a full modal editor." A whole-document
group's stored file was the last content still confined to the tight 12-row
inline editor (the item editor got its full modal in v1.12.0, row buttons in
v1.13.0).

**Status: DONE — v1.14.0.** Commits: `0730d9d` (audit + spec), `fc7a5f7` (the
feature + harness + tests + screenshots), docs+version commit, tag `v1.14.0`.

**What shipped** (details DECISIONS §56): the "Full editor" button sits at the
marked spot — right end of the "Replace document" row, same Maximize2 glyph as
every other launch point. One click moves the whole editing session into a
~900px modal (`DocumentFullEditor`, manager-owned like the other two modals
because `setGroupDocument` bumps `updatedAt` and re-keys the group editor):
the inline draft — unsaved edits included — carries over as `initialText`, a
24-row mono editor opens with live draft stats (the backend's rune/newline
rule), and the inline session closes behind it so no stale draft can ever
overwrite a save made in the modal. Saving is byte-exact through the unchanged
`setGroupDocument`, toasts, and closes; Esc/scrim/×/Cancel on a dirty draft
shows the same "Discard changes?" guard as the item full editor. Read-only
hides the button (like the pencil). The backend, the modal shell, the inline
editor and the §40 redaction rules are untouched.

**Verification this session:** `bun run build` clean; **159/159** vitest (+11);
`lint:tokens` + `check:contrast` pass; real-browser verification through the
dev harness (which gained a FAKE document group + `getGroupDocument`/
`setGroupDocument` handlers) — four screenshots
`docs/assets/2026-11-25-harness-11..14-*.png`: the button on the marked row,
the open modal (24-row editor, carried content, live stats updating
416→444 chars while typing), the dirty-close guard, and the stats row after
save (the save round-tripped through the fake store; reopening the inline
editor showed the saved content). Browser console clean. Go untouched (CI
runs the Windows matrix).

**Note for the owner's install:** if the installed Clavis is still ≤ 1.12.0,
its updater predates the v1.12.1 proxy fix — that one update needs the manual
path (Settings → About → "Release page", or VPN/TUN on); from 1.12.1 on,
self-updates route through the system proxy.

---

## Session 2026-11-24 (later) — full-editor button on list rows (v1.13.0)

**Goal:** the owner reported "when you have items showing in sidebar, I want a
button so u can edit/work on them in a bigger editor" — v1.12.0's full-modal editor
is only reachable through the tight inline editor; add the launch button directly
on the rows where items are listed (manager entry list + group member well).

**Status: DONE — v1.13.0.** Commits: `3ad1bf7` (audit + spec), `aece364` (the
feature), docs+version commit, tag `v1.13.0`.

**What shipped** (details DECISIONS §55): item rows in the manager's list column
and member rows in a group's member well carry the expand button (Maximize2, the
same glyph as the inline editor's affordances, first row action) — one click opens
that item directly in the full-modal editor. One `openFullEditor` handler in the
manager (select → clear create form → `setFullEditId`); the member-row path passes
`groupContextId`, so the "editing within …" chip and the SPEC §5.6 shared-item
choices work inside the modal. Group rows, the Manage items modal and the popup
are untouched; read-only opens the read-only full view; the modal, its dirty-close
guard and `followFullEdit` are unchanged.

**Verification this session:** `bun run build` (tsc+vite) clean; **148/148**
vitest (+3: the row button opens the modal from an unselected list and hands the
selection up; group rows show no such button; the member-row callback carries the
group context); `lint:tokens` + `check:contrast` pass; visual verification in the
dev harness (real browser, FAKE-* data) — four screenshots
`docs/assets/2026-11-24-harness-7..10-*.png`: the buttons on the rows, the modal
opened straight from a row (all fields, key visible, focus on Name), and the
member-row open carrying the "editing within 'FAKE Deploy set'" chip. Go untouched
(CI runs the Windows matrix).

**Note for the owner's install:** if the installed Clavis is still ≤ 1.12.0, its
updater predates the v1.12.1 proxy fix — that one update needs the manual path
(Settings → About → "Release page", or VPN/TUN on); from 1.12.1 on, self-updates
route through the system proxy.

---

## Session 2026-11-24 (later) — self-update download resilience (v1.12.1) — DONE

**Goal:** fix the in-app update failure the owner hit updating to 1.12.0
(`net/http: TLS handshake timeout` against `release-assets.githubusercontent.com`).

**Status: DONE — v1.12.1 released.** Commits: `1e839a0` (audit + spec), `df7ae3d`
(the fix), docs+version commit, tag `v1.12.1` (Release workflow publishes both
artifacts — verify on the releases page before announcing).

**Root cause in one line:** Go's net/http ignores the Windows system proxy, and
the owner's network starves the GitHub asset CDN's TLS handshake — the updater
connected direct-only, once, with a 10 s handshake deadline.

**What shipped** (details DECISIONS §54): proxy-aware transports (env → Windows
system proxy → direct) for both the update check and the download; proxy→direct
client rotation over 4 attempts with backoff; 30 s dial/TLS budgets, 3-min
per-attempt deadline under the unchanged 10-min total; resume from `.part` +
`.part.meta` guard (stale parts never mixed; a complete part finishes without
re-downloading); honest failure messages mentioning the VPN/proxy path.

**Verification this session:** Go 1.27.4 installed in the sandbox; `gofmt`,
`go vet ./internal/...`, `go test ./internal/...` green on linux; `GOOS=windows
go vet ./...` green (type-checks the registry code); production
`-tags production` build cross-compiled cleanly; govulncheck clean on
`./internal/...`; frontend gates re-run green (145/145, tsc, tokens, contrast).
NOT tested: the real Windows proxy registry read and a live censored-network
download (no Windows machine in the sandbox) — the registry reader is 15 lines
over a documented WinINET key and the parser/resume/retry logic is fully
covered by tests; CI vets/compiles the Windows path on windows-latest.

**How the owner gets 1.12.1** (their installed updater is the broken one):
turn the VPN on (Clavis ≥ 1.12.1 follows the Windows proxy setting — but the
OLD build does not), or download once from the release page in a browser
(Settings → About → "Release page"), or use TUN/VPN mode for that one update.
From 1.12.1 on, self-updates route through the system proxy and retry/resume.

**Follow-ups (not blocking):** PAC/WPAD (`AutoConfigURL`) proxy support if a
PAC user reports failure; consider surfacing the detected proxy in the update
card for transparency.

---

## Session 2026-11-24 — full-modal item editor (v1.12.0) — DONE

**Goal:** give the item editor a second, bigger home — the inline editor stays as-is, and "Full editor" buttons open the complete editor in a large centered modal (~900px). Owner's answers: open via button on the inline view (B), large centered dialog (B), the whole editor inside (A).

**Status: DONE AND RELEASED — v1.12.0 is live.** Releases page: `Clavis-Setup-1.12.0.exe` + `Clavis-Portable-1.12.0.exe` (verified). Commits: `d9d5a21` (§12 setup), `6b85d7f` (audit + spec), `9a8a0a4` (the feature), `6463ed0` (docs+version), `2123924` (go 1.27.4 — govulncheck gate had started failing every push on the Go stdlib advisory GO-2026-6859), `cdbb37d` (toolchain note), `9d02168` (complete the five-place version bump the release guard enforces).

**Process note (disclosed):** the first `v1.12.0` tag pointed at `cdbb37d`, whose release run was REFUSED by the version guard (two of the five version places were still 1.11.1) — nothing was published. The tag was deleted and re-created at `9d02168` before any release existed; the re-run published cleanly. No published artifact was ever affected.

**What shipped:**
- `ItemEditor` has `variant: "inline" | "modal"` — one component, one logic, two presentations. The inline editor is unchanged except two launch affordances: a header expand button (always visible) and a footer "Full editor" button.
- The modal: the app's Modal shell at `min(900px, …)`, Advanced pre-expanded (key visible), 12-row value area, focus on Name, pinned action bar, Enter saves, `aria-label` "Edit item …" (new optional `ariaLabel` prop on the Modal shell).
- Dirty-close guard ("Discard changes?" / Keep editing / Discard). Manager owns the open state (`fullEditId`): saves inside keep it open, delete closes it, Duplicate/"Only for this group" follow the new copy, `groupContextId` passes through (SPEC §5.6 works inside).
- Variant-unique field ids (`clavis-item-name-full` …) — the two mounted editors never share an id (the collision was caught by the new manager test).
- Dev harness (unshipped dev tool): `frontend/vite.harness.config.ts`, `dev-harness.html`, `dev-harness/wails-runtime-mock.ts`, `src/dev-harness-entry.tsx`. Run: `cd frontend && bunx vite --config vite.harness.config.ts` → open `http://localhost:5199/dev-harness.html` (or any port). Fake FAKE-* data only.
- Docs: DECISIONS §53, BUILD_LOG v1.12.0, SPEC §5.4 rewritten for both presentations, README highlights, CHANGELOG. Version: `app.go` → 1.12.0, `build/winres/info.json` → 1.12.0.0.

**Verification:** tsc clean; **145/145** vitest green (+9 new); token lint + AA contrast gates pass; `bun run build` clean. Visual: six screenshots in `docs/assets/2026-11-24-harness-*.png` (manager, inline editor, full editor, dirty guard, shared save, after-save) — taken in a real browser through the dev harness and checked. **Not verified here:** the Windows exe itself (no Windows/Wails in the sandbox) — CI's Windows matrix covers the Go build; the owner should also try the real app after the release.

**Known notes for future sessions:**
- A tooling quirk in this sandbox: displayed command output can swallow `[m`-style byte pairs (e.g. `const [manual,` displays as `const anual,`). Before "fixing" anything that looks like a syntax error, verify the raw bytes (`od -c`) — this session nearly chased a phantom bug because of it.
- The Go side was not touched this session; if a future session changes `internal/`, the Go tests can only run in CI (no Go toolchain in the sandbox).
- Possible follow-ups the owner may ask for (not built, out of scope): full editor for CREATE mode; a full-modal group editor; remember-the-modal preference.

**Standing limits:** none. Standing approval (AGENTS.md §5) applies: commit, push, tag releases.

## Repo state

Clean tree on `main`. No unfinished migrations, no leftover TODOs from this session.

## Spec hunt (from the §12 setup, still accurate)

`docs/SPEC.md` was spot-checked against the code for §5.4/§5.5/§5.6 (they match; §5.4 now documents both editor presentations). `docs/ui-audit/round-1/` is a completed audit round and stays where it is. Minor drift noticed (not blocking): SPEC §5.4's field list predates the v1.6.0 Shared toggle (DECISIONS §44) — the code and DECISIONS are the truth. A full line-by-line SPEC audit has NOT been done; only the sections above were verified.
