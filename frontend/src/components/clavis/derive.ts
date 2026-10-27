/**
 * CLAVIS — client-side derivations from the state snapshot
 * (live entries, shared markers, tags, masked previews).
 */
import { autoKey, dedupeKeys } from "@/lib/clavis/dotenv";
import type { Group, Item, VaultData } from "@/lib/clavis/types";

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
