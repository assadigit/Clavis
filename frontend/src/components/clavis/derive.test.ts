/**
 * CLAVIS — derivation tests: masked previews (SPEC §5.2), group member keys,
 * hierarchical-category tree derivations (v1.4.0, DECISIONS.md §41).
 */
import { describe, expect, it } from "vitest";
import { categoryPathLabel, categorySubtreeIds, categoryTree, groupMemberKeys, maskFromLast4, maskValue, metaLine, rowPreview, subtreeCounts } from "./derive";
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

function vaultWith(categories: VaultData["categories"], items: Item[]): VaultData {
  return {
    schemaVersion: 1, appVersion: "t", encryption: { enabled: false },
    settings: {
      shortcut: "Ctrl+Shift+Space", startWithWindows: false, solidMode: false,
      glassIntensity: 100, showLast4: true, managerBounds: null,
    },
    categories, items, groups: [],
  };
}

describe("categoryTree (v1.4.0 hierarchy)", () => {
  it("nests children under their parent and sets depth", () => {
    const data = vaultWith(
      [
        { id: "projects", name: "Projects", sortOrder: 0 },
        { id: "hibana", name: "Hibana", sortOrder: 1, parentId: "projects" },
        { id: "clavis", name: "Clavis", sortOrder: 2, parentId: "projects" },
        { id: "creds", name: "Credentials", sortOrder: 3 },
      ],
      [],
    );
    const tree = categoryTree(data);
    expect(tree.map((n) => n.cat.id)).toEqual(["projects", "creds"]);
    const projects = tree[0];
    expect(projects.depth).toBe(0);
    expect(projects.children.map((n) => n.cat.id)).toEqual(["hibana", "clavis"]);
    expect(projects.children[0].depth).toBe(1);
  });

  it("defends against dangling and self-referencing parents", () => {
    const data = vaultWith(
      [
        { id: "a", name: "A", sortOrder: 0 },
        { id: "ghost-child", name: "G", sortOrder: 1, parentId: "missing" },
        { id: "self", name: "S", sortOrder: 2, parentId: "self" },
      ],
      [],
    );
    const tree = categoryTree(data);
    // All three fall back to top level; nothing crashes, nothing lost.
    expect(tree.map((n) => n.cat.id).sort()).toEqual(["a", "ghost-child", "self"]);
  });
});

describe("categorySubtreeIds", () => {
  it("collects the category and all descendants", () => {
    const data = vaultWith(
      [
        { id: "p", name: "P", sortOrder: 0 },
        { id: "c1", name: "C1", sortOrder: 1, parentId: "p" },
        { id: "c2", name: "C2", sortOrder: 2, parentId: "c1" },
        { id: "other", name: "O", sortOrder: 3 },
      ],
      [],
    );
    expect([...categorySubtreeIds(data, "p")].sort()).toEqual(["c1", "c2", "p"]);
    expect([...categorySubtreeIds(data, "other")]).toEqual(["other"]);
  });
});

describe("subtreeCounts", () => {
  it("bumps the own category and every ancestor, once per live entry", () => {
    const data = vaultWith(
      [
        { id: "p", name: "P", sortOrder: 0 },
        { id: "c", name: "C", sortOrder: 1, parentId: "p" },
      ],
      [
        item({ id: "i1", name: "one", categoryId: "c" }),
        item({ id: "i2", name: "two", categoryId: "c" }),
        item({ id: "i3", name: "three", categoryId: "p" }),
        item({ id: "i4", name: "gone", categoryId: "c", deletedAt: "2025-01-02T00:00:00.000Z" }),
      ],
    );
    const counts = subtreeCounts(data);
    expect(counts.get("p")).toBe(3); // two in the child + one own (deleted excluded)
    expect(counts.get("c")).toBe(2);
  });
});

describe("categoryPathLabel", () => {
  it("joins ancestors with slashes", () => {
    const categories: VaultData["categories"] = [
      { id: "p", name: "Projects", sortOrder: 0 },
      { id: "c", name: "Hibana", sortOrder: 1, parentId: "p" },
    ];
    expect(categoryPathLabel(categories, "c")).toBe("Projects / Hibana");
    expect(categoryPathLabel(categories, "p")).toBe("Projects");
  });
});
