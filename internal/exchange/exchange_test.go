/**
 * CLAVIS — exchange tests (SPEC §10): dotenv quoting, Markdown/TXT
 * byte-exact round-trips, safe file names. Failure messages never carry
 * values, only lengths and byte offsets.
 */
package exchange

import (
	"strings"
	"testing"
)

func TestNeedsQuoting(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"", false},
		{"plain", false},
		{"with space", false},
		{" leading", true},
		{"trailing ", true},
		{"tab\tat-end", false},
		{"trailing-tab\t", true},
		{"\rcr", true},
		{"multi\nline", true},
		{`has "quote"`, true},
		{`back\slash`, true},
		{"سلام دنیا", false},
	}
	for _, c := range cases {
		if got := NeedsDotenvQuoting(c.in); got != c.want {
			t.Errorf("NeedsDotenvQuoting(%q-len) = %v, want %v", firstByte(c.in), got, c.want)
		}
	}
}

func firstByte(s string) string {
	if len(s) > 8 {
		return s[:8] + "…"
	}
	return s
}

func TestFormatDotenvLine(t *testing.T) {
	cases := []struct {
		key, in, want string
	}{
		{"A", "plain", "A=plain"},
		{"A", "two\nlines", `A="two\nlines"`},
		{"A", `say "hi"`, `A="say \"hi\""`},
		{"A", `c:\path`, `A="c:\\path"`},
		{"A", " pad ", `A=" pad "`},
		{"A", "", "A="},
	}
	for _, c := range cases {
		if got := FormatDotenvLine(c.key, c.in); got != c.want {
			t.Errorf("FormatDotenvLine: got len %d, want len %d (%q)", len(got), len(c.want), c.key)
		}
	}
}

func TestParseDotenvValueRoundTrip(t *testing.T) {
	values := []string{
		"plain",
		"two\nlines",
		`quotes "in" value`,
		`back\slash`,
		" leading and trailing ",
		"",
		"سلام دنیا",
		"line1\nline2\nline3",
		"tab\tinside",
	}
	for _, v := range values {
		line := FormatDotenvLine("KEY", v)
		_, parsed, ok := ParseDotenvLine(line)
		if !ok || parsed != v {
			t.Errorf("round-trip failed for value of length %d", len(v))
		}
	}
}

