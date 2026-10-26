/**
 * CLAVIS — toggle switch + checkbox. Moved from ui-bits.tsx (move-only;
 * ui-bits.tsx re-exports the public surface).
 */
"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Ix } from "../icons";

export function Toggle({
  checked,
  onChange,
  label,
  note,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  note?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="clavis-focusable flex items-center"
      style={{
        gap: "var(--space-3)",
        cursor: disabled ? "not-allowed" : "pointer",
        textAlign: "left",
        opacity: disabled ? 0.5 : 1,
        background: "transparent",
        border: "none",
        padding: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          width: "calc(var(--space-5) + var(--space-4))",
          height: "calc(var(--space-4) + var(--space-1))",
          borderRadius: "var(--radius-chip)",
          border: "1px solid var(--glass-border)",
          background: checked ? "var(--color-primary)" : "var(--control-track)",
          display: "inline-flex",
          alignItems: "center",
          padding: "calc(var(--space-1) / 2)",
          transition: `background var(--motion-toast) var(--ease)`,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: "var(--space-4)",
            height: "var(--space-4)",
            borderRadius: "var(--radius-chip)",
            background: "var(--text-on-primary)",
            transform: checked ? "translateX(calc(var(--space-4) + var(--space-1)))" : "translateX(0)",
            transition: `transform var(--motion-toast) var(--ease)`,
          }}
        />
      </span>
      <span className="flex flex-col" style={{ gap: "calc(var(--space-1) / 2)" }}>
        <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-medium)", color: "var(--text)" }}>{label}</span>
        {note ? (
          <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>
            {note}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function CheckBox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="clavis-focusable flex items-center"
      style={{ gap: "var(--space-2)", cursor: disabled ? "not-allowed" : "pointer", textAlign: "left", padding: 0, border: "none", background: "transparent" }}
    >
      <span
        aria-hidden
        style={{
          width: "var(--text-lg)",
          height: "var(--text-lg)",
          borderRadius: "var(--radius-row)",
          border: "1px solid var(--glass-border)",
          background: checked ? "var(--color-primary)" : "var(--glass-bg)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {checked ? <Ix icon={Check} size="sm" style={{ color: "var(--text-on-primary)", width: "var(--text-sm)", height: "var(--text-sm)" }} /> : null}
      </span>
      <span style={{ fontSize: "var(--text-sm)", color: "var(--text)" }}>{label}</span>
    </button>
  );
}
