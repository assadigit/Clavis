/**
 * CLAVIS — client-side derivations from the state snapshot
 * (live entries, shared markers, tags, masked previews).
 */
import { autoKey, dedupeKeys } from "@/lib/clavis/dotenv";
import type { Category, Group, Item, VaultData } from "@/lib/clavis/types";

export function liveItems(data: VaultData): Item[] {
  return data.items.filter((i) => i.deletedAt === null);
}

export function liveGroups(data: VaultData): Group[] {
  return data.groups.filter((g) => g.deletedAt === null);
}

export interface DeletedEntry {
  kind: "item" | "group";
  id: string;
  name: string;
  deletedAt: string;
  isSecret: boolean;
  key: string;
}

export function deletedEntries(data: VaultData): DeletedEntry[] {
  const out: DeletedEntry[] = [];
  for (const i of data.items) {
    if (i.deletedAt) {
      out.push({ kind: "item", id: i.id, name: i.name, deletedAt: i.deletedAt, isSecret: i.isSecret, key: i.key });
    }
  }
  for (const g of data.groups) {
    if (g.deletedAt) {
      out.push({ kind: "group", id: g.id, name: g.name, deletedAt: g.deletedAt, isSecret: false, key: "" });
    }
  }
  out.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
  return out;
}

/** Live groups that reference the item (shared markers, "Used in" list). */
export function groupsContaining(data: VaultData, itemId: string): Group[] {
  return liveGroups(data).filter((g) => g.itemIds.includes(itemId));
}

/** itemId → number of live groups referencing it. */
export function sharedCountMap(data: VaultData): Map<string, number> {
  const map = new Map<string, number>();
  for (const g of liveGroups(data)) {
    for (const id of g.itemIds) {
      map.set(id, (map.get(id) ?? 0) + 1);
    }
  }
  return map;
}

/** itemId → the live item (or null). */
export function itemById(data: VaultData, id: string): Item | null {
  return data.items.find((i) => i.id === id && i.deletedAt === null) ?? null;
}

/** groupId → the live group (or null). */
export function groupById(data: VaultData, id: string): Group | null {
  return data.groups.find((g) => g.id === id && g.deletedAt === null) ?? null;
}

