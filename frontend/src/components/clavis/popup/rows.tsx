/**
 * CLAVIS — popup result rows (SPEC §3.3b): the listbox, section headers,
 * the copied-row feedback state and the empty states. Moved move-only from
 * popup.tsx in UI-audit round 1 Phase 11 (F-026); popup.tsx stays the
 * palette controller (state, search, keyboard, copy orchestration).
 *
 * v1.9.0 compact palette (DECISIONS.md §49): rows are SINGLE-LINE — name
 * and category/tags share one baseline, the masked preview stays on the
 * right — so the mini window reads like a launcher palette (ueli/PowerToys
 * Run) instead of a vault table. Row height 48 → 28, window 640 → 440.
 *
 * v1.11.0 (DECISIONS.md §51): the drill-down became a navigation STACK of
 * folders and groups — "I pin some folders, then they have hierarchical
 * and nested access": Prompts → Image generation → Artistic Picture
 * Prompt. Folder rows ride the default list only while pinned (see
 * homeEntries); typing finds every folder by name. Inside a folder view
 * the SUBFOLDERS list first (file-manager convention), then the groups
 * and standalone items filed directly in it; inside a group the classic
 * member list (§3.3b) is unchanged. The row builders are pure functions
 * (buildTopRows / buildLocationRows) so back() can compute the parent
 * view's exact rows and restore the selection onto the row you left.
 */
"use client";

import { Fragment, useMemo } from "react";
import { Check, ChevronRight, ClipboardCopy, Search } from "lucide-react";
import { compareEntries, compareRecent, homeEntries, searchEntries } from "@/lib/clavis/search";
import type { SearchEntry } from "@/lib/clavis/search";
import type { Group, Item, VaultData } from "@/lib/clavis/types";
import { groupById, groupMemberKeys, metaLine, rowPreview, subtreeCounts } from "../derive";
import { EntryTypeIcon, Ix } from "../icons";

/** How many rows the default (empty-query) list shows. */
export const RECENT_LIMIT = 10;

/**
 * One step of the drill-down path (v1.11.0, DECISIONS.md §51): a folder
 * (category) or a group. The palette keeps a stack of these — Enter/→
 * pushes, Esc/←/Backspace-on-empty pops, exactly like the old single-level
 * group drill, just recursive.
 */
export interface NavLoc {
  kind: "category" | "group";
  id: string;
}

/**
 * Build the top-level (search or recent+pinned) rows. Pure core of
 * useTopRows — back() also calls it directly with query "" so it can land
 * the selection on the exact rows the home view will show.
 */
export function buildTopRows(
  query: string,
  entries: SearchEntry[],
  itemMap: Map<string, Item>,
  groupMap: Map<string, Group>,
  catCounts: Map<string, number>
): PopupRow[] {
  /* v1.11.0 §51: the default list carries pinned folders; typing finds
   * every folder by name (unpinned folders stay out of the home pool). */
  const pool = query.trim() === "" ? homeEntries(entries) : entries;
  const results = searchEntries(query, pool);
  let list: SearchEntry[];
  if (query.trim() === "") {
    /* §5.1: the 10 most recently used/copied entries (items AND groups),
     * then pinned/most-used fill so the palette is never sparse. */
    const recent = results
      .filter((e) => e.lastUsedAt > 0)
      .sort(compareRecent)
      .slice(0, RECENT_LIMIT);
    const seen = new Set(recent.map((e) => `${e.kind}:${e.id}`));
    const fill = results
      .filter((e) => !seen.has(`${e.kind}:${e.id}`))
      .sort(compareEntries)
      .slice(0, Math.max(0, RECENT_LIMIT - recent.length));
    list = [...recent, ...fill];
  } else {
    list = results;
  }
  return list.map((e) => entryToRow(e, itemMap, groupMap, catCounts));
}

/** Map one search entry to its palette row (shared by the home list and the
 *  folder views — the group member list keeps its own key-bearing mapping). */
function entryToRow(
  e: SearchEntry,
  itemMap: Map<string, Item>,
  groupMap: Map<string, Group>,
  catCounts: Map<string, number>
): PopupRow {
  if (e.kind === "category") {
    /* A folder row: there is nothing to copy — Enter/→ drills into it.
     * The preview counts every entry in its subtree, like the sidebar. */
    return {
      kind: "category" as const,
      id: e.id,
      name: e.name,
      meta: "folder",
      isSecret: false,
      preview: `${catCounts.get(e.id) ?? 0} entries`,
    };
  }
  if (e.kind === "group") {
    const g = groupMap.get(e.id);
    if (g && g.mode === "document") {
      /* Whole-document groups carry a file, not members (§40). */
      const stats = `document · ${(g.docChars ?? 0).toLocaleString()} chars`;
      return { kind: "group" as const, id: e.id, name: e.name, meta: metaLine(e.categoryName, e.tags), isSecret: g.isSecret ?? false, preview: stats };
    }
    const count = g ? g.itemIds.filter((id) => itemMap.has(id)).length : 0;
    return { kind: "group" as const, id: e.id, name: e.name, meta: metaLine(e.categoryName, e.tags), isSecret: false, preview: `${count} items` };
  }
  const it = itemMap.get(e.id);
  return {
    kind: "item" as const,
    id: e.id,
    name: e.name,
    meta: metaLine(e.categoryName, e.tags),
    isSecret: it?.isSecret ?? false,
    preview: rowPreview({ isSecret: it?.isSecret ?? false, valueLast4: it?.valueLast4 }),
  };
}

