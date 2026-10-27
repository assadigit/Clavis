# 04b — Implementation plan (code-level companion to `04-fix-plan.md`)

Written: 2026-01-28 · For the implementation session (prompt: `05-session2-prompt.md`).

**How to use this document.** `04-fix-plan.md` defines *what* to do, *why*, in *what order*, and the milestone/verification per phase. This document defines *how*: exact files, anchors (file:line verified at commit `6e0d865`), data shapes, function signatures, code sketches for the non-obvious parts, and the test matrix. Where the two documents disagree on scope, `04` wins; on mechanics, this document wins. Nothing here overrides the standing rules in `04` (off-limits areas, one commit per phase, baseline re-runs).

**Line anchors drift.** Every anchor below was verified at `6e0d865` (current `main`). If an anchor no longer matches, re-locate with the quoted code, not by line number. The symbols and shapes are the contract.

---

## 0. Conventions and shared facts

**Run / verify (Linux or Windows):**

| What | Command | Where |
|---|---|---|
| Frontend install | `bun install` | `frontend/` |
| Frontend build (typecheck + vite) | `bun run build` | `frontend/` |
| Frontend tests (vitest, jsdom) | `bun run test` | `frontend/` |
| Go tests | `go test ./...` | repo root |
| Go vet | `go vet ./...` | repo root |
| Go format gate | `gofmt -l .` (must print nothing) | repo root |
| Frontend dev (browser, no tray) | `bun run dev` → `/popup.html`, `/manager.html` | `frontend/` |

CI (`.github/workflows/ci.yml`, windows-latest) already runs: frontend build + vitest; gofmt gate; `go vet`; `go test ./...`; a production build; govulncheck; npm audit. Everything you add must keep all of that green. Note the known `clipboard-e2e` flake documented in `01b-baseline.md`'s appendix — re-run once before believing a red go job.

**Result envelope.** Go methods callable from the frontend return `map[string]any` built with `service.Fail(msg, status)` / `service.FailErr(err)` / plain `{"ok": true, ...}`. Import results flow through `internal/service/service.go` `Dispatch` (the `call()` on the frontend) — actions `importBackupPreview` (service.go:509) and `importBackup` (service.go:518) are thin pass-throughs to the store. **The frontend never talks to the store except through these two layers.**

**Export call path (for Phase 4):** frontend `downloadExport(what, id)` (`frontend/src/lib/clavis/client.ts:83`) → `Call.ByName("main.Clavis.ExportSave", what, id ?? "")` → `ExportSave` switch in `app_exports.go:23`. The `what` strings are the API contract; `kindOf(what)` (app_exports.go:69) maps `"item*"` → item, anything else → group.

**UI-kit pattern:** small primitives live in `components/clavis/ui/*.tsx` and are re-exported from `ui-bits.tsx` (see the header comment of `ui/modal.tsx` for the pattern). New shared UI goes there.

