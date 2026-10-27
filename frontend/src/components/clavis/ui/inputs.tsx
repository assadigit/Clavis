/**
 * CLAVIS — form inputs and section headers. Moved from ui-bits.tsx
 * (move-only; ui-bits.tsx re-exports the public surface).
 */
"use client";

import type { CSSProperties, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { Ix } from "../icons";

export const inputStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  fontSize: "var(--text-sm)",
  fontFamily: "var(--font-ui)",
  fontWeight: "var(--weight-regular)",
  color: "var(--text)",
  width: "100%",
};

export function TextInput({
  style,
  className,
  mono,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return (
    <input
      {...rest}
      className={`glass-input ${className ?? ""}`}
      style={{ ...inputStyle, fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)", ...style }}
    />
  );
}

export function TextArea({
  style,
  className,
  mono,
  rows = 5,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean; rows?: number }) {
  return (
    <textarea
      {...rest}
      rows={rows}
      className={`glass-input clavis-scroll ${className ?? ""}`}
      style={{
        ...inputStyle,
        fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)",
        resize: "vertical",
        lineHeight: "var(--leading-normal)",
        ...style,
      }}
    />
  );
}

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="t-muted"
      style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-medium)", letterSpacing: "var(--tracking-input)" }}
    >
      {children}
    </label>
  );
}

/** Small muted hint rendered directly under a field it explains. */
export function FieldHint({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p id={id} className="t-muted" style={{ margin: 0, fontSize: "var(--text-xs)" }}>
      {children}
    </p>
  );
}

export function SectionHeader({ icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center" style={{ gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
      <Ix icon={icon} size="md" style={{ color: "var(--color-accent-text)" }} />
      <h2 style={{ margin: 0, fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)" }}>{title}</h2>
    </div>
  );
}
