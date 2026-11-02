/**
 * CLAVIS — the popup quick palette (SPEC §3.3b, §5.1, §5.2).
 * Keyboard-first: Up/Down move selection (wrap), Enter copies, Right drills
 * into a group or folder, Left/Backspace-on-empty/Esc go back one level,
 * Esc at the top hides. Never shows secret values — only masked previews.
 *
 * Empty query (§5.1): "Recent" — the 10 most recently used/copied entries
 * (items AND groups; copying a whole group counts) — topped up to 10 rows
 * with pinned/most-used entries. Every open starts fresh: query cleared,
 * selection at the top, copy state cleared.
 *
 * v1.9.0 compact palette (DECISIONS.md §49, user request "make it 30–50%
 * smaller"): the window is 440 DIP wide (was 640), rows are single-line on
 * a 28px rhythm (was 48px two-line), and every chrome surface — search bar,
 * drill-down header, footer keycaps — tightened around the token scale.
 * "Open Clavis" is the primary CTA (Bitwarden brand blue).
 *
 * v1.10.0 (DECISIONS.md §50): the desktop window is CENTERED on screen both
 * ways (Go popupmath — Spotlight style), the OS rounds its corners (DWM
 * frame), and the web edition mirrors the placement: the floating panel
 * sits at the vertical middle instead of 18vh.
 *
 * v1.11.0 (DECISIONS.md §51): nested selection — the drill-down became a
 * navigation STACK (the old single drillId → NavLoc[]). "I pin some
 * folders (which appear in clavis mini), then they have hierarchical and
 * nested access": Prompts → Image generation → Artistic Picture Prompt.
 * Pinned folders ride the default list (homeEntries); every folder is
 * findable by typing its name; Enter/→ on a folder row pushes it, Esc/←/
 * Backspace-on-empty pops one level, and the header shows the whole path.
 * Every show still starts fresh (the palette unmounts on hide).
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppWindow, ChevronLeft, Folder, Layers } from "lucide-react";
import type { CallFn } from "@/lib/clavis/client";
import { buildSearchEntries, compareRecent, homeEntries } from "@/lib/clavis/search";
import type { ClavisState } from "@/lib/clavis/types";
import { messages } from "@/lib/clavis/messages";
import type { Selection } from "./app-types";
import { groupById, liveGroups, liveItems, subtreeCounts } from "./derive";
import { Ix } from "./icons";
import {
  PopupRows,
  RECENT_LIMIT,
  buildLocationRows,
  buildTopRows,
  rowKeyOf,
  useLocationRows,
  useTopRows,
  type CopiedState,
  type NavLoc,
} from "./popup/rows";

/** The drill-down views have no section headers. */
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
  /* v1.11.0 §51: the drill-down path as a stack — [Prompts, Image
   * generation, Artistic Picture Prompt] renders three levels deep with
   * one level of state per step. [] = the home list. */
  const [nav, setNav] = useState<NavLoc[]>([]);
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
  /* Subtree entry counts per folder — the sidebar's numbers, reused for
     the folder rows' "N entries" preview and the header count. */
  const catCounts = useMemo(() => subtreeCounts(state.data), [state.data]);

  const topRows = useTopRows(query, entries, itemMap, groupMap, catCounts);

  /* Section labels for the default list: "Recent" over the recent block,
     "Pinned & frequent" over the fill. Headers are presentation-only —
     selection indices still address the flat row list. */
  const topHeaders = useMemo(() => {
    const map = new Map<number, string>();
    if (query.trim() !== "") return map;
    /* Must mirror topRows: the same pinned-folders-ride pool (v1.11.0 §51),
       then recent = used entries, most-recent-first. */
    const pool = homeEntries(entries);
    const used = pool.filter((e) => e.lastUsedAt > 0).sort(compareRecent);
    const recentCount = Math.min(used.length, RECENT_LIMIT);
    if (recentCount > 0) map.set(0, "Recent");
    const fillCount = Math.min(
      pool.length - used.length,
      Math.max(0, RECENT_LIMIT - recentCount)
    );
    if (fillCount > 0) map.set(recentCount, "Pinned & frequent");
    return map;
  }, [query, entries]);

  /* The current drill-down location (top of the stack). */
  const loc: NavLoc | null = nav.length > 0 ? nav[nav.length - 1] : null;
  const locGroup = loc?.kind === "group" ? groupById(state.data, loc.id) : null;
  const locCat = loc?.kind === "category" ? state.data.categories.find((c) => c.id === loc.id) ?? null : null;
  const drilling = loc !== null;

  const locRows = useLocationRows(loc, query, entries, itemMap, groupMap, state.data);

  const rows = drilling ? locRows : topRows;
  const headers = drilling ? NO_HEADERS : topHeaders;

  /* A data-changed refetch (v1.3.2 sync) can delete the drilled folder or
     group out from under the palette — prune dead levels off the stack
     instead of stranding the view on an empty list. */
  useEffect(() => {
    setNav((n) => {
      let cut = n.length;
      while (cut > 0) {
        const l = n[cut - 1];
        const alive =
          l.kind === "group"
            ? groupById(state.data, l.id) !== null
            : state.data.categories.some((c) => c.id === l.id);
        if (alive) break;
        cut--;
      }
      return cut === n.length ? n : n.slice(0, cut);
    });
  }, [state.data]);

  /* Selection is kept inside the list by deriving a clamped index (no
     setState-in-effect): rows shrink → the index rides along. */
  const selIdx = rows.length === 0 ? 0 : Math.min(sel, rows.length - 1);

  /* Report the selected row to the app (global Ctrl+E). Folders have no
     editor — a category selection reports null so Ctrl+E stays an entry
     action (v1.11.0 §51). */
  useEffect(() => {
    const row = rows[selIdx];
    onReportSelection(row && row.kind !== "category" ? { kind: row.kind, id: row.id } : null);
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

  /* Push one drill-down level (Enter/→/click on a folder or group row). */
  function enter(next: NavLoc) {
    setNav((n) => [...n, next]);
    /* SPEC §3.3b: the query that found the container must not filter (and
       empty) the inside list; it is cleared, typing then searches within. */
    setQuery("");
    setSel(0);
  }

  function activate(index: number) {
    if (copied || busy) return;
    const row = rows[index];
    if (!row) return;
    /* v1.11.0 §51: a folder row navigates — there is nothing to copy. */
    if (row.kind === "category") {
      enter({ kind: "category", id: row.id });
      return;
    }
    doCopy(row.kind, row.id, rowKeyOf(row));
  }

  function move(dir: 1 | -1) {
    if (rows.length === 0) return;
    setSel((s) => (s + dir + rows.length) % rows.length);
  }

  function back() {
    if (!loc) return;
    const popped = loc;
    const rest = nav.slice(0, -1);
    setNav(rest);
    setQuery("");
    /* Land the selection back on the row you left — computed from the same
       pure builders the view uses, at the post-back query (""). */
    const parent = rest.length > 0 ? rest[rest.length - 1] : null;
    const parentRows = parent
      ? buildLocationRows(parent, "", entries, itemMap, groupMap, state.data)
      : buildTopRows("", entries, itemMap, groupMap, catCounts);
    const idx = parentRows.findIndex((r) => r.kind === popped.kind && r.id === popped.id);
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
      /* Inside a group view, Ctrl+Enter copies the whole group (§3.3b). */
      if (locGroup) doCopy("group", locGroup.id, `group:${locGroup.id}`);
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
          if (!drilling && query.trim() !== "") onOpenManagerNewItem(query.trim());
          return;
        }
        activate(selIdx);
        return;
      }
      case "ArrowRight": {
        /* v1.11.0 §51: → drills at ANY level — a group row opens its
           members, a folder row opens its subfolders and entries. */
        const row = rows[selIdx];
        if (row && (row.kind === "group" || row.kind === "category")) {
          e.preventDefault();
          enter({ kind: row.kind, id: row.id });
        }
        return;
      }
      case "ArrowLeft":
        if (drilling) {
          e.preventDefault();
          back();
        }
        return;
      case "Backspace":
        if (query === "" && drilling) {
          e.preventDefault();
          back();
        }
        return;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        if (drilling) back();
        else onHide();
        return;
      default:
        return;
    }
  }

  if (!open) return null;

  /* The drill-down header: back button, the FULL path ("Prompts › Image
     generation › Artistic Picture Prompt"), and the size hint. */
  const pathLabel = nav
    .map((l) =>
      l.kind === "group"
        ? groupMap.get(l.id)?.name ?? ""
        : state.data.categories.find((c) => c.id === l.id)?.name ?? ""
    )
    .filter((n) => n !== "")
    .join(" › ");
  const countLabel = locGroup
    ? locGroup.mode === "document"
      ? `document · ${(locGroup.docChars ?? 0).toLocaleString()} chars`
      : `${locGroup.itemIds.filter((id) => itemMap.has(id)).length} items`
    : locCat
      ? `${catCounts.get(locCat.id) ?? 0} entries`
      : "";

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
                /* Web edition: mirrors the desktop placement (v1.10.0) —
                   horizontally centered by the flex parent, vertically at the
                   middle of the viewport (was 18vh). */
                position: "absolute",
                top: "50%",
                transform: "translateY(-50%)",
                width: "min(calc(440px + var(--window-shadow-pad) * 2), calc(100vw - var(--space-4)))",
                padding: "var(--window-shadow-pad)",
                pointerEvents: "none",
              }
        }
      >
        <div className="clavis-pop-in relative" style={{ pointerEvents: "auto" }}>
          <div className="clavis-backdrop-layer" aria-hidden />
          <div className="glass-panel relative flex flex-col" style={{ overflow: "hidden", boxShadow: fill ? undefined : "var(--overlay-shadow)" }}>
            {drilling ? (
              <div
                className="flex items-center"
                style={{
                  gap: "var(--space-2)",
                  padding: "var(--space-1) var(--space-2)",
                  borderBottom: "1px solid var(--glass-border)",
                }}
              >
                <button
                  type="button"
                  onClick={back}
                  aria-label="Back"
                  title="Back one level (Esc at the top closes)"
                  className="clavis-btn clavis-btn-ghost"
                  style={{ padding: "var(--space-1)" }}
                >
                  <Ix icon={ChevronLeft} size="sm" />
                </button>
                <Ix
                  icon={locGroup ? Layers : Folder}
                  size="sm"
                  style={{ color: "var(--color-accent-text)", flexShrink: 0 }}
                />
                {/* v1.11.0 §51: the whole path, not just the leaf — deep
                    stacks stay orientable at 440 DIP. */}
                <span className="truncate" style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)" }}>
                  {pathLabel}
                </span>
                <span className="t-muted" style={{ fontSize: "var(--text-xs)", flexShrink: 0 }}>
                  {countLabel}
                </span>
              </div>
            ) : null}
            <div style={{ padding: "var(--space-2) var(--space-3)", borderBottom: "1px solid var(--glass-border)" }}>
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
                  fontSize: "var(--text-md)",
                  color: "var(--text)",
                  width: "100%",
                  padding: "var(--space-1) var(--space-2)",
                }}
              />
            </div>
            <PopupRows
              rows={rows}
              headers={headers}
              selIdx={selIdx}
              copied={copied}
              noData={noData}
              drilling={drilling}
              query={query}
              onHover={setSel}
              onActivate={activate}
              onCreateItem={onOpenManagerNewItem}
            />
            <footer
              className="flex items-center"
              style={{
                borderTop: "1px solid var(--glass-border)",
                padding: "var(--space-1) var(--space-3)",
                gap: "var(--space-3)",
              }}
            >
              <span className="flex items-center" style={{ gap: "var(--space-1)" }}>
                <kbd className="clavis-keycap">↵</kbd>
                <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>Copy</span>
              </span>
              <span className="flex items-center" style={{ gap: "var(--space-1)" }}>
                {/* v1.11.0 §51: → opens groups AND folders now. */}
                <kbd className="clavis-keycap">→</kbd>
                <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>Open</span>
              </span>
              <span className="flex items-center" style={{ gap: "var(--space-1)" }}>
                <kbd className="clavis-keycap">Esc</kbd>
                <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>Close</span>
              </span>
              {/* v1.9.0 (user request): the popup's one affirmative action is
                  the CTA — Bitwarden brand blue, white text, hover darkens. */}
              <button
                type="button"
                onClick={() => {
                  onHide();
                  onOpenManager();
                }}
                title="Open the full Clavis window (Esc closes the popup)"
                className="clavis-btn clavis-btn-primary clavis-focusable ml-auto flex items-center"
                style={{ gap: "var(--space-1)", padding: "var(--space-1) var(--space-3)", flexShrink: 0 }}
              >
                <Ix icon={AppWindow} size="sm" />
                <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)" }}>
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
