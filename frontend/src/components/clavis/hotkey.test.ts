/**
 * CLAVIS — shortcut capture rules tests (SPEC §3.3, §5.9).
 */
import { describe, expect, it } from "vitest";
import {
  displayKey,
  isBrowserReservedShortcut,
  matchesShortcut,
  parseShortcut,
} from "./hotkey";

describe("parseShortcut", () => {
  it("parses the default combo", () => {
    expect(parseShortcut("Ctrl+Shift+Space")).toEqual({
      ctrl: true, alt: false, shift: true, meta: false, key: "space",
    });
  });

  it("lowercases and tolerates spaces", () => {
    expect(parseShortcut(" ctrl + K ").key).toBe("k");
  });

  it("null for nothing", () => {
    expect(parseShortcut("")).toBeNull();
    expect(parseShortcut("++")).toBeNull();
  });
});

describe("matchesShortcut", () => {
  const parsed = parseShortcut("Ctrl+Shift+Space")!;
  it("matches exactly, including the space key", () => {
    expect(
      matchesShortcut(
        { key: " ", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, preventDefault: () => {} },
        parsed,
      ),
    ).toBe(true);
  });

  it("rejects extra modifiers", () => {
    expect(
      matchesShortcut(
        { key: " ", ctrlKey: true, shiftKey: true, altKey: true, metaKey: false, preventDefault: () => {} },
        parsed,
      ),
    ).toBe(false);
  });
});

describe("isBrowserReservedShortcut", () => {
  it("blocks OS/meta combos, plain function keys, and browser letters", () => {
    expect(isBrowserReservedShortcut(["Meta"], "K")).toBe(true);
    expect(isBrowserReservedShortcut([], "F5")).toBe(true);
    expect(isBrowserReservedShortcut(["Ctrl"], "T")).toBe(true); // new tab
    expect(isBrowserReservedShortcut(["Ctrl", "Shift"], "N")).toBe(true); // incognito
  });

  it("allows the Clavis default and ordinary combos", () => {
    expect(isBrowserReservedShortcut(["Ctrl", "Shift"], "Space")).toBe(false);
    expect(isBrowserReservedShortcut(["Alt"], "Q")).toBe(false);
  });
});

describe("displayKey", () => {
  it("renders space, letters and arrows", () => {
    expect(displayKey({ key: " ", preventDefault: () => {} } as never)).toBe("Space");
    expect(displayKey({ key: "a", preventDefault: () => {} } as never)).toBe("A");
    expect(displayKey({ key: "ArrowUp", preventDefault: () => {} } as never)).toBe("Up");
  });
});
