/**
 * CLAVIS — popup entry (desktop).
 *
 * Runs inside the pre-created popup window (§3.1). The window is shown and
 * hidden by Go (global shortcut / tray); this entry mounts the palette only
 * while the window is open — every show is a fresh mount (query cleared,
 * selection at top, copy state cleared, autofocus — §3.3b) and keeps the
 * window sized to the panel (height grows with the rows, §3.3b).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { apiCall, fetchState } from "@/lib/clavis/client";
import type { ApiResult } from "@/lib/clavis/client";
import type { ClavisState } from "@/lib/clavis/types";
import type { Selection } from "@/components/clavis/app-types";
import { applyTheme } from "@/components/clavis/glass";
import { Popup } from "@/components/clavis/popup";
import { platform } from "@/desktop/platform";

import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono";
import "@/globals.css";

function PopupRoot() {
  const [state, setState] = useState<ClavisState | null>(null);
  const [open, setOpen] = useState(false);
  const selRef = useRef<Selection | null>(null);

  /* ---- load ---- */
  useEffect(() => {
    let alive = true;
    fetchState()
      .then((s) => alive && setState(s))
      .catch(() => {
        /* the window stays blank on failure; retry on next show */
      });
    return () => {
      alive = false;
    };
  }, []);

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
  }, [open, state]);

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
    return null; // hidden window, nothing to paint yet
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

createRoot(document.getElementById("root")!).render(<PopupRoot />);
