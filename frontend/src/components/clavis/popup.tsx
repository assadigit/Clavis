/**
 * CLAVIS — the popup quick palette (SPEC §3.3b, §5.1, §5.2).
 * Keyboard-first: Up/Down move selection (wrap), Enter copies, Right drills
 * into a group, Left/Backspace-on-empty/Esc go back, Esc at top hides.
 * Never shows secret values — only masked previews.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronLeft, ClipboardCopy, Layers, Search } from "lucide-react";
import type { CallFn } from "@/lib/clavis/client";
import { copyToClipboard } from "@/lib/clavis/client";
import { buildSearchEntries, searchEntries } from "@/lib/clavis/search";
import type { ClavisState } from "@/lib/clavis/types";
import type { Selection } from "./app-types";
import { groupById, groupMemberKeys, liveGroups, liveItems, maskValue, metaLine } from "./derive";
import { EntryTypeIcon, Ix } from "./icons";

interface PopupRow {
  kind: "item" | "group";
  id: string;
  name: string;
  meta: string;
  isSecret: boolean;
  preview: string;
}

const rowKeyOf = (row: PopupRow) => `${row.kind}:${row.id}`;

export interface PopupProps {
  open: boolean;
  onHide: () => void;
  state: ClavisState;
  call: CallFn;
  /** Open the Manager with the new-item form (optionally prefilled). */
  onOpenManagerNewItem: (prefillName?: string) => void;
  /** Reports the currently selected row (used by the global Ctrl+E). */
  onReportSelection: (sel: Selection | null) => void;
  /** Desktop: the window IS the panel — fill it instead of centering. */
  fill?: boolean;
}

