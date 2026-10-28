/**
 * CLAVIS — category picker (dropdown + inline create). Moved from
 * ui-bits.tsx (move-only; ui-bits.tsx re-exports the public surface).
 */
"use client";

import { useCallback, useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import type { CallFn } from "@/lib/clavis/client";
import type { Category } from "@/lib/clavis/types";
import { categoryPathLabel } from "../derive";
import { Ix } from "../icons";
import { useDismiss } from "./dismiss";

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
        {/* v1.4.0: nested categories show their full path ("Projects / Hibana")
            so same-named children stay distinguishable. */}
        <span className="truncate" style={{ color: "var(--text)" }}>
          {current ? categoryPathLabel(categories, current.id) : "No category"}
        </span>
        <Ix icon={ChevronDown} size="sm" style={{ color: "var(--text-muted)" }} />
      </button>
      {open ? (
        <div
          className="clavis-menu absolute left-0"
          role="listbox"
          style={{ top: "100%", marginTop: "var(--space-1)", zIndex: 60, width: "100%" }}
        >
          {row(null, "No category")}
          {categories.map((c) => row(c.id, categoryPathLabel(categories, c.id)))}
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
