/**
 * CLAVIS — the list-column search box: icon + token-styled input. Extracted
 * in UI-audit round 1 Phase 10 (F-027): the entry list and the manage-items
 * modal each carried a copy of the icon positioning + input styling.
 */
"use client";

import type { KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { Ix } from "../icons";

export function SearchField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  autoFocus,
  onKeyDown,
  id,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  ariaLabel: string;
  autoFocus?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  id?: string;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <Ix
        icon={Search}
        size="sm"
        style={{
          position: "absolute",
          left: "var(--space-3)",
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--text-muted)",
          pointerEvents: "none",
        }}
      />
      <input
        id={id}
        className="glass-input"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        spellCheck={false}
        autoComplete="off"
        autoFocus={autoFocus}
        style={{
          width: "100%",
          padding: "var(--space-2) var(--space-3)",
          paddingLeft: "calc(var(--space-3) + var(--text-lg) + var(--space-1))",
          fontSize: "var(--text-sm)",
          fontFamily: "var(--font-ui)",
          color: "var(--text)",
        }}
      />
    </div>
  );
}
