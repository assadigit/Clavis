# Clavis — Engineering notes (engineering/hardening-pass)

Living memory for the hardening pass. Updated after every phase. Format:
facts first, decisions with reasons, debt honestly labeled.

---

## 0. Environment & constraints

- Work machine: **Linux (Debian 13)**, Go 1.27.3 (at `/home/z/sdk/go`), bun 1.3.14,
  node 24, git 2.47. **Windows-only behavior cannot be executed here** (tray,
  global hotkey, real clipboard, installer). Covered instead by:
  - `GOOS=windows` compile + vet checks,
  - pure-Go unit tests (store/search/exchange/updater run anywhere),
  - `//go:build windows` tests that run in GitHub Actions on `windows-latest`,
  - Wails `-tags server` mode is NOT used in CI (it exists for dev only).
- Branch: `engineering/hardening-pass` (never commit to `main`).
- Repo at fork point: `407fe72` (v1.1.4).

## 1. Architecture map (verified by reading every file)

| Piece | Files | Notes |
| --- | --- | --- |
| App shell: windows, tray, hotkey, single instance | `main.go` | Wails v3.0.0-beta.33. Two pre-created windows (popup `popup.html`, manager `manager.html`), tray with menu, `--hidden` autostart flag. |
| Wails service (everything the UI can call) | `app.go` (1278 lines) | `GetState`, `Dispatch(action, json)`, `WriteClipboard`, `ExportSave`, `ExportAllMarkdown`, `PickImportFolder`, `OpenDataFolder`, window controls, `Pause/ResumeShortcut`, `CheckUpdate`/`InstallUpdate`/`OpenReleasePage`, `QuitApp`. |
| Store engine | `internal/store/` | `store.go` (single-writer mutex, atomic tmp+fsync+rename writes, daily + pre-migration/import/restore backups with retention), `model.go` (VaultData v1), `normalize.go` (lenient load), `import.go` (backup merge/replace + .md/.txt import). Plaintext JSON at `%APPDATA%\Clavis\clavis-data.json` — SPEC §6: owner's explicit v1 choice. |
| Search | `internal/search/search.go` + `frontend/src/lib/clavis/search.ts` | Two implementations of one documented algorithm (§5.1). Values are never searched. |
| Exchange | `internal/exchange/` | dotenv quoting/dedup, Clavis Markdown + TXT import/export, Windows-safe filenames. |
| Clipboard | `internal/clipboard/` | Pure-syscall Win32: CF_UNICODETEXT + 3 privacy formats (verified against Microsoft Learn, see §4). |
| OS helpers | `internal/system/` | Registry transparency read, cursor, Explorer open, HKCU InstallDir, `ForceForeground` (AttachThreadInput recipe). |
| Self-update | `internal/updater/` | GitHub latest release (API + atom fallback), size-verified download, cmd hand-off script, portable vs installed detection. |
| Frontend | `frontend/src/` | React 19 + TS 5 strict + Vite 6 + Tailwind 4. `popup-entry.tsx` / `manager-entry.tsx`; components in `src/components/clavis/`; Go bridge in `src/lib/clavis/client.ts` + `src/desktop/platform.ts`. Everything inlined at build (no remote loads). |
| Build/installer | `build/` + `tools/` | NSIS per-user installer, winres manifest/icon via `tools/syso`. |

## 2. Verified build & test commands (run on this machine, Phase 0)

```
cd frontend && bun install && bun run build   # tsc --noEmit + vite build — OK (6 s)
go test ./internal/...                        # all pass (host)
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-s -w -H windowsgui" -o dist/Clavis.exe .   # OK, 13.8 MB
go vet ./internal/...                         # clean (host)
GOOS=windows ... go vet ./...                 # 2 PRE-EXISTING unsafeptr findings (clipboard_windows.go:76,92)
gofmt -l .                                    # 4 files unformatted (app.go, internal/system/*_windows.go + system_other.go, tools/icopack/main.go)
GOOS=windows ... govulncheck ./...            # 0 reachable vulns; 5 module-level in x/image (indirect, fixed in x/image ≥0.45)
npm audit (via generated lockfile in /tmp)    # 0 vulnerabilities
```

## 3. Baseline pre-existing issues (NOT introduced by this branch)

- `gofmt`: 4 files use spaces instead of tabs.
- `go vet` (GOOS=windows): 2 × "possible misuse of unsafe.Pointer" in
  `internal/clipboard/clipboard_windows.go:76,92` — inherent to the
  LazyProc→uintptr→Pointer pattern; see §5 fix.
- Vite build warning: `sonner` both statically and dynamically imported
  (benign chunking hint).
- No CI, no frontend tests, no Go tests for `internal/clipboard`,
  `internal/system`, package `main`.

## 4. Security review findings (Phase 1)

