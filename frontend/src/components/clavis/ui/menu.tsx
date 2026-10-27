/**
 * CLAVIS — dropdown / context menu. Moved from ui-bits.tsx (move-only;
 * ui-bits.tsx re-exports the public surface).
 */
"use client";

import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Ix } from "../icons";
import { useDismiss } from "./dismiss";
import type { BtnVariant } from "./buttons";

export function Menu({
  triggerIcon,
  triggerLabel,
  triggerTitle,
  triggerStyle,
  triggerClassName,
  triggerVariant = "glass",
  align = "end",
  direction = "down",
  disabled,
  menuStyle,
  children,
}: {
  triggerIcon?: LucideIcon;
  triggerLabel?: ReactNode;
  triggerTitle?: string;
  triggerStyle?: CSSProperties;
  triggerClassName?: string;
  triggerVariant?: BtnVariant;
  align?: "start" | "end";
  direction?: "down" | "up";
  disabled?: boolean;
  menuStyle?: CSSProperties;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);

  const pos: CSSProperties =
    direction === "down"
      ? { top: "100%", marginTop: "var(--space-1)" }
      : { bottom: "100%", marginBottom: "var(--space-1)" };
  if (align === "end") pos.right = 0;
  else pos.left = 0;

  const v =
    triggerVariant === "primary"
      ? "clavis-btn-primary"
      : triggerVariant === "danger"
        ? "clavis-btn-danger"
        : triggerVariant === "ghost"
          ? "clavis-btn-ghost"
          : "clavis-btn-glass";

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        disabled={disabled}
        title={triggerTitle}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`clavis-btn ${v} ${triggerClassName ?? ""}`}
        style={triggerStyle}
      >
        {triggerIcon ? <Ix icon={triggerIcon} size="sm" /> : null}
        {triggerLabel !== undefined ? <span>{triggerLabel}</span> : null}
      </button>
      {open ? (
        <div role="menu" className="clavis-menu absolute clavis-pop-in" style={{ zIndex: 60, ...pos, ...menuStyle }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  icon,
  label,
  danger,
  disabled,
  onClick,
  hint,
}: {
  icon?: LucideIcon;
  label: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /** Optional one-line warning under the label (UI-audit round 1 Phase 4,
   * F-003 — e.g. the plaintext warning on export items). */
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      data-danger={danger ? "true" : undefined}
      className="clavis-menu-item"
      onClick={onClick}
    >
      {icon ? (
        <Ix icon={icon} size="sm" style={danger ? { color: "var(--color-danger-text)" } : undefined} />
      ) : null}
      <span style={{ whiteSpace: "nowrap" }}>
        <span style={{ display: "block" }}>{label}</span>
        {hint ? (
          <span
            className="t-warning"
            style={{ display: "block", whiteSpace: "normal", fontSize: "var(--text-xs)", maxWidth: "calc(var(--space-6) * 11)", lineHeight: 1.3 }}
          >
            {hint}
          </span>
        ) : null}
      </span>
    </button>
  );
}
