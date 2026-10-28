/**
 * CLAVIS — popup result rows (SPEC §3.3b): the listbox, section headers,
 * the copied-row feedback state and the empty states. Moved move-only from
 * popup.tsx in UI-audit round 1 Phase 11 (F-026); popup.tsx stays the
 * palette controller (state, search, keyboard, copy orchestration).
 */
"use client";

import { Fragment, useMemo } from "react";
import { Check, ClipboardCopy, Search } from "lucide-react";
import { compareEntries, compareRecent, searchEntries } from "@/lib/clavis/search";
import type { SearchEntry } from "@/lib/clavis/search";
import type { Group, Item, VaultData } from "@/lib/clavis/types";
import { groupMemberKeys, metaLine, rowPreview } from "../derive";
import { EntryTypeIcon, Ix } from "../icons";

/** How many rows the default (empty-query) list shows. */
export const RECENT_LIMIT = 10;

/** Build the top-level (search or recent+pinned) rows. Moved move-only
 * from popup.tsx in UI-audit round 1 Phase 11 (F-026). */
export function useTopRows(
  query: string,
  entries: SearchEntry[],
  itemMap: Map<string, Item>,
  groupMap: Map<string, Group>
): PopupRow[] {
  return useMemo(() => {
    const results = searchEntries(query, entries);
    let list: SearchEntry[];
    if (query.trim() === "") {
      /* §5.1: the 10 most recently used/copied entries (items AND groups),
         then pinned/most-used fill so the palette is never sparse. */
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
    return list.map((e) => {
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
    });
  }, [query, entries, itemMap, groupMap]);
}

/** Build the drill-down member rows (same search, group member order). */
export function useMemberRows(
  drillGroup: Group | null,
  query: string,
  entries: SearchEntry[],
  itemMap: Map<string, Item>,
  data: VaultData
): PopupRow[] {
  return useMemo(() => {
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
  }, [drillGroup, query, entries, itemMap, data]);
}

export interface PopupRow {
  kind: "item" | "group";
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
  inGroup,
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
  inGroup: boolean;
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
          style={{ gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", minHeight: "var(--clavis-row-h)" }}
        >
          <Ix icon={Check} size="md" />
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
        style={{ gap: "var(--space-3)", padding: "var(--space-2) var(--space-3)", minHeight: "var(--clavis-row-h)" }}
        onMouseEnter={() => onHover(i)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onActivate(i)}
      >
        <EntryTypeIcon kind={row.kind} isSecret={row.isSecret} size="md" />
        <span className="flex min-w-0 flex-1 flex-col" style={{ gap: "calc(var(--space-1) / 2)" }}>
          <span
            className="truncate"
            style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)" }}
          >
            {row.name}
          </span>
          {row.meta !== "" ? (
            <span className="truncate t-muted" style={{ fontSize: "var(--text-xs)" }}>
              {row.meta}
            </span>
          ) : null}
        </span>
        <span
          className="t-mono t-muted truncate"
          dir="auto"
          style={{ fontSize: "var(--text-xs)", maxWidth: "calc(var(--space-6) * 8)" }}
        >
          {row.preview}
        </span>
        <Ix
          icon={ClipboardCopy}
          size="sm"
          style={{ color: i === selIdx ? "var(--color-accent-text)" : "var(--text-muted)" }}
        />
      </div>
    );
  };

  return (
    <div
      id="clavis-popup-list"
      role="listbox"
      aria-label="Results"
      className="clavis-popup-rows clavis-scroll flex flex-col"
      style={{ gap: "var(--space-1)", padding: "0 var(--space-2) var(--space-2)" }}
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
            style={{ gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", minHeight: "var(--clavis-row-h)", cursor: "pointer" }}
            onClick={() => onCreateItem()}
          >
            <Ix icon={Search} size="md" style={{ color: "var(--color-accent-text)" }} />
            <span className="t-muted" style={{ fontSize: "var(--text-sm)" }}>
              Nothing here yet. Press Ctrl+N to add your first item.
            </span>
          </button>
        ) : inGroup ? (
          <div className="flex items-center" style={{ gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", minHeight: "var(--clavis-row-h)" }}>
            <Ix icon={Search} size="md" />
            <span className="t-muted" style={{ fontSize: "var(--text-sm)" }}>
              Nothing found.
            </span>
          </div>
        ) : (
          <button
            type="button"
            className="glass-row flex items-center"
            style={{ gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", minHeight: "var(--clavis-row-h)", cursor: "pointer" }}
            onClick={() => onCreateItem(query.trim())}
          >
            <Ix icon={Search} size="md" style={{ color: "var(--color-accent-text)" }} />
            <span className="t-muted" style={{ fontSize: "var(--text-sm)" }}>
              Nothing found. Press Enter to create “{query.trim()}”.
            </span>
          </button>
        )
      ) : null}
    </div>
  );
}
