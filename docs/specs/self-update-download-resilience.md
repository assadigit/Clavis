> Agents: read AGENTS.md in the repo root first, and follow it for this whole task.

# Spec — self-update download resilience (v1.12.1)

Audit: `docs/audits/2026-11-24-self-update-download-failure.md` · Decision: DECISIONS.md §54.

## Goal

The in-app self-update must complete on networks where GitHub's asset CDN
(`release-assets.githubusercontent.com`) is unreachable directly but reachable
through the Windows system proxy — the owner's situation — and it must survive
transient failures instead of dying on the first one.

## Scope

- `internal/updater` (Go): new proxy resolution, resilient download engine.
- `app_update.go`: use the new engine; better failure copy.
- No frontend changes (the update card already renders backend error text and
  has a release-page button).

## Decisions (details in DECISIONS.md §54)

1. **Proxy order**: `HTTP(S)_PROXY` env vars first, then the Windows system
   proxy (WinINET static setting, HKCU `Internet Settings`), then direct.
   PAC/WPAD and `ProxyOverride` are out of scope (documented).
2. **Two transports, rotated**: a proxy-aware transport, then an unproxied one —
   a dead/misbehaving proxy must not strand the update.
3. **Budgets**: one overall 10-minute context (unchanged UX), 3-minute
   per-attempt deadline, 30 s dial / 30 s TLS handshake / 60 s response header.
4. **Retry policy**: up to 4 attempts (proxy, direct, proxy, direct — a single
   configured transport just retries), backoff 1 s / 2 s / 4 s. Retryable:
   network errors, HTTP 408/429/5xx, truncation/size-mismatch, rename blocked
   (AV-style locks). Fatal: other 4xx, local disk errors, overall budget spent.
5. **Resume**: the `.part` file survives between attempts with a
   `.part.meta` sidecar (`{"url","size"}`); a retry continues from where it
   stopped when the server honors `Range` (206), restarts cleanly when it
   doesn't (200), and a stale/mismatched part is discarded, never mixed. A
   fully-downloaded part (rename previously blocked) is finished without
   re-downloading. Every fresh start re-requests the stable
   `github.com/…/releases/download/…` URL, so each attempt gets a fresh signed
   redirect — the ~1 h CDN signature can never go stale mid-retry.
6. **The check (`HTTPGetter`) gets the same proxy-aware transport.**

## Plan

1. `internal/updater/proxy.go` (all platforms): WinINET `ProxyServer` string
   parser (pure), the proxy resolver (env → system → direct), transport builders.
2. `internal/updater/proxy_windows.go` / `proxy_other.go`: registry reader / stub.
3. `internal/updater/updater.go`: `DownloadToFile` gains `context.Context`,
   resume + 206 support, typed status errors; new `DownloadWithRetries`.
4. `app_update.go`: context budget, two clients, new call, new error copy.
5. Tests: proxy-string parser table; resume (server honors Range after a
   mid-body cut); client rotation (dead proxy → direct wins); give-up (always
   500 → 4 attempts, cleanup); fatal 404 (no retry); stale-meta guard;
   full-part short-circuit; retryability classification; existing download
   tests updated for the new signature and still green.
6. Docs: DECISIONS §54, CHANGELOG, HANDOFF; version bump 1.12.0 → 1.12.1 in
   all five places; tag `v1.12.1` after CI is green.

## Done criteria

- [ ] `go vet ./...` clean on Windows (CI) and cross-compile check locally; `gofmt -l .` empty.
- [ ] All Go tests green locally (linux) and on CI (windows-latest).
- [ ] New tests prove: resume continues from the cut point; proxy-then-direct
      rotation recovers from a dead proxy; retry limits and cleanup behave as
      specified; stale parts are never mixed into a new version's download.
- [ ] Frontend suite untouched and green (no frontend change).
- [ ] v1.12.1 tagged, Release workflow publishes both artifacts, releases page verified.

## Out of scope

- PAC/WPAD (`AutoConfigURL`), `ProxyOverride` bypass evaluation.
- Mirrors/alternate CDNs, download-through-browser automation.
- Any change to the update UI, scripts, or swap logic (those work).
