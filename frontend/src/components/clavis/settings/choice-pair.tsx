/**
 * CLAVIS — settings › import conflicts: the reuse/keep-both pair of buttons.
 * Moved from settings-view.tsx (move-only).
 */
"use client";

export type FileChoice = "reuse" | "keepBoth";

export function ChoicePair({ value, onChange }: { value: FileChoice; onChange: (c: FileChoice) => void }) {
  const style = (active: boolean): React.CSSProperties => ({
    background: active ? "var(--color-primary)" : "var(--glass-bg)",
    color: active ? "var(--text-on-primary)" : "var(--text)",
    borderColor: active ? "transparent" : "var(--glass-border)",
  });
  return (
    <span className="flex items-center" style={{ gap: "var(--space-1)", flexShrink: 0 }} role="group" aria-label="Conflict resolution">
      <button
        type="button"
        className="clavis-btn"
        style={style(value === "reuse")}
        onClick={() => onChange("reuse")}
        aria-pressed={value === "reuse"}
      >
        Reuse existing
      </button>
      <button
        type="button"
        className="clavis-btn"
        style={style(value === "keepBoth")}
        onClick={() => onChange("keepBoth")}
        aria-pressed={value === "keepBoth"}
      >
        Keep both
      </button>
    </span>
  );
}
