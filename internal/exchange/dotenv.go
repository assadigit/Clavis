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

/* ------------------------- tolerant paste parsing ------------------------- */
//
// v1.6.0 (DECISIONS.md §45): the group-creation paste box used to accept ONLY
// strict `KEY=value` lines — anything else (`GitHub token: ghp_…`, spaced
// `KEY = value`, markdown bullets) silently produced an EMPTY group and threw
// the pasted credentials away. ParseCredentialLine is the tolerant parser
// shared by the store and mirrored in the frontend preview:
//
//      KEY=value            → name=KEY, key=KEY          (classic .env)
//      KEY = value          → spaces around the separator are fine
//      Name: value          → name=Name, key=AutoKey(Name)
//      DATABASE_URL: x      → a valid var name before ":" keeps itself as the key
//      - KEY=value / * x    → leading markdown bullets and "N." numbering are fine
//      # comment / blank    → skipped cleanly, never counted as bad lines
//
// A colon line with an EMPTY value is NOT a credential ("My credentials:" is
// prose, not a key) — it returns ok=false so callers count it as skipped.

// bulletRe strips markdown list prefixes ("- ", "* ", "• ", "+ ", "3. ").
var bulletRe = regexp.MustCompile(`^\s*(?:[-*•+]|\d+[.)])\s+`)

// varNameRe matches a plain dotenv variable name before a separator.
var varNameRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// IsSkippablePasteLine reports a blank line or a # comment — pastes commonly
// carry both, and neither is an error.
func IsSkippablePasteLine(line string) bool {
	l := strings.TrimSuffix(line, "\r")
	return strings.TrimSpace(l) == "" || strings.HasPrefix(strings.TrimSpace(l), "#")
}

// ParsedCredential is one line of a pasted credentials block.
type ParsedCredential struct {
	Name  string // human item name ("GitHub token")
	Key   string // dotenv key (GITHUB_TOKEN); AutoKey applied when needed
	Value string
}

// ParseCredentialLine parses one pasted line tolerantly. ok=false means the
// line is not a credential (the caller skips it; the UI counts it).
func ParseCredentialLine(line string) (ParsedCredential, bool) {
	l := strings.TrimSuffix(line, "\r")
	l = bulletRe.ReplaceAllString(l, "")
	if IsSkippablePasteLine(l) {
		return ParsedCredential{}, false
	}
	l = strings.TrimSpace(l)
	if l == "" {
		return ParsedCredential{}, false
	}
	// Separator: the FIRST "=" or ":" wins, whichever comes first (a value may
	// itself contain colons — "URL: https://…" must keep them).
	eq := strings.Index(l, "=")
	co := strings.Index(l, ":")
	sep, isColon := eq, false
	if co >= 0 && (eq < 0 || co < eq) {
		sep, isColon = co, true
	}
	if sep <= 0 {
		return ParsedCredential{}, false
	}
	rawName := strings.TrimSpace(l[:sep])
	value := ParseDotenvValue(strings.TrimSpace(l[sep+1:]))
	if rawName == "" {
		return ParsedCredential{}, false
	}
	if isColon {
		// "Name: value" needs a non-empty value — "My credentials:" is prose.
		if value == "" {
			return ParsedCredential{}, false
		}
		// A bare URL ("https://api.example.com") is not "https" = "//api…";
		// a colon followed by "//" is a scheme, not a separator.
		if strings.HasPrefix(value, "//") {
			return ParsedCredential{}, false
		}
		if varNameRe.MatchString(rawName) {
			return ParsedCredential{Name: rawName, Key: rawName, Value: value}, true
		}
		return ParsedCredential{Name: rawName, Key: AutoKey(rawName), Value: value}, true
	}
	// "KEY = value": a valid var name keeps itself; a free-form left side
	// ("GitHub token = x") becomes the name with an AutoKey key.
	if varNameRe.MatchString(rawName) {
		return ParsedCredential{Name: rawName, Key: rawName, Value: value}, true
	}
	return ParsedCredential{Name: rawName, Key: AutoKey(rawName), Value: value}, true
}

// ParseCredentialBlock parses a whole pasted block, returning the credentials
// (in paste order) and the number of non-blank, non-comment lines that did
// not parse. Keys are deduped exactly like group copies (§4.2) so the block
// round-trips.
func ParseCredentialBlock(text string) (creds []ParsedCredential, bad int) {
	type pair struct{ name, key, value string }
	var pairs []pair
	for _, raw := range strings.Split(text, "\n") {
		if IsSkippablePasteLine(raw) {
			continue
		}
		c, ok := ParseCredentialLine(raw)
		if !ok {
			bad++
			continue
		}
		pairs = append(pairs, pair{c.Name, c.Key, c.Value})
	}
	rawKeys := make([]string, len(pairs))
	for i, p := range pairs {
		rawKeys[i] = p.key
	}
	keys := DedupeKeys(rawKeys)
	creds = make([]ParsedCredential, len(pairs))
	for i, p := range pairs {
		creds[i] = ParsedCredential{Name: p.name, Key: keys[i], Value: p.value}
	}
	return creds, bad
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
