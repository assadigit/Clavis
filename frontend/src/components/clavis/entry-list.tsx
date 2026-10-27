/**
 * CLAVIS — manager list column (SPEC §5.3): instant search, New menu,
 * items and groups mixed; rows select on click and with Up/Down arrows.
 * Every row carries an instant-copy button and a working pin toggle.
 */
"use client";

import { useMemo, useRef } from "react";
import { Key, Layers, MoreHorizontal, Plus, Search, Upload } from "lucide-react";
import type { ListFilter, Selection } from "./app-types";
import {
  categoryName,
  deletedEntries,
  formatDateTime,
  liveGroups,
  liveItems,
  metaLine,
  sharedCountMap,
} from "./derive";
import { EntryTile, Ix } from "./icons";
import { Btn, Menu, MenuItem, SearchField } from "./ui-bits";
import { EntryListRow, type EntryRowData } from "./entry-list/entry-list-row";
import { buildSearchEntries, searchEntries } from "@/lib/clavis/search";
import type { ClavisState } from "@/lib/clavis/types";

export interface EntryListProps {
  state: ClavisState;
  query: string;
  setQuery: (q: string) => void;
  filter: ListFilter;
  selection: Selection | null;
  onSelect: (sel: Selection) => void;
  onCreate: (kind: "item" | "group") => void;
  onOpenSettings: () => void;
  readOnly: boolean;
  /** Instant copy: returns true when the value actually reached the clipboard. */
  copyEntry: (kind: "item" | "group", id: string) => Promise<boolean>;
  /** Pin/unpin straight from the row. */
  togglePin: (kind: "item" | "group", id: string, pinned: boolean) => void;
}

type ListRow = EntryRowData;

