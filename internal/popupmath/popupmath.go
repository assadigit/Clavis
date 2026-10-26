/**
 * CLAVIS — popup placement math (SPEC §3.3b), pure so it is testable on
 * any host.
 *
 * The Windows shell feeds it the target screen's work area in PHYSICAL
 * pixels (Wails beta.33 fills Screen.WorkArea and Screen.PhysicalWorkArea
 * identically from GetMonitorInfo's RcWork — DPI scaling is not applied to
 * either there yet), plus the screen's scale factor and the panel size in
 * DIP (CSS pixels reported by the webview), and gets back the window origin
 * in DIP — the unit WebviewWindow.SetPosition/SetSize expect on Windows.
 */
package popupmath

import "math"

// Origin returns the popup origin in DIP: horizontally centered on the
// work area, in the upper third (§3.3b), clamped so the whole panel stays
// inside. A non-positive scale (unpopulated by the screen service) degrades
// to 100%.
func Origin(waX, waY, waW, waH int, scale float64, panelW, panelH int) (x, y int) {
	if scale <= 0 {
		scale = 1
	}
	toDIP := func(v int) int { return int(math.Round(float64(v) / scale)) }
	x0, y0 := toDIP(waX), toDIP(waY)
	aw, ah := toDIP(waW), toDIP(waH)
	x = x0 + (aw-panelW)/2
	y = y0 + int(float64(ah)*0.18)
	// Keep the whole panel inside the work area.
	if x < x0 {
		x = x0
	}
	if y+panelH > y0+ah {
		y = y0 + ah - panelH
	}
	if y < y0 {
		y = y0
	}
	return x, y
}
