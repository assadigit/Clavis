/**
 * CLAVIS — shared load-failure retry panel (UI-audit round 1, Phase 2; F-001).
 * Extracted from popup-root.tsx's PopupLoadError so both windows offer the
 * same "Try again" affordance instead of only the popup. Purely visual —
 * the caller owns any Esc handling (the popup keeps its Esc-to-hide effect;
 * the manager has none, its window hides to tray normally).
 */
"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Btn } from "./buttons";
import { Ix } from "../icons";

export function LoadErrorPanel({
  title,
  body,
  onRetry,
  retryLabel,
}: {
  title: string;
  body: string;
  onRetry: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="clavis-desk-popup fixed inset-0" role="alertdialog" aria-label={title}>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "18vh" }}>
        <div className="clavis-pop-in relative">
          <div
            className="glass-panel relative flex flex-col items-center text-center"
            style={{ gap: "var(--space-3)", padding: "var(--space-6)", width: "min(560px, calc(100vw - var(--space-6)))" }}
          >
            <Ix icon={AlertTriangle} size="md" style={{ color: "var(--color-danger-text)" }} />
            <span style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)" }}>
              {title}
            </span>
            <span className="t-muted" style={{ fontSize: "var(--text-xs)", lineHeight: "var(--leading-normal)" }}>
              {body}
            </span>
            <Btn variant="primary" icon={RefreshCw} label={retryLabel ?? "Try again"} onClick={onRetry} ariaLabel="Retry loading your data" />
          </div>
        </div>
      </div>
    </div>
  );
}
