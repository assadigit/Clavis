/**
 * CLAVIS — small token-styled UI kit shared by the manager, popup and
 * settings (menus, modals, toggles, tag chips, category picker).
 * Every visual value is a var() from design-tokens.css.
 */
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { Check, ChevronDown, Hash, Plus, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CallFn } from "@/lib/clavis/client";
import type { Category } from "@/lib/clavis/types";
import { Ix } from "./icons";

/* ------------------------------------------------------------------ */
/* Escape stack: only the topmost overlay closes on Esc.               */
/* ------------------------------------------------------------------ */

const escStack: Array<() => void> = [];

function escDocHandler(ev: KeyboardEvent) {
  if (ev.key !== "Escape") return;
  const top = escStack[escStack.length - 1];
  if (top) {
    ev.stopPropagation();
    ev.preventDefault();
    top();
  }
}
if (typeof document !== "undefined") {
  document.addEventListener("keydown", escDocHandler, true);
}

function useEscStack(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return undefined;
    escStack.push(onClose);
    return () => {
      const i = escStack.indexOf(onClose);
      if (i >= 0) escStack.splice(i, 1);
    };
  }, [open, onClose]);
}

/** Outside-pointer + Esc dismissal for popovers (menus, suggestions). */
export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEscStack(open, onClose);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (ev: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [open, onClose]);
  return ref;
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

export type BtnVariant = "primary" | "glass" | "ghost" | "danger";

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
  const v =
    variant === "primary"
      ? "clavis-btn-primary"
      : variant === "danger"
        ? "clavis-btn-danger"
        : variant === "ghost"
          ? "clavis-btn-ghost"
          : "clavis-btn-glass";
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

