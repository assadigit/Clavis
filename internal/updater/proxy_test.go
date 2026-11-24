/**
 * CLAVIS — updater proxy resolution tests (spec: self-update-download-
 * resilience). Pure logic; no network, no Windows required.
 */
package updater

import (
	"net/http"
	"os"
	"testing"
)

func TestProxyFromServerString(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", ""},
		{"   ", ""},
		// Bare form: one proxy for every protocol.
		{"127.0.0.1:8080", "http://127.0.0.1:8080"},
		{"proxy.lan", "http://proxy.lan"},
		{"[::1]:8080", "http://[::1]:8080"},
		{"socks5://127.0.0.1:1080", "socks5://127.0.0.1:1080"}, // already a URL (defensive)
		// Per-protocol form: https wins, then http, then socks.
		{"http=127.0.0.1:8080;https=127.0.0.1:8443;ftp=127.0.0.1:21;socks=127.0.0.1:1080", "http://127.0.0.1:8443"},
		{"https=127.0.0.1:8443", "http://127.0.0.1:8443"},
		{"http=127.0.0.1:8080;socks=127.0.0.1:1080", "http://127.0.0.1:8080"},
		{"http=127.0.0.1:8080 ; socks=127.0.0.1:1080", "http://127.0.0.1:8080"}, // spaces tolerated
		{"socks=127.0.0.1:1080", "socks5://127.0.0.1:1080"},
		{"http=127.0.0.1:8080;https=", "http://127.0.0.1:8080"}, // empty entry ignored
		{"ftp=127.0.0.1:21", ""}, // nothing usable for https
		{";;;", ""},
	}
	for _, c := range cases {
		if got := proxyFromServerString(c.in); got != c.want {
			t.Errorf("proxyFromServerString(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestUpdaterProxyUsesSystemProxy: with no environment proxy configured, the
// system proxy (registry on Windows, stub elsewhere) must be used. The
// environment-wins half of the ordering is Go stdlib behavior and is not
// re-tested here — net/http caches the env proxy per process, so flipping
// env vars inside a test binary is not deterministic.
func TestUpdaterProxyUsesSystemProxy(t *testing.T) {
	for _, v := range []string{"HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"} {
		if os.Getenv(v) != "" {
			t.Skipf("host has %s set; proxy env would shadow the system proxy", v)
		}
	}
	orig := systemProxyURL
	systemProxyURL = func() string { return "http://127.0.0.1:8080" }
	t.Cleanup(func() { systemProxyURL = orig })

	req, err := http.NewRequest(http.MethodGet, "https://github.com/assadigit/Clavis", nil)
	if err != nil {
		t.Fatal(err)
	}
	u, err := updaterProxy(req)
	if err != nil || u == nil {
		t.Fatalf("system proxy must be used, got %v, %v", u, err)
	}
	if u.Scheme != "http" || u.Host != "127.0.0.1:8080" {
		t.Errorf("proxy = %s://%s, want http://127.0.0.1:8080", u.Scheme, u.Host)
	}
}

// TestUpdaterProxyDirectWhenUnconfigured: no env, no system proxy → direct.
func TestUpdaterProxyDirectWhenUnconfigured(t *testing.T) {
	for _, v := range []string{"HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"} {
		if os.Getenv(v) != "" {
			t.Skipf("host has %s set; proxy env would shadow the system proxy", v)
		}
	}
	orig := systemProxyURL
	systemProxyURL = func() string { return "" }
	t.Cleanup(func() { systemProxyURL = orig })

	req, err := http.NewRequest(http.MethodGet, "https://github.com/assadigit/Clavis", nil)
	if err != nil {
		t.Fatal(err)
	}
	if u, err := updaterProxy(req); err != nil || u != nil {
		t.Errorf("unconfigured host must connect directly, got %v, %v", u, err)
	}
}

func TestTransportShapes(t *testing.T) {
	if DirectTransport().Proxy != nil {
		t.Error("DirectTransport must never proxy")
	}
	if ProxyTransport().Proxy == nil {
		t.Error("ProxyTransport must resolve proxies")
	}
}