func TestDedupeKeys(t *testing.T) {
	got := DedupeKeys([]string{"A", "B", "A", "", "A", "KEY"})
	want := []string{"A", "B", "A_2", "KEY", "A_3", "KEY_2"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("DedupeKeys[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestAutoKey(t *testing.T) {
	cases := []struct{ in, want string }{
		{"GitHub token", "GITHUB_TOKEN"},
		{"Cloudflare API-token!", "CLOUDFLARE_API_TOKEN"},
		{"سلام", "KEY"},
		{"lower case", "LOWER_CASE"},
		{"  spaces  ", "SPACES"},
	}
	for _, c := range cases {
		if got := AutoKey(c.in); got != c.want {
			t.Errorf("AutoKey(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestLooksLikeDotenv(t *testing.T) {
	if !LooksLikeDotenv("A=1\nB=2") {
		t.Error("A=1\\nB=2 should look like dotenv")
	}
	if !LooksLikeDotenv("A=1\n\nB=2") {
		t.Error("blank lines should be skipped")
	}
	if LooksLikeDotenv("just text") {
		t.Error("plain text is not dotenv")
	}
	if LooksLikeDotenv("") {
		t.Error("empty is not dotenv")
	}
	if LooksLikeDotenv("A=1\nrandom line") {
		t.Error("mixed content is not dotenv")
	}
}

/* ------------------------- Markdown ------------------------- */

func itemMd(name, key, category string, tags []string, secret bool, value string) string {
	secretField := "false"
	if secret {
		secretField = "true"
	}
	tagField := "[]"
	if len(tags) > 0 {
		tagField = "[" + strings.Join(tags, ", ") + "]"
	}
	catField := "category:"
	if category != "" {
		catField = "category: " + category
	}
	keyField := "key:"
	if key != "" {
		keyField = "key: " + key
	}
	return "---\ntype: item\nname: " + name + "\n" + keyField + "\n" + catField + "\ntags: " + tagField + "\nsecret: " + secretField + "\n---\n" + value
}

func TestItemMarkdownRoundTrip(t *testing.T) {
	values := []string{
		"simple value",
		"multi\nline\nvalue",
		"value with \"quotes\" and \\ backslashes",
		" leading and trailing spaces ",
		"سلام دنیا — Farsi",
		"",
		"value\nstarting\nwith newline",
	}
	for _, v := range values {
		item := MdItem{Name: "Test item", Key: "TEST_ITEM", Value: v, Tags: []string{"a", "b"}, IsSecret: true}
		body := ExportItemMarkdown(item, "Credentials")
		imp, err := ParseMarkdown("test-item.md", body)
		if err != nil {
			t.Fatalf("ParseMarkdown error for value len %d: %v", len(v), err)
		}
		if imp.Kind != KindItem || imp.Name != "Test item" || imp.Key != "TEST_ITEM" {
			t.Fatalf("header mismatch for value len %d", len(v))
		}
		if imp.Value != v {
			t.Fatalf("value round-trip failed: got len %d, want len %d (offset %d)",
				len(imp.Value), len(v), firstDiff(imp.Value, v))
		}
	}
}

func firstDiff(a, b string) int {
	i := 0
	for i < len(a) && i < len(b) && a[i] == b[i] {
		i++
	}
	return i
}

func TestGroupMarkdownRoundTrip(t *testing.T) {
	members := []Member{
		{Key: "GITHUB_TOKEN", Value: "gh_value"},
		{Key: "CLOUDFLARE_API_TOKEN", Value: "multi\nline \"quoted\""},
	}
	body := ExportGroupMarkdown(MdGroup{Name: "Sedanama credentials", Tags: []string{"sedanama"}}, members, "Credentials")
	wantHead := "---\ntype: group\nname: Sedanama credentials\ncategory: Credentials\ntags: [sedanama]\n---\n"
	if !strings.HasPrefix(body, wantHead) {
		t.Fatalf("group header layout mismatch")
	}
	imp, err := ParseMarkdown("sedanama.md", body)
	if err != nil {
		t.Fatalf("ParseMarkdown: %v", err)
	}
	if imp.Kind != KindGroup || len(imp.Lines) != 2 {
		t.Fatalf("group parse mismatch (lines=%d)", len(imp.Lines))
	}
	if imp.Lines[0].Key != "GITHUB_TOKEN" || imp.Lines[0].Value != "gh_value" {
		t.Error("member 0 mismatch")
	}
	if imp.Lines[1].Value != "multi\nline \"quoted\"" {
		t.Errorf("member 1 value len = %d, want %d", len(imp.Lines[1].Value), len("multi\nline \"quoted\""))
	}
}

func TestParseMarkdownEdgeCases(t *testing.T) {
	if _, err := ParseMarkdown("x.md", "no front matter"); err != ErrNotClavisMarkdown {
		t.Errorf("missing fence: err = %v", err)
	}
	if _, err := ParseMarkdown("x.md", "---\ntype: item\nname: X\n"); err == nil {
		t.Error("missing closing fence should error")
	}
	if _, err := ParseMarkdown("x.md", "---\ntype: widget\n---\n"); err == nil {
		t.Error("unknown type should error")
	}
	// BOM + CRLF tolerated.
	bom := "\ufeff---\r\ntype: item\r\nname: BOM\r\nkey:\r\ncategory:\r\ntags: []\r\nsecret: true\r\n---\r\nvalue"
	imp, err := ParseMarkdown("bom.md", bom)
	if err != nil {
		t.Fatalf("BOM/CRLF: %v", err)
	}
	if imp.Name != "BOM" || imp.Value != "value" {
		t.Errorf("BOM/CRLF parse mismatch")
	}
	// Missing name → file base name; missing secret → true.
	imp, err = ParseMarkdown("my-file.md", "---\ntype: item\n---\nval")
	if err != nil || imp.Name != "my-file" || !imp.IsSecret {
		t.Errorf("defaults: name=%q secret=%v err=%v", imp.Name, imp.IsSecret, err)
	}
}

/* ------------------------- TXT ------------------------- */

func TestTextRoundTrip(t *testing.T) {
	// Item .txt = value only.
	item := ExportItemText("the value\nsecond line")
	if item != "the value\nsecond line" {
		t.Errorf("item txt export mismatch")
	}
	// Group .txt = KEY=value lines.
	block := ExportGroupText([]Member{{Key: "A", Value: "1"}, {Key: "B", Value: "two\nlines"}})
	want := "A=1\nB=\"two\\nlines\""
	if block != want {
		t.Errorf("group txt export mismatch (len %d vs %d)", len(block), len(want))
	}
	// .txt import: dotenv → group, else → item.
	imp := ParseText("env.txt", block)
	if imp.Kind != KindGroup || imp.Name != "env" || len(imp.Lines) != 2 {
		t.Errorf("dotenv txt should import as a group named after the file")
	}
	if imp.Lines[1].Value != "two\nlines" {
		t.Errorf("member value round-trip failed")
	}
	imp = ParseText("note.txt", "just a note\nwith lines")
	if imp.Kind != KindItem || imp.Value != "just a note\nwith lines" || !imp.IsSecret {
		t.Errorf("plain txt should import as a secret item")
	}
}

/* ------------------------- SafeFilename ------------------------- */

func TestSafeFilename(t *testing.T) {
	cases := []struct{ in, want string }{
		{"normal name", "normal name"},
		{`a/b\c:d*e?f"g<h>i|j`, "a_b_c_d_e_f_g_h_i_j"},
		{"   spaced   ", "spaced"},
		{"...dots...", "dots"},
		{"CON", "CON_"},
		{"com1.txt", "com1.txt_"},
		{"", "export"},
		{"سلام", "سلام"},
	}
	for _, c := range cases {
		if got := SafeFilename(c.in); got != c.want {
			t.Errorf("SafeFilename(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

/* ------------------------- Farsi / unicode ------------------------- */

func TestFarsiRoundTrip(t *testing.T) {
	v := "این یک متن فارسی است\nبا چند خط"
	item := MdItem{Name: "پرامپت فارسی", Key: "FARSI_PROMPT", Value: v, Tags: []string{"فارسی"}, IsSecret: true}
	body := ExportItemMarkdown(item, "Prompts")
	imp, err := ParseMarkdown("farsi.md", body)
	if err != nil {
		t.Fatalf("farsi parse: %v", err)
	}
	if imp.Value != v || imp.Name != "پرامپت فارسی" {
		t.Errorf("farsi round-trip mismatch (value len %d vs %d)", len(imp.Value), len(v))
	}
	if len(imp.Tags) != 1 || imp.Tags[0] != "فارسی" {
		t.Errorf("farsi tag mismatch")
	}
}

// TestDedupeKeysCollisionWithExistingSuffix: a key like A_2 that already
// exists must not be produced again for a later duplicate of A — the old
// algorithm emitted A_2 twice, producing a group block with duplicate env
// vars (data loss on round-trip).
func TestDedupeKeysCollisionWithExistingSuffix(t *testing.T) {
	got := DedupeKeys([]string{"A", "A_2", "A"})
	want := []string{"A", "A_2", "A_3"}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("DedupeKeys = %v, want %v", []string(got), want)
		}
	}

	got = DedupeKeys([]string{"KEY", "", "KEY", "", "KEY"})
	want = []string{"KEY", "KEY_2", "KEY_3", "KEY_4", "KEY_5"}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("DedupeKeys(empty mix) = %v, want %v", []string(got), want)
		}
	}
}

/* ------------------- tolerant paste parsing (v1.6.0 §45) ------------------- */

func TestIsSkippablePasteLine(t *testing.T) {
	cases := map[string]bool{
		"":                 true,
		"   ":              true,
		"\t":               true,
		"# comment":        true,
		"  # indented #2":  true,
		"#tag not comment": true, // any # prefix is a comment, like .env
		"KEY=value":        false,
		"GitHub token: x":  false,
		"  - KEY=value":    false,
		"line\r":           false, // CR-stripped, still text
	}
	for line, want := range cases {
		if got := IsSkippablePasteLine(line); got != want {
			t.Errorf("IsSkippablePasteLine(%q) = %v, want %v", line, got, want)
		}
	}
}

func TestParseCredentialLine(t *testing.T) {
	type want struct {
		ok   bool
		name string
		key  string
		val  string
	}
	cases := map[string]want{
		// Classic dotenv.
		"DATABASE_URL=postgres://db": {true, "DATABASE_URL", "DATABASE_URL", "postgres://db"},
		// Spaced separator.
		"KEY = value": {true, "KEY", "KEY", "value"},
		// Free-form left side with "=" becomes the name; key is auto.
		"GitHub token = ghp_123": {true, "GitHub token", "GITHUB_TOKEN", "ghp_123"},
		// Colon lines: valid var name keeps itself…
		"DATABASE_URL: postgres://db": {true, "DATABASE_URL", "DATABASE_URL", "postgres://db"},
		// …free-form becomes name + AutoKey.
		"GitHub token: ghp_123": {true, "GitHub token", "GITHUB_TOKEN", "ghp_123"},
		// Markdown bullets and numbered lists.
		"- API_KEY=secret":     {true, "API_KEY", "API_KEY", "secret"},
		"* GitHub token: ghp_": {true, "GitHub token", "GITHUB_TOKEN", "ghp_"},
		"• spacing = loose":    {true, "spacing", "spacing", "loose"},
		"3. PORT=8080":         {true, "PORT", "PORT", "8080"},
		"1) HOST=localhost":    {true, "HOST", "HOST", "localhost"},
		// Quoted values round-trip through the dotenv unescaper.
		`TOKEN="abc def"`: {true, "TOKEN", "TOKEN", "abc def"},
		// Not credentials.
		"# comment":               {false, "", "", ""},
		"just prose":              {false, "", "", ""},
		"My credentials:":         {false, "", "", ""}, // empty colon value = prose
		"https://api.example.com": {false, "", "", ""}, // URL scheme is not a separator
		"=value":                  {false, "", "", ""}, // empty name
		": value":                 {false, "", "", ""},
		"no separator":            {false, "", "", ""},
		"":                        {false, "", "", ""},
		"   \t  ":                 {false, "", "", ""},
	}
	for line, w := range cases {
		c, ok := ParseCredentialLine(line)
		if ok != w.ok {
			t.Errorf("ParseCredentialLine(%q) ok = %v, want %v", line, ok, w.ok)
			continue
		}
		if !ok {
			continue
		}
		if c.Name != w.name || c.Key != w.key || c.Value != w.val {
			t.Errorf("ParseCredentialLine(%q) = {%s %s %s}, want {%s %s %s}",
				line, c.Name, c.Key, c.Value, w.name, w.key, w.val)
		}
	}
}

func TestParseCredentialBlock(t *testing.T) {
	text := "# project credentials\n" +
		"\n" +
		"DATABASE_URL=postgres://localhost/app\n" +
		"GitHub token: ghp_abc123\n" +
		"- STRIPE_KEY = sk_test_456\n" +
		"not a credential line\n" +
		"GitHub token: ghp_dup\n" +
		"1. PORT=8080\n"
	creds, bad := ParseCredentialBlock(text)
	if bad != 1 {
		t.Errorf("bad = %d, want 1 (only the prose line)", bad)
	}
	if len(creds) != 5 {
		t.Fatalf("creds = %d, want 5", len(creds))
	}
	want := []struct{ name, key, val string }{
		{"DATABASE_URL", "DATABASE_URL", "postgres://localhost/app"},
		{"GitHub token", "GITHUB_TOKEN", "ghp_abc123"},
		{"STRIPE_KEY", "STRIPE_KEY", "sk_test_456"},
		{"GitHub token", "GITHUB_TOKEN_2", "ghp_dup"}, // deduped
		{"PORT", "PORT", "8080"},
	}
	for i, w := range want {
		if creds[i].Name != w.name || creds[i].Key != w.key || creds[i].Value != w.val {
			t.Errorf("creds[%d] = {%s %s %s}, want {%s %s %s}",
				i, creds[i].Name, creds[i].Key, creds[i].Value, w.name, w.key, w.val)
		}
	}
}

// The user-reported bug (v1.6.0 §45): a paste of colon-style credentials used
// to parse to ZERO items — the block parser must never produce an empty group
// out of non-empty input that carries credentials.
func TestParseCredentialBlockNeverEmptyForRealPastes(t *testing.T) {
	blocks := []string{
		"GitHub token: ghp_abc\nOpenAI key: sk-xyz",
		"- GitHub token: ghp_abc\n- Notion token: secret_x",
		"API_KEY = value with spaces\nANOTHER=1",
	}
	for _, b := range blocks {
		creds, _ := ParseCredentialBlock(b)
		if len(creds) == 0 {
			t.Errorf("ParseCredentialBlock(%q) found no credentials — this is the empty-group bug", b)
		}
	}
}
