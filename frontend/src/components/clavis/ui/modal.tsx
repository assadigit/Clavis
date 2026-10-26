/**
 * CLAVIS — modal shell. Moved from ui-bits.tsx (move-only; ui-bits.tsx
 * re-exports the public surface).
 */
"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Ix } from "../icons";
import { useEscStack } from "./dismiss";

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
  if (!open) return null;
  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 80 }}>
      <div className="clavis-scrim absolute inset-0" onMouseDown={onClose} aria-hidden />
      <div
        className="glass-panel clavis-pop-in relative flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : "Clavis dialog"}
        style={{
          width: width ?? "min(560px, calc(100vw - var(--space-6)))",
          maxHeight: "calc(var(--clavis-modal-vh, 100dvh) - var(--space-6))",
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