export function EntryList({
  state,
  query,
  setQuery,
  filter,
  selection,
  onSelect,
  onCreate,
  onOpenSettings,
  readOnly,
  copyEntry,
  togglePin,
}: EntryListProps) {
  const data = state.data;
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const entries = useMemo(() => buildSearchEntries(data), [data]);

  const results: ListRow[] = useMemo(() => {
    let items = liveItems(data);
    let groups = liveGroups(data);
    if (filter.view === "pinned") {
      items = items.filter((i) => i.pinned);
      groups = groups.filter((g) => g.pinned);
    } else if (filter.view === "recent") {
      items = items.filter((i) => i.lastUsedAt !== null);
      groups = groups.filter((g) => g.lastUsedAt !== null);
    } else if (filter.view === "category") {
      items = items.filter((i) => i.categoryId === filter.categoryId);
      groups = groups.filter((g) => g.categoryId === filter.categoryId);
    } else if (filter.view === "tag") {
      const t = filter.tag.toLowerCase();
      items = items.filter((i) => i.tags.some((x) => x.toLowerCase() === t));
      groups = groups.filter((g) => g.tags.some((x) => x.toLowerCase() === t));
    }
    const ids = new Set<string>([...items.map((i) => i.id), ...groups.map((g) => g.id)]);
    const filtered = entries.filter((e) => ids.has(e.id));
    let ranked = searchEntries(query, filtered);
    if (filter.view === "recent") {
      /* §5.1: the 10 most recently used/copied — items AND groups. */
      const lastUsed = new Map<string, number>();
      for (const i of items) lastUsed.set(i.id, Date.parse(i.lastUsedAt ?? "") || 0);
      for (const g of groups) lastUsed.set(g.id, Date.parse(g.lastUsedAt ?? "") || 0);
      ranked = ranked
        .filter((e) => (lastUsed.get(e.id) ?? 0) > 0)
        .sort((a, b) => (lastUsed.get(b.id) ?? 0) - (lastUsed.get(a.id) ?? 0))
        .slice(0, 10);
    }
    const shared = sharedCountMap(data);
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const groupMap = new Map(groups.map((g) => [g.id, g]));
    return ranked.map((e) => {
      if (e.kind === "group") {
        const g = groupMap.get(e.id);
        return {
          kind: "group" as const,
          id: e.id,
          name: e.name,
          meta: metaLine(categoryName(data, g?.categoryId ?? null), e.tags),
          isSecret: false,
          pinned: e.pinned,
          shared: 0,
          memberCount: g ? g.itemIds.filter((id) => data.items.some((i) => i.id === id && !i.deletedAt)).length : 0,
        };
      }
      const it = itemMap.get(e.id);
      return {
        kind: "item" as const,
        id: e.id,
        name: e.name,
        meta: metaLine(categoryName(data, it?.categoryId ?? null), e.tags),
        isSecret: it?.isSecret ?? false,
        pinned: e.pinned,
        shared: shared.get(e.id) ?? 0,
      };
    });
  }, [data, entries, filter, query]);

  const trashResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    return deletedEntries(data).filter(
      (e) => q === "" || e.name.toLowerCase().includes(q) || e.key.toLowerCase().includes(q)
    );
  }, [data, query]);

  const liveCount = liveItems(data).length + liveGroups(data).length;
  const isTrash = filter.view === "trash";

  function move(dir: 1 | -1) {
    if (results.length === 0) return;
    const idx = results.findIndex((r) => selection && r.id === selection.id && r.kind === selection.kind);
    const cur = idx >= 0 ? idx : -1;
    const next = cur === -1 ? 0 : (cur + dir + results.length) % results.length;
    const row = results[next];
    onSelect({ kind: row.kind, id: row.id });
    rowRefs.current[next]?.focus();
  }

  return (
    <section
      aria-label={isTrash ? "Trash list" : "Entry list"}
      className="clavis-col flex flex-none flex-col"
      style={{
        /* F-009 (UI-audit round 1 Phase 6): the list is the column users scan
           most, so it gets a real budget — 320px made even 20-char names
           truncate at the default 1000px window. 416px keeps a 26-char name
           whole at 1000px and still no horizontal scroll at the 800px min
           (the detail column owns overflow: hidden). */
        width: "min(100%, calc(var(--space-6) * 13))",
        padding: "var(--space-2)",
        gap: "var(--space-2)",
        overflow: "hidden",
        borderRight: "1px solid var(--glass-border)",
      }}
    >
      <header className="flex items-center" style={{ gap: "var(--space-2)" }}>
        {/* F-027 (UI-audit round 1 Phase 10): the shared SearchField
            replaces this file's copy of the icon-positioning + input styles. */}
        <SearchField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={isTrash ? "Search trash…" : "Search… (try #tag or @category)"}
          ariaLabel="Search entries"
        />
        {!isTrash ? (
          <Menu
            triggerIcon={Plus}
            triggerLabel="New"
            triggerVariant="primary"
            triggerTitle="New item or group"
            align="end"
            disabled={readOnly}
            triggerStyle={{ flexShrink: 0 }}
          >
            <MenuItem
              icon={Key}
              label={
                <span className="flex flex-col" style={{ lineHeight: "var(--leading-tight)" }}>
                  <span>New item</span>
                  <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>
                    One key, prompt or note
                  </span>
                </span>
              }
              onClick={() => onCreate("item")}
            />
            <MenuItem
              icon={Layers}
              label={
                <span className="flex flex-col" style={{ lineHeight: "var(--leading-tight)" }}>
                  <span>New group</span>
                  <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>
                    All credentials for a project (.env)
                  </span>
                </span>
              }
              onClick={() => onCreate("group")}
            />
          </Menu>
        ) : null}
      </header>

      {isTrash ? (
        <div
          role="list"
          aria-label="Deleted entries"
          className="clavis-scroll clavis-divided flex flex-col"
          style={{ overflowY: "auto", flex: 1, minHeight: 0, paddingBottom: "var(--space-1)" }}
        >
          {trashResults.map((e) => (
            <div
              key={`${e.kind}:${e.id}`}
              role="listitem"
              className="glass-row flex items-center"
              style={{ gap: "var(--space-3)", padding: "var(--space-2) var(--space-3)", borderRadius: 0 }}
            >
              <EntryTile kind={e.kind} isSecret={e.isSecret} />
              <span className="flex min-w-0 flex-1 flex-col" style={{ gap: "calc(var(--space-1) / 2)" }}>
                <span className="truncate" style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-medium)" }}>
                  {e.name}
                </span>
                <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>
                  deleted {formatDateTime(e.deletedAt)}
                </span>
              </span>
            </div>
          ))}
          {trashResults.length === 0 ? (
            <div className="flex items-center" style={{ gap: "var(--space-2)", padding: "var(--space-3)" }}>
              <Ix icon={MoreHorizontal} size="sm" />
              <span className="t-muted" style={{ fontSize: "var(--text-sm)" }}>
                {query.trim() === "" ? "Trash is empty." : "Nothing found."}
              </span>
            </div>
          ) : null}
        </div>
      ) : liveCount === 0 ? (
        <div className="flex flex-col items-center" style={{ padding: "var(--space-5) var(--space-4)", gap: "var(--space-3)", textAlign: "center", flex: 1, justifyContent: "center" }}>
          <Ix icon={Key} size="lg" style={{ color: "var(--color-accent-text)" }} />
          <p style={{ margin: 0, fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)" }}>
            Your keys, prompts and notes — one shortcut away.
          </p>
          <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-sm)" }}>
            Add your first item, or import what you already have.
          </p>
          <div className="flex flex-wrap justify-center" style={{ gap: "var(--space-2)" }}>
            <Btn variant="primary" icon={Plus} label="Add your first item" onClick={() => onCreate("item")} disabled={readOnly} />
            <Btn variant="glass" icon={Upload} label="Import" onClick={onOpenSettings} />
          </div>
        </div>
      ) : (
        <div
          role="list"
          aria-label="Entries"
          tabIndex={0}
          className="clavis-scroll clavis-focusable clavis-divided flex flex-col"
          style={{ overflowY: "auto", flex: 1, minHeight: 0, paddingBottom: "var(--space-1)" }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            }
          }}
        >
          {results.map((row, i) => (
            <EntryListRow
              key={`${row.kind}:${row.id}`}
              row={row}
              index={i}
              selected={selection !== null && selection.kind === row.kind && selection.id === row.id}
              readOnly={readOnly}
              registerRef={(el) => {
                rowRefs.current[i] = el;
              }}
              onSelect={onSelect}
              copyEntry={copyEntry}
              togglePin={togglePin}
            />
          ))}
          {results.length === 0 ? (
            <div className="flex items-center" style={{ gap: "var(--space-2)", padding: "var(--space-3)" }}>
              <Ix icon={Search} size="sm" />
              <span className="t-muted" style={{ fontSize: "var(--text-sm)" }}>
                {filter.view === "recent" && query.trim() === ""
                  ? "Nothing used yet — copy an entry and it shows up here."
                  : "Nothing found."}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