/**
 * Build the rows of one drill-down location (v1.11.0 §51). A group view is
 * the classic member list (§3.3b, same search, the dotenv key as meta); a
 * folder view lists its SUBFOLDERS first — the file-manager convention:
 * you descend before you pick — then the groups and standalone items filed
 * directly in it. Pure core of useLocationRows; back() calls it directly
 * to restore the selection on the parent view.
 */
export function buildLocationRows(
  loc: NavLoc,
  query: string,
  entries: SearchEntry[],
  itemMap: Map<string, Item>,
  groupMap: Map<string, Group>,
  data: VaultData
): PopupRow[] {
  if (loc.kind === "group") {
    const drillGroup = groupById(data, loc.id);
    if (!drillGroup) return [];
    const memberEntries = entries.filter(
      (e) => e.kind === "item" && drillGroup.itemIds.includes(e.id)
    );
    const results = searchEntries(query, memberEntries);
    const keyed = groupMemberKeys(drillGroup, data);
    const keyById = new Map(keyed.map((m) => [m.item.id, m.key]));
    return results.map((e) => {
      const it = itemMap.get(e.id);
      return {
        kind: "item" as const,
        id: e.id,
        name: e.name,
        meta: keyById.get(e.id) ?? it?.key ?? "",
        isSecret: it?.isSecret ?? false,
        preview: rowPreview({ isSecret: it?.isSecret ?? false, valueLast4: it?.valueLast4 }),
      };
    });
  }
  /* Folder view: what lives directly inside this folder. */
  const inside = entries.filter((e) => {
    if (e.kind === "category") return e.parentId === loc.id;
    if (e.kind === "group") return groupMap.get(e.id)?.categoryId === loc.id;
    const it = itemMap.get(e.id);
    return it !== undefined && it.categoryId === loc.id;
  });
  const results = searchEntries(query, inside);
  /* Subfolders always first, search order preserved within each class. */
  const folders = results.filter((e) => e.kind === "category");
  const rest = results.filter((e) => e.kind !== "category");
  return [...folders, ...rest].map((e) => entryToRow(e, itemMap, groupMap, subtreeCounts(data)));
}

export function useTopRows(
  query: string,
  entries: SearchEntry[],
  itemMap: Map<string, Item>,
  groupMap: Map<string, Group>,
  catCounts: Map<string, number>
): PopupRow[] {
  return useMemo(
    () => buildTopRows(query, entries, itemMap, groupMap, catCounts),
    [query, entries, itemMap, groupMap, catCounts]
  );
}

export function useLocationRows(
  loc: NavLoc | null,
  query: string,
  entries: SearchEntry[],
  itemMap: Map<string, Item>,
  groupMap: Map<string, Group>,
  data: VaultData
): PopupRow[] {
  return useMemo(
    () => (loc ? buildLocationRows(loc, query, entries, itemMap, groupMap, data) : []),
    [loc, query, entries, itemMap, groupMap, data]
  );
}

export interface PopupRow {
  kind: "item" | "group" | "category";
  id: string;
  name: string;
  meta: string;
  isSecret: boolean;
  preview: string;
}

/** The copy-feedback state shown in place of the copied row. */
export type CopiedState = { rowKey: string; label: string } | null;

export const rowKeyOf = (row: PopupRow) => `${row.kind}:${row.id}`;

