/**
 * CLAVIS — modal shell. Moved from ui-bits.tsx (move-only; ui-bits.tsx
 * re-exports the public surface).
 *
 * UI-audit round 1, Phase 3 (F-004): the modal now owns the keyboard —
 * focus starts inside the dialog, Tab/Shift+Tab cycle within it, and focus
 * returns to the opener on close (any close path: Esc via useEscStack,
 * scrim, the X button, or the parent unmounting the modal).
 */
"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Ix } from "../icons";
import { useEscStack } from "./dismiss";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* jsdom has no layout engine: offsetParent is null for EVERY element there,
   which would filter out every focusable. Probe once whether layout exists. */
let layoutSupported: boolean | null = null;
function hasLayout(): boolean {
  if (layoutSupported === null) {
    const probe = document.createElement("div");
    document.body.appendChild(probe);
    layoutSupported = probe.offsetParent !== null;
    probe.remove();
  }
  return layoutSupported;
}

function focusablesIn(panel: HTMLElement): HTMLElement[] {
  const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (!hasLayout()) return nodes;
  return nodes.filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEscStack(open, onClose);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  /* F-004: capture the opener DURING the render that opens the dialog —
     before the panel's DOM exists. (An effect would be too late: autoFocus
     inputs already grab focus during the commit, and the panel itself would
     be captured as its own opener.) Reading activeElement in render is a
     harmless DOM read — no state is touched. */
  if (open && !wasOpenRef.current) {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpenRef.current = open;

  useEffect(() => {
    if (!open) return;
    /* Land focus inside the dialog — unless something already took focus
       (the manage-items modal's search input uses autoFocus: don't steal). */
    const panel = panelRef.current;
    if (panel) {
      const inside =
        document.activeElement instanceof Node && panel.contains(document.activeElement);
      if (!inside) {
        const nodes = focusablesIn(panel);
        (nodes.length > 0 ? nodes[0] : panel).focus();
      }
    }
    return () => {
      const el = openerRef.current;
      openerRef.current = null;
      if (el && el.isConnected) el.focus();
    };
  }, [open]);

  if (!open) return null;

  function trapTab(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const panel = e.currentTarget;
    const nodes = focusablesIn(panel);
    const active = document.activeElement;
    /* Focus somehow left the panel: pull it back to the start. */
    if (nodes.length === 0 || !(active instanceof Node) || !panel.contains(active)) {
      e.preventDefault();
      (nodes[0] ?? panel).focus();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 80 }}>
      <div className="clavis-scrim absolute inset-0" onMouseDown={onClose} aria-hidden />
      <div
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={trapTab}
        className="glass-panel clavis-pop-in relative flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : "Clavis dialog"}
        style={{
          width: width ?? "min(560px, calc(100vw - var(--space-6)))",
          maxHeight: "calc(var(--clavis-modal-vh, 100dvh) - var(--space-6))",
          outline: "none",
        }}
      >
        <header
          className="flex items-center justify-between"
          style={{ padding: "var(--space-4) var(--space-5)", gap: "var(--space-3)" }}
        >
          <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: "var(--weight-semibold)" }}>{title}</h2>
          <button
            type="button"
            className="clavis-btn clavis-btn-ghost"
            onClick={onClose}
            aria-label="Close dialog"
            style={{ padding: "var(--space-1)" }}
          >
            <Ix icon={X} size="sm" />
          </button>
        </header>
        <div className="clavis-scroll" style={{ padding: "0 var(--space-5) var(--space-5)", overflowY: "auto" }}>
          {children}
        </div>
        {footer ? (
          <footer
            className="flex flex-wrap items-center justify-end"
            style={{ gap: "var(--space-2)", padding: "var(--space-4) var(--space-5)", borderTop: "1px solid var(--glass-border)" }}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
