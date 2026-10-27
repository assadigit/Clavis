/**
 * CLAVIS — derivation tests: masked previews (SPEC §5.2), group member keys.
 */
import { describe, expect, it } from "vitest";
import { groupMemberKeys, maskFromLast4, maskValue, metaLine, rowPreview } from "./derive";
import type { Group, Item, VaultData } from "@/lib/clavis/types";

function item(partial: Partial<Item>): Item {
  return {
    id: "x", name: "Item", key: "", value: "", note: "", categoryId: null, tags: [],
    isSecret: false, pinned: false, useCount: 0, lastUsedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z",
    deletedAt: null, ...partial,
  };
}

describe("maskFromLast4 (backend-computed hint)", () => {
  it("shows dots plus the hint when present", () => {
    expect(maskFromLast4("abcd")).toBe("••••••••abcd");
    expect(maskFromLast4("")).toBe("••••••••");
    expect(maskFromLast4(undefined)).toBe("••••••••");
  });
});

describe("rowPreview (F-013: non-secrets get no lying dots)", () => {
  it("secrets keep the masked dots + last-4 hint", () => {
    expect(rowPreview({ isSecret: true, valueLast4: "ef90" })).toBe("••••••••ef90");
    expect(rowPreview({ isSecret: true, valueLast4: undefined })).toBe("••••••••");
  });

  it("non-secret prompts/notes show nothing instead of dots", () => {
    expect(rowPreview({ isSecret: false, valueLast4: "" })).toBe("");
    expect(rowPreview({ isSecret: false, valueLast4: undefined })).toBe("");
  });
});

describe("maskValue (editor-local rule, mirrors the backend)", () => {
  it("masks everything for short values even when showLast4 is on", () => {
    expect(maskValue("short", true)).toBe("••••••••");
  });

  it("shows last 4 only at 12+ characters", () => {
    expect(maskValue("abcdefghijkl", true)).toBe("••••••••ijkl");
    expect(maskValue("abcdefghijkl", false)).toBe("••••••••");
  });
});

describe("metaLine", () => {
  it("joins category and tags with ·", () => {
    expect(metaLine("Credentials", ["github", "ci"])).toBe("Credentials · github, ci");
    expect(metaLine("", [])).toBe("");
  });
});

describe("groupMemberKeys", () => {
  it("derives dotenv keys (autoKey + dedupe) in group order", () => {
    const items = [
      item({ id: "a", name: "GitHub token" }), // auto → GITHUB_TOKEN
      item({ id: "b", name: "DB", key: "GITHUB_TOKEN" }), // explicit clash → _2
    ];
    const data: VaultData = {
      schemaVersion: 1, appVersion: "t", encryption: { enabled: false },
      settings: {
        shortcut: "Ctrl+Shift+Space", startWithWindows: false, solidMode: false,
        glassIntensity: 100, showLast4: true, managerBounds: null,
      },
      categories: [], items, groups: [],
    };
    const group: Group = {
      id: "g", name: "G", categoryId: null, tags: [], itemIds: ["a", "b"],
      pinned: false, useCount: 0, lastUsedAt: null,
      createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z",
      deletedAt: null,
    };
    const keyed = groupMemberKeys(group, data);
    expect(keyed.map((m) => m.key)).toEqual(["GITHUB_TOKEN", "GITHUB_TOKEN_2"]);
    expect(keyed.map((m) => m.item.id)).toEqual(["a", "b"]);
  });
});
