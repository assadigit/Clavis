/**
 * CLAVIS — icon helpers.
 * Sizes are token-derived (font-size tokens) so no px value is hard-coded.
 * Every icon is aria-hidden; states are always paired with a text label.
 */
"use client";

import type { CSSProperties } from "react";
import { AlignLeft, Key, Layers } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type IconSize = "sm" | "md" | "lg" | "xl";

const SIZES: Record<IconSize, string> = {
  sm: "var(--text-md)",
  md: "var(--text-lg)",
  lg: "var(--text-xl)",
  xl: "calc(var(--text-xl) * 3)",
};

export interface IxProps {
  icon: LucideIcon;
  size?: IconSize;
  style?: CSSProperties;
  className?: string;
}

export function Ix({ icon: Icon, size = "md", style, className }: IxProps) {
  return (
    <Icon
      aria-hidden
      className={className}
      style={{ width: SIZES[size], height: SIZES[size], flexShrink: 0, ...style }}
    />
  );
}

/** Type icon: key = secret item, lines = note/prompt item, stack = group. */
export function EntryTypeIcon({
  kind,
  isSecret,
  size = "md",
  style,
}: {
  kind: "item" | "group";
  isSecret: boolean;
  size?: IconSize;
  style?: CSSProperties;
}) {
  if (kind === "group") return <Ix icon={Layers} size={size} style={style} />;
  if (isSecret) return <Ix icon={Key} size={size} style={style} />;
  return <Ix icon={AlignLeft} size={size} style={style} />;
}

/** Bitwarden-style icon tile: the entry type icon inside a bordered square. */
export function EntryTile({
  kind,
  isSecret,
  lg,
  style,
}: {
  kind: "item" | "group";
  isSecret: boolean;
  lg?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span className="clavis-icon-tile" data-lg={lg ? "true" : undefined} style={style}>
      <EntryTypeIcon kind={kind} isSecret={isSecret} size={lg ? "md" : "sm"} />
    </span>
  );
}

/** Keycap-styled shortcut fragment (e.g. one per part of Ctrl+Shift+Space). */
export function ShortcutKeycaps({ shortcut }: { shortcut: string }) {
  const parts = shortcut.split("+").filter(Boolean);
  return (
    <span className="flex items-center flex-wrap" style={{ gap: "var(--space-1)" }}>
      {parts.map((p) => (
        <kbd key={p} className="clavis-keycap">
          {p}
        </kbd>
      ))}
    </span>
  );
}
