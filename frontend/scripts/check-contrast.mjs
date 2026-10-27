#!/usr/bin/env node
/**
 * CLAVIS — contrast checker (UI-audit round 1, Phase 12, F-016).
 *
 * Parses `src/design-tokens.css` `:root` and `html.solid` overrides and
 * checks the WCAG AA contrast ratio for an explicit list of foreground
 * /background pairs that the app actually uses. Fails if any pair misses
 * 4.5:1 (normal text) or 3:1 (large text — bold ≥18.66px or regular
 * ≥24px). All Clavis text is at most --text-lg (16px) so the script uses
 * 4.5:1 as the threshold for every pair by default; large-text pairs can
 * be added with a `large: true` flag that loosens to 3:1.
 *
 * The script owns the "color-contrast" axe rule's job (axe can't measure
 * it in jsdom). The pair list lives here — add a pair whenever a new
 * text/background combination lands in the design tokens.
 *
 * v1.3.1 hardening: the list grew from 12 to 15 pairs per theme (30 total),
 * covering the selected-row surface (--glass-bg-selected), the app canvas
 * (--backdrop-base) and the button hover states (danger → danger-text,
 * primary → primary-strong). A pair that resolves to anything other than a
 * hex literal now FAILS loudly: rgb()/rgba() tints (like --glass-bg-hover)
 * composite over an unknown base, so the script cannot measure them — such
 * a pair is a real coverage gap, never a silent pass.
 *
 * Usage:
 *   node scripts/check-contrast.mjs
 *
 * Exit codes: 0 = all pairs pass; 1 = at least one pair fails.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = resolve(__dirname, "..", "src", "design-tokens.css");

/* ---- tiny CSS value parser --------------------------------------------- */

/**
 * Parse a CSS file's :root and html.solid blocks into two maps of
 * `--token-name → value`. Only `--*` custom properties are captured; the
 * rest of the file is ignored. var() references in the values are NOT
 * resolved here — `resolveVar` does it on demand so the dark-theme block
 * can override only the tokens it actually changes.
 */
function parseTokens(css) {
  const blocks = { root: {}, solid: {} };
  const rootRe = /:root\s*\{([^}]*)\}/g;
  const solidRe = /html\.solid\s*\{([^}]*)\}/g;
  const propRe = /(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g;

  let m;
  while ((m = rootRe.exec(css)) !== null) {
    let pm;
    while ((pm = propRe.exec(m[1])) !== null) blocks.root[pm[1]] = pm[2].trim();
  }
  while ((m = solidRe.exec(css)) !== null) {
    let pm;
    while ((pm = propRe.exec(m[1])) !== null) blocks.solid[pm[1]] = pm[2].trim();
  }
  return blocks;
}

/**
 * Resolve a CSS value (like `var(--gray-200)` or `#FFFFFF` or
 * `var(--color-primary)`) against a token map, recursively. Returns the
 * hex literal it resolves to, or throws if it can't. v1.3.1: only hex
 * literals are accepted as final values — rgb()/rgba()/named colors fail
 * loudly (see the header comment for why).
 */
function resolveVar(value, tokens, seen = new Set()) {
  if (seen.has(value)) throw new Error(`circular reference: ${value}`);
  seen.add(value);
  const v = value.trim();
  // Direct hex literal — the only final value the math below understands.
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
  // var(--name, fallback?)
  const varMatch = v.match(/^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^)]+))?\)$/);
  if (varMatch) {
    const [, name, fallback] = varMatch;
    const next = tokens[name] ?? fallback;
    if (!next) throw new Error(`unresolved: ${name}`);
    return resolveVar(next, tokens, seen);
  }
  // Anything else (rgb()/rgba() tints, transparent, none, named colors)
  // cannot be measured — fail loudly instead of passing silently.
  throw new Error(`non-hex value: ${value}`);
}

/* ---- color math --------------------------------------------------------- */

