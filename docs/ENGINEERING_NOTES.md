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
1. **[HIGH] `group copy` skipped the clipboard-privacy formats.**
   `frontend/src/components/clavis/group-editor.tsx:136` —
   `copyToClipboard(res.text)` omitted `res.containsSecret === true`, so
   copying a group that contains secrets put it in Win+V history and cloud
   sync — violates SPEC §5.2 (mandatory) and the app's core promise.
   Fix: pass the flag like every other call site; regression test added.
2. **[MED-HIGH] Every state snapshot sends ALL item values to BOTH windows.**
   `internal/store/store.go:597` (`State()` returns full `VaultData`),
   `app.go:85` `GetState` + `app.go:92` `stateMap()` re-sent after every
   action. The popup only ever needs a masked preview (last-4); the manager
   needs a value only while that item is open in the editor. Fix: state now
   carries `value:""` plus `valueLast4` (computed under the documented §5.2
   rule: only when `showLast4` and length ≥ 12); a new `getValue` action
   fetches one value on demand for the editor. Search behavior unchanged
   (values were never searchable).
3. **[MED] The `copy` action handed the secret text to JavaScript**, which
   then handed it back to `WriteClipboard` (`app.go:394-405`,
   `client.ts:75-81`, popup.tsx/manager.tsx/item-editor.tsx/group-editor.tsx).
   Fix: the backend writes the clipboard inside the `copy` action and returns
   only metadata (`lineCount`, `containsSecret`). Secrets no longer round-trip
   through the webview on copy.
4. **[MED] Release binaries ship with WebView2 DevTools enabled.**
   Wails v3 enables DevTools unless built with `-tags production`
   (`webview_window_windows_devtools.go`: `PutAreDevToolsEnabled(true)` when
   `!production`), and the documented build command (README:55, BUILD_LOG:19)
   had no such tag. Fix: documented + CI build command now includes
   `-tags production` (disables DevTools + dev-mode startup logging).
5. **[MED] Self-update download URL not pinned.** `updater.go` accepted any
   `browser_download_url` from the API/atom responses. Fix: downloads are
   restricted to `https://github.com/assadigit/Clavis/releases/download/…`
   (and the release-page button falls back to the canonical releases URL) —
   a tampered response can no longer steer the updater at another host.
6. **[LOW] `unsafe.Pointer` misuse warnings (vet) in clipboard code.**
   Rewritten with documented Win32 functions that keep the pointer as
   `uintptr` end-to-end (`MultiByteToWideChar` into the locked block), so
   there is no uintptr→Pointer conversion left to get wrong.
7. **[LOW] `undoRing` grew without bound and kept deleted secrets in RAM
   forever.** `store.go:1069` — every delete stored a full item snapshot,
   removed only on undo. Fix: capped (newest 50).

### Open / accepted (owner decision required — do NOT change unilaterally)
8. **[KNOWN DESIGN] Vault + backups are plaintext JSON in `%APPDATA%\Clavis`.**
   SPEC §6: owner's explicit v1 choice; `Encryption{enabled:false}` is the
   hook. Changing the on-disk format is on the ASK-FIRST list. Recommendation
   recorded in §8: Windows DPAPI (CryptProtectData) per-user encryption would
   raise the bar with zero new UX; needs owner sign-off + migration test.
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

## 6. Bug hunt findings (Phase 2)

1. **`exchange.DedupeKeys` can emit duplicates** (`dotenv.go:108`): keys
   `[A, A_2, A]` yield `[A, A_2, A_2]` — a group block can contain the same
   env var twice. Fixed with a loop that keeps probing `_3`, `_4`…; failing
   test added first.
2. **Tray tooltip keeps the old shortcut forever** (`main.go:155` set once at
   startup; `updateSettings` never refreshes it). Fixed: tooltip is updated
   whenever the shortcut setting changes.
3. Clipboard/`copy` order: use-count is bumped even if the clipboard write
   fails. Accepted for now (counts intent, no data risk); noted as debt.

## 7. Structure changes (Phase 3) — behavior-preserving, tests first

- Characterization tests added BEFORE any move: dispatch surface
  (`app_test.go` covers copy-metadata contract, state redaction, getValue,
  settings rollback paths), store invariants (state never contains values),
  exchange/search parity for the TS side.
- `app.go` split by responsibility into `app_dispatch.go`, `app_windows.go`,
  `app_hotkey.go`, `app_update.go`, `app_exports.go` (file moves only);
  `GetState`/service surface unchanged.

## 8. Recommended next steps (priority order, for the owner)

1. Decide on at-rest encryption (DPAPI) — ASK FIRST item; plan is in §4.8.
2. Code-sign releases (ASK FIRST item) so self-update can verify signatures.
3. Add CSP after verifying on Windows (§4.10).
4. Clipboard auto-clear behind a setting (spec change; see hazard note §4.12).
5. Keep CI green: `go vet` for both host and `GOOS=windows`, `gofmt -l`,
   `govulncheck`, `npm audit`, frontend + Go tests.

## 9. Debt list (short)

- `sortStrings` is insertion sort — fine at n≈40, don't bother.
- `stateMap()` marshals state through JSON on every dispatch — acceptable
  while vaults are small; revisit if the popup ever stutters.
- `positionPopup` mixes physical cursor px with DIP work-area math — works on
  100% DPI; untestable here, flagged for on-Windows QA.
- popup stays blank if the first `fetchState` fails (no retry UI) — cosmetic.
- `main.go:236` `var _ = strings.TrimSpace` — vestigial import keeper.
