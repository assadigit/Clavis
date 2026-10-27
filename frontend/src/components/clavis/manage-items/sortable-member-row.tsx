/**
 * CLAVIS — the big-screen sortable member card: grip + hairline-separated
 * actions, built for comfortable drag & drop. Moved move-only from
 * manage-items-modal.tsx in UI-audit round 1 Phase 11 (F-026).
 */
"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";
import { EntryTypeIcon, Ix } from "../icons";
import { MemberRowBody } from "../ui-bits";

/* The big-screen member card: taller than the editor's summary rows, grip +
   hairline-separated actions — built for comfortable drag & drop. */
export function SortableMemberRow({
  itemId,
  name,
  isSecret,
  valueKey,
  preview,
  shared,
  disabled,
  isDraggingEnabled,
  onMoveUp,
  onMoveDown,
  onRemove,
  canMoveUp,
  canMoveDown,
}: {
  itemId: string;
  name: string;
  isSecret: boolean;
  valueKey: string;
  preview: string;
  shared: number;
  disabled: boolean;
  isDraggingEnabled: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: itemId });
  const rowLabel =
    shared > 0
      ? `${name}, used in ${shared} ${shared === 1 ? "group" : "groups"}, key ${valueKey}`
      : `${name}, key ${valueKey}`;
  return (
    <div
      ref={setNodeRef}
      className="clavis-member-row clavis-focusable flex items-center"
      role="group"
      aria-label={rowLabel}
      data-dragging={isDragging ? "true" : undefined}
      style={{
        gap: "var(--space-2)",
        padding: "var(--space-3)",
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.85 : 1,
      }}
    >
      {isDraggingEnabled ? (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${name}`}
          title="Drag to reorder"
          className="clavis-focusable"
          style={{
            display: "inline-flex",
            color: "var(--text-muted)",
            background: "transparent",
            border: "none",
            cursor: "grab",
            padding: "var(--space-1)",
          }}
        >
          <Ix icon={GripVertical} size="md" />
        </button>
      ) : (
        <span aria-hidden style={{ display: "inline-flex", padding: "var(--space-1)" }}>
          <Ix icon={GripVertical} size="md" style={{ color: "var(--color-neutral)" }} />
        </span>
      )}
      <EntryTypeIcon kind="item" isSecret={isSecret} size="md" />
      {/* F-027: the shared two-line member body. */}
      <MemberRowBody name={name} shared={shared} valueKey={valueKey} preview={preview} />
      <span
        className="flex items-center"
        style={{
          gap: "calc(var(--space-1) / 2)",
          flexShrink: 0,
          alignSelf: "stretch",
          borderLeft: "1px solid var(--glass-border)",
          paddingLeft: "var(--space-2)",
        }}
      >
        <button
          type="button"
          onClick={onMoveUp}
          disabled={disabled || !canMoveUp}
          aria-label={`Move ${name} up`}
          title="Move up"
          className="clavis-btn clavis-btn-ghost clavis-row-action"
          style={{ padding: "var(--space-1)" }}
        >
          <Ix icon={ArrowUp} size="sm" />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={disabled || !canMoveDown}
          aria-label={`Move ${name} down`}
          title="Move down"
          className="clavis-btn clavis-btn-ghost clavis-row-action"
          style={{ padding: "var(--space-1)" }}
        >
          <Ix icon={ArrowDown} size="sm" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove ${name} from group`}
          title="Remove from group"
          className="clavis-btn clavis-btn-ghost clavis-row-action"
          style={{ padding: "var(--space-1)", color: "var(--color-danger-text)" }}
        >
          <Ix icon={X} size="sm" />
        </button>
      </span>
    </div>
  );
}