export function Popup({ open, onHide, state, call, onOpenManagerNewItem, onReportSelection, fill }: PopupProps) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [drillId, setDrillId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<{ rowKey: string; label: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const showLast4 = state.data.settings.showLast4;
  const noData = liveItems(state.data).length === 0 && liveGroups(state.data).length === 0;

  const entries = useMemo(() => buildSearchEntries(state.data), [state.data]);
  const itemMap = useMemo(
    () => new Map(state.data.items.filter((i) => i.deletedAt === null).map((i) => [i.id, i])),
    [state.data.items]
  );
  const groupMap = useMemo(
    () => new Map(state.data.groups.filter((g) => g.deletedAt === null).map((g) => [g.id, g])),
    [state.data.groups]
  );

  const topRows: PopupRow[] = useMemo(() => {
    let results = searchEntries(query, entries);
    if (query.trim() === "") results = results.slice(0, 8); /* pinned, then most-used */
    return results.map((e) => {
      if (e.kind === "group") {
        const g = groupMap.get(e.id);
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
        preview: maskValue(it?.value ?? "", showLast4),
      };
    });
  }, [query, entries, itemMap, groupMap, showLast4]);

  const drillGroup = drillId ? groupById(state.data, drillId) : null;

  const memberRows: PopupRow[] = useMemo(() => {
    if (!drillGroup) return [];
    const memberEntries = entries.filter(
      (e) => e.kind === "item" && drillGroup.itemIds.includes(e.id)
    );
    const results = searchEntries(query, memberEntries);
    const keyed = groupMemberKeys(drillGroup, state.data);
    const keyById = new Map(keyed.map((m) => [m.item.id, m.key]));
    return results.map((e) => {
      const it = itemMap.get(e.id);
      return {
        kind: "item" as const,
        id: e.id,
        name: e.name,
        meta: keyById.get(e.id) ?? it?.key ?? "",
        isSecret: it?.isSecret ?? false,
        preview: maskValue(it?.value ?? "", showLast4),
      };
    });
  }, [drillGroup, query, entries, itemMap, state.data, showLast4]);

  const rows = drillGroup ? memberRows : topRows;

  /* Selection is kept inside the list by deriving a clamped index (no
     setState-in-effect): rows shrink → the index rides along. */
  const selIdx = rows.length === 0 ? 0 : Math.min(sel, rows.length - 1);

  /* Report the selected row to the app (global Ctrl+E). */
  useEffect(() => {
    const row = rows[selIdx];
    onReportSelection(row ? { kind: row.kind, id: row.id } : null);
  }, [rows, selIdx, onReportSelection]);

  async function doCopy(kind: "item" | "group", id: string, rowKey: string) {
    if (busy || copied) return;
    setBusy(true);
    const res = await call("copy", { kind, id });
    if (res.ok && typeof res.text === "string") {
      const ok = await copyToClipboard(res.text, res.containsSecret === true);
      if (ok) {
        const label =
          kind === "group" && res.lineCount != null ? `Copied ${res.lineCount} lines` : "Copied";
        setCopied({ rowKey, label });
        if (res.containsSecret) {
          toast("Copied — kept out of clipboard history.");
        }
        window.setTimeout(() => onHide(), 500);
      } else {
        toast.error("Could not copy to the clipboard. Try again.");
      }
    }
    setBusy(false);
  }

  function activate(index: number) {
    if (copied || busy) return;
    const row = rows[index];
    if (!row) return;
    if (drillGroup) doCopy("item", row.id, rowKeyOf(row));
    else doCopy(row.kind, row.id, rowKeyOf(row));
  }

  function move(dir: 1 | -1) {
    if (rows.length === 0) return;
    setSel((s) => (s + dir + rows.length) % rows.length);
  }

  function back() {
    if (!drillGroup) return;
    const gid = drillGroup.id;
    setDrillId(null);
    setQuery("");
    const idx = topRows.findIndex((r) => r.kind === "group" && r.id === gid);
    setSel(idx >= 0 ? idx : 0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (copied) {
      e.preventDefault();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      if (drillGroup) doCopy("group", drillGroup.id, `group:${drillGroup.id}`);
      else activate(selIdx);
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        return;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        return;
      case "Enter": {
        e.preventDefault();
        if (rows.length === 0) {
          if (!drillGroup && query.trim() !== "") onOpenManagerNewItem(query.trim());
          return;
        }
        activate(selIdx);
        return;
      }
      case "ArrowRight": {
        if (!drillGroup) {
          const row = rows[selIdx];
          if (row && row.kind === "group") {
            e.preventDefault();
            setDrillId(row.id);
            setSel(0);
          }
        }
        return;
      }
      case "ArrowLeft":
        if (drillGroup) {
          e.preventDefault();
          back();
        }
        return;
      case "Backspace":
        if (query === "" && drillGroup) {
          e.preventDefault();
          back();
        }
        return;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        if (drillGroup) back();
        else onHide();
        return;
      default:
        return;
    }
  }

  if (!open) return null;

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
        onMouseEnter={() => setSel(i)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => activate(i)}
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
      className={fill ? "clavis-desk-popup fixed inset-0" : "fixed inset-0 flex justify-center"}
      style={{ zIndex: 70 }}
      role="dialog"
      aria-label="Clavis quick search"
    >
      <div className="clavis-scrim absolute inset-0" onMouseDown={onHide} aria-hidden />
      <div
        style={
          fill
            ? {
                /* Desktop: the window IS the panel — solid background, no pad. */
                position: "absolute",
                inset: 0,
              }
            : {
                position: "absolute",
                top: "18vh",
                width: "min(calc(640px + var(--window-shadow-pad) * 2), calc(100vw - var(--space-4)))",
                padding: "var(--window-shadow-pad)",
                pointerEvents: "none",
              }
        }
      >
        <div className="clavis-pop-in relative" style={{ pointerEvents: "auto" }}>
          <div className="clavis-backdrop-layer" aria-hidden />
          <div className="glass-panel relative flex flex-col" style={{ overflow: "hidden" }}>
            {drillGroup ? (
              <div
                className="flex items-center"
                style={{
                  gap: "var(--space-2)",
                  padding: "var(--space-2) var(--space-3)",
                  borderBottom: "1px solid var(--glass-border)",
                }}
              >
                <button
                  type="button"
                  onClick={back}
                  aria-label="Back to results"
                  className="clavis-btn clavis-btn-ghost"
                  style={{ padding: "var(--space-1)" }}
                >
                  <Ix icon={ChevronLeft} size="sm" />
                </button>
                <Ix icon={Layers} size="sm" style={{ color: "var(--color-accent-text)" }} />
                <span className="truncate" style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)" }}>
                  {drillGroup.name}
                </span>
                <span className="t-muted" style={{ fontSize: "var(--text-xs)", flexShrink: 0 }}>
                  {drillGroup.itemIds.filter((id) => itemMap.has(id)).length} items
                </span>
              </div>
            ) : null}
            <div style={{ padding: "var(--space-3) var(--space-4)" }}>
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                role="combobox"
                aria-expanded="true"
                aria-controls="clavis-popup-list"
                aria-activedescendant={rows.length > 0 ? `clavis-pop-row-${selIdx}` : undefined}
                aria-autocomplete="list"
                aria-label="Search Clavis"
                placeholder="Search Clavis…"
                spellCheck={false}
                autoComplete="off"
                className="glass-input"
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-lg)",
                  color: "var(--text)",
                  width: "100%",
                  padding: "var(--space-2) var(--space-3)",
                }}
              />
            </div>
            <div
              id="clavis-popup-list"
              role="listbox"
              aria-label="Results"
              className="clavis-popup-rows clavis-scroll flex flex-col"
              style={{ gap: "var(--space-1)", padding: "0 var(--space-2) var(--space-2)" }}
            >
              {rows.map(renderRow)}
              {rows.length === 0 ? (
                noData ? (
                  <button
                    type="button"
                    className="glass-row flex items-center"
                    style={{ gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", minHeight: "var(--clavis-row-h)", cursor: "pointer" }}
                    onClick={() => onOpenManagerNewItem()}
                  >
                    <Ix icon={Search} size="md" style={{ color: "var(--color-accent-text)" }} />
                    <span className="t-muted" style={{ fontSize: "var(--text-sm)" }}>
                      Nothing here yet. Press Ctrl+N to add your first item.
                    </span>
                  </button>
                ) : drillGroup ? (
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
                    onClick={() => onOpenManagerNewItem(query.trim())}
                  >
                    <Ix icon={Search} size="md" style={{ color: "var(--color-accent-text)" }} />
                    <span className="t-muted" style={{ fontSize: "var(--text-sm)" }}>
                      Nothing found. Press Enter to create “{query.trim()}”.
                    </span>
                  </button>
                )
              ) : null}
            </div>
            <footer
              className="flex items-center"
              style={{
                borderTop: "1px solid var(--glass-border)",
                padding: "var(--space-2) var(--space-4)",
                gap: "var(--space-4)",
              }}
            >
              <span className="flex items-center" style={{ gap: "var(--space-1)" }}>
                <kbd className="clavis-keycap">↵</kbd>
                <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>Copy</span>
              </span>
              <span className="flex items-center" style={{ gap: "var(--space-1)" }}>
                <kbd className="clavis-keycap">→</kbd>
                <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>Open group</span>
              </span>
              <span className="flex items-center" style={{ gap: "var(--space-1)" }}>
                <kbd className="clavis-keycap">Esc</kbd>
                <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>Close</span>
              </span>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
