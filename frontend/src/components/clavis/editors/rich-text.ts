/**
 * CLAVIS — the rich-text format layer for whole-document groups (v1.15.0,
 * DECISIONS §57). A rich document is stored as
 * `<!--clavis-rich-->` + HTML; a plain document (every existing one) stays a
 * plain string, byte-identical until the owner flips it to rich.
 *
 * The plain-text conversion here is rule-identical to the Go side
 * (internal/store/richdoc.go) so the stats in the UI and the numbers the
 * backend reports always agree: `<br>` and closing block tags become
 * newlines, every other tag is dropped, entities are unescaped, 3+ blank
 * newlines collapse to one blank line, and the ends are trimmed.
 *
 * Pure functions only — no React, no DOM events — so every rule is unit
 * tested in rich-text.test.ts.
 */

/** Prefix marking a stored document as rich text (an HTML comment, so a
 *  stray paste into a plain document can never forge it visibly). */
export const RICH_SENTINEL = "<!--clavis-rich-->";

export function isRichDoc(doc: string): boolean {
  return doc.startsWith(RICH_SENTINEL);
}

/** The HTML body of a stored rich document (everything after the sentinel). */
export function htmlFromRichDoc(doc: string): string {
  return isRichDoc(doc) ? doc.slice(RICH_SENTINEL.length) : doc;
}

/** The canonical stored form of rich HTML. */
export function richDocFromHtml(html: string): string {
  return RICH_SENTINEL + html;
}

/* ---- HTML escaping (the plain → rich direction) ---- */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Plain text → rich HTML, one `<div>` per line (an empty line becomes
 * `<div><br></div>`), so alignment and lists work per paragraph and the
 * plain → rich → plain round-trip is exact for clean input. The empty
 * string maps to the empty string (the editor's placeholder state).
 */
export function plainToRich(text: string): string {
  if (text === "") return "";
  return text
    .split("\n")
    .map((line) => `<div>${line === "" ? "<br>" : escapeHtml(line)}</div>`)
    .join("");
}

/* ---- HTML → plain text (the lossy direction) ---- */

const BLOCK_CLOSE_RE = /<\/(?:div|p|li|h[1-6]|ul|ol|blockquote|pre|tr)\s*>/gi;
const BR_RE = /<br\s*\/?>/gi;
const ANY_TAG_RE = /<[^>]*>/g;

/** Entity → character. Mirrors Go's html.UnescapeString for the entities
 *  escapeHtml can produce (plus numeric forms for robustness). */
function unescapeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Rich HTML → plain text. Rule-identical to Go's DocumentPlainText so
 *  copies, stats and conversions never disagree. */
export function richToPlain(html: string): string {
  if (html === "") return "";
  let text = html
    .replace(BR_RE, "\n")
    .replace(BLOCK_CLOSE_RE, "\n")
    .replace(ANY_TAG_RE, "")
    .replace(/\r\n?/g, "\n");
  text = unescapeEntities(text);
  while (text.includes("\n\n\n")) text = text.replaceAll("\n\n\n", "\n\n");
  return text.replace(/^\n+|\n+$/g, "");
}

/** The plain text of a stored document, whatever its mode. */
export function richPlainText(doc: string): string {
  return isRichDoc(doc) ? richToPlain(htmlFromRichDoc(doc)) : doc;
}

/* ---- Sanitizing (before anything is stored or pasted back) ---- */

const ALLOWED_TAGS = new Set([
  "div", "p", "br", "b", "strong", "i", "em", "u", "s", "strike", "ul", "ol", "li", "span",
]);
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "link", "meta", "title"]);
/** The only style properties the editor writes; keyword-only values keep
 *  urls/expressions out even if something odd reaches the clipboard. */
const ALLOWED_STYLE_PROPS = new Set(["text-align", "font-weight", "font-style", "text-decoration", "text-decoration-line"]);
const STYLE_VALUE_RE = /^[a-zA-Z0-9-]+(?:\s+[a-zA-Z0-9-]+)*$/;

function cleanStyle(style: string): string {
  const kept: string[] = [];
  for (const decl of style.split(";")) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (ALLOWED_STYLE_PROPS.has(prop) && STYLE_VALUE_RE.test(value)) kept.push(`${prop}: ${value}`);
  }
  return kept.join("; ");
}

/**
 * Reduce arbitrary HTML (the editor's own output, a paste, or a hand-edited
 * vault) to the editor's vocabulary: allowed tags only, `style` kept solely
 * on block/inline containers and solely for the editor's properties.
 * Everything else is unwrapped to its text; scripts and their kin are
 * dropped together with their content. Returns the cleaned inner HTML.
 */
export function sanitizeRich(html: string): string {
  if (html === "") return "";
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const clean = (node: Node): void => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (!(child instanceof HTMLElement)) continue;
      const tag = child.tagName.toLowerCase();
      if (DROP_WITH_CONTENT.has(tag)) {
        child.remove();
        continue;
      }
      clean(child);
      if (!ALLOWED_TAGS.has(tag)) {
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        if (attr.name === "style" && (tag === "div" || tag === "p" || tag === "span" || tag === "li")) {
          const kept = cleanStyle(attr.value);
          if (kept === "") child.removeAttribute("style");
          else child.setAttribute("style", kept);
        } else {
          child.removeAttribute(attr.name);
        }
      }
    }
  };
  clean(doc.body);
  return doc.body.innerHTML;
}

/* ---- Mode bookkeeping ---- */

/**
 * True when the rich HTML carries anything a plain-text document cannot
 * represent (inline formatting, lists, alignment). Rich → plain asks for
 * confirmation exactly when this is true.
 */
export function richHasFormatting(html: string): boolean {
  const clean = sanitizeRich(html);
  if (clean === "") return false;
  /* Any surviving style attribute (e.g. alignment on a block) is formatting. */
  if (/style\s*=\s*["'][^"']*["']/i.test(clean)) return true;
  /* Anything but the structural div/p/br left over is formatting. */
  const withoutStructure = clean
    .replace(/<\/?div[^>]*>/gi, "")
    .replace(/<\/?p[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "");
  return /<\/?[a-z]+[\s>/]/i.test(withoutStructure);
}

/* ---- Stats (the backend's rule, applied to the plain text) ---- */

export interface DocStats {
  chars: number;
  lines: number;
}

/** Rune count + newline+1 lines of the PLAIN text — the numbers the backend
 *  reports for the document, so the editor's live stats match the panel's. */
export function richStats(html: string): DocStats {
  const plain = richToPlain(html);
  return {
    chars: [...plain].length,
    lines: plain === "" ? 0 : plain.split("\n").length,
  };
}