export function PopupRows({
  rows,
  headers,
  selIdx,
  copied,
  noData,
  drilling,
  query,
  onHover,
  onActivate,
  onCreateItem,
}: {
  rows: PopupRow[];
  headers: Map<number, string>;
  selIdx: number;
  copied: CopiedState;
  noData: boolean;
  /** Inside a drill-down location (a group or a folder) — the empty state
   *  says "Nothing found." instead of offering to create. */
  drilling: boolean;
  query: string;
  onHover: (i: number) => void;
  onActivate: (i: number) => void;
  /** Open the Manager's new-item form (optionally prefilled with the query). */
  onCreateItem: (prefillName?: string) => void;
}) {
  const renderRow = (row: PopupRow, i: number) => {
    const key = rowKeyOf(row);
    const isCopied = copied?.rowKey === key;
    if (isCopied) {
      return (
        <div
          key={key}
          role="option"
          aria-selected="true"
          data-selected="true"
          className="glass-row flex items-center justify-center clavis-copied"
          style={{ gap: "var(--space-2)", padding: "var(--space-1) var(--space-2)", minHeight: "var(--clavis-row-h)" }}
        >
          <Ix icon={Check} size="sm" />
          <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-medium)" }}>{copied?.label}</span>
        </div>
      );
    }
    return (
      <div
        key={key}
        id={`clavis-pop-row-${i}`}
        role="option"
        aria-selected={i === selIdx}
        data-selected={i === selIdx ? "true" : "false"}
        className="glass-row flex cursor-pointer items-center"
        style={{ gap: "var(--space-2)", padding: "var(--space-1) var(--space-2)", minHeight: "var(--clavis-row-h)" }}
        onMouseEnter={() => onHover(i)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onActivate(i)}
      >
        <EntryTypeIcon kind={row.kind} isSecret={row.isSecret} size="sm" />
        {/* v1.9.0: name + meta on ONE baseline (was a two-line stack) — the
            meta shrinks after the name, the preview stays right-aligned. */}
        <span className="flex min-w-0 flex-1 items-baseline" style={{ gap: "var(--space-2)" }}>
          <span
            className="truncate"
            style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)", flex: "0 1 auto", minWidth: 0 }}
          >
            {row.name}
          </span>
          {row.meta !== "" ? (
            <span className="truncate t-muted" style={{ fontSize: "var(--text-xs)", flex: "0 1 auto", minWidth: 0 }}>
              {row.meta}
            </span>
          ) : null}
        </span>
        <span
          className="t-mono t-muted truncate"
          dir="auto"
          style={{ fontSize: "var(--text-xs)", maxWidth: "calc(var(--space-6) * 5)" }}
        >
          {row.preview}
        </span>
        {/* Folders drill instead of copying (v1.11.0 §51) — the glyph says
            which: chevron for folders, clipboard for everything else. */}
        {row.kind === "category" ? (
          <Ix icon={ChevronRight} size="sm" style={{ color: i === selIdx ? "var(--color-accent-text)" : "var(--text-muted)" }} />
        ) : (
          <Ix
            icon={ClipboardCopy}
            size="sm"
            style={{ color: i === selIdx ? "var(--color-accent-text)" : "var(--text-muted)" }}
          />
        )}
      </div>
    );
  };

  return (
    <div
      id="clavis-popup-list"
      role="listbox"
      aria-label="Results"
      className="clavis-popup-rows clavis-scroll flex flex-col"
      style={{ gap: 0, padding: "0 var(--space-2) calc(var(--space-1) / 2)" }}
    >
      {rows.map((row, i) => (
        <Fragment key={rowKeyOf(row)}>
          {headers.get(i) ? (
            <div className="clavis-pop-header" role="presentation">
              {headers.get(i)}
            </div>
          ) : null}
          {renderRow(row, i)}
        </Fragment>
      ))}
      {rows.length === 0 ? (
        noData ? (
          <button
            type="button"
            className="glass-row flex items-center"
            style={{ gap: "var(--space-2)", padding: "var(--space-1) var(--space-2)", minHeight: "var(--clavis-row-h)", cursor: "pointer" }}
            onClick={() => onCreateItem()}
          >
            <Ix icon={Search} size="sm" style={{ color: "var(--color-accent-text)" }} />
            <span className="t-muted" style={{ fontSize: "var(--text-sm)" }}>
              Nothing here yet. Press Ctrl+N to add your first item.
            </span>
          </button>
        ) : drilling ? (
          <div className="flex items-center" style={{ gap: "var(--space-2)", padding: "var(--space-1) var(--space-2)", minHeight: "var(--clavis-row-h)" }}>
            <Ix icon={Search} size="sm" />
            <span className="t-muted" style={{ fontSize: "var(--text-sm)" }}>
              Nothing found.
            </span>
          </div>
        ) : (
          <button
            type="button"
            className="glass-row flex items-center"
            style={{ gap: "var(--space-2)", padding: "var(--space-1) var(--space-2)", minHeight: "var(--clavis-row-h)", cursor: "pointer" }}
            onClick={() => onCreateItem(query.trim())}
          >
            <Ix icon={Search} size="sm" style={{ color: "var(--color-accent-text)" }} />
            <span className="t-muted" style={{ fontSize: "var(--text-sm)" }}>
              Nothing found. Press Enter to create “{query.trim()}”.
            </span>
          </button>
        )
      ) : null}
    </div>
  );
}
