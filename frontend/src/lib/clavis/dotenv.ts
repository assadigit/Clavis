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

export interface DotenvMember {
  key: string;
  value: string;
}

export function formatGroupBlock(members: DotenvMember[]): string {
  return members.map((m) => formatDotenvLine(m.key, m.value)).join("\n");
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
  const used = new Map<string, number>();
  const out: string[] = [];
  for (const raw of keys) {
    let key = raw.trim() === "" ? "KEY" : raw;
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    if (n > 0) key = `${key}_${n + 1}`;
    out.push(key);
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
