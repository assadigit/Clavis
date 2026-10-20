/**
 * CLAVIS — trash view (SPEC §5.7): soft-deleted entries with per-row
 * Restore / Delete forever, plus Empty trash.
 */
"use client";

import { toast } from "sonner";
import { RotateCcw, Trash2 } from "lucide-react";
import type { CallFn } from "@/lib/clavis/client";
import type { ClavisState } from "@/lib/clavis/types";
import { deletedEntries, formatDateTime } from "./derive";
import { EntryTile, Ix } from "./icons";
import { Btn } from "./ui-bits";

export interface TrashViewProps {
  state: ClavisState;
  call: CallFn;
  readOnly: boolean;
}

export function TrashView({ state, call, readOnly }: TrashViewProps) {
  const entries = deletedEntries(state.data);

  async function restore(kind: "item" | "group", id: string, name: string) {
    const res = await call("restoreEntry", { kind, id });
    if (res.ok) toast.success(`Restored “${name}”.`);
  }

  async function purge(kind: "item" | "group", id: string, name: string) {
    const res = await call("purgeEntry", { kind, id });
    if (res.ok) toast(`Deleted “${name}” forever.`);
  }

  async function empty() {
    if (entries.length === 0) return;
    const res = await call("emptyTrash");
    if (res.ok) toast.success("Trash emptied.");
  }

  return (
    <div className="clavis-scroll flex flex-col" style={{ gap: "var(--space-3)", overflowY: "auto", padding: "var(--space-4)", flex: 1, minHeight: 0 }}>
      <header className="flex items-center" style={{ gap: "var(--space-3)" }}>
        <Ix icon={Trash2} size="lg" style={{ color: "var(--color-accent-text)" }} />
        <div className="flex-1">
          <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: "var(--weight-semibold)" }}>Trash</h2>
          <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>
            {entries.length} {entries.length === 1 ? "entry" : "entries"} · kept for 30 days, then purged
          </span>
        </div>
        <Btn
          variant="danger"
          icon={Trash2}
          label="Empty trash"
          onClick={() => void empty()}
          disabled={readOnly || entries.length === 0}
          title="Delete everything in the trash"
        />
      </header>

      {entries.length === 0 ? (
        <div className="glass-row flex flex-col items-center" style={{ gap: "var(--space-2)", padding: "var(--space-5)", textAlign: "center" }}>
          <Ix icon={Trash2} size="lg" />
          <span className="t-muted" style={{ fontSize: "var(--text-sm)" }}>
            Trash is empty. Deleted items rest here for 30 days.
          </span>
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: "var(--space-1)" }}>
          {entries.map((e) => (
            <div
              key={`${e.kind}:${e.id}`}
              className="glass-row flex items-center"
              style={{ gap: "var(--space-3)", padding: "var(--space-2) var(--space-3)" }}
            >
              <EntryTile kind={e.kind} isSecret={e.isSecret} />
              <span className="flex min-w-0 flex-1 flex-col" style={{ gap: "calc(var(--space-1) / 2)" }}>
                <span className="truncate" style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)" }}>
                  {e.name}
                </span>
                <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>
                  {e.kind === "group" ? "Group" : "Item"} · deleted {formatDateTime(e.deletedAt)}
                </span>
              </span>
              <span className="flex items-center" style={{ gap: "var(--space-2)", flexShrink: 0 }}>
                <Btn
                  variant="glass"
                  icon={RotateCcw}
                  label="Restore"
                  onClick={() => void restore(e.kind, e.id, e.name)}
                  disabled={readOnly}
                  ariaLabel={`Restore ${e.name}`}
                  title={`Restore ${e.name}`}
                />
                <Btn
                  variant="danger"
                  icon={Trash2}
                  label="Delete forever"
                  onClick={() => void purge(e.kind, e.id, e.name)}
                  disabled={readOnly}
                  ariaLabel={`Delete ${e.name} forever`}
                  title={`Delete ${e.name} forever`}
                />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
