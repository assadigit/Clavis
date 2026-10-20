/** Structural keyboard event: native and React events both fit. */
export interface ClavisKeyboardEvent {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  preventDefault(): void;
}

/**
 * CLAVIS — shortcut parsing / matching / capture rules (SPEC §3.3, §5.9).
 * Web edition: the shortcut works while the Clavis tab is focused.
 */

export interface ParsedShortcut {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** normalized, lowercase: " " → "space" */
  key: string;
}

export function parseShortcut(shortcut: string): ParsedShortcut | null {
  const parts = shortcut
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const keyPart = parts[parts.length - 1].toLowerCase();
  const key = keyPart === "space" || keyPart === "" ? "space" : keyPart;
  return {
    ctrl: parts.some((p) => p.toLowerCase() === "ctrl"),
    alt: parts.some((p) => p.toLowerCase() === "alt"),
    shift: parts.some((p) => p.toLowerCase() === "shift"),
    meta: parts.some((p) => p.toLowerCase() === "meta" || p.toLowerCase() === "cmd"),
    key,
  };
}

export function matchesShortcut(e: ClavisKeyboardEvent, parsed: ParsedShortcut): boolean {
  const key = e.key === " " ? "space" : e.key.toLowerCase();
  return (
    e.ctrlKey === parsed.ctrl &&
    e.altKey === parsed.alt &&
    e.shiftKey === parsed.shift &&
    e.metaKey === parsed.meta &&
    key === parsed.key
  );
}

/** Normalize a KeyboardEvent key into display form (" " → "Space", "a" → "A"). */
export function displayKey(e: ClavisKeyboardEvent): string {
  if (e.key === " ") return "Space";
  if (e.key.length === 1) return e.key.toUpperCase();
  if (e.key.startsWith("Arrow")) return e.key.slice(5); /* ArrowUp → Up */
  return e.key;
}

export function activeModifiers(e: ClavisKeyboardEvent): string[] {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Meta");
  return mods;
}

/** True while the user is still holding only modifiers (composing a combo). */
export function isModifierKey(e: ClavisKeyboardEvent): boolean {
  return ["Control", "Shift", "Alt", "Meta"].includes(e.key);
}

/**
 * Combos the browser eats or that are dangerous to grab (SPEC §3.3 message):
 * "This shortcut is used by another app. Choose a different one."
 */
const RESERVED_LETTERS = new Set(
  ["w", "t", "n", "q", "l", "d", "j", "h", "o", "p", "s", "u", "e", "k", "m", "b", "f"]
);
const RESERVED_CTRL_SHIFT = new Set(["n", "t", "q", "w", "i", "j", "c", "m", "delete", "backspace"]);
const RESERVED_FUNCTION_KEYS = new Set(
  ["f1", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12"]
);

export function isBrowserReservedShortcut(
  mods: string[],
  key: string
): boolean {
  const lower = key.toLowerCase();
  const hasCtrl = mods.includes("Ctrl");
  const hasShift = mods.includes("Shift");
  const hasAlt = mods.includes("Alt");
  const hasMeta = mods.includes("Meta");
  // OS-level: any Meta combo is owned by the OS/shell in most environments.
  if (hasMeta) return true;
  // Plain function keys (reload, devtools, fullscreen…).
  if (RESERVED_FUNCTION_KEYS.has(lower) && !hasCtrl && !hasAlt) return true;
  // Ctrl+<letter> window/tab/omnibox management.
  if (hasCtrl && !hasAlt && !hasShift && RESERVED_LETTERS.has(lower)) return true;
  // Ctrl+Shift+<letter> tab/window/devtools management.
  if (hasCtrl && hasShift && !hasAlt && RESERVED_CTRL_SHIFT.has(lower)) return true;
  return false;
}