function hexToRgb(hex) {
  let h = hex.replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 4) h = h.slice(1); // strip alpha for #RRGGBBAA-style 4-char
  if (h.length === 8) h = h.slice(0, 6); // ignore alpha channel for contrast
  const n = parseInt(h, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function parseColor(raw) {
  if (raw.startsWith("#")) return hexToRgb(raw);
  const rgb = raw.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) return [parseInt(rgb[1], 10), parseInt(rgb[2], 10), parseInt(rgb[3], 10)];
  throw new Error(`unparseable color: ${raw}`);
}

/** WCAG relative luminance. */
function luminance([r, g, b]) {
  const lin = ([x]) => x / 255;
  const trans = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * trans(r) + 0.7152 * trans(g) + 0.0722 * trans(b);
  void lin;
}

/** WCAG contrast ratio — always ≥ 1. */
function contrast(fg, bg) {
  const L1 = luminance(fg);
  const L2 = luminance(bg);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}

/* ---- pair list & runner ------------------------------------------------- */

/**
 * The pairs the app actually uses — 15 per theme (30 total, v1.3.1).
 * Surfaces: panels (--glass-bg), selected rows (--glass-bg-selected), the
 * canvas (--backdrop-base), primary buttons normal + hover, danger buttons
 * normal + hover. Add a pair whenever a new text/background combination
 * lands in the design tokens. `large: true` loosens the threshold from
 * 4.5:1 to 3:1 (WCAG AA large-text definition: ≥24px regular, or ≥18.66px
 * bold). Clavis body text is at most --text-lg (16px), so every pair is
 * treated as normal text by default.
 */
const PAIRS = [
  // Light theme
  { theme: "root",  fg: "--text",                  bg: "--glass-bg",          label: "text on panel (light)" },
  { theme: "root",  fg: "--text-muted",            bg: "--glass-bg",          label: "muted text on panel (light)" },
  { theme: "root",  fg: "--text-on-primary",       bg: "--color-primary",     label: "button text on primary (light)" },
  { theme: "root",  fg: "--color-danger-text",     bg: "--glass-bg",          label: "danger text on panel (light)" },
  { theme: "root",  fg: "--color-warning-text",    bg: "--glass-bg",          label: "warning text on panel (light)" },
  { theme: "root",  fg: "--color-success-text",    bg: "--glass-bg",          label: "success text on panel (light)" },
  { theme: "root",  fg: "--text",                  bg: "--glass-bg-selected", label: "text on selected row (light)" },
  { theme: "root",  fg: "--text-muted",            bg: "--glass-bg-selected", label: "muted text on selected row (light)" },
  { theme: "root",  fg: "--color-accent-text",     bg: "--glass-bg-selected", label: "accent text on selected row (light)" },
  { theme: "root",  fg: "--text",                  bg: "--backdrop-base",     label: "text on canvas (light)" },
  { theme: "root",  fg: "--text-muted",            bg: "--backdrop-base",     label: "muted text on canvas (light)" },
  { theme: "root",  fg: "--color-accent-text",     bg: "--backdrop-base",     label: "accent text on canvas (light)" },
  { theme: "root",  fg: "--text-on-primary",       bg: "--color-danger-fill",  label: "danger button text (light)" },
  { theme: "root",  fg: "--text-on-primary",       bg: "--color-danger-text",  label: "danger button text, hover (light)" },
  { theme: "root",  fg: "--text-on-primary",       bg: "--color-primary-strong", label: "button text on primary, hover (light)" },
  // Dark theme
  { theme: "solid", fg: "--text",                  bg: "--glass-bg",          label: "text on panel (dark)" },
  { theme: "solid", fg: "--text-muted",            bg: "--glass-bg",          label: "muted text on panel (dark)" },
  { theme: "solid", fg: "--text-on-primary",       bg: "--color-primary",     label: "button text on primary (dark)" },
  { theme: "solid", fg: "--color-danger-text",    bg: "--glass-bg",          label: "danger text on panel (dark)" },
  { theme: "solid", fg: "--color-warning-text",   bg: "--glass-bg",          label: "warning text on panel (dark)" },
  { theme: "solid", fg: "--color-success-text",   bg: "--glass-bg",          label: "success text on panel (dark)" },
  { theme: "solid", fg: "--text",                  bg: "--glass-bg-selected", label: "text on selected row (dark)" },
  { theme: "solid", fg: "--text-muted",            bg: "--glass-bg-selected", label: "muted text on selected row (dark)" },
  { theme: "solid", fg: "--color-accent-text",     bg: "--glass-bg-selected", label: "accent text on selected row (dark)" },
  { theme: "solid", fg: "--text",                  bg: "--backdrop-base",     label: "text on canvas (dark)" },
  { theme: "solid", fg: "--text-muted",            bg: "--backdrop-base",     label: "muted text on canvas (dark)" },
  { theme: "solid", fg: "--color-accent-text",     bg: "--backdrop-base",     label: "accent text on canvas (dark)" },
  { theme: "solid", fg: "--text-on-primary",       bg: "--color-danger-fill",  label: "danger button text (dark)" },
  { theme: "solid", fg: "--text-on-primary",       bg: "--color-danger-text",  label: "danger button text, hover (dark)" },
  { theme: "solid", fg: "--text-on-primary",       bg: "--color-primary-strong", label: "button text on primary, hover (dark)" },
];

