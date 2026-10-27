#!/usr/bin/env node
/**
 * CLAVIS — token lint (UI-audit round 1, Phase 8; F-011 / upgrade U-01).
 *
 * The token discipline is the codebase's biggest visual strength — this
 * script keeps it that way. It fails the build when a color or size literal
 * escapes `src/design-tokens.css`.
 *
 * Rules:
 *   1. Hex colors are allowed ONLY inside src/design-tokens.css.
 *   2. `px` and `ms` literals are not allowed anywhere else, except the
 *      documented allowlist below (every entry has its reason).
 *   3. `vh` offsets are allowed (popup geometry, not theme values).
 *   4. Test files and comments are exempt.
 *
 * Run from frontend/:  node scripts/check-tokens.mjs   (or: bun run lint:tokens)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)), ""); // frontend/
const TOKEN_FILE = "src/design-tokens.css";

/* ---- allowlist: a literal line is OK only if one of these matches it ---- */
const ALLOWED_PATTERNS = [
  /1px solid/, // hairline borders: the flat Bitwarden system's constant width
  /inset 3px/, // the selected-row accent bar (globals.css, no token equivalent)
  /width: 8px/, // globals.css scrollbar width (UA quirk)
  /min-width: 20px/, // globals.css scrollbar thumb
  /min\(\d+px/, // modal & popup width caps (440/560/640/720px) — window geometry
  /minmax\(170px, 1fr\)/, // the editor's Secret/Pinned responsive grid floor
  /calc\(640px/, // the popup window's design width (matches Go popupWidth)
];

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
const UNIT_RE = /\b\d+(?:\.\d+)?(px|ms)\b/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walk(p, out);
    } else if (/\.(tsx|ts|css)$/.test(name) && !/\.test\./.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function lineAllowed(line) {
  return ALLOWED_PATTERNS.some((re) => re.test(line));
}

const violations = [];
for (const file of walk(join(ROOT, "src"))) {
  const rel = relative(ROOT, file).split("\\").join("/");
  const isTokenFile = rel === TOKEN_FILE;
  let inBlockComment = false;
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((rawLine, i) => {
      const lineno = i + 1;
      if (isTokenFile) return;
      /* strip comments first (single pass over the line, toggling block state) */
      let code = "";
      let rest = rawLine;
      while (rest.length > 0) {
        if (inBlockComment) {
          const end = rest.indexOf("*/");
          if (end === -1) {
            rest = "";
          } else {
            inBlockComment = false;
            rest = rest.slice(end + 2);
          }
        } else {
          const start = rest.search(/\/\*|\/\//);
          if (start === -1) {
            code += rest;
            rest = "";
          } else if (rest[start] === "/" && rest[start + 1] === "/") {
            rest = "";
          } else {
            code += rest.slice(0, start);
            inBlockComment = true;
            rest = rest.slice(start + 2);
          }
        }
      }
      const line = code.trim();
      if (line === "") return;

      if (HEX_RE.test(line)) {
        violations.push(`${rel}:${lineno}: hex color outside the token file: ${line}`);
        return; // one report per line
      }
      const m = line.match(UNIT_RE);
      if (m && !lineAllowed(line)) {
        violations.push(`${rel}:${lineno}: ${m[1]} literal outside the token file: ${line}`);
      }
    });
}

if (violations.length > 0) {
  console.error(
    `token lint: ${violations.length} violation(s) — colors and sizes come from src/design-tokens.css:`
  );
  for (const v of violations) console.error("  " + v);
  process.exit(1);
}
console.log("token lint: clean — every color and size lives in src/design-tokens.css.");
