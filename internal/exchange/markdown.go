/**
 * CLAVIS — Markdown / TXT import & export (SPEC §5.8B).
 *
 * Layouts are byte-exact:
 *
 * Item .md
 *   ---
 *   type: item
 *   name: GitHub token
 *   key: GITHUB_TOKEN
 *   category: Credentials
 *   tags: [github, ci]
 *   secret: true
 *   ---
 *   <the value, exactly as stored, multi-line allowed>
 *
 * Group .md
 *   ---
 *   type: group
 *   name: Sedanama credentials
 *   category: Credentials
 *   tags: [sedanama]
 *   ---
 *   GITHUB_TOKEN=<value>        (dotenv quoting rules apply)
 *
 * Empty header values emit "key:" with nothing after the colon.
 * The body is written verbatim after the closing fence line + its one
 * newline; no trailing newline is appended.
 */
package exchange

import (
	"errors"
	"strings"
)

// ErrNotClavisMarkdown is the sentinel for "not a Clavis markdown file".
var ErrNotClavisMarkdown = errors.New("not a Clavis markdown file")

// Kind discriminates imported files.
const (
	KindItem  = "item"
	KindGroup = "group"
)

// Imported is the parse result of one .md/.txt file.
type Imported struct {
	Kind         string
	Name         string
	Key          string // items only
	Value        string // items only
	CategoryName string
	Tags         []string
	IsSecret     bool
	Lines        []Member // groups only
	// Mode/Document (v1.5.0 §40): a group .md whose header carries
	// "mode: document" imports as a whole-document group and its body IS
	// the verbatim document (never parsed as KEY=value lines).
	Mode     string
	Document string
}

// MdItem is the subset of store.Item needed for Markdown export.
type MdItem struct {
	Name       string
	Key        string
	Value      string
	Note       string
	CategoryID *string
	Tags       []string
	IsSecret   bool
}

// MdGroup is the subset of store.Group needed for Markdown export.
type MdGroup struct {
	Name       string
	CategoryID *string
	Tags       []string
	// Mode/Document (v1.5.0 §40): when Mode == ModeDocument the body is the
	// raw document itself and the header announces "mode: document" so the
	// import round-trips without trying to parse KEY=value lines.
	Mode     string
	Document string
}

// ModeDocument is the group-mode marker in Markdown headers (§40). The
// store package re-exports the same value as GroupModeDocument.
const ModeDocument = "document"

func headerValue(label, value string) string {
	if value == "" {
		return label + ":"
	}
	return label + ": " + value
}

func tagsField(tags []string) string {
	if len(tags) == 0 {
		return "[]"
	}
	return "[" + strings.Join(tags, ", ") + "]"
}

// ExportItemMarkdown renders an item as Clavis Markdown.
func ExportItemMarkdown(item MdItem, categoryName string) string {
	lines := []string{
		"---",
		"type: item",
		headerValue("name", item.Name),
		headerValue("key", item.Key),
		headerValue("category", categoryName),
		"tags: " + tagsField(item.Tags),
		"secret: " + boolField(item.IsSecret),
		"---",
	}
	return strings.Join(lines, "\n") + "\n" + item.Value
}

// ExportGroupMarkdown renders a group as Clavis Markdown. Document groups
// (§40) carry "mode: document" in the header and store the pasted file
// verbatim as the body — byte-exact, no KEY=value parsing in either
// direction.
func ExportGroupMarkdown(group MdGroup, members []Member, categoryName string) string {
	lines := []string{
		"---",
		"type: group",
		headerValue("name", group.Name),
		headerValue("category", categoryName),
		"tags: " + tagsField(group.Tags),
	}
	if group.Mode == ModeDocument {
		lines = append(lines, "mode: "+ModeDocument)
		return strings.Join(lines, "\n") + "\n---\n" + group.Document
	}
	lines = append(lines, "---")
	return strings.Join(lines, "\n") + "\n" + FormatGroupBlock(members)
}