**Data model (`internal/store/model.go`):** `Item` = {id, name, key, value, note, categoryId*, tags, isSecret, pinned, useCount, lastUsedAt*, createdAt, updatedAt, deletedAt*}; `Group` = same minus key/value/note/isSecret, plus `itemIds` (membership order is this slice's order); `Category` = {id, name, sortOrder}; `VaultData` = {schemaVersion, appVersion, encryption, settings, categories, items, groups}. `NowISO` = UTC ms-precision ISO (lexicographic == chronological). `SafeFilename` lives in `internal/exchange/safe.go`. Group membership resolves through `groupMembersLocked(groupID)` (`internal/store/store.go`, ~1395). Every import takes an automatic pre-import backup via `saveLocked(kindPreImport)` (see `import.go:191,336`) — the fragment import keeps this guarantee.

**Frontend types** mirror the Go shapes in `frontend/src/lib/clavis/types.ts`; the transport interfaces (`BackupPreview`, `ApiResult`, `ExportWhat`) are in `client.ts`.

---

## Phase 1 — Screen smoke tests (safety net)

**New files only** (`frontend/src/components/clavis/*.test.tsx`), no product changes.

Mock pattern: copy `popup.test.tsx` — it already mocks `@wailsio/runtime` and/or `client.ts`/`platform.ts`. Render with fake state (reuse the fixture style of the audit mock: names like `FAKE-token item`; never real-looking secrets).

| Test file | Screen under test | One key assertion each |
|---|---|---|
| `manager.test.tsx` | `manager.tsx` | renders with a selected item; clicking a row selects it (calls back) |
| `item-editor.test.tsx` | `item-editor.tsx` | renders fields from a fake item; Save disabled until dirty |
| `group-editor.test.tsx` | `group-editor.tsx` | renders member rows; "Export Markdown" menu item calls `downloadExport("group-md", id)` (mock it) |
| `settings-view.test.tsx` | `settings-view.tsx` | renders 4 sections + 5 data buttons; backup-restore buttons present |
| `trash-view.test.tsx` | `trash-view.tsx` | renders; Restore button calls `call("restoreEntry", …)` (mocked) |
| `manage-items-modal.test.tsx` | `manage-items-modal.tsx` | opens/closes; Esc closes (esc-stack) |

Milestone per `04`: ≥ 12 tests green; every screen file imported by ≥ 1 test. Do not weaken the 6 existing tests.

## Phase 2 — `LoadErrorPanel` shared retry panel (F-001)

**New file** `frontend/src/components/clavis/ui/load-error.tsx`, re-exported from `ui-bits.tsx`:

```tsx
export function LoadErrorPanel({ title, body, onRetry, retryLabel }: {
  title: string; body: string; onRetry: () => void; retryLabel?: string;
}) { /* glass panel: AlertTriangle (danger), title, body, Btn variant="primary" label={retryLabel ?? "Try again"} */ }
```

Purely visual — **no Esc binding inside the panel.** The popup keeps its own Esc-to-hide `useEffect` (popup-root.tsx:218-224) wrapping it.

- `popup-root.tsx:217-246` (`PopupLoadError`): body becomes `<LoadErrorPanel title="Couldn't load your Clavis data" body="The data folder could not be read. Check that it still exists and that Clavis can open it — then try again." onRetry={onRetry} />` + the existing Esc effect. Identical pixels.
- `manager-entry.tsx` (~229-235): the **error** case of `FullMessage` is replaced by `<LoadErrorPanel title="Clavis could not load your data" body={<same sentence as popup>} onRetry={() => void reload()} />` where `reload` re-runs the state fetch. Keep the **loading** case ("Loading your keys…") exactly as-is. No Esc handler in the manager.
- Extend `popup-root.test.tsx` with the manager variant (render panel, assert "Try again" present, retry callback fires).

## Phase 3 — Modal focus trap (F-004)

Only `ui/modal.tsx` changes. Keep the component signature; add:

1. `tabIndex={-1}` on the panel `div` (`.glass-panel`) + `style={{ outline: "none" }}` so the panel itself is focusable as a last resort.
2. On `open`, capture `document.activeElement` (the opener) in a ref; on cleanup, restore focus to it (`restoreRef.current?.focus?.()`), wrapped in a guard for elements no longer in the DOM.
3. A Tab handler on the panel:

```tsx
const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])";
function trapTab(panel: HTMLElement, e: KeyboardEvent) {
  const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(el => el.offsetParent !== null || el === document.activeElement);
  if (nodes.length === 0) { e.preventDefault(); panel.focus(); return; }
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === panel))
    { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last)
    { e.preventDefault(); first.focus(); }
}
```

4. Initial focus: after mount, if nothing inside the panel already has focus (the manage-items modal's search input uses `autoFocus` — **do not steal it**), focus the first focusable node, else the panel.
5. Register/unregister in the same `useEffect` keyed on `open`; the effect must return **before** the early `if (!open) return null` pattern is broken (register effect with `useEffect(() => { if (!open) return; ... }, [open])`).

**Caveats verified for you:** `useEscStack` (ui/dismiss.ts) closes on Esc and stays untouched; dnd-kit's keyboard sensor (manage-items modal) uses Space/Arrows, not Tab — unaffected. All six modals (import backup, resolve conflicts, manage items, shared edit, shared delete, category) get the trap for free.

**New test** `ui/modal-focus.test.tsx`: render opener button + Modal with 3 focusables → open → Tab × 5 keeps focus inside → Esc → focus back on opener.

## Phase 4 — Fragment export + import (owner-requested, F-017/F-018/F-019, + F-003 warning)

The centerpiece. A **clavis-fragment** is a partial vault: same row shapes as a full backup, scoped to one item or one group, importable by the existing JSON import path with merge semantics. Old files keep working: a fragment is detected *before* the full-backup parser, and a full backup is never mistaken for a fragment.

### 4a — Go: export

**New file `internal/store/fragment.go`:**

```go
package store

const fragmentKind = "clavis-fragment"
const CurrentFragmentVersion = 1

// FragmentScope names what the fragment contains.
type FragmentScope struct {
    Type string `json:"type"` // "item" | "group"
    ID   string `json:"id"`
    Name string `json:"name"`
}

// Fragment is a lossless partial export (owner request, audit F-017).
// Row shapes are byte-compatible with VaultData's so JSON tags never drift.
type Fragment struct {
    Kind             string        `json:"kind"`
    FragmentVersion  int           `json:"fragmentVersion"`
    ExportedAt       string        `json:"exportedAt"`
    SourceAppVersion string        `json:"sourceAppVersion"`
    Scope            FragmentScope `json:"scope"`
    Categories       []Category    `json:"categories"`
    Groups           []Group       `json:"groups"`
    Items            []Item        `json:"items"`
}
```

**`ExportEntryFragment(kind EntryKind, id string) (ExportTarget, error)`** (put it next to `ExportEntryMarkdown` in `import.go` or in `fragment.go`; mirror their locking and not-found behavior):

- Group: `findGroup` (skip soft-deleted → `notFound`), `members := s.groupMembersLocked(id)`, `Items: members` (full structs — this is what makes it lossless: note, tags, isSecret, pinned, useCount, lastUsedAt, timestamps all ride along), `Groups: []Group{group}`, categories = dedup of `group.CategoryID` + each member's `CategoryID` resolved against `s.data.Categories` (nil-safe), `Scope: {Type: "group", ID: group.ID, Name: group.Name}`.
- Item: `findItem`, `Items: []Item{item}`, `Groups: []Group{}` (an item may belong to groups by ID, but a lone item export carries no group rows — re-import adds/updates the item only, and existing groups that reference its ID pick it up automatically), categories = the item's own, `Scope: {Type: "item", …}`.
- Marshal with 2-space indent. `ExportedAt: NowISO(s.now())`, `SourceAppVersion: s.appVersion`.
- Filename matches the existing backup convention: `"clavis-group-" + exchange.SafeFilename(name) + "-" + s.now().Format("20060102-1504") + ".json"` (item variant likewise).

**`app_exports.go` `ExportSave` switch** — insert before `default:`:

```go
case "item-json", "group-json":
    target, err := c.core.Store.ExportEntryFragment(store.EntryKind(kindOf(what)), id)
    if err != nil {
        return service.FailErr(err)
    }
    body, filename = target.Body, target.Filename
    filterName, pattern = "Clavis partial backup", "*.json"
```

(`kindOf("group-json")` → `"group"`; `kindOf("item-json")` → `"item"` — already correct.)

### 4b — Go: import

In `fragment.go`:

- `parseFragment(jsonText string) (Fragment, bool)` — `json.Unmarshal` into `Fragment`; ok only when `f.Kind == fragmentKind` (an absent/empty `kind` ⇒ not a fragment ⇒ returns false; a full backup is never misdetected).
- `importFragmentLocked(f Fragment) (ImportSummary, error)`:
  1. `if f.FragmentVersion > CurrentFragmentVersion` → error `"This partial export was created by a newer version of Clavis. Please update the app."` (mirrors the existing newer-schema guard, import.go:188-190).
  2. Drop incoming rows with `DeletedAt != nil` (defense in depth; export never writes them).
  3. **Merge, reusing the exact loops of `ImportBackup`'s merge branch (import.go:205-231):** categories by ID (add missing), then items by ID (`newer UpdatedAt wins`, count Added/Updated/Skipped), then groups by ID (same). Membership order survives because `Group.ItemIDs` is part of the Group row.
  4. Return summary; the caller persists.

Wire into `import.go` (both entry points, fragment check **first**):

```go
// ImportBackupPreview:
if frag, ok := parseFragment(jsonText); ok {
    if frag.FragmentVersion > CurrentFragmentVersion {
        return BackupPreview{Valid: false, Error: "This partial export was created by a newer version of Clavis. Please update the app."}
    }
    return BackupPreview{Valid: true, Items: len(frag.Items), Groups: len(frag.Groups), Cats: len(frag.Categories), Fragment: &frag.Scope}
}
// … existing parseVault path unchanged below

// ImportBackup:
if frag, ok := parseFragment(jsonText); ok {
    // Fragments always merge — mode is ignored (a fragment is not a vault).
    if err := s.assertWritable(); err != nil { return ImportSummary{}, err }
    if err := s.saveLocked(kindPreImport); err != nil { return ImportSummary{}, err }
    return s.importFragmentLocked(frag)
}
// … existing path unchanged below
```

Why fragment-first is safe today: `parseVault` → `NormalizeVault` (normalize.go:52-69) requires `schemaVersion` **and** `items`/`groups`/`categories` arrays, so a fragment currently fails with the clean "Not a valid Clavis backup file." — no wipe risk, and the new branch removes that dead end.

**`BackupPreview` (store.go:135)** gains `Fragment *FragmentScope `json:"fragment,omitempty"``. **Thread it through the service mapping** (service.go:509-517): add `"fragment": preview.Fragment` to the `preview` map (nil is omitted naturally on the wire — the frontend type marks it optional).

### 4c — Frontend

- `client.ts`: extend `ExportWhat` with `"item-json" | "group-json"`. Extend the `BackupPreview` interface with `fragment?: { type: "item" | "group"; name: string }`.
- `group-editor.tsx:362` (above the Markdown item) and `item-editor.tsx:494`:
  `<MenuItem icon={FileJson} label="Export JSON (backup-safe)" onClick={() => downloadExport("group-json", group.id)} />` (`FileJson` from lucide-react; wording already agreed in `04` — if you improve it during Phase 7's copy pass, keep "JSON" visible and keep it clearly distinct from the lossy Markdown/TXT items).
- **Plaintext warning (F-003)** in the same menu: extend `MenuItem` (ui/menu.tsx) with an optional `hint` string rendered under the label in `--text-xs` muted/warning text, and put the existing warning sentence (settings-view.tsx:360-363) as the hint on the JSON item: `"Contains your real value in plain text."` (editors' menus are per-entry; the sentence can be singular).
- **Import modal** (`settings-view.tsx`, modal opens from `onBackupFileChosen`:124, body ~line 427): when `backupImport.preview.fragment` is set:
  - Replace the counts sentence with: `This is a partial export of the {fragment.type === "group" ? "group" : "item"} “{fragment.name}” ({preview.incoming.items} items, {preview.incoming.groups} groups). Merging adds anything you don't already have.` (plain language; counts always shown).
  - **Hide the "Replace everything" button** (footer, line ~438) and make "Merge" `variant="primary"`. Full backups keep all three buttons.

### 4d — Tests

**Go (`internal/store/fragment_test.go`, style of `store_test.go`):**

| Test | Asserts |
|---|---|
| `TestFragmentGroupExportIsLossless` | group of 3 items (one with note+tags+isSecret+pinned+useCount+lastUsedAt set) → export → unmarshal Fragment → every Item/Group field byte-equal incl. `itemIds` order; scope.type "group"; categories included |
| `TestFragmentItemExport` | single item, `groups` empty, scope.type "item" |
| `TestFragmentSkipsSoftDeleted` | soft-deleted member not in `items` |
| `TestFragmentExportNotFound` | unknown id → error, nothing written |
| `TestFragmentRoundTripEmptyVault` | export from store A → `ImportBackup("merge", frag)` into empty store B → group present, membership order identical, note/tags/pinned survive |
| `TestFragmentMergeNewerLocalWins` | local item same ID newer `updatedAt` → Skipped++, local value unchanged |
| `TestFragmentMergeOlderLocalWins` | local older → Updated++, value replaced |
| `TestFragmentReimportSkips` | import same fragment twice → second run `{0 added, 0 updated, N skipped}` |
| `TestFragmentPreviewDistinguishes` | preview on fragment → Valid + `Fragment` set; preview on full backup → `Fragment` nil; preview on garbage → Valid false |
| `TestFullBackupStillImports` | `ExportBackupString` → both `"replace"` and `"merge"` behave exactly as before (regression guard) |
| `TestFragmentRejectsFutureVersion` | `fragmentVersion: 2` → error string, nothing written |
| `TestFragmentImportTakesPreImportBackup` | after import, newest backup in `backups/` is the pre-import kind (the existing hook already does this — prove it) |

**Frontend:** extend `settings-view.test.tsx` — fragment preview renders the partial-export sentence and no "Replace everything" button; full backup preview shows all three buttons.

**Milestone check (from `04`):** group of 4 fake items exports to one JSON file; importing into an empty vault restores the group with notes/tags/secrets/pins and copy order; second import merges "0 added, 0 updated, 4 skipped"; full backup export/import unchanged; `go test ./...` + `bun run test` green.

## Phase 5 — A11y batch

| Finding | File:anchor | Change |
|---|---|---|
| F-005 | `settings-view.tsx` backups list | Restore `Btn` gets `ariaLabel={`Restore backup from ${b.name}`}` (prop exists, ui/buttons.tsx:24,36) |
| F-002 | `settings/update-card.tsx` | status line → `role="status"`; progressbar → `aria-valuenow={pct}` `aria-valuemin={0}` `aria-valuemax={100}` |
| F-006 | `globals.css:144` | `.glass-input:focus` → `.glass-input:focus-visible` (both selectors' rules move; keep `::placeholder` untouched) |
| F-007 | `group-editor.tsx` member rows + `manage-items-modal.tsx` rows | explicit `aria-label` on the row button: `` `${name}, used ${useCount} times, key ${key}` `` (or visually-hidden separators between the three spans — pick one, apply to both files) |
| F-008 | `sidebar.tsx` tree | `aria-level={1}` on top-level treeitems (and `aria-expanded` where a node opens); resolve `.clavis-sr-only` — either use it for the F-007 fallback text or delete the rule (Phase 9 will grep it) |

No styling changes. Verify with an a11y snapshot (agent-browser) or axe (Phase 12 lands the automated version; here a manual pass suffices).

## Phase 6 — Manager list-column budget + button alignment (F-009/F-010)

The three columns are flex siblings: sidebar `width: calc(var(--space-6) * 7)` fixed (sidebar.tsx:136 = 224px), entry list `width: min(100%, calc(var(--space-6) * 10))` (entry-list.tsx:258 = **320px cap** — the truncation culprit), detail panel takes the rest. `--space-6 = 32px` (design-tokens.css:98).

- `entry-list.tsx:258`: raise the cap to `calc(var(--space-6) * 13)` (416px) **or** switch to `flex: "1 1 380px", width: "auto", maxWidth: "min(100%, calc(var(--space-6) * 15))"` — pick whichever keeps 800px without horizontal scroll (verify both; prefer the smaller change). The right-side meta (key badge, use count — `flexShrink: 0` at entry-list.tsx:194-202) is not the problem; don't shrink it.
- `manager.tsx` nothing-selected panel (~206-217): the "New item"/"New group" buttons sit in a `flex-wrap` row under centered text — give the row a shared center line: `justifyContent: "center"` + same `alignItems`, remove per-button margins; if they're in separate rows today, put both `Btn`s in one row div (this is F-010's misalignment).
- Keep window min 800×520; sidebar untouched.

Milestone: a 26-char name renders unclipped at 1000px default width; no horizontal scroll at 800px; screenshots 800/1000/1280 before-vs-after.

## Phase 7 — Feedback & copy consistency (F-012/F-013/F-020/F-023/F-024)

1. **`frontend/src/lib/clavis/messages.ts`** (new): one `as const` map for clipboard/export toasts. Today's four variants live at: `group-editor.tsx:145` + `item-editor.tsx:256` ("Could not copy to the clipboard."), `popup.tsx:193` ("Could not copy to the clipboard. Try again."), `item-editor.tsx:251` ("Copied."), `client.ts:93,98` (export saved/failed). Unify to: success `Copied.` / `Saved: {path}`, failure `Could not copy that value. Try again.` / `The export was not saved.` — every sentence ends with a period. Import the map everywhere; no string literals left at those sites.
2. **F-013 honest previews:** in `derive.ts` add `previewText(value, isSecret)`: secrets keep the existing dots+last-4 masking (unchanged — masking logic itself is off-limits to weaken); non-secrets return the first 24 chars + `…` when longer. Use it in the popup/list rows where dots currently lie. Update `derive.test.ts` expectations (add: non-secret long value → truncated text; secret → dots as before).
3. **F-020 always-visible save:** item-editor + group-editor footers render a disabled `Btn label="Save"` when the form is clean instead of nothing (visual state only — save behavior unchanged).
4. **F-023:** placeholder `"Sedanama credentials"` → `"Acme API credentials"` everywhere (`rg -n "Sedanama" frontend/src` — includes test fixtures).
5. **F-024:** `settings/update-card.tsx:178` transition `200ms` → `var(--motion-toast) var(--ease)`.

## Phase 8 — One token file, enforced (F-011/F-015)

1. Root `design-tokens.css` (stale dark theme) → replace content with a 3-line comment pointing to `frontend/src/design-tokens.css`; update `README.md` (~line 85) and `SPEC.md` (~line 4) links.
2. `globals.css:208,432` `#ffffff` → `var(--text-on-primary)` (token exists in design-tokens.css; if the name differs, use the on-primary text token that exists — do not mint a near-duplicate).
3. Typography tokens into `design-tokens.css`: `--tracking-label: 0.05em; --tracking-input: 0.02em; --leading-tight: 1.3; --leading-normal: 1.5; --leading-relaxed: 1.6;` and replace the hardcoded `letterSpacing`/`lineHeight` literals in TSX (explore-notes counts: letterSpacing em values in editors, `lineHeight: 1.5` in popup-root.tsx:237 etc.). `SectionHeader` → `h2` element (settings-view + wherever it's defined).
4. **`frontend/scripts/check-tokens.mjs`** (new, node, zero deps): walk `frontend/src/**/*.{tsx,ts,css}` excluding `design-tokens.css`; fail on `/#[0-9a-fA-F]{3,8}\b/` and on `px`/`ms` literals inside inline `style` objects; allowlist (each entry with a comment): `globals.css` scrollbar widths, the 4 modal `min(NNpx, …)` widths, `item-editor.tsx:433` `minmax(170px, 1fr)`, popup `18vh` offsets (vh, allowed by rule), `focus` ring (already a token). Add `"lint:tokens": "node scripts/check-tokens.mjs"` to `frontend/package.json` scripts and a step in ci.yml's frontend job (after tests).
5. Visual parity: this phase changes sources, not looks — before/after screenshots must be pixel-near-identical at 800/1280.

## Phase 9 — Dead code sweep + mobile removal (F-025/F-021)

Delete after grep-proving zero references (record each grep in the commit message body):

- `ShortcutKeycaps` — **use it** in `manager.tsx:199` (it renders proper keycaps; the raw string there is the accident), then it's not dead. If the keycap look is wrong there, keep the raw string and delete the component instead. One survives.
- `formatDate`, `formatGroupBlock`, `EntryLike`, `AppActions`, `platform.quit`, `onUpdateUpToDate`, `.clavis-slider` CSS block, the no-op ternary at `item-editor.tsx:296` (`"New item" : "New item"` → single string).
- `Settings.glassIntensity`: **keep the field** in Go (`model.go:39`) and `types.ts` (persisted schema — never break old data files); remove any UI-facing normalization; add a `// reserved, unused` comment both sides.
- `APP_VERSION` (`types.ts:8`): **keep** — `release.yml` (~line 40) bumps/checks it; add the comment `// bumped by the release workflow (release.yml)`.
- **Mobile layout: remove** (the decision from `04`): the `<47.99rem` media block, `mobileSidebarOpen` state + drawer/scrim JSX in `manager.tsx` (~line 44, 250, 308+), Back-button bits. Only strip `md:` utilities that become unreferenced; do **not** rewrite the ones that also serve ≥800px layouts (equivalent-behavior churn = risk, zero gain). Fallback (only if removal turns risky): keep + add a 375px render test; record the choice in PROGRESS.md.

## Phase 10 — De-duplication (F-014/F-022/F-027)

1. `ui/buttons.tsx`: export `btnClasses(variant)`; `ui/menu.tsx` imports it (kill the copied class list).
2. **Popup height constant:** `main.go:34` `popupHeightDefault = 208` vs `app.go:307` fallback `ph = 200`. Same package — change `app.go:307` to `ph = popupHeightDefault`. One line, constants only, surrounding window code untouched. (`popupmath` tests use arbitrary sizes; unaffected.)
3. Extract `SearchField` (input + icon + hover positioning) and `MemberRow` from the duplicated blocks in `entry-list.tsx`, `manage-items-modal.tsx`, `group-editor.tsx` into `ui-bits` / `ui/` primitives.
4. `useMaximized` hook (one definition) replacing the twin listeners in `manager-entry.tsx:107-112` and `manager.tsx:47-52`.

## Phase 11 — Split monoliths (move-only)

Target structure (one commit per file, `git diff --stat` must read as moves; **zero** logic/string/style edits — if a split demands rewriting, stop and record it for round 2):

| From | To | What moves |
|---|---|---|
| `settings-view.tsx` (547) | `settings/import-flows.tsx` | backup import (incl. the Phase-4 fragment UI), files import, conflicts flow, folder import |
| `popup.tsx` (526) | `popup/rows.tsx` | row rendering + copy-state logic; `popup.tsx` stays the palette controller |
| `item-editor.tsx` (525) | `editors/value-field.tsx` | value field + reveal/copy logic |
| `manage-items-modal.tsx` (426), `entry-list.tsx` (410) | — | only if still > ~350 lines after Phase 10's extractions |

All Phase-1 smoke tests must stay green **unmodified** — that's the proof of "move-only".

## Phase 12 — UI quality gates (F-016)

1. **axe in CI, jsdom-based (no browser download, rides the existing vitest job):** devDependency `axe-core`; helper `frontend/src/test/a11y.ts` — `expectNoViolations(container)` running `axe.run` with color-contrast rules disabled (jsdom can't measure them; task 2 owns contrast). Call it once per rendered screen inside the Phase-1 smoke tests (or one `a11y.test.tsx` rendering all screens). Fail on serious violations; the run must be fast (<30s).
2. **`frontend/scripts/check-contrast.mjs`** (new): parse `design-tokens.css` `:root` + `html.solid` overrides; check an explicit pair list (text-primary/text-muted/danger/warning/success on bg-primary/bg-panel, at minimum, light + dark) at WCAG AA: ≥ 4.5:1 normal text, ≥ 3:1 large (≥24px, or ≥18.66px bold). Fix failures **in token values only**; note any structural (non-token) failures for round 2 instead of redesigning components. `"check:contrast": "node scripts/check-contrast.mjs"` in package.json + ci.yml step.
3. One paragraph in `docs/DEVELOPMENT.md` documenting both gates + how to run locally.

Prove the gate bites: break a token on a scratch branch, watch CI fail, discard.

## Phase R1 — Final re-audit

Per `04` — every lens re-run, full baseline, 34 after-screenshots with the same names/sizes as `evidence/before/`, write `07-before-after.md` (plain language, 1–2 sentences per pair) and `06-next-focus.md` (top 3–5 next-round areas with confidence labels, deferred list, "I am not sure" where true). Update every finding's status in PROGRESS.md.

## Phase R2 — Release v1.3.0

Version bump — exactly these five places (anchors at 1.2.0 today):

| # | File | Anchor |
|---|---|---|
| 1 | `app.go:36` | `const AppVersion = "1.3.0"` |
| 2 | `build/windows/installer/clavis.nsi:12` | `!define VERSION "1.3.0"` |
| 3 | `build/winres/info.json:3-4` | `"file_version": "1.3.0.0"`, `"product_version": "1.3.0.0"` |
| 4 | `frontend/src/lib/clavis/types.ts:8` | `export const APP_VERSION = "1.3.0"` |
| 5 | git tag | `v1.3.0` |

Order: fill PROGRESS.md's rollback plan **first** (what's live = v1.2.0; undo = revert on main → bump v1.3.1 → tag; restore tags `pre-ui-audit-round-1`, `pre-ui-upgrade-round-1`; never force-push tags), then run the full local check suite (`bun run build`, `bun run test`, `gofmt -l .`, `go vet ./...`, `go test ./...`), then commit `release: v1.3.0` (explicit paths), push `main`, push tag `v1.3.0`. Verify the GitHub Release shows `Clavis-Setup-1.3.0.exe` + `Clavis-Portable-1.3.0.exe`; write release notes in plain language with the owner's 5-minute Windows smoke-test checklist (hotkey popup; copy → Win+V exclusion; **group JSON export → import round-trip**; dark mode; window resize).

---

## Appendix — Verified anchor snapshot (commit `6e0d865`)

| Anchor | Fact |
|---|---|
| `app_exports.go:23-67` | `ExportSave(what, id)` switch + dialog + write |
| `app_exports.go:69-74` | `kindOf` prefix mapping |
| `import.go:19-22` | `ExportBackupString` |
| `import.go:31-89` | `ExportEntryMarkdown` / `ExportEntryText` (pattern to mirror) |
| `import.go:169-175` | `ImportBackupPreview` |
| `import.go:178-233` | `ImportBackup` (replace + merge loops — reuse the merge loops) |
| `import.go:191` / `:336` | pre-import backup hook `saveLocked(kindPreImport)` |
| `normalize.go:52-69` | `NormalizeVault` requires schemaVersion+items+groups+categories |
| `store.go:112` / `:135` | `ImportSummary` / `BackupPreview` structs |
| `store.go:283-289` | `parseVault` |
| `store.go` ~1395 | `groupMembersLocked` |
| `model.go:52-93` | Item/Group/VaultData shapes (fragment reuses them verbatim) |
| `service.go:509-517` | `importBackupPreview` preview mapping (thread `fragment` through) |
| `service.go:518-524` | `importBackup` pass-through |
| `main.go:34` / `app.go:307` | `popupHeightDefault = 208` / fallback `200` |
| `main.go:105` | popup window uses the constant |
| `client.ts:13-17` / `:75-100` | `BackupPreview` interface / `ExportWhat` + `downloadExport` |
| `settings-view.tsx:124-136` | `onBackupFileChosen` → preview call |
| `settings-view.tsx:~420-443` | import-backup modal (Merge/Replace footer) |
| `settings-view.tsx:360-363` | plaintext warning sentence (reuse for F-003) |
| `group-editor.tsx:362-363` / `item-editor.tsx:494-495` | export menu items |
| `popup-root.tsx:217-246` | `PopupLoadError` (Phase 2 extraction source) |
| `manager-entry.tsx` ~229-235 | error `FullMessage` (Phase 2 target) |
| `ui/modal.tsx` (71 lines) | modal shell, no focus trap (Phase 3 target) |
| `entry-list.tsx:258` / `sidebar.tsx:136` | list column cap 320px / sidebar 224px (Phase 6) |
| `globals.css:144` | `.glass-input:focus` (Phase 5) |
| `globals.css:208,432` | `#ffffff` literals (Phase 8) |
| `design-tokens.css:98,106-107` | `--space-6: 32px`, `--motion-toast: 150ms`, `--ease` |
| `settings/update-card.tsx:178` | 200ms transition (Phase 7) |
| `item-editor.tsx:296` / `:433` | no-op ternary / `minmax(170px, 1fr)` |
| `popup.tsx:193`, `item-editor.tsx:251,256`, `group-editor.tsx:145` | copy-toast literals (Phase 7) |
| `.github/workflows/ci.yml` | frontend + go jobs (add lint:tokens / check:contrast to frontend) |
| `.github/workflows/release.yml` ~40 | release guard checks `APP_VERSION` (never delete it) |
