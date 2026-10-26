/**
 * CLAVIS — tag chips input with autocomplete. Moved from ui-bits.tsx
 * (move-only; ui-bits.tsx re-exports the public surface).
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { Hash, X } from "lucide-react";
import { Ix } from "../icons";
import { useDismiss } from "./dismiss";

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
