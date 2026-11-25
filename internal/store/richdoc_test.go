/**
 * CLAVIS — rich-document plain-text conversion tests (v1.15.0, DECISIONS
 * §57). These mirror frontend/src/components/clavis/editors/rich-text.test.ts
 * case for case: the Go DocumentPlainText and the TS richToPlain are
 * rule-identical by contract, so copies, stats and the editor's live
 * numbers can never disagree. Plain documents must come back VERBATIM
 * (§40 byte-exact).
 */
package store

import (
        "strings"
        "testing"
)

func TestIsRichDocument(t *testing.T) {
        if !IsRichDocument(RichSentinel + "<div>x</div>") {
                t.Fatal("sentinel-prefixed document should be rich")
        }
        if IsRichDocument("NAME=value") {
                t.Fatal("plain document must not be rich")
        }
        /* Only a PREFIX marks rich mode — the comment pasted mid-document (a
           plain paste of a Clavis export, say) stays plain. */
        if IsRichDocument("intro\n" + RichSentinel + "\nrest") {
                t.Fatal("mid-document sentinel must not flip the mode")
        }
}

func TestDocumentPlainTextVerbatimForPlain(t *testing.T) {
        docs := []string{
                "",
                "single line",
                "FAKE credentials\nCLOUDFLARE_API_TOKEN=FAKE-token\n\n# rotate every 90 days\n",
                "emoji 🎉 and <b> literal tags in a plain doc",
        }
        for _, doc := range docs {
                if got := DocumentPlainText(doc); got != doc {
                        t.Fatalf("plain document changed:\n got %q\nwant %q", got, doc)
                }
        }
}

func TestDocumentPlainTextConversion(t *testing.T) {
        cases := []struct{ name, in, want string }{
                {"empty rich", RichSentinel, ""},
                {"one line", RichSentinel + "<div>hello</div>", "hello"},
                {"div per line", RichSentinel + "<div>a</div><div>b</div>", "a\nb"},
                {"blank line round-trip", RichSentinel + "<div>a</div><div><br></div><div>b</div>", "a\n\nb"},
                {"inline formatting stripped", RichSentinel + "<div><b>bold</b> and <i>italic</i></div>", "bold and italic"},
                {"entities unescaped", RichSentinel + "<div>a &amp; b &lt;c&gt;</div>", "a & b <c>"},
                {"alignment dropped", RichSentinel + `<div style="text-align: center">title</div>`, "title"},
                {"lists become lines", RichSentinel + "<ul><li>one</li><li>two</li></ul>", "one\ntwo"},
                {"nested blocks collapse", RichSentinel + "<div><div>deep</div></div>", "deep"},
                {"paragraphs", RichSentinel + "<p>one</p><p>two</p>", "one\ntwo"},
                {"emoji survive", RichSentinel + "<div>ship it 🚀</div>", "ship it 🚀"},
                {"unknown tags dropped, text kept", RichSentinel + "<div><span>words</span></div>", "words"},
        }
        for _, c := range cases {
                if got := DocumentPlainText(c.in); got != c.want {
                        t.Errorf("%s:\n got %q\nwant %q", c.name, got, c.want)
                }
        }
}

/* The exact plain → rich → plain round-trip the frontend performs when a
   plain document is flipped to rich mode and back without edits. */
func TestDocumentPlainTextRoundTrip(t *testing.T) {
        plains := []string{
                "single line",
                "one\ntwo\nthree",
                "blank\n\nline",
                "symbols < > & \" ' done",
                "emoji 🎉 and ✅ characters",
        }
        for _, plain := range plains {
                rich := RichSentinel + plainToRichHTML(plain)
                if got := DocumentPlainText(rich); got != plain {
                        t.Fatalf("round-trip changed the document:\n got %q\nwant %q", got, plain)
                }
        }
}

/* plainToRichHTML mirrors the frontend's plainToRich (one div per line,
 * empty line → <br>, HTML-escaped text) — the test's conversion oracle,
 * kept inline so the test explains itself without frontend code. */
func plainToRichHTML(text string) string {
        var b strings.Builder
        for _, line := range strings.Split(text, "\n") {
                if line == "" {
                        b.WriteString("<div><br></div>")
                        continue
                }
                b.WriteString("<div>")
                b.WriteString(escapeHTML(line))
                b.WriteString("</div>")
        }
        return b.String()
}

func escapeHTML(s string) string {
        r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;")
        return r.Replace(s)
}
