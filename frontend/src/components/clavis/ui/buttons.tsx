/**
 * CLAVIS — token-styled button. Moved from ui-bits.tsx (move-only;
 * ui-bits.tsx re-exports the public surface).
 */
"use client";

import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Ix } from "../icons";

export type BtnVariant = "primary" | "glass" | "ghost" | "danger";

/* The variant → class mapping, exported for the Menu trigger (F-014,
   UI-audit round 1 Phase 10): one definition instead of two drifting ones. */
export function btnClasses(variant: BtnVariant): string {
  return variant === "primary"
    ? "clavis-btn-primary"
    : variant === "danger"
      ? "clavis-btn-danger"
      : variant === "ghost"
        ? "clavis-btn-ghost"
        : "clavis-btn-glass";
}

export function Btn({
  variant = "glass",
  icon,
  label,
  onClick,
  onMouseDown,
  disabled,
  title,
  type = "button",
  style,
  className,
  ariaLabel,
}: {
  variant?: BtnVariant;
  icon?: LucideIcon;
  label?: ReactNode;
  onClick?: () => void;
  onMouseDown?: () => void;
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
  style?: CSSProperties;
  className?: string;
  ariaLabel?: string;
}) {
  const v = btnClasses(variant);
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={onMouseDown}
      title={title}
      aria-label={ariaLabel ?? (title && label === undefined ? title : undefined)}
      className={`clavis-btn ${v} ${className ?? ""}`}
      style={style}
    >
      {icon ? <Ix icon={icon} size="sm" /> : null}
      {label !== undefined ? <span>{label}</span> : null}
    </button>
  );
}
