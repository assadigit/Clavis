//go:build windows

/**
 * CLAVIS — Windows system proxy (WinINET static setting). This is what
 * browsers honor and what VPN/proxy clients set on censored networks; Go's
 * net/http ignores it (golang/go#26003). PAC/WPAD (AutoConfigURL) and
 * ProxyOverride evaluation are out of scope — DECISIONS.md §54.
 */
package updater

import (
	"golang.org/x/sys/windows/registry"
)

const inetSettingsKey = `Software\Microsoft\Windows\CurrentVersion\Internet Settings`

// systemProxyURL returns the per-user static proxy for https traffic, or ""
// when none is enabled. Overridable in tests (proxy_test.go).
var systemProxyURL = func() string {
	k, err := registry.OpenKey(registry.CURRENT_USER, inetSettingsKey, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	enabled, _, err := k.GetIntegerValue("ProxyEnable")
	if err != nil || enabled == 0 {
		return ""
	}
	server, _, err := k.GetStringValue("ProxyServer")
	if err != nil {
		return ""
	}
	return proxyFromServerString(server)
}
