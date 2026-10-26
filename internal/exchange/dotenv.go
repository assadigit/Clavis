/**
 * CLAVIS — dotenv quoting rules (SPEC §5.2).
 *
 * THE algorithm (single documented implementation; the frontend mirrors it):
 * - A value needs quoting when it contains a newline, a double quote, a
 *   backslash, or leading/trailing spaces, tabs or CR characters.
 * - Escapes inside quotes: `\n` for newline, `\"` for quote, `\\` for
 *   backslash. `\r` and `\t` pass through raw.
 * - A group block is its lines joined with "\n" and NO trailing newline.
 * - Keys are deduped with `_2`, `_3`… suffixes; an empty key becomes "KEY".
 */
package exchange

import (
	"regexp"
	"strings"
)

var keyRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*=`)

// NeedsDotenvQuoting reports whether a value must be written quoted.
func NeedsDotenvQuoting(value string) bool {
	if len(value) == 0 {
		return false
	}
	leading := regexp.MustCompile(`^[ \t\r]`).MatchString(value)
	trailing := regexp.MustCompile(`[ \t\r]$`).MatchString(value)
	return strings.Contains(value, "\n") ||
		strings.Contains(value, `"`) ||
		strings.Contains(value, `\`) ||
		leading ||
		trailing
}

// DotenvEscape escapes \ " and newline.
func DotenvEscape(value string) string {
	r := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`)
	return r.Replace(value)
}

// FormatDotenvLine renders one KEY=value line with the quoting rules.
func FormatDotenvLine(key, value string) string {
	if NeedsDotenvQuoting(value) {
		return key + `="` + DotenvEscape(value) + `"`
	}
	return key + "=" + value
}

// ParseDotenvValue unescapes a value that was (possibly) written quoted.
func ParseDotenvValue(raw string) string {
	if len(raw) >= 2 && strings.HasPrefix(raw, `"`) && strings.HasSuffix(raw, `"`) {
		inner := raw[1 : len(raw)-1]
		r := strings.NewReplacer(`\n`, "\n", `\"`, `"`, `\\`, `\`)
		return r.Replace(inner)
	}
	return raw
}

// Member is a KEY=value pair of a group block.
type Member struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// FormatGroupBlock joins members with "\n" and no trailing newline.
func FormatGroupBlock(members []Member) string {
	lines := make([]string, len(members))
	for i, m := range members {
		lines[i] = FormatDotenvLine(m.Key, m.Value)
	}
	return strings.Join(lines, "\n")
}

// ParseDotenvLine splits one line; ok=false when it is not KEY=value.
func ParseDotenvLine(line string) (key, value string, ok bool) {
	l := line
	l = strings.TrimSuffix(l, "\r") // tolerate CRLF files
	if !keyRe.MatchString(l) {
		return "", "", false
	}
	eq := strings.Index(l, "=")
	return l[:eq], ParseDotenvValue(l[eq+1:]), true
}

// LooksLikeDotenv is true when every non-blank line is KEY=value (≥1 line).
func LooksLikeDotenv(text string) bool {
	seen := 0
	for _, line := range splitLines(text) {
		if strings.TrimSpace(line) == "" {
			continue
		}
		if _, _, ok := ParseDotenvLine(line); !ok {
			return false
		}
		seen++
	}
	return seen > 0
}

// splitLines splits on \n, \r\n or lone \r.
func splitLines(text string) []string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	return strings.Split(text, "\n")
}

// DedupeKeys dedupes keys: duplicates get _2, _3… Empty keys become "KEY".
// The suffixed form probes forward until it is free, so a name like A_2
// that already exists never collides with a later duplicate of A.
func DedupeKeys(keys []string) []string {
	used := map[string]bool{}
	out := make([]string, len(keys))
	for i, raw := range keys {
		key := raw
		if strings.TrimSpace(raw) == "" {
			key = "KEY"
		}
		if !used[key] {
			used[key] = true
			out[i] = key
			continue
		}
		for n := 2; ; n++ {
			candidate := key + "_" + itoa(n)
			if !used[candidate] {
				used[candidate] = true
				out[i] = candidate
				break
			}
		}
	}
	return out
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// AutoKey generates a variable name from an item name (§4.2): uppercase,
// spaces and symbols to underscores. "GitHub token" → GITHUB_TOKEN.
func AutoKey(name string) string {
	key := strings.ToUpper(name)
	var b strings.Builder
	prev := false
	for _, r := range key {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			prev = false
		} else if !prev {
			b.WriteByte('_')
			prev = true
		}
	}
	out := b.String()
	out = strings.Trim(out, "_")
	if out == "" {
		return "KEY"
	}
	return out
}
