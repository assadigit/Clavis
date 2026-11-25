/**
 * CLAVIS — the Plain text / Rich text mode switch of the document editors
 * (v1.15.0, DECISIONS §57). One control, two presentations of the same
 * document editor (the inline panel and the full modal); the mode lives in
 * the stored string itself (the rich sentinel), never in separate state.
 */
"use client";

export type DocMode = "plain" | "rich";

export function DocModeToggle({ mode, onChange, disabled }: { mode: DocMode; onChange: (m: DocMode) => void; disabled?: boolean }) {
  return (
    <div className="clavis-tool-bar" role="radiogroup" aria-label="Editor mode">
      <button
        type="button"
        role="radio"
        aria-checked={mode === "plain"}
        disabled={disabled}
        onClick={() => onChange("plain")}
        className="clavis-btn clavis-btn-ghost clavis-mode"
      >
        Plain text
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "rich"}
        disabled={disabled}
        onClick={() => onChange("rich")}
        className="clavis-btn clavis-btn-ghost clavis-mode"
      >
        Rich text
      </button>
    </div>
  );
}