func boolField(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

// ExportItemText is the item .txt export: the value only.
func ExportItemText(value string) string { return value }

// ExportGroupText is the group .txt export: the KEY=value lines only — or,
// for document groups (§40), the verbatim document itself.
func ExportGroupText(members []Member) string { return FormatGroupBlock(members) }

func baseName(fileName string) string {
	n := strings.ReplaceAll(fileName, "\\", "/")
	if slash := strings.LastIndex(n, "/"); slash >= 0 {
		n = n[slash+1:]
	}
	if dot := strings.LastIndex(n, "."); dot > 0 {
		n = n[:dot]
	}
	if strings.TrimSpace(n) == "" {
		return "Imported"
	}
	return n
}

// ParseMarkdown parses a Clavis .md file. Returns ErrNotClavisMarkdown when
// the first line is not "---". BOM and CRLF are tolerated.
func ParseMarkdown(fileName, content string) (Imported, error) {
	text := content
	text = strings.TrimPrefix(text, "\ufeff") // BOM

	firstNewline := strings.Index(text, "\n")
	firstLine := text
	if firstNewline >= 0 {
		firstLine = text[:firstNewline]
	}
	firstLine = strings.TrimSuffix(firstLine, "\r")

	if firstLine != "---" {
		return Imported{}, ErrNotClavisMarkdown
	}

	// Walk header lines until the closing "---".
	pos := len(text)
	if firstNewline >= 0 {
		pos = firstNewline + 1
	}
	header := map[string]string{}
	closed := false
	for pos <= len(text) {
		nl := strings.Index(text[pos:], "\n")
		rawLine := ""
		if nl == -1 {
			rawLine = text[pos:]
		} else {
			rawLine = text[pos : pos+nl]
		}
		line := strings.TrimSuffix(rawLine, "\r")
		if line == "---" {
			closed = true
			if nl == -1 {
				pos = len(text)
			} else {
				pos = pos + nl + 1
			}
			break
		}
		if strings.TrimSpace(line) != "" {
			if colon := strings.Index(line, ":"); colon > 0 {
				key := strings.TrimSpace(strings.ToLower(line[:colon]))
				val := strings.TrimSpace(line[colon+1:])
				header[key] = val
			}
		}
		if nl == -1 {
			pos = len(text)
			break
		}
		pos += nl + 1
	}
	if !closed {
		return Imported{}, errors.New("missing closing fence")
	}

	typ := header["type"]
	if typ != KindItem && typ != KindGroup {
		return Imported{}, errors.New("unknown or missing type in header")
	}

	name, hasName := header["name"]
	if !hasName || strings.TrimSpace(name) == "" {
		name = baseName(fileName)
	}
	name = strings.TrimSpace(name)
	categoryName := header["category"]
	tags := parseTags(header["tags"])
	secretRaw := strings.ToLower(header["secret"])
	// Absent or unparseable "secret" defaults to TRUE (never under-mask).
	isSecret := true
	if secretRaw != "" && secretRaw == "false" {
		isSecret = false
	}

	body := text[pos:]

	if typ == KindItem {
		return Imported{
			Kind: KindItem, Name: name, Key: header["key"], Value: body,
			CategoryName: categoryName, Tags: tags, IsSecret: isSecret,
		}, nil
	}

	// Whole-document groups (§40): the body is the pasted file, verbatim.
	if strings.ToLower(header["mode"]) == ModeDocument {
		return Imported{
			Kind: KindGroup, Name: name, CategoryName: categoryName, Tags: tags,
			IsSecret: isSecret, Mode: ModeDocument, Document: body,
		}, nil
	}

	var lines []Member
	for _, line := range splitLines(body) {
		if strings.TrimSpace(line) == "" {
			continue
		}
		if key, value, ok := ParseDotenvLine(line); ok {
			lines = append(lines, Member{Key: key, Value: value})
		}
	}
	return Imported{Kind: KindGroup, Name: name, CategoryName: categoryName, Tags: tags, IsSecret: isSecret, Lines: lines}, nil
}

func parseTags(raw string) []string {
	s := strings.TrimSpace(raw)
	if strings.HasPrefix(s, "[") && strings.HasSuffix(s, "]") {
		s = s[1 : len(s)-1]
	}
	if strings.TrimSpace(s) == "" {
		return []string{}
	}
	out := []string{}
	for _, t := range strings.Split(s, ",") {
		t = strings.TrimSpace(t)
		if t != "" {
			out = append(out, t)
		}
	}
	return out
}

// ParseText parses a .txt import (§5.8B): all KEY=value lines → a group
// named after the file; anything else → a single item with the whole text.
func ParseText(fileName, content string) Imported {
	name := baseName(fileName)
	if LooksLikeDotenv(content) {
		var lines []Member
		for _, line := range splitLines(content) {
			if strings.TrimSpace(line) == "" {
				continue
			}
			if key, value, ok := ParseDotenvLine(line); ok {
				lines = append(lines, Member{Key: key, Value: value})
			}
		}
		return Imported{Kind: KindGroup, Name: name, CategoryName: "", Tags: []string{}, IsSecret: true, Lines: lines}
	}
	return Imported{Kind: KindItem, Name: name, Key: "", Value: content, CategoryName: "", Tags: []string{}, IsSecret: true}
}
