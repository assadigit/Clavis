/**
 * CLAVIS — popup placement math tests (SPEC §3.3b).
 *
 * positionPopup used to mix coordinate spaces: Wails beta.33 fills
 * Screen.WorkArea in PHYSICAL pixels on Windows (identical to
 * PhysicalWorkArea — DPI scaling is not applied there yet), while
 * WebviewWindow.SetPosition/SetSize and the panel size reported by the
 * webview are DIP. The blend only lined up at 100% scaling. These tables
 * pin the fixed, unit-explicit math: physical work area + scale in, DIP
 * window origin out.
 */
package popupmath

import "testing"

func TestOrigin(t *testing.T) {
	cases := []struct {
		name           string
		waX, waY       int
		waW, waH       int
		scale          float64
		panelW, panelH int
		wantX, wantY   int
	}{
		/* 100%: DIP == physical; centered, upper third. */
		{"100% primary", 0, 0, 1920, 1040, 1.0, 640, 360, 640, 187},
		/* 150%: 2880x1560 physical is the same 1920x1040 DIP geometry —
		   the panel must land exactly where it does at 100%. */
		{"150% primary", 0, 0, 2880, 1560, 1.5, 640, 360, 640, 187},
		/* 125% secondary monitor placed left of the primary (negative
		   physical origin) — the origin must convert before centering. */
		{"125% secondary left of primary", -3840, 0, 3840, 2080, 1.25, 640, 360, -1856, 299},
		/* Panel taller than the work area clamps to the top edge. */
		{"taller panel clamps to top", 0, 0, 800, 400, 1.0, 640, 900, 80, 0},
		/* Panel wider than the work area clamps to the left edge. */
		{"wider panel clamps to left", 0, 0, 600, 1040, 1.0, 640, 360, 0, 187},
		/* A zero scale (unpopulated by the screen service) must not
		   divide by zero — it degrades to 100%. */
		{"zero scale guarded", 0, 0, 1920, 1040, 0, 640, 360, 640, 187},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			x, y := Origin(tc.waX, tc.waY, tc.waW, tc.waH, tc.scale, tc.panelW, tc.panelH)
			if x != tc.wantX || y != tc.wantY {
				t.Fatalf("Origin(%d,%d,%d,%d,%v,%d,%d) = (%d, %d), want (%d, %d)",
					tc.waX, tc.waY, tc.waW, tc.waH, tc.scale, tc.panelW, tc.panelH,
					x, y, tc.wantX, tc.wantY)
			}
		})
	}
}
