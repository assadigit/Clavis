> Agents: read AGENTS.md in the repo root first, and follow it for this whole task.

# Audit — self-update download failure (`net/http: TLS handshake timeout`)

Date: 2026-11-24 · Triggered by: owner report, in-app update to v1.12.0 failed.

## The report

> The download did not complete: Get "https://release-assets.githubusercontent.com/github-production-release-asset/…Clavis-Portable-1.12.0.exe…": net/http: TLS handshake timeout

## Code-path walk (what actually ran)

1. `InstallUpdate` (`app_update.go:194`) builds the download client:
   `client := &http.Client{Timeout: updateDownloadTimeout}` — **no custom Transport**, so it uses `http.DefaultTransport`.
2. `updater.DownloadToFile` (`internal/updater/updater.go:297`) GETs the asset's
   `browser_download_url` (`https://github.com/assadigit/Clavis/releases/download/v1.12.0/…`).
   That URL 302-redirects to a short-lived (~1 h) signed URL on
   `release-assets.githubusercontent.com`; the client follows it.
3. The error text shows the **post-redirect** URL — so `github.com` answered the
   first hop fine. The TLS handshake to the **CDN host** then starved until Go's
   default `TLSHandshakeTimeout` (10 s) fired.

## Root cause

**The updater never uses the Windows system proxy, and the CDN host is the one
part of GitHub that the owner's network path cannot reach directly.**

- Go's `http.DefaultTransport` sets `Proxy: http.ProxyFromEnvironment`, which
  reads **environment variables only** (`HTTP_PROXY`/`HTTPS_PROXY`). On Windows
  it does **not** read the per-user WinINET proxy from the registry
  (long-standing upstream gap, golang/go#26003) — the setting every browser and
  WebView2 honors. GUI apps on Windows almost never have those env vars set, so
  the updater always connects **directly**.
- The owner's network (Iran) commonly throttles/blocks `*.githubusercontent.com`
  CDN hosts by SNI while leaving `github.com` and `api.github.com` usable —
  which matches the evidence exactly: the release check (api.github.com)
  succeeded, the redirect (github.com) succeeded, and only the CDN handshake
  timed out. VPN/proxy clients in that region work by setting the **Windows
  system proxy** — invisible to the current updater.
- Even when a proxy is set, the current code would still be fragile:

  | Weakness | Today |
  |---|---|
  | TLS handshake timeout | Go default 10 s — too impatient for proxied/high-latency paths |
  | Retries | none — a single transient failure kills the whole update |
  | Resume | none — a mid-body drop restarts the full ~14 MB download |
  | Per-attempt stall guard | none — one stalled body burns the entire 10-min client timeout |

- `HTTPGetter` (the release **check**) has the same proxy blindness — on
  networks where `api.github.com` is also blocked, checking fails the same way.

## Non-causes (checked, ruled out)

- **Auth/token**: the repo's release assets are public; the signed redirect URL
  needs no `Authorization` header (and Go strips it on cross-host redirects anyway).
- **Signed-URL expiry**: the URL in the report was fresh (`se=` ≈ request time + 1 h);
  the timeout is a transport failure, not a 403.
- **Overall client timeout**: `Timeout: 10 min` was not the limiter — the error
  is specifically the TLS handshake deadline (10 s default).

## Fix directions (spec follows)

1. Proxy-aware transports: environment proxy first, then the Windows system
   proxy (WinINET `ProxyEnable`/`ProxyServer` from HKCU) — plus an unproxied
   fallback transport so a dead proxy can't strand the updater.
2. Patient transport: 30 s dial / 30 s TLS handshake / 60 s response-header.
3. A retry engine: rotate [proxy, direct] clients, a handful of attempts with
   short backoff, one overall context budget (10 min) and a per-attempt deadline.
4. Resume: keep the `.part` file between attempts with a small
   `.part.meta` sidecar (URL + expected size) so a retry continues instead of
   restarting — and so a stale part from a *different* version is never reused
   (portable dest paths are not version-scoped).
5. Honest error copy: attempts made + the Windows-proxy hint + release-page fallback.

Out of scope (documented in DECISIONS.md): PAC/WPAD (`AutoConfigURL`) and
`ProxyOverride` evaluation — WinHTTP-level machinery for a marginal share of
proxy setups; the static WinINET proxy covers the common VPN clients.
