/**
 * CLAVIS — one voice for clipboard/export feedback (UI-audit round 1,
 * Phase 7; F-012). Same event, same words everywhere: popup, list rows,
 * both editors and the export toasts. Toast sentences always end with a
 * period; the in-row copy glyph is a label, not a sentence.
 */
export const messages = {
  /* ---- toasts (sentences — end with ".") ---- */
  copied: "Copied.",
  copiedLines: (n: number) => `Copied ${n} ${n === 1 ? "line" : "lines"}.`,
  copiedEntry: (name: string) => `Copied ${name}.`,
  copiedEntryLines: (name: string, n: number) => `Copied ${n} ${n === 1 ? "line" : "lines"} — ${name}.`,
  copyFailed: "Could not copy that value. Try again.",
  /** Shown after copying something that contains a secret. */
  copiedSecretNote: "Copied — kept out of clipboard history.",
  exportSaved: (path: string) => `Saved: ${path}`,
  exportFailed: "The export was not saved.",

  /* ---- in-row copy glyph (a label, not a sentence) ---- */
  copiedLabel: "Copied",
  copiedLabelLines: (n: number) => `Copied ${n} ${n === 1 ? "line" : "lines"}`,
} as const;
