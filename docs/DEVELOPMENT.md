# Building, testing and releasing Clavis

Everything below works from a clean checkout on Windows, and the Linux/macOS
parts of it (all tests except the Win32 clipboard e2e) work on any machine
with Go 1.27+ and bun. CI (`.github/workflows/ci.yml`) runs the whole thing
on `windows-latest` on every push.

## Prerequisites

- **Go 1.27+** (`go.mod` pins the exact version)
- **bun** (or npm ≥ 10) for the frontend
- For the **installer** only: NSIS (makensis) — see "Release" below

## Layout

```
main.go                app bootstrap: windows, tray, hotkey, single instance
app.go                 Windows shell: window controls, hotkey, autostart
app_exports.go         export/import dialogs (bodies are built by the store)
app_update.go          self-update shell (check, download, hand-off)
internal/service/      the pure dispatcher: GetState/Dispatch, no Wails types
internal/store/        data model, atomic writes, backups, trash, undo
internal/search/       the documented search/ranking algorithm (Go side)
internal/exchange/     dotenv, Markdown/TXT import & export
internal/clipboard/    Win32 clipboard with the privacy formats
internal/system/       registry, cursor, Explorer, ForceForeground
internal/updater/      GitHub release discovery + download + swap
frontend/              React + TypeScript + Vite (popup + manager windows)
build/                 icons, manifest, NSIS installer script
```

## Build

```bash
# 1. Frontend (also runs tsc --noEmit as a typecheck)
cd frontend
bun install
bun run build          # -> frontend/dist/, embedded into the exe

# 2. Go core — run the tests, then build the exe
cd ..
go test ./internal/...

# Release build (REQUIRED for anything you ship):
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -tags production \
  -ldflags "-s -w -H windowsgui" -o dist/Clavis.exe .
```

**Why `-tags production` is mandatory:** without it, Wails v3 leaves WebView2
DevTools enabled in the binary — fine while debugging your own build, wrong
for a secrets app. Plain `go build` (devtools on) is for local debugging only.

Local development loop: `cd frontend && bun run dev` + Wails' `-tags server`
mode gives a plain browser page against the real Go backend (see BUILD_LOG.md).

## Test

```bash
# Go core.
# On Windows: the whole module — this ALSO runs internal/clipboard's real
# Win32 clipboard e2e (the privacy-format guarantee, tested for real).
go test ./...
# On Linux/macOS: package main needs the Wails Linux backend (GTK), so run
# the pure core instead:
go test ./internal/...

# Frontend (vitest + jsdom: search/dotenv/derive/hotkey logic, popup flow)
cd frontend && bun run test

# Static checks
gofmt -l .                                            # must print nothing
go vet ./...                                          # on Windows hosts
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go vet ./...  # cross from Linux/macOS
govulncheck ./...   # after: go install golang.org/x/vuln/cmd/govulncheck@latest
                    # (on Linux/macOS, prefix with GOOS=windows GOARCH=amd64 CGO_ENABLED=0)
cd frontend && bunx npm install --package-lock-only --ignore-scripts && bunx npm audit
```

CI runs all of the above on every push (`.github/workflows/ci.yml`).

## Release

1. Bump the version in **three** places (keep them in sync):
   `AppVersion` in `app.go`, `VERSION` in `build/windows/installer/clavis.nsi`,
   `file_version`/`product_version` in `build/winres/info.json`, plus
   `APP_VERSION` in `frontend/src/lib/clavis/types.ts` (four places total).
2. Build the portable exe exactly as in "Build" → `dist/Clavis.exe`.
3. Embed icon/version/manifest (the next `go build` picks the .syso up
   automatically):
   ```bash
   go run ./tools/syso build/appicon.ico build/winres/app.manifest \
     build/winres/info.json amd64 rsrc_windows_amd64.syso
   ```
4. Installer (Windows host with NSIS): fetch Microsoft's WebView2 bootstrapper
   into `build/windows/webview2-bootstrapper.exe`, then run
   `makensis build/windows/installer/clavis.nsi` from the repo root
   (paths in the script are relative to it).
5. Smoke-test both artifacts on a clean Windows VM: popup hotkey, copy (check
   Win+V does NOT contain the secret), manager edit round-trip, self-update.
6. Tag `vX.Y.Z` and push the tag: `.github/workflows/release.yml` then
   builds BOTH artifacts on a real windows-latest runner (this exact
   sequence, plus NSIS + Microsoft's WebView2 bootstrapper) and publishes
   them to the release for that tag. The workflow first guards that the
   tag, `AppVersion`, the NSIS `VERSION` and `APP_VERSION` all agree.
   Asset names — `Clavis-Setup-X.Y.Z.exe` + `Clavis-Portable-X.Y.Z.exe` —
   are what the self-updater looks for; keep them exact.

## Engineering notes

`docs/ENGINEERING_NOTES.md` is the living log: architecture map, verified
build results, security findings with file:line evidence, known decisions
and debt. Update it when you change something worth remembering.