/** All distinct tags on live entries, case-insensitively unique, sorted. */
export function allTags(data: VaultData): string[] {
  const seen = new Map<string, string>();
  for (const i of liveItems(data)) {
    for (const t of i.tags) seen.set(t.toLowerCase(), t);
  }
  for (const g of liveGroups(data)) {
    for (const t of g.tags) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export function categoryName(data: VaultData, categoryId: string | null): string {
  if (!categoryId) return "";
  return data.categories.find((c) => c.id === categoryId)?.name ?? "";
}

export function categoryCounts(data: VaultData): Map<string, number> {
  const map = new Map<string, number>();
  for (const i of liveItems(data)) {
    if (i.categoryId) map.set(i.categoryId, (map.get(i.categoryId) ?? 0) + 1);
  }
  for (const g of liveGroups(data)) {
    if (g.categoryId) map.set(g.categoryId, (map.get(g.categoryId) ?? 0) + 1);
  }
  return map;
}

export function tagCounts(data: VaultData): Map<string, number> {
  const map = new Map<string, number>();
  const bump = (t: string) => map.set(t.toLowerCase(), (map.get(t.toLowerCase()) ?? 0) + 1);
  for (const i of liveItems(data)) i.tags.forEach(bump);
  for (const g of liveGroups(data)) g.tags.forEach(bump);
  return map;
}

/* ── Hierarchical categories (v1.4.0, DECISIONS.md §41) ────────────────── */

/** One node of the sidebar category tree. */
export interface CatNode {
  cat: Category;
  /** 0 = top level. */
  depth: number;
  children: CatNode[];
}

/**
 * Nested category tree sorted by (sortOrder, name). Parent references that
 * dangle or self-loop fall back to top level defensively — the Go backend
 * already repairs those on load; this is the belt to its suspenders.
 */
export function categoryTree(data: VaultData): CatNode[] {
  const known = new Set(data.categories.map((c) => c.id));
  const byParent = new Map<string, Category[]>();
  const sorted = [...data.categories].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
  );
  for (const c of sorted) {
    const key = c.parentId && known.has(c.parentId) && c.parentId !== c.id ? c.parentId : "";
    const list = byParent.get(key);
    if (list) list.push(c);
    else byParent.set(key, [c]);
  }
  const build = (key: string, depth: number): CatNode[] =>
    (byParent.get(key) ?? []).map((cat) => ({ cat, depth, children: build(cat.id, depth + 1) }));
  return build("", 0);
}

/** A category plus all of its descendants (used to filter the entry list). */
export function categorySubtreeIds(data: VaultData, id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of data.categories) {
      if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
        out.add(c.id);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * Live-entry count per category INCLUDING all descendants — the number the
 * sidebar tree shows. An entry bumps its own category and every ancestor.
 */
export function subtreeCounts(data: VaultData): Map<string, number> {
  const parentOf = new Map<string, string>();
  for (const c of data.categories) {
    if (c.parentId) parentOf.set(c.id, c.parentId);
  }
  const out = new Map<string, number>();
  const bumpChain = (start: string | null) => {
    const seen = new Set<string>();
    let cur = start;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      out.set(cur, (out.get(cur) ?? 0) + 1);
      cur = parentOf.get(cur) ?? null;
    }
  };
  for (const i of liveItems(data)) bumpChain(i.categoryId);
  for (const g of liveGroups(data)) bumpChain(g.categoryId);
  return out;
}

/** "Projects / Hibana" — full path label for dropdowns and breadcrumbs. */
export function categoryPathLabel(categories: Category[], id: string): string {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const names: string[] = [];
  const seen = new Set<string>();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    names.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return names.join(" / ");
}

/**
 * Masked preview (SPEC §5.2): 8 dots; the last 4 characters are shown only
 * when showLast4 is on and the value is at least 12 characters long.
 */
export function maskValue(value: string, showLast4: boolean): string {
  if (showLast4 && value.length >= 12) return `••••••••${value.slice(-4)}`;
  return "••••••••";
}

/** Masked preview from the backend's redacted hint (valueLast4). The rule
 *  (showLast4, ≥ 12 chars) is applied by the backend — one source of truth. */
export function maskFromLast4(last4: string | undefined): string {
  return last4 ? `••••••••${last4}` : "••••••••";
}

/** Row preview (F-013, UI-audit round 1 Phase 7): secrets keep the masked
 *  dots; non-secret prompts/notes show nothing instead of lying dots —
 *  the row icon already distinguishes a note from a key. Values never cross
 *  the backend boundary, so rows have no text to preview (the redaction is
 *  deliberately untouched this round). */
export function rowPreview(item: {
  isSecret: boolean;
  valueLast4?: string;
}): string {
  return item.isSecret ? maskFromLast4(item.valueLast4) : "";
}

/** "category · tag1 · tag2" muted meta line used under entry names. */
export function metaLine(category: string, tags: string[]): string {
  const parts: string[] = [];
  if (category !== "") parts.push(category);
  if (tags.length > 0) parts.push(tags.join(", "));
  return parts.join(" · ");
}

/** The dotenv keys a group's members will use (autoKey + dedupe, §4.2). */
export function groupMemberKeys(group: Group, data: VaultData): { item: Item; key: string }[] {
  const members = group.itemIds
    .map((id) => itemById(data, id))
    .filter((i): i is Item => i !== null);
  const keys = dedupeKeys(members.map((i) => (i.key.trim() !== "" ? i.key : autoKey(i.name))));
  return members.map((item, idx) => ({ item, key: keys[idx] }));
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** True when a value is a plain http(s) URL (one token, no whitespace) —
 *  revealed values that match render as clickable links (§40 nice-to-have).
 *  Everything else (ftp:, javascript:, multi-line text) is deliberately NOT
 *  treated as a link. */
export function isHttpUrl(value: string): boolean {
  const v = value.trim();
  if (/[^!-~]/.test(v)) return false; // any whitespace/control char → not a link
  return /^https?:\/\/\S+$/i.test(v);
}
