/**
 * CLAVIS — manage-items modal (SPEC §5.5): the dedicated, bigger screen for
 * curating a group's member items — drag reorder, move up/down, remove,
 * multi-add existing items, or create a new item right here. Opens from the
 * group editor's "Add item" button; every action applies immediately
 * through the store API (no draft state — same philosophy as the vault).
 */
"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Check, GripVertical, Layers, Plus, X } from "lucide-react";
import type { CallFn } from "@/lib/clavis/client";
import type { ClavisState, Group } from "@/lib/clavis/types";
import { groupMemberKeys, rowPreview, sharedCountMap } from "./derive";
import { EntryTypeIcon, Ix } from "./icons";
import { Btn, FieldHint, FieldLabel, MemberRowBody, Modal, SearchField } from "./ui-bits";
import { buildSearchEntries, searchEntries } from "@/lib/clavis/search";

export interface ManageItemsModalProps {
  group: Group;
  state: ClavisState;
  call: CallFn;
  readOnly: boolean;
  onClose: () => void;
  onCreateItemHere?: (groupId: string) => void;
}

export function ManageItemsModal(props: ManageItemsModalProps) {
  const { group, state, call, readOnly, onClose, onCreateItemHere } = props;
  const [addQuery, setAddQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const members = useMemo(() => groupMemberKeys(group, state.data), [group, state.data]);
  const memberIds = useMemo(() => members.map((m) => m.item.id), [members]);
  const shared = useMemo(() => sharedCountMap(state.data), [state.data]);

  const candidates = useMemo(() => {
    const existing = new Set(memberIds);
    const entries = buildSearchEntries(state.data).filter((e) => e.kind === "item" && !existing.has(e.id));
    return searchEntries(addQuery, entries);
  }, [state.data, memberIds, addQuery]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function onDragEnd(e: DragEndEvent) {
    if (readOnly) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = memberIds.indexOf(String(active.id));
    const newIndex = memberIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(memberIds, oldIndex, newIndex);
    void call("reorderGroupItems", { groupId: group.id, itemIds: next });
  }

  function moveMember(i: number, dir: -1 | 1) {
    if (readOnly) return;
    const j = i + dir;
    if (j < 0 || j >= memberIds.length) return;
    const next = arrayMove(memberIds, i, j);
    void call("reorderGroupItems", { groupId: group.id, itemIds: next });
  }

  function removeMember(itemId: string) {
    if (readOnly) return;
    void call("removeItemFromGroup", { groupId: group.id, itemId });
  }

  async function applyPicked() {
    if (readOnly || picked.size === 0) return;
    const res = await call("addItemsToGroup", { groupId: group.id, itemIds: [...picked] });
    if (res.ok) {
      toast.success(`Added ${picked.size} ${picked.size === 1 ? "item" : "items"} to “${group.name}”.`);
      setPicked(new Set());
      setAddQuery("");
    }
  }

  function createHere() {
    onClose();
    onCreateItemHere?.(group.id);
  }

  return (
    <Modal
      open
      onClose={onClose}
      width="min(720px, calc(100vw - var(--space-6)))"
      title={
        <span className="flex items-center" style={{ gap: "var(--space-2)" }}>
          <Ix icon={Layers} size="md" style={{ color: "var(--color-accent-text)" }} />
          Manage items
        </span>
      }
      footer={
        <>
          <span className="t-muted flex-1 truncate" style={{ fontSize: "var(--text-xs)" }} dir="auto">
            {members.length} {members.length === 1 ? "item" : "items"} · copied as NAME=value lines in this order
          </span>
          <Btn variant="primary" label="Done" onClick={onClose} />
        </>
      }
    >
      {/* Keys typed in the modal must never reach the group editor behind it
          (the editor's Enter handler would save the group). */}
      <div className="flex flex-col" style={{ gap: "var(--space-4)" }} onKeyDown={(e) => e.stopPropagation()}>
        <div className="flex flex-col" style={{ gap: "var(--space-1)" }}>
          <span className="t-muted truncate" style={{ fontSize: "var(--text-sm)" }} dir="auto">
            Group “{group.name}”
          </span>
          <FieldLabel>Current items</FieldLabel>
          <FieldHint>Drag the grip to reorder — this is the exact order Copy group uses.</FieldHint>
        </div>

        {members.length === 0 ? (
          <div
            className="clavis-members-box flex flex-col items-center"
            style={{ gap: "var(--space-2)", padding: "var(--space-4)", textAlign: "center" }}
          >
            <Ix icon={Layers} size="lg" style={{ color: "var(--color-accent-text)" }} />
            <span className="t-muted" style={{ fontSize: "var(--text-sm)" }}>
              No items yet — add the ones you copy together below.
            </span>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={memberIds} strategy={verticalListSortingStrategy}>
              <div className="clavis-members-box clavis-scroll flex flex-col" style={{ gap: "var(--space-2)", maxHeight: "none" }}>
                {members.map((m, i) => (
                  <SortableMemberRow
                    key={m.item.id}
                    itemId={m.item.id}
                    name={m.item.name}
                    isSecret={m.item.isSecret}
                    valueKey={m.key}
                    preview={rowPreview(m.item)}
                    shared={shared.get(m.item.id) ?? 0}
                    disabled={readOnly}
                    isDraggingEnabled={!readOnly}
                    onMoveUp={() => moveMember(i, -1)}
                    onMoveDown={() => moveMember(i, 1)}
                    onRemove={() => removeMember(m.item.id)}
                    canMoveUp={i > 0}
                    canMoveDown={i < members.length - 1}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {!readOnly ? (
          <div className="flex flex-col" style={{ gap: "var(--space-2)" }}>
            <FieldLabel>Add items</FieldLabel>
            <div className="flex items-center" style={{ gap: "var(--space-2)" }}>
              {/* F-027 (UI-audit round 1 Phase 10): shared SearchField. */}
              <SearchField
                value={addQuery}
                onChange={(e) => setAddQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && picked.size > 0) {
                    e.preventDefault();
                    void applyPicked();
                  }
                }}
                placeholder="Search items to add…"
                ariaLabel="Search items to add"
                autoFocus
              />
              <Btn
                variant="primary"
                label={picked.size > 0 ? `Add ${picked.size} item${picked.size === 1 ? "" : "s"}` : "Add items"}
                onClick={() => void applyPicked()}
                disabled={picked.size === 0}
              />
            </div>
            <div className="clavis-members-box clavis-scroll flex flex-col" style={{ gap: "var(--space-2)" }}>
              {candidates.map((c) => {
                const it = state.data.items.find((i) => i.id === c.id && !i.deletedAt);
                const on = picked.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="clavis-member-row clavis-focusable flex items-center"
                    style={{ gap: "var(--space-3)", padding: "var(--space-3)", cursor: "pointer", textAlign: "left" }}
                    aria-pressed={on}
                    aria-label={c.name}
                    onClick={() => {
                      setPicked((p) => {
                        const n = new Set(p);
                        if (n.has(c.id)) n.delete(c.id);
                        else n.add(c.id);
                        return n;
                      });
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: "var(--text-xl)",
                        height: "var(--text-xl)",
                        borderRadius: "var(--radius-row)",
                        border: "1px solid var(--glass-border)",
                        background: on ? "var(--color-primary)" : "var(--glass-bg)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {on ? (
                        <Ix icon={Check} size="sm" style={{ color: "var(--text-on-primary)", width: "var(--text-sm)", height: "var(--text-sm)" }} />
                      ) : null}
                    </span>
                    <EntryTypeIcon kind="item" isSecret={it?.isSecret ?? false} size="md" />
                    <span className="flex min-w-0 flex-1 flex-col items-start" style={{ gap: "calc(var(--space-1) / 2)" }}>
                      <span className="truncate" style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-medium)", maxWidth: "100%" }}>
                        {c.name}
                      </span>
                      <span className="t-mono t-muted truncate" dir="auto" style={{ fontSize: "var(--text-xs)", maxWidth: "100%" }}>
                        {rowPreview({ isSecret: it?.isSecret ?? false, valueLast4: it?.valueLast4 })}
                      </span>
                    </span>
                  </button>
                );
              })}
              {candidates.length === 0 ? (
                <span
                  className="t-muted"
                  style={{ fontSize: "var(--text-sm)", padding: "var(--space-2) var(--space-3)", textAlign: "center" }}
                >
                  {addQuery.trim() === "" ? "Every item in your vault is already in this group." : "Nothing found."}
                </span>
              ) : null}
            </div>
            <Btn variant="ghost" icon={Plus} label="Create new item here" onClick={createHere} />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/* The big-screen member card: taller than the editor's summary rows, grip +
   hairline-separated actions — built for comfortable drag & drop. */
function SortableMemberRow({
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
