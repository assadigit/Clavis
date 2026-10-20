/**
 * CLAVIS — manager entry (desktop).
 *
 * Runs inside the Manager window (§3.4): the app's own title bar, the
 * three-column body, banners (read-only / recovery / shortcut conflict),
 * the central delete+undo toast, and cross-window requests from the popup
 * (Ctrl+N / Ctrl+E). The window itself is a transparent, frameless native
 * window; this entry draws the floating glass frame with the shadow pad.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster, toast } from "sonner";
import { AlertTriangle, ShieldAlert, X } from "lucide-react";
import { apiCall, fetchState } from "@/lib/clavis/client";
import type { ApiResult } from "@/lib/clavis/client";
import type { ClavisState } from "@/lib/clavis/types";
import type { Creating, ListFilter, Selection } from "@/components/clavis/app-types";
import { applyTheme } from "@/components/clavis/glass";
import { Manager } from "@/components/clavis/manager";
import { Ix } from "@/components/clavis/icons";
import { platform } from "@/desktop/platform";

import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono";
import "@/globals.css";

function entryName(state: ClavisState, kind: "item" | "group", id: string): string {
  if (kind === "item") return state.data.items.find((i) => i.id === id)?.name ?? "item";
  return state.data.groups.find((g) => g.id === id)?.name ?? "group";
}

function FullMessage({ title, text }: { title: string; text: string }) {
  return (
    <div className="clavis-app-shell fixed inset-0 flex flex-col items-center justify-center" style={{ gap: "var(--space-3)", padding: "var(--space-5)", textAlign: "center" }}>
      <Ix icon={AlertTriangle} size="xl" style={{ color: "var(--color-accent-text)" }} />
      <h1 style={{ margin: 0, fontSize: "var(--text-xl)", fontWeight: "var(--weight-semibold)" }}>{title}</h1>
      <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-sm)", maxWidth: "calc(var(--space-6) * 18)" }}>
        {text}
      </p>
    </div>
  );
}

function RecoveredBanner({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div
      className="glass-panel fixed left-1/2 top-0 flex -translate-x-1/2 flex-wrap items-center justify-center"
      role="alert"
      style={{ zIndex: 90, margin: "var(--space-3)", maxWidth: "calc(100vw - var(--space-6))", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)" }}
    >
      <Ix icon={ShieldAlert} size="sm" style={{ color: "var(--color-warning-text)" }} />
      <span className="t-warning" style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-medium)" }}>
        Recovered
      </span>
      <span style={{ fontSize: "var(--text-sm)" }}>{text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notice"
        className="clavis-btn clavis-btn-ghost"
        style={{ padding: "var(--space-1)" }}
      >
        <Ix icon={X} size="sm" />
      </button>
    </div>
  );
}

function ShortcutConflictBanner({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div
      className="glass-panel fixed left-1/2 bottom-0 flex -translate-x-1/2 flex-wrap items-center justify-center"
      role="alert"
      style={{ zIndex: 90, margin: "var(--space-3)", maxWidth: "calc(100vw - var(--space-6))", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)" }}
    >
      <Ix icon={AlertTriangle} size="sm" style={{ color: "var(--color-warning-text)" }} />
      <span className="t-warning" style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-medium)" }}>
        Shortcut
      </span>
      <span style={{ fontSize: "var(--text-sm)" }}>{text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notice"
        className="clavis-btn clavis-btn-ghost"
        style={{ padding: "var(--space-1)" }}
      >
        <Ix icon={X} size="sm" />
      </button>
    </div>
  );
}

function ManagerRoot() {
  const [state, setState] = useState<ClavisState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shortcutConflict, setShortcutConflict] = useState<string | null>(null);
  const [filter, setFilter] = useState<ListFilter>({ view: "all" });
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [creating, setCreating] = useState<Creating | null>(null);
  const [maximized, setMaximized] = useState(false);

  const stateRef = useRef<ClavisState | null>(null);

  /* ---- edge-to-edge when the native window is maximized ---- */
  useEffect(() => {
    const onResize = () => setMaximized(window.innerWidth >= window.screen.availWidth - 8);
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* ---- load ---- */
  useEffect(() => {
    let alive = true;
    fetchState()
      .then((s) => {
        if (alive) setState(s);
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(err instanceof Error ? err.message : "Could not load your Clavis data.");
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    stateRef.current = state;
    if (state) {
      /* Dark mode is a pure user preference now — the flat Bitwarden theme
         needs no OS transparency, so osTransparency no longer forces it. */
      applyTheme(state.data.settings.solidMode);
    }
  }, [state]);

  /* ---- shortcut conflict notice (§3.3) ---- */
  useEffect(() => {
    const off = platform.onShortcutConflict((message) => setShortcutConflict(message));
    return off;
  }, []);

  /* ---- cross-window requests from the popup (Ctrl+N / Ctrl+E) ---- */
  useEffect(() => {
    const offNew = platform.onManagerNewItem((prefill) => {
      setSelection(null);
      setCreating({ kind: "item", prefillName: prefill || undefined });
      setFilter((f) => (f.view === "settings" || f.view === "trash" ? { view: "all" } : f));
    });
    const offOpen = platform.onManagerOpenEntry((kind, id) => {
      if (kind === "item" || kind === "group") {
        setCreating(null);
        setSelection({ kind, id });
        setFilter((f) => (f.view === "settings" || f.view === "trash" ? { view: "all" } : f));
      }
    });
    return () => {
      offNew();
      offOpen();
    };
  }, []);

  /* ---- Ctrl+N inside the Manager too ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof Element && t.closest("[data-shortcut-capture]") !== null) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setSelection(null);
        setCreating({ kind: "item" });
        setFilter((f) => (f.view === "settings" || f.view === "trash" ? { view: "all" } : f));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  /* ---- API wrapper (mirrors the web edition) ---- */
  const call = useCallback(async (action: string, payload: Record<string, unknown> = {}): Promise<ApiResult> => {
    const res = await apiCall(action, payload);
    if (res.ok) {
      if (res.state) setState(res.state);
      return res;
    }
    if (res.status === 409) {
      toast.error(res.error ?? "Clavis is read-only right now.");
      try {
        setState(await fetchState());
      } catch {
        /* keep the old snapshot */
      }
    } else {
      toast.error(res.error ?? "Something went wrong.");
    }
    return res;
  }, []);

  /* ---- central delete + undo toast (§5.7) ---- */
  const deleteEntry = useCallback(
    (kind: "item" | "group", id: string) => {
      const snap = stateRef.current;
      const name = snap ? entryName(snap, kind, id) : "entry";
      void call("deleteEntry", { kind, id }).then((res) => {
        if (res.ok && res.undoToken) {
          toast(`Deleted “${name}”`, {
            duration: 8000,
            action: {
              label: "Undo",
              onClick: () => {
                void call("undoDelete", { undoToken: res.undoToken }).then((r) => {
                  if (r.ok) toast.success(`Restored “${name}”.`);
                });
              },
            },
          });
        }
      });
    },
    [call]
  );

  const dismissRecovered = useCallback(() => {
    void call("clearRecoveredNotice", {});
  }, [call]);

  let body: React.ReactNode;
  if (state === null) {
    body =
      loadError !== null ? (
        <FullMessage title="Clavis could not load" text={loadError} />
      ) : (
        <FullMessage title="Clavis" text="Loading your keys…" />
      );
  } else {
    body = (
      <>
        <Manager
          state={state}
          call={call}
          readOnly={state.readOnly}
          filter={filter}
          setFilter={setFilter}
          query={query}
          setQuery={setQuery}
          selection={selection}
          setSelection={setSelection}
          creating={creating}
          setCreating={setCreating}
          onHide={() => platform.hideManager()}
          deleteEntry={deleteEntry}
        />
        {state.recoveredNotice ? (
          <RecoveredBanner text={state.recoveredNotice} onDismiss={dismissRecovered} />
        ) : null}
        {shortcutConflict ? (
          <ShortcutConflictBanner text={shortcutConflict} onDismiss={() => setShortcutConflict(null)} />
        ) : null}
      </>
    );
  }

  return (
    <>
      {/* The floating glass frame: the window is transparent and frameless;
          the app draws its rounded surface + shadow inside the pad (§7). */}
      <div className={maximized ? "clavis-desk-manager is-max" : "clavis-desk-manager"}>
        <div className="clavis-window-frame clavis-desk-frame">{body}</div>
      </div>
      <Toaster position="bottom-center" duration={4000} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<ManagerRoot />);
