/**
 * CLAVIS — updater proxy resolution (spec: self-update-download-resilience;
 * audit: 2026-11-24-self-update-download-failure).
 *
 * Go's net/http only honors HTTP(S)_PROXY environment variables; the Windows
 * system (WinINET) proxy that every browser and VPN client uses is invisible
 * to it (golang/go#26003). On networks where GitHub's asset CDN is unreachable
 * directly — the owner's situation — that blindness is the difference between
 * an update that works and "net/http: TLS handshake timeout". Resolution
 * order per request: environment first, then the Windows system proxy, then a
 * direct connection.
 */
package updater

import (
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// proxyFromServerString maps WinINET's ProxyServer value (the registry string
// every Windows proxy client writes) to a proxy URL:
//
//	"host:port"                     — one proxy for every protocol
//	"http=h:p;https=h:p;socks=h:p"  — per-protocol entries
//
// Preference for an https download: https, then http, then socks (mapped to
// socks5://, which net/http speaks natively). Empty or unusable input → "".
func proxyFromServerString(server string) string {
	server = strings.TrimSpace(server)
	if server == "" {
		return ""
	}
	if strings.Contains(server, "://") {
		return server // already a URL (defensive; WinINET stores bare hosts)
	}
	if !strings.Contains(server, "=") {
		if strings.Contains(server, ";") {
			return "" // semicolons only appear in the per-protocol form
		}
		return "http://" + server
	}
	var httpPick, socksPick string
	for _, entry := range strings.Split(server, ";") {
		proto, host, ok := strings.Cut(strings.TrimSpace(entry), "=")
		if !ok {
			continue
		}
		proto, host = strings.TrimSpace(proto), strings.TrimSpace(host)
		if host == "" {
			continue
		}
		switch proto {
		case "https":
			return "http://" + host // CONNECT carries https through an http proxy
		case "http":
			if httpPick == "" {
				httpPick = "http://" + host
			}
		case "socks":
			if socksPick == "" {
				socksPick = "socks5://" + host
			}
		}
	}
	if httpPick != "" {
		return httpPick
	}
	return socksPick
}

// updaterProxy resolves the proxy for one request: HTTP(S)_PROXY first, then
// the Windows system proxy (a registry reader on Windows, a stub elsewhere).
// (nil, nil) means connect directly.
var updaterProxy = func(req *http.Request) (*url.URL, error) {
	if u, err := http.ProxyFromEnvironment(req); err == nil && u != nil {
		return u, nil
	}
	if s := systemProxyURL(); s != "" {
		if u, err := url.Parse(s); err == nil && u.Host != "" {
			return u, nil
		}
	}
	return nil, nil
}

// Patient transport budgets for proxied and throttled paths: the stock 10 s
// TLS handshake deadline is what gave up on the GitHub asset CDN.
const (
	dialTimeout         = 30 * time.Second
	tlsHandshakeTimeout = 30 * time.Second
	responseHeaderWait  = 60 * time.Second
)

func baseTransport(proxy func(*http.Request) (*url.URL, error)) *http.Transport {
	return &http.Transport{
		Proxy: proxy,
		DialContext: (&net.Dialer{
			Timeout:   dialTimeout,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          10,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   tlsHandshakeTimeout,
		ExpectContinueTimeout: 5 * time.Second,
		ResponseHeaderTimeout: responseHeaderWait,
	}
}

// ProxyTransport is the updater's default transport: environment proxy,
// Windows system proxy, or direct — whichever is configured.
func ProxyTransport() *http.Transport { return baseTransport(updaterProxy) }

// DirectTransport never proxies. It is the fallback attempt when a configured
// proxy is dead or breaking TLS (a stranded updater helps nobody).
func DirectTransport() *http.Transport { return baseTransport(nil) }
