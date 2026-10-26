/**
 * CLAVIS — popup root (desktop, §3.1): data load + retry, show/hide
 * lifecycle, window sizing, the palette mount.
 *
 * Runs inside the pre-created popup window. The window is shown and hidden
 * by Go (global shortcut / tray); the palette mounts only while the window
 * is open — every show is a fresh mount (query cleared, selection at top,
 * copy state cleared, autofocus — §3.3b) — and the window keeps itself
 * sized to the panel (height grows with the rows, §3.3b).
 *
 * If the very first data load fails the window used to stay blank until an
 * app restart (the fetch ran exactly once at mount). Now it shows a small
 * retry panel instead, and every later show retries silently for as long
 * as there is no data.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Toaster } from "sonner";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { apiCall, fetchState } from "@/lib/clavis/client";
import type { ApiResult } from "@/lib/clavis/client";
import type { ClavisState } from "@/lib/clavis/types";
import type { Selection } from "./app-types";
import { applyTheme } from "./glass";
import { Popup } from "./popup";
import { Btn } from "./ui-bits";
import { Ix } from "./icons";
import { platform } from "@/desktop/platform";

export function PopupRoot() {
  const [state, setState] = useState<ClavisState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const selRef = useRef<Selection | null>(null);
  const aliveRef = useRef(true);
  const loadingRef = useRef(false);

  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );

  /* ---- load (one in-flight request at a time) ---- */
  const load = useCallback(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    fetchState()
      .then((s) => {
        if (!aliveRef.current) return;
        setState(s);
        setLoadFailed(false);
      })
      .catch(() => {
        if (aliveRef.current) setLoadFailed(true);
      })
      .finally(() => {
        loadingRef.current = false;
      });
  }, []);

  useEffect(() => {
    load(); // eager: the data is ready before the first hotkey press
  }, [load]);

  /* Still no data when the window comes back? Retry silently — the first
     failure must not brick the popup until an app restart. */
  useEffect(() => {
    if (open && !state) load();
  }, [open, state, load]);

  useEffect(() => {
    if (state) {
      /* Dark mode is a pure user preference now — the flat Bitwarden theme
         needs no OS transparency, so osTransparency no longer forces it. */
      applyTheme(state.data.settings.solidMode);
    }
  }, [state]);

  /* ---- open/close follows the Go window (§3.3b) ---- */
  useEffect(() => {
    const offs = [
      platform.onPopupShown(() => setOpen(true)),
      platform.onPopupHidden(() => setOpen(false)),
    ];
    const onVisibility = () => setOpen(document.visibilityState === "visible");
    onVisibility(); // browser tabs start visible; hidden windows stay closed
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      offs.forEach((off) => off());
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  /* The window can be shown without OS focus in edge cases (Go forces the
     foreground, but be defensive): whenever the window gains focus, put it
     in the search box so typing always lands in the palette. */
  useEffect(() => {
    if (!open) return;
    const onFocus = () => {
      const el = document.querySelector<HTMLInputElement>('input[aria-label="Search Clavis"]');
      if (el && document.activeElement !== el) el.focus();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [open]);

  /* ---- keep the window sized to the panel + shadow pad (§3.3b) ---- */
  useEffect(() => {
    if (!open || typeof ResizeObserver === "undefined") return;
    const el = document.querySelector<HTMLElement>(".clavis-pop-in");
    if (!el) return;
    const push = () => {
      const w = Math.ceil(el.offsetWidth);
      const h = Math.ceil(el.offsetHeight);
      if (w > 0 && h > 0) {
        /* The window IS the panel now — no shadow pad (solid background). */
        platform.setPopupSize(w, h);
      }
    };
    push();
    const ro = new ResizeObserver(push);
    ro.observe(el);
    return () => ro.disconnect();
    /* loadFailed: the retry panel replaces the palette and must be sized
       too (it also carries .clavis-pop-in). */
  }, [open, state, loadFailed]);

  /* ---- Ctrl+N / Ctrl+E open the Manager (§5.2) ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof Element && t.closest("[data-shortcut-capture]") !== null) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === "n") {
          e.preventDefault();
          platform.managerNewItem();
        } else if (k === "e") {
          e.preventDefault();
          const sel = selRef.current;
          if (sel) platform.managerOpenEntry(sel.kind, sel.id);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const call = useCallback(async (action: string, payload: Record<string, unknown> = {}): Promise<ApiResult> => {
    const res = await apiCall(action, payload);
    if (res.ok) {
      if (res.state) setState(res.state);
      return res;
    }
    if (res.status === 409) {
      try {
        setState(await fetchState());
      } catch {
        /* keep the old snapshot */
      }
    }
    return res;
  }, []);

  const onHide = useCallback(() => {
    setOpen(false);
    platform.hidePopup();
  }, []);

  if (!state) {
    /* First load still in flight (window hidden): nothing to paint. */
    if (!loadFailed) return null;
    /* First load failed: paint the retry panel instead of a blank window. */
    return (
      <>
        <PopupLoadError onRetry={load} onHide={onHide} />
        <Toaster position="bottom-center" duration={2500} />
      </>
    );
  }

  return (
    <>
      {/* Mounted only while the window is open: every show starts fresh —
          query cleared, selection at the top, copy state cleared, autofocus.
          (Keeping it mounted across hides left a stale "copied" state that
          blocked every keystroke on the next show — the stuck search bar.) */}
      {open ? (
        <Popup
          open={open}
          onHide={onHide}
          state={state}
          call={call}
          fill
          onOpenManagerNewItem={(prefillName) => {
            platform.managerNewItem(prefillName);
            onHide();
          }}
          onOpenManager={() => {
            onHide();
            platform.showManager();
          }}
          onReportSelection={(sel) => {
            selRef.current = sel;
          }}
        />
      ) : null}
      <Toaster position="bottom-center" duration={2500} />
    </>
  );
}

/** The load-failure panel: same glass-panel look, retry + Esc to close. */
function PopupLoadError({ onRetry, onHide }: { onRetry: () => void; onHide: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onHide();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onHide]);
  return (
    <div className="clavis-desk-popup fixed inset-0" role="alertdialog" aria-label="Clavis could not load your data">
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "18vh" }}>
        <div className="clavis-pop-in relative">
          <div
            className="glass-panel relative flex flex-col items-center text-center"
            style={{ gap: "var(--space-3)", padding: "var(--space-6)", width: "min(560px, calc(100vw - var(--space-6)))" }}
          >
            <Ix icon={AlertTriangle} size="md" style={{ color: "var(--color-danger-text)" }} />
            <span style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)" }}>
              Couldn&apos;t load your Clavis data
            </span>
            <span className="t-muted" style={{ fontSize: "var(--text-xs)", lineHeight: 1.5 }}>
              The data folder could not be read. Check that it still exists and that Clavis can open it — then try again.
            </span>
            <Btn variant="primary" icon={RefreshCw} label="Try again" onClick={onRetry} ariaLabel="Retry loading your data" />
          </div>
        </div>
      </div>
    </div>
  );
}
