/**
 * CLAVIS — filesystem-safe names (Windows).
 *
 * \ / : * ? " < > | and control characters become "_", underscore runs
 * collapse, spaces and dots are trimmed from the ends, reserved device names
 * (CON, PRN, AUX, NUL, COM1-9, LPT1-9) get a trailing "_", fallback
 * "export".
 */
package exchange

import (
	"regexp"
)

var (
	unsafeChars = regexp.MustCompile(`[\x00-\x1f\\/:*?"<>|]`)
	underscore  = regexp.MustCompile(`_+`)
	edgeDots    = regexp.MustCompile(`^[ .]+|[ .]+$`)
	reserved    = regexp.MustCompile(`(?i)^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)`)
)

// SafeFilename makes a name safe as a Windows file name.
func SafeFilename(name string) string {
	s := unsafeChars.ReplaceAllString(name, "_")
	s = underscore.ReplaceAllString(s, "_")
	s = edgeDots.ReplaceAllString(s, "")
	if s == "" {
		s = "export"
	}
	if reserved.MatchString(s) {
		s = s + "_"
	}
	return s
}
