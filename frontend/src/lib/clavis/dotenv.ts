/**
 * CLAVIS — dotenv quoting rules (SPEC §5.2).
 *
 * THE algorithm (single documented implementation, mirrored from the
 * reference Go implementation):
 * - A value needs quoting when it contains a newline, a double quote, a
 *   backslash, or leading/trailing spaces, tabs or CR characters.
 * - Escapes inside quotes: `\n` for newline, `\"` for quote, `\\` for
 *   backslash. `\r` and `\t` pass through raw.
 * - A group block is its lines joined with "\n" and NO trailing newline.
 * - Keys are deduped with `_2`, `_3`… suffixes; an empty key becomes "KEY".
 */

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

export function needsDotenvQuoting(value: string): boolean {
  if (value.length === 0) return false;
  const inner = value;
  const leading = /^[ \t\r]/.test(inner);
  const trailing = /[ \t\r]$/.test(inner);
  return (
    inner.includes("\n") ||
    inner.includes('"') ||
    inner.includes("\\") ||
    leading ||
    trailing
  );
}

export function dotenvEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

export function formatDotenvLine(key: string, value: string): string {
  if (needsDotenvQuoting(value)) {
    return `${key}="${dotenvEscape(value)}"`;
  }
  return `${key}=${value}`;
}

/** Unescape a value that was (possibly) written quoted. */
export function parseDotenvValue(raw: string): string {
  if (
    raw.length >= 2 &&
    raw.startsWith('"') &&
    raw.endsWith('"')
  ) {
    const inner = raw.slice(1, -1);
    return inner
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  return raw;
}

export function parseDotenvLine(
  line: string
): { key: string; value: string } | null {
  let l = line;
  if (l.endsWith("\r")) l = l.slice(0, -1); // tolerate CRLF files
  if (!KEY_RE.test(l)) return null;
  const eq = l.indexOf("=");
  const key = l.slice(0, eq);
  const value = parseDotenvValue(l.slice(eq + 1));
  return { key, value };
}

/** True when every non-blank line is a KEY=value line (and there is ≥1). */
export function looksLikeDotenv(text: string): boolean {
  const lines = text.split(/\r?\n/);
  let seen = 0;
  for (const line of lines) {
    if (line.trim() === "") continue;
    if (!parseDotenvLine(line)) return false;
    seen++;
  }
  return seen > 0;
}

/**
 * Dedupe keys: duplicates get _2, _3… Empty keys become "KEY" (then _2…).
 */
export function dedupeKeys(keys: string[]): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  for (const raw of keys) {
    const key = raw.trim() === "" ? "KEY" : raw;
    if (!used.has(key)) {
      used.add(key);
      out.push(key);
      continue;
    }
    for (let n = 2; ; n++) {
      const candidate = `${key}_${n}`;
      if (!used.has(candidate)) {
        used.add(candidate);
        out.push(candidate);
        break;
      }
    }
  }
  return out;
}

/**
 * Auto-generate a variable name from an item name (SPEC §4.2):
 * uppercase, spaces and symbols to underscores. "GitHub token" →
 * GITHUB_TOKEN. Falls back to "KEY" when nothing survives.
 */
export function autoKey(name: string): string {
  const key = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return key === "" ? "KEY" : key;
}

/* ------------- tolerant paste parsing (v1.6.0, DECISIONS §45) -------------
 *
 * Mirrors the Go reference implementation (internal/exchange/dotenv.go) line
 * for line — the create-group paste box and its live preview must agree with
 * exactly what the store will create:
 *
 *   KEY=value        → name=KEY, key=KEY          (classic .env)
 *   KEY = value      → spaces around the separator are fine
 *   Name: value      → name=Name, key=AutoKey(Name)
 *   DATABASE_URL: x  → a valid var name before ":" keeps itself as the key
 *   - KEY=value / * x / 3. x → markdown bullets and numbering are fine
 *   # comment / blank → skipped cleanly, never counted as bad lines
 *
 * A colon line with an EMPTY value is NOT a credential ("My credentials:"
 * is prose, not a key); a bare URL's "https:" is a scheme, not a separator.
 */

/** Markdown list prefixes ("- ", "* ", "• ", "+ ", "3. ", "2) "). */
const BULLET_RE = /^\s*(?:[-*•+]|\d+[.)])\s+/;
/** A plain dotenv variable name before a separator. */
const VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** True for a blank line or a # comment (skipped, never an error). */
export function isSkippablePasteLine(line: string): boolean {
  const l = line.endsWith("\r") ? line.slice(0, -1) : line;
  const t = l.trim();
  return t === "" || t.startsWith("#");
}

/** One line of a pasted credentials block. */
export interface ParsedCredential {
  /** Human item name ("GitHub token"). */
  name: string;
  /** Dotenv key (GITHUB_TOKEN); autoKey applied when needed. */
  key: string;
  value: string;
}

/** Parse one pasted line tolerantly; null = not a credential (skip). */
export function parseCredentialLine(line: string): ParsedCredential | null {
  let l = line.endsWith("\r") ? line.slice(0, -1) : line;
  l = l.replace(BULLET_RE, "");
  if (isSkippablePasteLine(l)) return null;
  l = l.trim();
  if (l === "") return null;
  // Separator: the FIRST "=" or ":" wins, whichever comes first (a value may
  // itself contain colons — "URL: https://…" must keep them).
  const eq = l.indexOf("=");
  const co = l.indexOf(":");
  let sep = eq;
  let isColon = false;
  if (co >= 0 && (eq < 0 || co < eq)) {
    sep = co;
    isColon = true;
  }
  if (sep <= 0) return null;
  const rawName = l.slice(0, sep).trim();
  const value = parseDotenvValue(l.slice(sep + 1).trim());
  if (rawName === "") return null;
  if (isColon) {
    // "Name: value" needs a non-empty value — "My credentials:" is prose.
    if (value === "") return null;
    // "https://api.example.com" is not "https" = "//api…": a scheme, not a
    // separator.
    if (value.startsWith("//")) return null;
    if (VAR_NAME_RE.test(rawName)) return { name: rawName, key: rawName, value };
    return { name: rawName, key: autoKey(rawName), value };
  }
  // "KEY = value": a valid var name keeps itself; a free-form left side
  // ("GitHub token = x") becomes the name with an autoKey key.
  if (VAR_NAME_RE.test(rawName)) return { name: rawName, key: rawName, value };
  return { name: rawName, key: autoKey(rawName), value };
}

/**
 * Parse a whole pasted block: the credentials (in paste order) and the number
 * of non-blank, non-comment lines that did not parse. Keys are deduped
 * exactly like group copies (§4.2) so the block round-trips.
 */
export function parseCredentialBlock(text: string): {
  creds: ParsedCredential[];
  bad: number;
} {
  const pairs: ParsedCredential[] = [];
  let bad = 0;
  for (const raw of text.split("\n")) {
    if (isSkippablePasteLine(raw)) continue;
    const c = parseCredentialLine(raw);
    if (!c) {
      bad++;
      continue;
    }
    pairs.push(c);
  }
  const keys = dedupeKeys(pairs.map((p) => p.key));
  return {
    creds: pairs.map((p, i) => ({ ...p, key: keys[i] })),
    bad,
  };
}
