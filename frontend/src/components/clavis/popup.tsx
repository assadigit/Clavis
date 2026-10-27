/**
 * CLAVIS — the popup quick palette (SPEC §3.3b, §5.1, §5.2).
 * Keyboard-first: Up/Down move selection (wrap), Enter copies, Right drills
 * into a group, Left/Backspace-on-empty/Esc go back, Esc at top hides.
 * Never shows secret values — only masked previews.
 *
 * Empty query (§5.1): "Recent" — the 10 most recently used/copied entries
 * (items AND groups; copying a whole group counts) — topped up to 10 rows
 * with pinned/most-used entries. Every open starts fresh: query cleared,
 * selection at the top, copy state cleared.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppWindow, ChevronLeft, Layers } from "lucide-react";
import type { CallFn } from "@/lib/clavis/client";
import { buildSearchEntries, compareRecent } from "@/lib/clavis/search";
import type { ClavisState } from "@/lib/clavis/types";
import { messages } from "@/lib/clavis/messages";
import type { Selection } from "./app-types";
import { groupById, liveGroups, liveItems } from "./derive";
import { Ix } from "./icons";
import { PopupRows, RECENT_LIMIT, rowKeyOf, useMemberRows, useTopRows, type CopiedState } from "./popup/rows";

/** The drill-down view has no section headers. */
const NO_HEADERS = new Map<number, string>();

export interface PopupProps {
  open: boolean;
  onHide: () => void;
  state: ClavisState;
  call: CallFn;
  /** Open the Manager with the new-item form (optionally prefilled). */
  onOpenManagerNewItem: (prefillName?: string) => void;
  /** Open the full Manager window — the popup's "Open Clavis" button. */
  onOpenManager: () => void;
  /** Reports the currently selected row (used by the global Ctrl+E). */
  onReportSelection: (sel: Selection | null) => void;
  /** Desktop: the window IS the panel — fill it instead of centering. */
  fill?: boolean;
}

export function Popup({ open, onHide, state, call, onOpenManagerNewItem, onOpenManager, onReportSelection, fill }: PopupProps) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [drillId, setDrillId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<CopiedState>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* Copy feedback always clears itself, even if the hide is cancelled —
     a leftover "copied" state must never block typing on the next show. */
  useEffect(() => {
    if (copied === null) return;
    const t = window.setTimeout(() => setCopied(null), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

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

  const topRows = useTopRows(query, entries, itemMap, groupMap);

  /* Section labels for the default list: "Recent" over the recent block,
     "Pinned & frequent" over the fill. Headers are presentation-only —
     selection indices still address the flat row list. */
  const topHeaders = useMemo(() => {
    const map = new Map<number, string>();
    if (query.trim() !== "") return map;
    /* Must mirror topRows: recent = used entries, most-recent-first. */
    const used = entries.filter((e) => e.lastUsedAt > 0).sort(compareRecent);
    const recentCount = Math.min(used.length, RECENT_LIMIT);
    if (recentCount > 0) map.set(0, "Recent");
    const fillCount = Math.min(
      entries.length - used.length,
      Math.max(0, RECENT_LIMIT - recentCount)
    );
    if (fillCount > 0) map.set(recentCount, "Pinned & frequent");
    return map;
  }, [query, entries]);

  const drillGroup = drillId ? groupById(state.data, drillId) : null;

  const memberRows = useMemberRows(drillGroup, query, entries, itemMap, state.data);

  const rows = drillGroup ? memberRows : topRows;
  const headers = drillGroup ? NO_HEADERS : topHeaders;

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
    /* The backend writes the clipboard (with the §5.2 privacy formats when
       the payload contains a secret) and returns metadata only — the value
       never enters the webview. */
    const res = await call("copy", { kind, id });
    if (res.ok) {
      if (res.copied) {
        const label =
          kind === "group" && res.lineCount != null ? messages.copiedLabelLines(res.lineCount) : messages.copiedLabel;
        setCopied({ rowKey, label });
        if (res.containsSecret) {
          toast(messages.copiedSecretNote);
        }
        window.setTimeout(() => onHide(), 500);
      } else {
        toast.error(messages.copyFailed);
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
            // SPEC §3.3b: "open a group and list its members" — the query
            // that found the group must not filter (and empty) the member
            // list; it is cleared, typing then searches within the group.
            setDrillId(row.id);
            setQuery("");
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

  return (
    <div
      className={fill ? "clavis-desk-popup fixed inset-0" : "fixed inset-0 flex justify-center"}
      style={{ zIndex: 70 }}
      role="dialog"
      aria-label="Clavis quick search"
    >
      {!fill ? <div className="clavis-scrim absolute inset-0" onMouseDown={onHide} aria-hidden /> : null}
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
          <div className="glass-panel relative flex flex-col" style={{ overflow: "hidden", boxShadow: fill ? undefined : "var(--overlay-shadow)" }}>
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
            <div style={{ padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--glass-border)" }}>
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
            <PopupRows
              rows={rows}
              headers={headers}
              selIdx={selIdx}
              copied={copied}
              noData={noData}
              inGroup={drillGroup !== null}
              query={query}
              onHover={setSel}
              onActivate={activate}
              onCreateItem={onOpenManagerNewItem}
            />
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
              <button
                type="button"
                onClick={() => {
                  onHide();
                  onOpenManager();
                }}
                title="Open the full Clavis window (Esc closes the popup)"
                className="clavis-btn clavis-btn-ghost clavis-focusable ml-auto flex items-center"
                style={{ gap: "var(--space-1)", padding: "var(--space-1) var(--space-2)", flexShrink: 0 }}
              >
                <Ix icon={AppWindow} size="sm" />
                <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-medium)" }}>
                  Open Clavis
                </span>
              </button>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
