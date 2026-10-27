/**
 * CLAVIS — the item editor's value field: masked preview + reveal, or the
 * multi-line textarea with the Enter/Ctrl+Enter hint. Moved move-only from
 * item-editor.tsx in UI-audit round 1 Phase 11 (F-026); the reveal state
 * lives here and resets on remount exactly as before (the editor remounts
 * with a fresh key whenever the item changes).
 */
"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { maskValue } from "../derive";
import { Btn, FieldHint, FieldLabel, TextArea } from "../ui-bits";

export function ValueField({
  isEdit,
  secret,
  value,
  onChange,
  disabled,
  showLast4,
}: {
  /** Edit mode: secrets start masked (create mode shows the plain textarea). */
  isEdit: boolean;
  /** Effective secret flag (draft or Credentials-derived). */
  secret: boolean;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  disabled: boolean;
  showLast4: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const masked = isEdit && secret && !revealed;

  if (masked) {
    return (
      <div className="flex flex-col" style={{ gap: "var(--space-1)" }}>
        <FieldLabel htmlFor="clavis-item-value">Value</FieldLabel>
        <div className="glass-input flex items-center justify-between" style={{ padding: "var(--space-2) var(--space-3)", gap: "var(--space-2)" }}>
          <span className="t-mono t-muted truncate" dir="auto" style={{ fontSize: "var(--text-sm)" }}>
            {maskValue(value, showLast4)}
          </span>
          <Btn variant="glass" icon={Eye} label="Reveal" onClick={() => setRevealed(true)} ariaLabel="Reveal value" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col" style={{ gap: "var(--space-1)" }}>
      <FieldLabel htmlFor="clavis-item-value">Value</FieldLabel>
      <div className="flex flex-col" style={{ gap: "var(--space-1)", width: "100%" }}>
        {isEdit && secret ? (
          <div className="flex justify-end">
            <Btn variant="ghost" icon={EyeOff} label="Hide" onClick={() => setRevealed(false)} ariaLabel="Hide value" />
          </div>
        ) : null}
        <TextArea
          id="clavis-item-value"
          mono
          dir="auto"
          value={value}
          disabled={disabled}
          spellCheck={false}
          aria-label="Value"
          placeholder="The token, prompt or note…"
          rows={6}
          onChange={onChange}
        />
        <FieldHint>Enter saves · Ctrl+Enter adds a line</FieldHint>
      </div>
    </div>
  );
}
