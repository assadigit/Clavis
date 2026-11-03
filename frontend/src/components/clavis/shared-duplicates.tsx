/**
 * CLAVIS — the Shared view's home panel (v1.8.0, DECISIONS.md §48).
 *
 * The intelligent half of shared credentials: values never cross to the
 * webview (§5.2), so the DUPLICATE SCAN runs in the backend and this panel
 * presents its name-only results. When the same secret exists as separate
 * copies across several groups (the bulk-paste world), each detected
 * cluster offers a one-click consolidation: keep one copy, mark it shared,
 * point every group at it — and from then on, changing the value once
 * updates everywhere (the §5.6 shared-item edit modal governs those edits).
 *
 * The scan re-runs automatically whenever the state snapshot moves (every
 * mutation returns a fresh state), so the suggestions can never go stale
 * while the panel is open.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, GitMerge, Key, Link2, RefreshCw } from "lucide-react";
import { sharedItems } from "./derive";
import { Ix } from "./icons";
import { Btn, Modal } from "./ui-bits";
import { maskFromLast4 } from "./derive";
import type { CallFn } from "@/lib/clavis/client";
import type { ClavisState, SharedDuplicateCluster } from "@/lib/clavis/types";

export interface SharedHomeProps {
  state: ClavisState;
  call: CallFn;
  readOnly: boolean;
}

function GroupChips({ names }: { names: string[] }) {
  return (
    <span className="flex flex-wrap items-center" style={{ gap: "var(--space-1)" }}>
      {names.length === 0 ? (
        <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>
          not in a group
        </span>
      ) : (
        names.map((n) => (
          <span
            key={n}
            className="glass-chip inline-flex items-center"
            style={{ gap: "var(--space-1)", padding: "calc(var(--space-1) / 2) var(--space-2)", fontSize: "var(--text-xs)" }}
          >
            <Ix icon={Link2} size="sm" style={{ width: "var(--text-xs)", height: "var(--text-xs)", color: "var(--color-accent-text)" }} />
            {n}
          </span>
        ))
      )}
    </span>
  );
}

/** One detected duplicate set: what it is, where the copies live, and the
 *  merge action (behind its own confirmation modal). */