function main() {
  const css = readFileSync(TOKENS_PATH, "utf-8");
  const blocks = parseTokens(css);
  let failed = 0;
  const rows = [];
  for (const p of PAIRS) {
    const tokens = blocks[p.theme] ?? {};
    let fgRaw, bgRaw;
    try {
      fgRaw = resolveVar(tokens[p.fg] ?? p.fg, tokens);
      bgRaw = resolveVar(tokens[p.bg] ?? p.bg, tokens);
    } catch (e) {
      rows.push({ ...p, ratio: null, ok: false, note: `resolve error: ${e.message}` });
      failed++;
      continue;
    }
    let ratio;
    try {
      ratio = contrast(parseColor(fgRaw), parseColor(bgRaw));
    } catch (e) {
      rows.push({ ...p, ratio: null, ok: false, note: `parse error: ${e.message}` });
      failed++;
      continue;
    }
    const threshold = p.large ? 3.0 : 4.5;
    const ok = ratio >= threshold;
    if (!ok) failed++;
    rows.push({ ...p, fgRaw, bgRaw, ratio, ok, threshold });
  }

  /* Pretty-print the report. */
  const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
  console.log("contrast pairs — WCAG AA (≥4.5:1 normal, ≥3:1 large)\n");
  console.log(
    pad("theme", 6) +
    pad("label", 38) +
    pad("fg", 14) +
    pad("bg", 14) +
    pad("ratio", 8) +
    pad("min", 6) +
    "result"
  );
  console.log("-".repeat(94));
  for (const r of rows) {
    const ratioStr = r.ratio != null ? r.ratio.toFixed(2) + ":1" : "?";
    console.log(
      pad(r.theme, 6) +
      pad(r.label, 38) +
      pad(r.fgRaw ?? "-", 14) +
      pad(r.bgRaw ?? "-", 14) +
      pad(ratioStr, 8) +
      pad(r.threshold?.toFixed(1) ?? "-", 6) +
      (r.ok ? "OK" : (r.note ?? "FAIL"))
    );
  }

  if (failed > 0) {
    console.log(`\nFAIL: ${failed} pair${failed === 1 ? "" : "s"} below AA.`);
    process.exit(1);
  }
  console.log(`\nOK: all ${rows.length} pair${rows.length === 1 ? "" : "s"} meet WCAG AA.`);
}

main();
