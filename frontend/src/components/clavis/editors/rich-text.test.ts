/**
 * CLAVIS — the rich-text format layer test (v1.15.0, DECISIONS §57). Pins
 * every rule the editors, the stats and the Go copy path (internal/store/
 * richdoc.go) agree on: sentinel detection, the plain → rich → plain
 * round-trip, the lossy rich → plain rules, the sanitizer allowlist, and
 * the plain-text stats. FAKE data only.
 */
import { describe, expect, it } from "vitest";
import {
  RICH_SENTINEL,
  escapeHtml,
  htmlFromRichDoc,
  isRichDoc,
  plainToRich,
  richDocFromHtml,
  richHasFormatting,
  richPlainText,
  richStats,
  richToPlain,
  sanitizeRich,
} from "./rich-text";

describe("sentinel", () => {
  it("marks and unwraps rich documents", () => {
    const doc = richDocFromHtml("<div>hello</div>");
    expect(doc).toBe(`${RICH_SENTINEL}<div>hello</div>`);
    expect(isRichDoc(doc)).toBe(true);
    expect(isRichDoc("plain text")).toBe(false);
    expect(htmlFromRichDoc(doc)).toBe("<div>hello</div>");
    expect(htmlFromRichDoc("plain text")).toBe("plain text");
  });

  it("is not forged by a plain paste of the comment", () => {
    /* A plain document that happens to contain the comment text keeps the
       sentinel in the middle — only a prefix marks rich mode. */
    expect(isRichDoc(`intro\n${RICH_SENTINEL}\nrest`)).toBe(false);
  });
});

describe("plainToRich", () => {
  it("maps the empty string to empty HTML", () => {
    expect(plainToRich("")).toBe("");
  });

  it("wraps each line in a div, empty lines get a br", () => {
    expect(plainToRich("one\ntwo")).toBe("<div>one</div><div>two</div>");
    expect(plainToRich("a\n\nb")).toBe("<div>a</div><div><br></div><div>b</div>");
  });

  it("escapes HTML in the text", () => {
    expect(plainToRich("<b> & \"q\" 'p'")).toBe(
      `<div>&lt;b&gt; &amp; &quot;q&quot; &#39;p&#39;</div>`,
    );
  });
});

describe("richToPlain", () => {
  it("maps empty HTML to the empty string", () => {
    expect(richToPlain("")).toBe("");
  });

  it("round-trips plainToRich output exactly", () => {
    const samples = [
      "single line",
      "one\ntwo\nthree",
      "blank\n\nline",
      "trailing spaces kept  \nnext",
      "symbols < > & \" ' done",
      "emoji 🎉 and ✅ characters",
    ];
    for (const plain of samples) {
      expect(richToPlain(plainToRich(plain))).toBe(plain);
    }
  });

  it("strips inline formatting but keeps the words", () => {
    expect(richToPlain("<div><b>bold</b> and <i>italic</i></div>")).toBe("bold and italic");
  });

  it("unescapes entities exactly once", () => {
    expect(richToPlain("<div>a &amp; b &lt;c&gt;</div>")).toBe("a & b <c>");
  });

  it("turns block closes and brs into newlines", () => {
    expect(richToPlain("<div>a</div><div>b</div>")).toBe("a\nb");
    expect(richToPlain("<p>one</p><p>two</p>")).toBe("one\ntwo");
    expect(richToPlain("<ul><li>one</li><li>two</li></ul>")).toBe("one\ntwo");
  });

  it("drops alignment styles without touching the text", () => {
    expect(richToPlain('<div style="text-align: center">title</div>')).toBe("title");
  });

  it("collapses triple newlines from nested block tags and trims the ends", () => {
    expect(richToPlain("<div><div>deep</div></div>")).toBe("deep");
    expect(richToPlain("<div>a</div>\n\n\n<div>b</div>")).toBe("a\n\nb");
  });
});

describe("richPlainText", () => {
  it("returns plain documents verbatim", () => {
    expect(richPlainText("NAME=value\n# comment")).toBe("NAME=value\n# comment");
  });

  it("converts rich documents to their plain text", () => {
    const doc = richDocFromHtml("<div><b>API</b> notes</div><div>rotate 🔄</div>");
    expect(richPlainText(doc)).toBe("API notes\nrotate 🔄");
  });
});

describe("sanitizeRich", () => {
  it("keeps the editor's own vocabulary untouched", () => {
    const html =
      '<div style="text-align: center">title</div><div><b>bold</b> <i>it</i> <u>un</u> <s>st</s></div><ul><li>one</li></ul>';
    expect(sanitizeRich(html)).toBe(html);
  });

  it("drops scripts and their content entirely", () => {
    expect(sanitizeRich("<div>safe</div><script>alert(1)</script>")).toBe("<div>safe</div>");
    expect(sanitizeRich('<div>x</div><iframe src="https://evil.example"></iframe>')).toBe("<div>x</div>");
  });

  it("unwraps tags outside the allowlist but keeps their text", () => {
    expect(sanitizeRich('<div><a href="https://x.example">link</a> tail</div>')).toBe("<div>link tail</div>");
    expect(sanitizeRich("<h1>Heading</h1>")).toBe("Heading");
  });

  it("removes every attribute except the allowed style properties", () => {
    expect(sanitizeRich('<div onclick="evil()" class="x" id="y">t</div>')).toBe("<div>t</div>");
    expect(sanitizeRich('<span onmouseover="evil()">t</span>')).toBe("<span>t</span>");
  });

  it("keeps only alignment/weight/style/decoration declarations in style", () => {
    expect(sanitizeRich('<div style="text-align: right; background: url(x); color: red">t</div>')).toBe(
      '<div style="text-align: right">t</div>',
    );
    expect(sanitizeRich('<div style="background-image: url(https://evil.example/x)">t</div>')).toBe("<div>t</div>");
    expect(sanitizeRich('<span style="font-weight: 700">t</span>')).toBe('<span style="font-weight: 700">t</span>');
  });

  it("maps the empty string to the empty string", () => {
    expect(sanitizeRich("")).toBe("");
  });
});

describe("richHasFormatting", () => {
  it("is false for empty and structure-only HTML", () => {
    expect(richHasFormatting("")).toBe(false);
    expect(richHasFormatting(plainToRich("just\ntext\nlines"))).toBe(false);
  });

  it("is true for inline formatting, lists and alignment", () => {
    expect(richHasFormatting("<div><b>bold</b></div>")).toBe(true);
    expect(richHasFormatting("<ul><li>one</li></ul>")).toBe(true);
    expect(richHasFormatting('<div style="text-align: center">c</div>')).toBe(true);
  });
});

describe("richStats", () => {
  it("counts runes and lines of the plain text (the backend rule)", () => {
    const stats = richStats("<div><b>héllo</b></div><div>two</div>");
    expect(stats).toEqual({ chars: [..."héllo\ntwo"].length, lines: 2 });
  });

  it("treats empty rich HTML as zero", () => {
    expect(richStats("")).toEqual({ chars: 0, lines: 0 });
    expect(richStats("<div><br></div>")).toEqual({ chars: 0, lines: 0 });
  });
});

describe("escapeHtml", () => {
  it("escapes the five significant characters", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });
});