function ClusterCard({
  cluster,
  readOnly,
  busy,
  onMerge,
}: {
  cluster: SharedDuplicateCluster;
  readOnly: boolean;
  busy: boolean;
  onMerge: (cluster: SharedDuplicateCluster) => void;
}) {
  return (
    <article
      className="glass-row flex flex-col"
      style={{ gap: "var(--space-2)", padding: "var(--space-3)" }}
      aria-label={`Duplicate credential ${cluster.name}`}
    >
      <div className="flex flex-wrap items-center" style={{ gap: "var(--space-2)" }}>
        <Ix icon={Key} size="sm" style={{ color: "var(--color-accent-text)" }} />
        <span className="truncate" style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)" }}>
          {cluster.name}
        </span>
        <span className="t-muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", flexShrink: 0 }}>
          {maskFromLast4(cluster.valueLast4)}
        </span>
        <span
          className="glass-chip"
          style={{ padding: "calc(var(--space-1) / 2) var(--space-2)", fontSize: "var(--text-xs)", flexShrink: 0 }}
        >
          {cluster.copies} {cluster.copies === 1 ? "copy" : "copies"}
        </span>
      </div>
      <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-xs)" }}>
        Same value in {cluster.groupNames.length} {cluster.groupNames.length === 1 ? "group" : "groups"} — change it once instead of {cluster.copies} times.
      </p>
      <ul className="flex flex-col" style={{ gap: "var(--space-1)", margin: 0, padding: 0, listStyle: "none" }}>
        {cluster.members.map((m) => (
          <li key={m.itemId} className="flex flex-wrap items-center justify-between" style={{ gap: "var(--space-2)" }}>
            <span className="truncate" style={{ fontSize: "var(--text-sm)" }}>
              {m.name}
            </span>
            <GroupChips names={m.groupNames} />
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Btn
          variant="primary"
          icon={GitMerge}
          label="Merge into one shared credential"
          onClick={() => onMerge(cluster)}
          disabled={readOnly || busy}
        />
      </div>
    </article>
  );
}

export function SharedHome({ state, call, readOnly }: SharedHomeProps) {
  /* null = the first scan is still running; [] = scanned and clean. */
  const [clusters, setClusters] = useState<SharedDuplicateCluster[] | null>(null);
  const [confirming, setConfirming] = useState<SharedDuplicateCluster | null>(null);
  const [merging, setMerging] = useState(false);

  const scan = useCallback(async () => {
    const res = await call("detectSharedDuplicates");
    setClusters(res.ok ? res.clusters ?? [] : []);
  }, [call]);

  /* Auto-scan on mount and after every mutation (each dispatched action
     returns a fresh state; the scan itself returns no state, so this can
     never loop). Results are name-only — values stay in the backend. */
  useEffect(() => {
    let alive = true;
    void call("detectSharedDuplicates").then((res) => {
      if (alive) setClusters(res.ok ? res.clusters ?? [] : []);
    });
    return () => {
      alive = false;
    };
  }, [call, state]);

  async function merge(cluster: SharedDuplicateCluster) {
    if (merging || readOnly) return;
    setMerging(true);
    const res = await call("mergeSharedDuplicates", {
      itemIds: cluster.members.map((m) => m.itemId),
    });
    setMerging(false);
    if (res.ok) {
      setConfirming(null);
      toast.success(
        `Merged ${cluster.copies} ${cluster.copies === 1 ? "copy" : "copies"} into one shared credential — “${cluster.name}”.`
      );
      /* The state in the response refreshes the app; the scan effect above
         re-runs on the new state and the cluster disappears. */
    } else {
      /* A stale confirmation (a copy was edited or deleted in between):
         the central call already surfaced the error; close the modal so
         the fresh scan tells the truth. */
      setConfirming(null);
    }
  }

  const sharedCount = sharedItems(state.data).length;

  return (
    <div
      className="clavis-scroll flex flex-col"
      style={{ gap: "var(--space-4)", overflowY: "auto", padding: "var(--space-4)", flex: 1, minHeight: 0 }}
    >
      <header className="flex flex-col" style={{ gap: "var(--space-2)" }}>
        <div className="flex items-center" style={{ gap: "var(--space-3)" }}>
          <Ix icon={Link2} size="lg" style={{ color: "var(--color-accent-text)" }} />
          <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: "var(--weight-semibold)" }}>
            Shared credentials
          </h2>
        </div>
        <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-sm)", lineHeight: "var(--leading-relaxed)" }}>
          Define a credential once — a GitHub token that works for every project — and add it to any
          number of groups. Change it once and every group updates.
          {sharedCount > 0 ? (
            <> You have {sharedCount} {sharedCount === 1 ? "shared credential" : "shared credentials"} so far.</>
          ) : null}
        </p>
      </header>

      <section className="flex flex-col" style={{ gap: "var(--space-2)" }} aria-label="Detected duplicates">
        <div className="flex items-center justify-between" style={{ gap: "var(--space-2)" }}>
          <span className="t-muted" style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-medium)", letterSpacing: "var(--tracking-label)", textTransform: "uppercase" }}>
            Detected duplicates
          </span>
          <Btn
            variant="ghost"
            icon={RefreshCw}
            label="Scan again"
            onClick={() => void scan()}
            title="Re-scan the vault for identical values across groups"
          />
        </div>

        {clusters === null ? (
          <p className="t-muted" role="status" style={{ margin: 0, fontSize: "var(--text-sm)" }}>
            Scanning your vault for identical values across groups…
          </p>
        ) : clusters.length === 0 ? (
          <div className="flex items-center" style={{ gap: "var(--space-2)", padding: "var(--space-2) 0" }}>
            <Ix icon={Check} size="sm" style={{ color: "var(--color-accent-text)" }} />
            <span className="t-muted" style={{ fontSize: "var(--text-sm)" }}>
              No duplicates detected — every value that appears in several groups is already one
              shared credential. Matching ignores leading/trailing spaces; quotes and letter case
              still have to match.
            </span>
          </div>
        ) : (
          <>
            <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-sm)" }}>
              Clavis found {clusters.length} {clusters.length === 1 ? "credential" : "credentials"}{" "}
              with the same value in several groups. Merge {clusters.length === 1 ? "it" : "them"}{" "}
              into one shared credential and future changes happen once.
            </p>
            {clusters.map((c) => (
              <ClusterCard key={c.itemId} cluster={c} readOnly={readOnly} busy={merging} onMerge={setConfirming} />
            ))}
          </>
        )}
      </section>

      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={`Merge ${confirming?.copies ?? 0} copies into one shared credential`}
        width="min(500px, calc(100vw - var(--space-6)))"
        footer={
          <>
            <Btn variant="ghost" label="Cancel" onClick={() => setConfirming(null)} disabled={merging} />
            <Btn
              variant="primary"
              icon={GitMerge}
              label={merging ? "Merging…" : "Merge into one"}
              onClick={() => confirming && void merge(confirming)}
              disabled={merging || readOnly}
            />
          </>
        }
      >
        {confirming ? (
          <>
            <p className="t-muted" style={{ margin: "0 0 var(--space-3) 0", fontSize: "var(--text-sm)" }}>
              These {confirming.copies} items hold the same value. Clavis will keep{" "}
              <strong>“{confirming.name}”</strong> as one shared credential and point every group at
              it:
            </p>
            <ul className="flex flex-col" style={{ gap: "var(--space-1)", margin: "0 0 var(--space-3) 0", padding: 0, listStyle: "none" }}>
              {confirming.groupNames.map((n) => (
                <li key={n} className="glass-row flex items-center" style={{ gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)" }}>
                  <Ix icon={Link2} size="sm" style={{ color: "var(--color-accent-text)" }} />
                  <span style={{ fontSize: "var(--text-sm)" }}>{n}</span>
                </li>
              ))}
            </ul>
            <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-sm)", lineHeight: "var(--leading-relaxed)" }}>
              The {Math.max(confirming.copies - 1, 0)} extra{" "}
              {Math.max(confirming.copies - 1, 0) === 1 ? "copy moves" : "copies move"} to the Trash —
              recoverable for 30 days. From then on, changing the value once updates every group at
              once.
            </p>
            <p className="t-muted" style={{ margin: "var(--space-3) 0 0 0", fontSize: "var(--text-sm)", lineHeight: "var(--leading-relaxed)" }}>
              Matching ignores leading/trailing spaces — the surviving copy keeps its stored value
              exactly as it is.
            </p>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