/* ------------------------------------------------------------------ */
/* Menu (dropdown / context menu)                                      */
/* ------------------------------------------------------------------ */

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
}: {
  icon?: LucideIcon;
  label: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
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
      <span style={{ whiteSpace: "nowrap" }}>{label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Toggle + checkbox                                                   */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

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
        lineHeight: 1.5,
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
      style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-medium)", letterSpacing: "0.02em" }}
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
      <h3 style={{ margin: 0, fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)" }}>{title}</h3>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tag chips input with autocomplete                                   */
/* ------------------------------------------------------------------ */

export function TagInput({
  value,
  onChange,
  suggestions,
  disabled,
  id,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
  disabled?: boolean;
  id?: string;
}) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const close = useCallback(() => {
    setOpen(false);
    setHighlight(-1);
  }, []);
  const ref = useDismiss(open, close);

  const lower = input.trim().toLowerCase();
  const matches = useMemo(() => {
    const have = new Set(value.map((t) => t.toLowerCase()));
    return suggestions
      .filter(
        (t) => !have.has(t.toLowerCase()) && (lower === "" || t.toLowerCase().includes(lower))
      )
      .slice(0, 6);
  }, [suggestions, value, lower]);

  const commit = useCallback(
    (raw: string) => {
      const t = raw.trim();
      if (t === "") return;
      const existing = [...value, ...suggestions].find((x) => x.toLowerCase() === t.toLowerCase());
      const tag = existing ?? t;
      if (!value.some((x) => x.toLowerCase() === tag.toLowerCase())) {
        onChange([...value, tag]);
      }
      setInput("");
      close();
    },
    [value, suggestions, onChange, close]
  );

  return (
    <div ref={ref} className="relative">
      <div
        className="glass-input flex flex-wrap items-center"
        style={{ padding: "calc(var(--space-1) * 1.5)", gap: "var(--space-1)", cursor: "text" }}
        onClick={() => {
          if (!disabled) {
            setOpen(true);
            document.getElementById(id ?? "clavis-tag-input")?.focus();
          }
        }}
      >
        {value.map((t) => (
          <span
            key={t}
            className="glass-chip inline-flex items-center"
            style={{ padding: "calc(var(--space-1) / 2) var(--space-2)", gap: "var(--space-1)", fontSize: "var(--text-xs)", color: "var(--text)" }}
          >
            {t}
            <button
              type="button"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((x) => x !== t));
              }}
              aria-label={`Remove tag ${t}`}
              className="clavis-focusable"
              style={{ display: "inline-flex", color: "var(--text-muted)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
            >
              <Ix icon={X} size="sm" style={{ width: "var(--text-xs)", height: "var(--text-xs)" }} />
            </button>
          </span>
        ))}
        <input
          id={id ?? "clavis-tag-input"}
          value={input}
          disabled={disabled}
          dir="auto"
          placeholder={value.length === 0 ? "Add tags…" : ""}
          aria-label="Add tag"
          onChange={(e) => {
            setInput(e.target.value);
            setOpen(true);
            setHighlight(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
              if (e.key === "Tab" && matches.length === 0) return; /* natural tab-out */
              e.preventDefault();
              e.stopPropagation();
              commit(highlight >= 0 && matches[highlight] ? matches[highlight] : input);
              return;
            }
            if (e.key === "Backspace" && input === "") {
              if (value.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                onChange(value.slice(0, -1));
              }
              return;
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              if (open && matches.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                setHighlight((h) => {
                  const n = matches.length;
                  return e.key === "ArrowDown" ? (h + 1) % n : (h - 1 + n) % n;
                });
              }
              return;
            }
            if (e.key === "Escape" && open) {
              e.stopPropagation();
              close();
            }
          }}
          style={{
            flex: "1 1 auto",
            minWidth: "calc(var(--space-6) * 4)",
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--text)",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-sm)",
            padding: "calc(var(--space-1) / 2) var(--space-2)",
          }}
        />
      </div>
      {open && matches.length > 0 ? (
        <div
          className="clavis-menu absolute left-0"
          style={{ top: "100%", marginTop: "var(--space-1)", zIndex: 60, width: "100%" }}
        >
          {matches.map((m, i) => (
            <button
              key={m}
              type="button"
              className="clavis-menu-item"
              style={i === highlight ? { background: "var(--glass-bg-hover)" } : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(m);
              }}
            >
              <Ix icon={Hash} size="sm" style={{ color: "var(--color-accent-text)" }} />
              {m}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Category picker (dropdown + inline create)                          */
/* ------------------------------------------------------------------ */

export function CategorySelect({
  categoryId,
  onChange,
  categories,
  call,
  disabled,
}: {
  categoryId: string | null;
  onChange: (id: string | null) => void;
  categories: Category[];
  call: CallFn;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
    setNewName("");
  }, []);
  const ref = useDismiss(open, close);
  const current = categories.find((c) => c.id === categoryId) ?? null;

  async function addCategory() {
    const name = newName.trim();
    if (name === "" || creating) return;
    const existing = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      onChange(existing.id);
      close();
      return;
    }
    setCreating(true);
    const res = await call("createCategory", { name });
    setCreating(false);
    if (res.ok && res.id) {
      onChange(res.id);
      close();
    }
  }

  const row = (id: string | null, name: string) => {
    const selected = categoryId === id;
    return (
      <button
        key={id ?? "none"}
        type="button"
        role="option"
        aria-selected={selected}
        className="clavis-menu-item"
        onClick={() => {
          onChange(id);
          close();
        }}
      >
        {selected ? (
          <Ix icon={Check} size="sm" style={{ color: "var(--color-accent-text)" }} />
        ) : (
          <span aria-hidden style={{ width: "var(--text-md)", flexShrink: 0 }} />
        )}
        {name}
      </button>
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="glass-input clavis-focusable flex items-center justify-between"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: "var(--space-2) var(--space-3)",
          gap: "var(--space-2)",
          cursor: disabled ? "not-allowed" : "pointer",
          width: "100%",
          fontSize: "var(--text-sm)",
        }}
      >
        <span style={{ color: "var(--text)" }}>{current ? current.name : "No category"}</span>
        <Ix icon={ChevronDown} size="sm" style={{ color: "var(--text-muted)" }} />
      </button>
      {open ? (
        <div
          className="clavis-menu absolute left-0"
          role="listbox"
          style={{ top: "100%", marginTop: "var(--space-1)", zIndex: 60, width: "100%" }}
        >
          {row(null, "No category")}
          {categories.map((c) => row(c.id, c.name))}
          <div aria-hidden style={{ borderTop: "1px solid var(--glass-border)", margin: "var(--space-1) 0" }} />
          <div className="flex items-center" style={{ gap: "var(--space-1)", padding: "var(--space-1)" }}>
            <input
              className="glass-input"
              value={newName}
              placeholder="New category…"
              dir="auto"
              disabled={creating}
              aria-label="New category name"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  void addCategory();
                }
              }}
              style={{ padding: "var(--space-1) var(--space-2)", fontSize: "var(--text-xs)", fontFamily: "var(--font-ui)", color: "var(--text)", minWidth: 0 }}
            />
            <button
              type="button"
              className="clavis-btn clavis-btn-glass"
              disabled={creating || newName.trim() === ""}
              onClick={() => void addCategory()}
              aria-label="Add category"
              style={{ padding: "var(--space-1) var(--space-2)", flexShrink: 0 }}
            >
              <Ix icon={Plus} size="sm" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
