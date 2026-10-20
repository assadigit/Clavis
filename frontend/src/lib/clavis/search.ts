/**
 * CLAVIS — search & ranking (SPEC §5.1).
 *
 * THE documented algorithm (frontend-side, runs on an in-memory snapshot):
 *
 * 1. The query is split on whitespace into tokens. A token starting with
 *    "#" restricts to entries whose tags match (case-insensitive); a token
 *    starting with "@" restricts to a category name; any other token is a
 *    plain word. ALL tokens must match (AND).
 * 2. A plain word matches when it is a case-insensitive PREFIX of, or a
 *    fuzzy SUBSEQUENCE of, any of: name, key, note, category name, tag.
 *    ("ghtk" finds "GitHub token".)
 * 3. Secret values are NEVER matched — they are not part of the index.
 * 4. Ranking: exact name match first, then name prefix, then anything
 *    else; within the same tier: pinned, then useCount, then lastUsedAt.
 * 5. Empty query: pinned first, then most-used (useCount, then
 *    lastUsedAt). The popup shows the first 8 rows.
 */

import type { VaultData } from "./types";

export interface SearchEntry {
  kind: "item" | "group";
  id: string;
  name: string;
  key: string; // "" for groups
  note: string; // "" for groups
  categoryName: string; // "" when no category
  tags: string[];
  pinned: boolean;
  useCount: number;
  lastUsedAt: number; // epoch ms; 0 when never used
}

export function buildSearchEntries(data: VaultData): SearchEntry[] {
  const catNames = new Map(data.categories.map((c) => [c.id, c.name]));
  const entries: SearchEntry[] = [];
  for (const it of data.items) {
    if (it.deletedAt) continue;
    entries.push({
      kind: "item",
      id: it.id,
      name: it.name,
      key: it.key,
      note: it.note,
      categoryName: it.categoryId ? catNames.get(it.categoryId) ?? "" : "",
      tags: it.tags,
      pinned: it.pinned,
      useCount: it.useCount,
      lastUsedAt: it.lastUsedAt ? Date.parse(it.lastUsedAt) || 0 : 0,
    });
  }
  for (const g of data.groups) {
    if (g.deletedAt) continue;
    entries.push({
      kind: "group",
      id: g.id,
      name: g.name,
      key: "",
      note: "",
      categoryName: g.categoryId ? catNames.get(g.categoryId) ?? "" : "",
      tags: g.tags,
      pinned: g.pinned,
      useCount: g.useCount,
      lastUsedAt: g.lastUsedAt ? Date.parse(g.lastUsedAt) || 0 : 0,
    });
  }
  return entries;
}

interface ParsedQuery {
  words: string[];
  tags: string[];
  cats: string[];
}

export function parseQuery(query: string): ParsedQuery {
  const words: string[] = [];
  const tags: string[] = [];
  const cats: string[] = [];
  for (const token of query.trim().split(/\s+/)) {
    if (token === "") continue;
    if (token.startsWith("#") && token.length > 1) {
      tags.push(token.slice(1).toLowerCase());
    } else if (token.startsWith("@") && token.length > 1) {
      cats.push(token.slice(1).toLowerCase());
    } else {
      words.push(token.toLowerCase());
    }
  }
  return { words, tags, cats };
}

function isSubsequence(word: string, field: string): boolean {
  let i = 0;
  for (const ch of field) {
    if (i < word.length && ch === word[i]) i++;
  }
  return i === word.length;
}

/** 0 = no match, 1 = fuzzy/other field, 2 = name prefix, 3 = exact name */
function wordTier(word: string, entry: SearchEntry): number {
  const name = entry.name.toLowerCase();
  if (name === word) return 3;
  if (name.startsWith(word)) return 2;
  const fields = [
    name,
    entry.key.toLowerCase(),
    entry.note.toLowerCase(),
    entry.categoryName.toLowerCase(),
    ...entry.tags.map((t) => t.toLowerCase()),
  ];
  for (const f of fields) {
    if (f.startsWith(word) || isSubsequence(word, f)) return 1;
  }
  return 0;
}

function compareEntries(a: SearchEntry, b: SearchEntry): number {
  if (b.pinned !== a.pinned) return b.pinned ? 1 : -1;
  if (b.useCount !== a.useCount) return b.useCount - a.useCount;
  if (b.lastUsedAt !== a.lastUsedAt) return b.lastUsedAt - a.lastUsedAt;
  return a.name.localeCompare(b.name);
}

/** Rank with tier first (3 > 2 > 1), then the shared comparator. */
function compareRanked(a: Tiered, b: Tiered): number {
  if (b.tier !== a.tier) return b.tier - a.tier;
  return compareEntries(a.entry, b.entry);
}

interface Tiered {
  tier: number;
  entry: SearchEntry;
}

export function searchEntries(
  query: string,
  entries: SearchEntry[]
): SearchEntry[] {
  const { words, tags, cats } = parseQuery(query);

  // Tag restrictions (#word)
  if (tags.length > 0) {
    entries = entries.filter((e) => {
      const et = e.tags.map((t) => t.toLowerCase());
      return tags.every((t) => et.some((x) => x.includes(t)));
    });
  }
  // Category restrictions (@word)
  if (cats.length > 0) {
    entries = entries.filter((e) => {
      const c = e.categoryName.toLowerCase();
      return cats.every((cat) => c.includes(cat));
    });
  }

  if (words.length === 0) {
    // Empty (or filter-only) query: pinned first, then most-used.
    return [...entries].sort(compareEntries);
  }

  const tiered: Tiered[] = [];
  for (const e of entries) {
    let tier = Infinity;
    let ok = true;
    for (const w of words) {
      const t = wordTier(w, e);
      if (t === 0) {
        ok = false;
        break;
      }
      tier = Math.min(tier, t);
    }
    if (ok) tiered.push({ tier, entry: e });
  }
  tiered.sort(compareRanked);
  return tiered.map((t) => t.entry);
}
