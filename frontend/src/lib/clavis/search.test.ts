/**
 * CLAVIS — search & ranking tests (SPEC §5.1), the documented algorithm.
 */
import { describe, expect, it } from "vitest";
import {
  buildSearchEntries,
  compareEntries,
  compareRecent,
  parseQuery,
  searchEntries,
} from "./search";
import type { VaultData } from "./types";

function vault(): VaultData {
  return {
    schemaVersion: 1,
    appVersion: "test",
    encryption: { enabled: false },
    settings: {
      shortcut: "Ctrl+Shift+Space",
      startWithWindows: false,
      solidMode: false,
      glassIntensity: 100,
      showLast4: true,
      managerBounds: null,
    },
    categories: [
      { id: "c1", name: "Credentials", sortOrder: 0 },
      { id: "c2", name: "Prompts", sortOrder: 1 },
    ],
    items: [
      {
        id: "i1", name: "GitHub token", key: "GITHUB_TOKEN", value: "", note: "",
        categoryId: "c1", tags: ["github", "ci"], isSecret: true, pinned: false,
        useCount: 3, lastUsedAt: "2025-01-02T00:00:00.000Z",
        createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
      },
      {
        id: "i2", name: "Grafana token", key: "", value: "", note: "graf",
        categoryId: "c1", tags: [], isSecret: true, pinned: true,
        useCount: 1, lastUsedAt: null,
        createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
      },
      {
        id: "i3", name: "Standup prompt", key: "", value: "", note: "",
        categoryId: "c2", tags: ["work"], isSecret: false, pinned: false,
        useCount: 9, lastUsedAt: "2025-01-05T00:00:00.000Z",
        createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
      },
      {
        id: "i4", name: "Deleted thing", key: "", value: "", note: "",
        categoryId: null, tags: [], isSecret: false, pinned: false,
        useCount: 0, lastUsedAt: null,
        createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z",
        deletedAt: "2025-01-03T00:00:00.000Z", // soft-deleted: never searchable
      },
    ],
    groups: [
      {
        id: "g1", name: "Sedanama credentials", categoryId: "c1", tags: ["sedanama"],
        itemIds: ["i1"], pinned: false, useCount: 2, lastUsedAt: "2025-01-04T00:00:00.000Z",
        createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
      },
    ],
  };
}

const entries = () => buildSearchEntries(vault());

describe("parseQuery", () => {
  it("splits words, #tags and @categories", () => {
    expect(parseQuery("ghtk #prod @cred")).toEqual({
      words: ["ghtk"],
      tags: ["prod"],
      cats: ["cred"],
    });
  });

  it("treats bare # and @ as words", () => {
    expect(parseQuery("# @ x")).toEqual({ words: ["#", "@", "x"], tags: [], cats: [] });
  });
});

describe("searchEntries", () => {
  it("finds the spec example: ghtk → GitHub token", () => {
    const got = searchEntries("ghtk", entries());
    expect(got[0]?.name).toBe("GitHub token");
  });

  it("ranks exact name above everything else", () => {
    const got = searchEntries("GitHub token", entries());
    expect(got[0]?.id).toBe("i1"); // exact name = top tier
  });

  it("same tier: pinned first, then useCount", () => {
    // "token" is a fuzzy match on both names (tier 1); Grafana is pinned.
    const got = searchEntries("token", entries());
    expect(got.map((e) => e.id)).toEqual(["i2", "i1"]);
  });

  it("matches name, key, note, category and tags (AND across words)", () => {
    expect(searchEntries("github ci", entries())[0]?.id).toBe("i1"); // name + tag
    expect(searchEntries("GITHUB_TOKEN", entries())[0]?.id).toBe("i1"); // key
    expect(searchEntries("graf", entries()).map((e) => e.id)).toContain("i2"); // note
    expect(searchEntries("@prompts", entries()).map((e) => e.id)).toEqual(["i3"]);
    expect(searchEntries("#sedanama", entries()).map((e) => e.id)).toEqual(["g1"]);
  });

  it("never returns soft-deleted entries", () => {
    expect(searchEntries("deleted", entries())).toHaveLength(0);
    expect(entries().map((e) => e.id)).not.toContain("i4");
  });

  it("empty query: pinned first, then most-used", () => {
    const got = searchEntries("", entries());
    expect(got[0]?.id).toBe("i2"); // pinned beats useCount
    expect(got[1]?.id).toBe("i3"); // useCount 9
  });

  it("never matches values — they are not part of the index", () => {
    // (values are redacted to "" in state anyway; the index never sees them)
    const all = searchEntries("", entries());
    for (const e of all) {
      expect((e as unknown as { value?: string }).value).toBeUndefined();
    }
  });

  it("unicode: subsequence over Farsi names", () => {
    const v = vault();
    v.items.push({
      ...v.items[0], id: "i5", name: "توکن گیت‌هاب", key: "", note: "", tags: [],
      pinned: false, useCount: 0, lastUsedAt: null,
    });
    const got = searchEntries("توگ", buildSearchEntries(v));
    expect(got.map((e) => e.id)).toEqual(["i5"]);
  });
});

describe("compareRecent", () => {
  it("orders by most recent use first", () => {
    const es = entries();
    const recent = es.filter((e) => e.lastUsedAt > 0).sort(compareRecent);
    expect(recent.map((e) => e.id)).toEqual(["i3", "g1", "i1"]); // Jan 5 > Jan 4 > Jan 2
  });
});

describe("compareEntries", () => {
  it("pinned beats useCount beats recency, name as final tiebreak", () => {
    const a = { ...entries()[0], pinned: false, useCount: 5, lastUsedAt: 100 };
    const b = { ...entries()[0], pinned: true, useCount: 0, lastUsedAt: 0 };
    expect(compareEntries(a, b)).toBeGreaterThan(0); // b first
  });
});
