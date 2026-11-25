/**
 * CLAVIS — rich-text document plumbing (v1.15.0, DECISIONS §57).
 *
 * A whole-document group's stored Document can be rich text: the sentinel
 * comment below followed by the WYSIWYG editor's HTML. The format decision
 * and the rule table live in docs/audits/2026-11-25-rich-text-document-editor.md;
 * these helpers are the ONE Go-side implementation of the plain-text view,
 * used by copies (Store.Copy, GroupCopyText) and the state stats
 * (service.redactState). The markdown export/import round-trip deliberately
 * keeps the stored bytes verbatim — the sentinel is a valid HTML comment in
 * markdown, and stripping it would break the re-import.
 *
 * DocumentPlainText is rule-identical to the frontend's richToPlain
 * (frontend/src/components/clavis/editors/rich-text.ts), so the numbers the
 * UI shows and the bytes a copy produces can never disagree:
 *   - `<br>` and closing block tags become newlines,
 *   - every other tag is dropped (formatting does not survive plain copies),
 *   - entities are unescaped,
 *   - 3+ newlines collapse to one blank line, and the ends are trimmed.
 * Plain documents are returned VERBATIM — the §40 byte-exact promise is
 * untouched for every existing document.
 */
package store

import (
	"html"
	"regexp"
	"strings"
)

// RichSentinel prefixes a document stored by the rich-text editor. It is an
// HTML comment so it renders as nothing in markdown viewers and can never
// appear in a document's visible text. Must match frontend rich-text.ts.
const RichSentinel = "<!--clavis-rich-->"

var (
	richBrRE    = regexp.MustCompile(`(?i)<br\s*/?>`)
	richCloseRE = regexp.MustCompile(`(?i)</(?:div|p|li|h[1-6]|ul|ol|blockquote|pre|tr)\s*>`)
	richTagRE   = regexp.MustCompile(`(?s)<[^>]*>`)
)

// IsRichDocument reports whether a stored document carries rich text.
func IsRichDocument(doc string) bool {
	return strings.HasPrefix(doc, RichSentinel)
}

// DocumentPlainText returns the text copies and stats should carry: the
// stored document verbatim when it is plain, and the words-without-markup
// conversion when it is rich. Never called for item values.
func DocumentPlainText(doc string) string {
	if !IsRichDocument(doc) {
		return doc
	}
	body := strings.TrimPrefix(doc, RichSentinel)
	body = richBrRE.ReplaceAllString(body, "\n")
	body = richCloseRE.ReplaceAllString(body, "\n")
	body = richTagRE.ReplaceAllString(body, "")
	body = html.UnescapeString(body)
	body = strings.ReplaceAll(body, "\r\n", "\n")
	for strings.Contains(body, "\n\n\n") {
		body = strings.ReplaceAll(body, "\n\n\n", "\n\n")
	}
	return strings.Trim(body, "\n")
}