Evidence = file:line at the fork point. Status updated as fixes land.

### Fixed on this branch
1. **[HIGH] `group copy` skipped the clipboard-privacy formats.** *(fixed in d0c1269)*
   `frontend/src/components/clavis/group-editor.tsx:136` —
   `copyToClipboard(res.text)` omitted `res.containsSecret === true`, so
   copying a group that contains secrets put it in Win+V history and cloud
   sync — violates SPEC §5.2 (mandatory) and the app's core promise.
   Fix: pass the flag like every other call site; regression test added.
2. **[MED-HIGH] Every state snapshot sends ALL item values to BOTH windows.** *(fixed in 77ecc7c)*
   `internal/store/store.go:597` (`State()` returns full `VaultData`),
   `app.go:85` `GetState` + `app.go:92` `stateMap()` re-sent after every
   action. The popup only ever needs a masked preview (last-4); the manager
   needs a value only while that item is open in the editor. Fix: state now
   carries `value:""` plus `valueLast4` (computed under the documented §5.2
   rule: only when `showLast4` and length ≥ 12); a new `getValue` action
   fetches one value on demand for the editor. Search behavior unchanged
   (values were never searchable).
3. **[MED] The `copy` action handed the secret text to JavaScript** *(fixed in d0c1269 — copy writes the clipboard in the backend with the store's privacy verdict; the response carries metadata only)*, which
   then handed it back to `WriteClipboard` (`app.go:394-405`,
   `client.ts:75-81`, popup.tsx/manager.tsx/item-editor.tsx/group-editor.tsx).
   Fix: the backend writes the clipboard inside the `copy` action and returns
   only metadata (`lineCount`, `containsSecret`). Secrets no longer round-trip
   through the webview on copy.
4. **[MED] Release binaries ship with WebView2 DevTools enabled.** *(fixed in 70d0e99 — documented build command now carries -tags production; CI builds with it)*
   Wails v3 enables DevTools unless built with `-tags production`
   (`webview_window_windows_devtools.go`: `PutAreDevToolsEnabled(true)` when
   `!production`), and the documented build command (README:55, BUILD_LOG:19)
   had no such tag. Fix: documented + CI build command now includes
   `-tags production` (disables DevTools + dev-mode startup logging).
5. **[MED] Self-update download URL not pinned.** *(fixed in f9435e5 — asset URLs and release-page links must be under github.com/assadigit/Clavis/)* `updater.go` accepted any
   `browser_download_url` from the API/atom responses. Fix: downloads are
   restricted to `https://github.com/assadigit/Clavis/releases/download/…`
   (and the release-page button falls back to the canonical releases URL) —
   a tampered response can no longer steer the updater at another host.
6. **[LOW] `unsafe.Pointer` misuse warnings (vet) in clipboard code.** *(fixed in 972df2a — MultiByteToWideChar keeps the pointer a uintptr end-to-end; also fail-closed on privacy-format failure and frees HGLOBALs on all paths)*
   Rewritten with documented Win32 functions that keep the pointer as
   `uintptr` end-to-end (`MultiByteToWideChar` into the locked block), so
   there is no uintptr→Pointer conversion left to get wrong.
7. **[LOW] `undoRing` grew without bound and kept deleted secrets in RAM
   forever.** `store.go:1069` — every delete stored a full item snapshot,
   removed only on undo. Fix: capped (newest 50). *(fixed in 7d857b5)*

### Open / accepted (owner decision required — do NOT change unilaterally)
8. **[KNOWN DESIGN] Vault + backups are plaintext JSON in `%APPDATA%\Clavis`.**
   SPEC §6: owner's explicit v1 choice; `Encryption{enabled:false}` is the
   hook. **OWNER DECISION (session 3): not needed now — keep plaintext.**
   Plan kept for a future revisit in §4.8: Windows DPAPI (CryptProtectData)
   per-user encryption with zero new UX; would need owner sign-off +
   migration test. See also §10.6.
9. **[OPEN] Self-update has no signature/checksum verification beyond size +
   HTTPS.** A compromise of the GitHub account/repo still yields arbitrary
   code via self-update. Real fix = code signing (ASK FIRST: signing
   identity). URL pinning (fix 5) narrows it to "repo compromise only".
10. **[OPEN] No Content-Security-Policy on popup.html/manager.html.** All
    assets are same-origin/inlined today; the Wails runtime uses
    `window.chrome.webview.postMessage` (CSP doesn't block postMessage). A
    tight CSP is defense-in-depth for the day a dependency regresses; needs
    on-Windows verification before shipping (risk of breaking the runtime).
    Recorded as next-step, not done blind.
11. **[INFO] Crash dumps / OS-level memory access expose secrets to the local
    user.** Same trust boundary as the plaintext file (SPEC §6); noted for the
    threat model, no action on this branch.
12. **[INFO] Clipboard auto-clear does not exist.** SPEC §366: explicitly out
    of scope for v1 (so the "must clear only our own value" hazard is moot
    today). If ever added: verify clipboard still holds our sequence number
    before clearing.

## 5. Verified clipboard facts (Microsoft Learn, "Clipboard Formats")

- `ExcludeClipboardContentFromMonitorProcessing` — "Place ANY data on the
  clipboard in this format to prevent all clipboard formats being included in
  the clipboard history or synchronized to the user's other devices."
- `CanIncludeInClipboardHistory` — serialized DWORD; `0` prevents history
  inclusion (1 explicitly requests it).
- `CanUploadToCloudClipboard` — serialized DWORD; `0` prevents cloud sync.
- All three must be registered with `RegisterClipboardFormat`.
- Clavis writes {DWORD 1, DWORD 0, DWORD 0} — compliant (1 counts as "any
  data"); the rewrite keeps the same bytes.

## 6. Bug hunt findings (Phase 2) — all fixed

1. **`exchange.DedupeKeys` could emit duplicates** (`dotenv.go:108`): keys
   `[A, A_2, A]` yielded `[A, A_2, A_2]` — a group block with the same env
   var twice (silent data loss on copy → re-import). Fixed with a probing
   loop in BOTH implementations (b20c23d), red-first test.
2. **Tray tooltip kept the old shortcut forever** (`main.go:155`, set once at
   startup). Fixed: the tooltip refreshes on every successful shortcut
   (re-)registration (7cb0c35), including the rollback path.
3. **Popup drill-in kept the query as a filter** — typing "sed" and pressing
   → on "Sedanama credentials" showed "Nothing found" instead of the
   members (SPEC §3.3b says "open a group and list its members"). Fixed:
   the query clears on drill (8e96047), red-first component test.
4. Clipboard/`copy` order: use-count is bumped even if the clipboard write
   fails. Accepted (counts intent, no data risk) **at the time**; FIXED in
   session 3 (43d724a, see §10.1).

## 7. Structure changes (Phase 3) — behavior-preserving, tests first

- Characterization tests written before the move (`internal/service/
  service_test.go`), then the pure dispatcher extracted from app.go into
  `internal/service.Service` (7e5b528): no Wails imports, hooks for shortcut
  re-registration and autostart, the whole action surface testable on any
  OS. This is what makes every later fix locally testable on Linux.
- app.go then split by responsibility into `app.go` (shell: windows, tray,
  hotkey, autostart, quit) + `app_exports.go` + `app_update.go` (a9a2edb,
  file move only, verified by build+vet+tests).
- TypeScript: zero `any` already; masked previews moved behind one helper
  (`maskFromLast4`, backend-computed rule); the popup's keyboard flow is
  component-tested. The big UI files (settings-view 796, ui-bits 794) were
  left as-is at the time; split move-only in session 3 (45fa919, §10.5).

## 7b. Tests & automation (Phase 4)

- Go: table-driven suites for store (incl. corrupted/empty/missing file —
  pre-existing and kept green), search, exchange, updater, and the new
  service (copy contract, redaction, getValue, invalid payloads).
- Frontend: vitest + jsdom, 38 tests: the documented search algorithm,
  dotenv rules (incl. the collision fix), masked previews, shortcut rules,
  and the popup keyboard flow end-to-end (typed copy → backend dispatch →
  auto-hide, create-on-empty, Esc, drill-in, Ctrl+Enter group copy).
- Windows-only e2e: `internal/clipboard/clipboard_windows_test.go` verifies
  the real clipboard: text round-trips (ASCII/Farsi/emoji/newlines/empty/
  100 KB), secret writes set all three privacy formats with the documented
  values, non-secret writes set none. Runs in CI on windows-latest.
- CI: `.github/workflows/ci.yml` — both jobs on windows-latest: frontend
  build+tests; gofmt gate, `go vet ./...` (Windows host covers the Win32
  files), `go test ./...` (real clipboard e2e), release build with
  `-tags production`, govulncheck, npm audit (63b6a76).
- CI is GREEN end-to-end on windows-latest (run 40255730969): the clipboard
  e2e passed for real — round-trips (ASCII/Farsi/emoji/newlines/CRLF/empty/
  100 KB), the three privacy formats present with the documented values
  after a secret write, absent after a plain write; vet clean; release
  build OK; govulncheck and npm audit clean.
- Two CI-only defects were found and fixed on the way (this is why the
  workflow runs on Windows at all): the runner's autocrlf handed gofmt CRLF
  files (fixed with `git config core.autocrlf false` before checkout), and
  the clipboard test's WideCharToMultiByte sizing call passed 7 arguments
  to the 8-parameter API — the callee read an uninitialized stack slot and
  corrupted the frame (fixed; every Call now passes the full argument list).
- `docs/DEVELOPMENT.md` documents build/test/release and was verified by
  cloning the repo fresh and running every command (that check caught two
  strict-mode test issues, fixed).

## 8. Recommended next steps (priority order, for the owner)

1. ~~Decide on at-rest encryption (DPAPI)~~ — decided in session 3: not
   needed now (§10.6).
2. Code-sign releases (ASK FIRST item) so self-update can verify signatures.
3. Add CSP after verifying on Windows (§4.10).
4. Clipboard auto-clear behind a setting (spec change; see hazard note §4.12).
5. Keep CI green: `go vet` for both host and `GOOS=windows`, `gofmt -l`,
   `govulncheck`, `npm audit`, frontend + Go tests.

## 9. Debt list (short)

- `sortStrings` is insertion sort — fine at n≈40, don't bother.
- ~~`stateMap()` marshals state through JSON on every dispatch~~ — fixed in
  session 3 (52f934b, §10.4).
- ~~`positionPopup` mixes physical cursor px with DIP work-area math~~ —
  fixed in session 3 (e626016, §10.3).
- ~~popup stays blank if the first `fetchState` fails~~ — fixed in session 3
  (2c42ce0, §10.2).
- ~~`main.go` `var _ = strings.TrimSpace`~~ — removed in session 3 (2a385fa).

## 10. Debt-pass resolutions (session 3 — owner-directed, branch engineering/hardening-pass)

The owner reviewed the final report's debt list and directed: fix all of
it, decide encryption at rest (answer: not needed now), then merge and
release. Disposition of each item:

1. **Used counter bumped even when the clipboard write fails** (§6.4) —
   FIXED in 43d724a. `Store.Copy` now only prepares the payload; the
   dispatcher calls the new `Store.MarkUsed` after a successful write
   (best-effort: a stats-save failure never fails a payload already on the
   clipboard; no-op for missing/deleted entries and read-only stores).
   Red-first: service test pins "failed write → useCount stays 0" for
   items and groups, success bumps exactly once.
2. **Popup blank forever if the first data load fails** — FIXED in 2c42ce0.
   Worse than cosmetic, actually: the fetch ran once at mount, so the
   promised "retry on next show" never happened — a first failure bricked
   the popup until an app restart. `PopupRoot` (extracted from the entry
   so this is jsdom-testable) now paints a retry panel (Try again + Esc),
   retries silently on every later show while data is missing, and guards
   double loads with an in-flight ref. 3 vitest cases.
3. **Popup positioning mixed physical and DIP coordinates** — FIXED in
   e626016, and the root cause is now pinned with evidence: Wails
   beta.33's Windows screen service fills `Screen.WorkArea` and
   `Screen.PhysicalWorkArea` IDENTICALLY from GetMonitorInfo's RcWork
   (physical pixels — DPI not applied there yet), while
   `WebviewWindow.SetPosition/SetSize` convert DIP→physical. The old math
   fed physical work-area numbers into a DIP-expecting SetPosition with a
   DIP panel size — wrong at every scale above 100%. New pure package
   `internal/popupmath` (physical area + scale + DIP panel in, DIP origin
   out) with table tests: 100%, 150%, 125% secondary monitor at a negative
   origin, clamps, zero-scale guard.
4. **`stateMap()` re-serialized the whole state on every action** — FIXED
   in 52f934b. The store now carries a snapshot-generation counter
   (`Version()`): bumped on every path that can change what `State()`
   returns (writes via `writeAtomicLocked`, notice clears, `Reopen`),
   never by reads. The service memoizes on (version, OS transparency
   flag) — the flag is a test seam so the invalidation is pinned. Cached
   snapshots stay redacted (test-asserted). Race-detector clean.
5. **Two ~800-line UI files left alone** — SPLIT in 45fa919, move-only
   and verified: `ui-bits.tsx` is a barrel over `ui/` modules (10
   importers unchanged), `settings-view.tsx` keeps the view while the
   update card and import-choice buttons moved to `settings/`. The
   sorted-line-set diff against HEAD shows identical code lines; only
   import plumbing differs. That verification replaces the visual
   regression suite the earlier "risk without benefit" call wanted.
6. **Encryption at rest — OWNER DECISION (this session): NOT NEEDED NOW.**
   Plaintext vault + backups in %APPDATA%\Clavis stays the documented v1
   behavior (SPEC §6, §4.8 hook unchanged). Revisit triggers: a shared
   machine threat model, or requests to sync/roam the vault.
7. Vestige: `var _ = strings.TrimSpace` import keeper removed (2a385fa).

All commits: gofmt clean, host `go test ./internal/...` green,
`GOOS=windows` build+vet clean, frontend build + 41 vitest green.
