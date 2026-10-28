/**
 * CLAVIS — one entry row in the manager's list column: the entry, shared
 * marker, instant-copy button (with its ✓ feedback beat) and pin toggle.
 * Moved move-only from entry-list.tsx in UI-audit round 1 Phase 11 (F-026);
 * the per-row copy feedback moved with it (identical behavior — only one
 * row is ever in the copied state, and the 1400 ms beat is unchanged).
 */
"use client";

import { useEffect, useState } from "react";
import { Check, ClipboardCopy, Link2, Pin } from "lucide-react";
import { EntryTile, Ix } from "../icons";

export interface EntryRowData {
  kind: "item" | "group";
  id: string;
  name: string;
  meta: string;
  isSecret: boolean;
  pinned: boolean;
  shared: number;
  memberCount?: number;
  /** Document groups (§40) show their size instead of a member count. */
  isDocument?: boolean;
  docChars?: number;
}

export function EntryListRow({
  row,
  index,
  selected,
  readOnly,
  registerRef,
  onSelect,
  copyEntry,
  togglePin,
}: {
  row: EntryRowData;
  index: number;
  selected: boolean;
  readOnly: boolean;
  /** The row registers itself so arrow-key navigation can focus it. */
  registerRef: (el: HTMLDivElement | null) => void;
  onSelect: (sel: { kind: "item" | "group"; id: string }) => void;
  /** Instant copy: returns true when the value reached the clipboard. */
  copyEntry: (kind: "item" | "group", id: string) => Promise<boolean>;
  togglePin: (kind: "item" | "group", id: string, pinned: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  /* The ✓ feedback beat (1400 ms) — moved verbatim from the list. */
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(t);
  }, [copied]);

  return (
    <div
      ref={registerRef}
      id={`clavis-list-row-${index}`}
      role="listitem"
      aria-current={selected ? "true" : undefined}
      tabIndex={-1}
      data-selected={selected ? "true" : "false"}
      className="glass-row clavis-focusable flex cursor-pointer items-center"
      style={{ gap: "var(--space-3)", padding: "var(--space-2) var(--space-3)", minHeight: "calc(var(--space-4) + var(--space-4))", borderRadius: 0 }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onSelect({ kind: row.kind, id: row.id })}
    >
      <EntryTile kind={row.kind} isSecret={row.isSecret} />
      <span className="flex min-w-0 flex-1 flex-col" style={{ gap: "calc(var(--space-1) / 2)" }}>
        <span className="truncate" style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-medium)" }}>
          {row.name}
        </span>
        {row.meta !== "" ? (
          <span className="truncate t-muted" style={{ fontSize: "var(--text-xs)" }}>
            {row.meta}
          </span>
        ) : null}
      </span>
      {row.shared > 0 ? (
        <span
          className="flex items-center t-muted"
          style={{ gap: "calc(var(--space-1) / 2)", fontSize: "var(--text-xs)", flexShrink: 0 }}
          title={`Used in ${row.shared} groups`}
        >
          <Ix icon={Link2} size="sm" />
          {row.shared}
        </span>
      ) : null}
      {row.kind === "group" ? (
        <span className="t-muted" style={{ fontSize: "var(--text-xs)", flexShrink: 0 }}>
          {row.isDocument ? `document · ${(row.docChars ?? 0).toLocaleString()} chars` : `${row.memberCount ?? 0} items`}
        </span>
      ) : null}
      {/* Instant copy — one click, no round-trip through the editor. */}
      <button
        type="button"
        className="clavis-btn clavis-btn-ghost clavis-focusable clavis-row-action"
        aria-label={copied ? `Copied ${row.name}` : `Copy ${row.name}${row.kind === "group" ? " (whole block)" : ""}`}
        title={row.kind === "group" ? "Copy the whole KEY=value block" : "Copy to clipboard instantly"}
        style={{
          padding: "var(--space-1)",
          color: copied ? "var(--color-success-text)" : undefined,
          flexShrink: 0,
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (copied) return;
          void copyEntry(row.kind, row.id).then((ok) => {
            if (ok) setCopied(true);
          });
        }}
      >
        <Ix icon={copied ? Check : ClipboardCopy} size="sm" />
      </button>
      {/* Pin toggle — always visible, accent when pinned (SPEC §5.1 ranking). */}
      <button
        type="button"
        className="clavis-btn clavis-btn-ghost clavis-focusable clavis-row-action"
        role="switch"
        aria-checked={row.pinned}
        aria-label={`${row.pinned ? "Unpin" : "Pin"} ${row.name}`}
        title={row.pinned ? "Unpin — stop showing first" : "Pin — show first"}
        disabled={readOnly}
        style={{
          padding: "var(--space-1)",
          flexShrink: 0,
          color: row.pinned ? "var(--color-accent-text)" : "var(--text-muted)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          togglePin(row.kind, row.id, !row.pinned);
        }}
      >
        <Ix icon={Pin} size="sm" />
      </button>
    </div>
  );
}
