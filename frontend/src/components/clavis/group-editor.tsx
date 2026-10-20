/**
 * CLAVIS — group editor (SPEC §5.5): fields, ordered member list with
 * drag reorder + up/down buttons, add-item picker, copy, export, delete.
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
import { ArrowDown, ArrowUp, Check, ClipboardPaste, Copy, FileText, GripVertical, Layers, Link2, MoreHorizontal, Plus, Search, Trash2, X } from "lucide-react";
import type { CallFn } from "@/lib/clavis/client";
import { copyToClipboard, downloadExport } from "@/lib/clavis/client";
import { dedupeKeys, parseDotenvLine } from "@/lib/clavis/dotenv";
import type { ClavisState, Group } from "@/lib/clavis/types";
import type { Selection } from "./app-types";
import { allTags, formatDateTime, groupMemberKeys, maskValue, sharedCountMap } from "./derive";
import { EntryTypeIcon, Ix } from "./icons";
import { Btn, CategorySelect, FieldLabel, Menu, MenuItem, TagInput, TextArea, TextInput, Toggle } from "./ui-bits";
import { buildSearchEntries, searchEntries } from "@/lib/clavis/search";

export interface GroupEditorProps {
  mode: "create" | "edit";
  state: ClavisState;
  call: CallFn;
  readOnly: boolean;
  group?: Group;
  onDone: (sel: Selection) => void;
  onSelectEntry: (sel: Selection) => void;
  deleteEntry: (kind: "item" | "group", id: string) => void;
  onCreateItemHere?: (groupId: string) => void;
  onCancelCreate: () => void;
}

interface GroupDraft {
  name: string;
  categoryId: string | null;
  tags: string[];
  pinned: boolean;
}

function draftFromGroup(group: Group): GroupDraft {
  return { name: group.name, categoryId: group.categoryId, tags: group.tags, pinned: group.pinned };
}

export function GroupEditor(props: GroupEditorProps) {
  const { mode, state, call, readOnly, group, onDone, onSelectEntry, deleteEntry, onCreateItemHere, onCancelCreate } = props;

  const [draft, setDraft] = useState<GroupDraft>(() =>
    group
      ? draftFromGroup(group)
      : { name: "", categoryId: null, tags: [], pinned: false }
  );
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /* Create mode: paste a whole project's credentials as KEY=value lines and
     Clavis builds the group AND every member item in one shot. */
  const [envText, setEnvText] = useState("");

  /* The manager remounts this editor with a fresh key whenever the group or
     its updatedAt changes, so the draft resets by remounting. */

  const showLast4 = state.data.settings.showLast4;
  const members = useMemo(() => (group ? groupMemberKeys(group, state.data) : []), [group, state.data]);
  const memberIds = useMemo(() => members.map((m) => m.item.id), [members]);
  const shared = useMemo(() => sharedCountMap(state.data), [state.data]);

  const dirty = useMemo(() => {
    if (!group) return true;
    const o = draftFromGroup(group);
    return (
      o.name !== draft.name ||
      o.categoryId !== draft.categoryId ||
      o.pinned !== draft.pinned ||
      o.tags.join("\u0000") !== draft.tags.join("\u0000")
    );
  }, [group, draft]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const candidates = useMemo(() => {
    const existing = new Set(memberIds);
    const entries = buildSearchEntries(state.data).filter((e) => e.kind === "item" && !existing.has(e.id));
    return searchEntries(addQuery, entries);
  }, [state.data, memberIds, addQuery]);

  /* Live parse of the pasted block: keys preview + bad-line detection,
     exactly what will be created (deduped like the store will dedupe). */
  const envPreview = useMemo(() => {
    if (mode !== "create") return null;
    const keys: string[] = [];
    let bad = 0;
    for (const line of envText.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      const parsed = parseDotenvLine(line);
      if (parsed) keys.push(parsed.key);
      else bad++;
    }
    return { keys: dedupeKeys(keys), bad };
  }, [mode, envText]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    const tag = (e.target as HTMLElement).tagName;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (tag === "BUTTON" || tag === "A" || tag === "KBD" || tag === "TEXTAREA") return;
    e.preventDefault();
    void save();
  }

  async function save() {
    if (readOnly || saving) return;
    const name = draft.name.trim();
    if (name === "") {
      toast.error("Give the group a name first.");
      return;
    }
    setSaving(true);
    if (mode === "create") {
      /* With a pasted KEY=value block: group + all member items in one shot. */
      const text = envText.trim();
      if (text !== "" && envPreview && envPreview.keys.length > 0) {
        const res = await call("createGroupFromEnv", {
          input: { name, categoryId: draft.categoryId, tags: draft.tags, pinned: draft.pinned, text },
        });
        if (res.ok && res.id) {
          toast.success(`Group “${name}” added with ${envPreview.keys.length} credential${envPreview.keys.length === 1 ? "" : "s"}.`);
          onDone({ kind: "group", id: res.id });
        }
      } else {
        const res = await call("createGroup", { input: { name, categoryId: draft.categoryId, tags: draft.tags, pinned: draft.pinned } });
        if (res.ok && res.id) {
          toast.success(`Group “${name}” added.`);
          onDone({ kind: "group", id: res.id });
        }
      }
    } else if (group) {
      const res = await call("updateGroup", { id: group.id, patch: { name, categoryId: draft.categoryId, tags: draft.tags, pinned: draft.pinned } });
      if (res.ok) toast.success(`Saved “${name}”.`);
    }
    setSaving(false);
  }

  function onDragEnd(e: DragEndEvent) {
    if (!group || readOnly) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = memberIds.indexOf(String(active.id));
    const newIndex = memberIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(memberIds, oldIndex, newIndex);
    void call("reorderGroupItems", { groupId: group.id, itemIds: next });
  }

  function moveMember(i: number, dir: -1 | 1) {
    if (!group || readOnly) return;
    const j = i + dir;
    if (j < 0 || j >= memberIds.length) return;
    const next = arrayMove(memberIds, i, j);
    void call("reorderGroupItems", { groupId: group.id, itemIds: next });
  }

  function removeMember(itemId: string) {
    if (!group || readOnly) return;
    void call("removeItemFromGroup", { groupId: group.id, itemId });
  }

  async function applyPicked() {
    if (!group || readOnly || picked.size === 0) return;
    const res = await call("addItemsToGroup", { groupId: group.id, itemIds: [...picked] });
    if (res.ok) {
      toast.success(`Added ${picked.size} ${picked.size === 1 ? "item" : "items"} to “${group.name}”.`);
      setPicked(new Set());
      setAddQuery("");
      setAdding(false);
    }
  }

  async function copyGroup() {
    if (!group) return;
    const res = await call("copy", { kind: "group", id: group.id });
    if (res.ok && typeof res.text === "string") {
      const ok = await copyToClipboard(res.text);
      if (ok) {
        toast.success(res.lineCount != null ? `Copied ${res.lineCount} lines.` : "Copied.");
        if (res.containsSecret) {
          toast("Copied. (Windows edition also excludes it from clipboard history.)");
        }
      } else {
        toast.error("Could not copy to the clipboard.");
      }
    }
  }

  return (
    <div
      className="clavis-scroll flex flex-col"
      style={{ gap: "var(--space-4)", overflowY: "auto", padding: "var(--space-4)", flex: 1, minHeight: 0 }}
      onKeyDown={handleKeyDown}
    >
      <header className="flex items-center" style={{ gap: "var(--space-3)" }}>
        <EntryTypeIcon kind="group" isSecret={false} size="lg" style={{ color: "var(--color-accent-text)" }} />
        <h2 className="flex-1 truncate" style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: "var(--weight-semibold)" }} dir="auto">
          {mode === "create" ? "New group" : draft.name}
        </h2>
      </header>
      {mode === "edit" && group ? (
        <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>
          {members.length} {members.length === 1 ? "item" : "items"} · used {group.useCount}× · updated {formatDateTime(group.updatedAt)}
        </span>
      ) : null}

      <div className="flex flex-col" style={{ gap: "var(--space-1)" }}>
        <FieldLabel htmlFor="clavis-group-name">Name</FieldLabel>
        <TextInput
          id="clavis-group-name"
          value={draft.name}
          disabled={readOnly}
          dir="auto"
          autoFocus={mode === "create"}
          placeholder="Sedanama credentials"
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
      </div>

      <div className="flex flex-col" style={{ gap: "var(--space-1)" }}>
        <FieldLabel>Category</FieldLabel>
        <CategorySelect
          categoryId={draft.categoryId}
          onChange={(id) => setDraft((d) => ({ ...d, categoryId: id }))}
          categories={state.data.categories}
          call={call}
          disabled={readOnly}
        />
      </div>

      <div className="flex flex-col" style={{ gap: "var(--space-1)" }}>
        <FieldLabel>Tags</FieldLabel>
        <TagInput
          value={draft.tags}
          onChange={(tags) => setDraft((d) => ({ ...d, tags }))}
          suggestions={allTags(state.data)}
          disabled={readOnly}
          id="clavis-group-tags"
        />
      </div>

      <Toggle
        checked={draft.pinned}
        onChange={(v) => setDraft((d) => ({ ...d, pinned: v }))}
        label="Pinned"
        note="Shows first"
        disabled={readOnly}
      />

      {mode === "edit" && group ? (
        <section className="flex flex-col" style={{ gap: "var(--space-2)" }} aria-label="Members">
          <div className="flex items-center justify-between">
            <FieldLabel>Members (copied as NAME=value lines, in this order)</FieldLabel>
            <Btn
              variant="glass"
              icon={Plus}
              label="Add item"
              onClick={() => setAdding((a) => !a)}
              disabled={readOnly}
              ariaLabel="Add items to this group"
            />
          </div>

          {adding ? (
            <div className="glass-row flex flex-col" style={{ gap: "var(--space-2)", padding: "var(--space-3)", border: "1px solid var(--glass-border)" }}>
              <div className="flex items-center" style={{ gap: "var(--space-2)" }}>
                <div className="relative min-w-0 flex-1">
                  <Ix
                    icon={Search}
                    size="sm"
                    style={{ position: "absolute", left: "var(--space-3)", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }}
                  />
                  <input
                    className="glass-input"
                    value={addQuery}
                    onChange={(e) => setAddQuery(e.target.value)}
                    placeholder="Search items to add…"
                    aria-label="Search items to add"
                    spellCheck={false}
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
                <Btn
                  variant="primary"
                  label={picked.size > 0 ? `Add ${picked.size} item${picked.size === 1 ? "" : "s"}` : "Add items"}
                  onClick={() => void applyPicked()}
                  disabled={readOnly || picked.size === 0}
                />
              </div>
              <div className="clavis-scroll flex flex-col" style={{ gap: "var(--space-1)", maxHeight: "calc(var(--space-6) * 5)", overflowY: "auto" }}>
                {candidates.map((c) => {
                  const it = state.data.items.find((i) => i.id === c.id && !i.deletedAt);
                  const on = picked.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="glass-row clavis-focusable flex items-center"
                      style={{ gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", cursor: "pointer", textAlign: "left" }}
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
                          width: "var(--text-lg)",
                          height: "var(--text-lg)",
                          borderRadius: "var(--radius-row)",
                          border: "1px solid var(--glass-border)",
                          background: on ? "var(--color-primary)" : "var(--glass-bg)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        {on ? <Ix icon={Check} size="sm" style={{ color: "var(--text-on-primary)", width: "var(--text-sm)", height: "var(--text-sm)" }} /> : null}
                      </span>
                      <EntryTypeIcon kind="item" isSecret={it?.isSecret ?? false} size="sm" />
                      <span className="flex-1 truncate" style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-medium)" }}>
                        {c.name}
                      </span>
                      <span className="t-mono t-muted" dir="auto" style={{ fontSize: "var(--text-xs)" }}>
                        {maskValue(it?.value ?? "", showLast4)}
                      </span>
                    </button>
                  );
                })}
                {candidates.length === 0 ? (
                  <span className="t-muted" style={{ fontSize: "var(--text-sm)", padding: "var(--space-2)" }}>
                    Nothing found.
                  </span>
                ) : null}
              </div>
              <div className="flex items-center justify-between" style={{ gap: "var(--space-2)" }}>
                <Btn
                  variant="ghost"
                  icon={Plus}
                  label="Create new item here"
                  onClick={() => onCreateItemHere?.(group.id)}
                  disabled={readOnly}
                />
                <Btn variant="ghost" label="Close" onClick={() => setAdding(false)} />
              </div>
            </div>
          ) : null}

          {members.length === 0 ? (
            <div className="glass-row flex flex-col items-center" style={{ gap: "var(--space-2)", padding: "var(--space-4)", textAlign: "center" }}>
              <Ix icon={Layers} size="lg" style={{ color: "var(--color-accent-text)" }} />
              <span className="t-muted" style={{ fontSize: "var(--text-sm)" }}>
                No items yet. Add the items you want to copy together.
              </span>
              {!readOnly ? (
                <Btn variant="primary" icon={Plus} label="Add item" onClick={() => setAdding(true)} />
              ) : null}
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={memberIds} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col" style={{ gap: "var(--space-1)" }}>
                  {members.map((m, i) => (
                    <SortableMemberRow
                      key={m.item.id}
                      itemId={m.item.id}
                      name={m.item.name}
                      isSecret={m.item.isSecret}
                      valueKey={m.key}
                      preview={maskValue(m.item.value, showLast4)}
                      shared={shared.get(m.item.id) ?? 0}
                      disabled={readOnly}
                      isDraggingEnabled={!readOnly}
                      onOpen={() => onSelectEntry({ kind: "item", id: m.item.id, groupContextId: group.id })}
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
        </section>
      ) : (
        <section className="flex flex-col" style={{ gap: "var(--space-2)" }} aria-label="Members">
          <div className="flex items-baseline justify-between" style={{ gap: "var(--space-2)" }}>
            <FieldLabel>Credentials for the whole project — paste them here</FieldLabel>
          </div>
          <TextArea
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            disabled={readOnly}
            mono
            rows={6}
            id="clavis-group-env"
            placeholder={"DATABASE_URL=postgres://…\nAPI_KEY=sk-live-…\nSTRIPE_SECRET=…"}
            aria-label="Paste KEY=value lines — one credential per line"
            spellCheck={false}
            dir="auto"
            style={{ fontSize: "var(--text-sm)" }}
          />
          <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-xs)" }}>
            One <span className="t-mono">KEY=value</span> per line (.env format). Saving creates the group and an item for every line — each masked as a secret, ready to copy together or one by one.
          </p>
          {envPreview && envText.trim() !== "" ? (
            <div className="glass-row flex flex-wrap items-center" style={{ gap: "calc(var(--space-1) / 2)", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--glass-border)" }} aria-live="polite">
              <Ix icon={Layers} size="sm" style={{ color: "var(--color-accent-text)" }} />
              {envPreview.keys.length === 0 ? (
                <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>
                  No KEY=value lines yet — keep typing or paste your project's .env.
                </span>
              ) : (
                <span className="flex flex-wrap items-center" style={{ gap: "calc(var(--space-1) / 2)", minWidth: 0 }}>
                  <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-medium)" }}>
                    {envPreview.keys.length} credential{envPreview.keys.length === 1 ? "" : "s"}:
                  </span>
                  {envPreview.keys.map((k) => (
                    <span key={k} className="t-mono glass-chip" style={{ fontSize: "var(--text-xs)", padding: "calc(var(--space-1) / 2) var(--space-2)", maxWidth: "calc(var(--space-6) * 6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {k}
                    </span>
                  ))}
                  {envPreview.bad > 0 ? (
                    <span className="t-warning" style={{ fontSize: "var(--text-xs)" }}>
                      {envPreview.bad} line{envPreview.bad === 1 ? "" : "s"} without KEY=value will be skipped
                    </span>
                  ) : null}
                </span>
              )}
            </div>
          ) : null}
          <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-xs)" }}>
            Prefer to bundle entries you already have? Save this group empty, then use “Add item” inside it.
          </p>
        </section>
      )}

      <footer className="flex flex-wrap items-center" style={{ gap: "var(--space-2)" }}>
        {dirty && !readOnly ? (
          <Btn
            variant="primary"
            icon={mode === "create" ? ClipboardPaste : Check}
            label={
              saving
                ? "Saving…"
                : mode === "create" && envPreview && envPreview.keys.length > 0
                  ? `Create group + ${envPreview.keys.length} credential${envPreview.keys.length === 1 ? "" : "s"}`
                  : mode === "create"
                    ? "Create group"
                    : "Save"
            }
            onClick={() => void save()}
            disabled={saving}
          />
        ) : null}
        {mode === "create" ? <Btn variant="ghost" label="Cancel" onClick={onCancelCreate} /> : null}
        <span className="t-muted flex-1" style={{ fontSize: "var(--text-xs)" }}>
          {mode === "edit" ? "Enter saves" : ""}
        </span>
        {mode === "edit" && group ? (
          <>
            <Btn variant="glass" icon={Copy} label="Copy group" onClick={() => void copyGroup()} title="Copy the NAME=value block" disabled={readOnly} />
            <Menu triggerIcon={MoreHorizontal} triggerTitle="More actions" align="end" triggerVariant="glass" disabled={readOnly}>
              <MenuItem icon={FileText} label="Export Markdown" onClick={() => downloadExport("group-md", group.id)} />
              <MenuItem icon={FileText} label="Export Text" onClick={() => downloadExport("group-txt", group.id)} />
              <MenuItem
                icon={Trash2}
                label="Delete group"
                danger
                onClick={() => deleteEntry("group", group.id)}
              />
            </Menu>
          </>
        ) : null}
      </footer>
    </div>
  );
}

function SortableMemberRow({
  itemId,
  name,
  isSecret,
  valueKey,
  preview,
  shared,
  disabled,
  isDraggingEnabled,
  onOpen,
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
  onOpen: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: itemId });
  return (
    <div
      ref={setNodeRef}
      className="glass-row flex items-center"
      style={{
        gap: "var(--space-2)",
        padding: "var(--space-2) var(--space-3)",
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.8 : 1,
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
          style={{ display: "inline-flex", color: "var(--text-muted)", background: "transparent", border: "none", cursor: "grab", padding: "var(--space-1)" }}
        >
          <Ix icon={GripVertical} size="sm" />
        </button>
      ) : (
        <span aria-hidden style={{ display: "inline-flex", padding: "var(--space-1)" }}>
          <Ix icon={GripVertical} size="sm" style={{ color: "var(--color-neutral)" }} />
        </span>
      )}
      <EntryTypeIcon kind="item" isSecret={isSecret} size="md" />
      <button
        type="button"
        onClick={onOpen}
        className="clavis-focusable flex min-w-0 flex-1 flex-col items-start"
        style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left", gap: "calc(var(--space-1) / 2)" }}
        title={`Edit ${name}`}
      >
        <span className="truncate" style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)" }}>
          {name}
        </span>
        <span className="t-mono t-muted truncate" dir="auto" style={{ fontSize: "var(--text-xs)" }}>
          {valueKey}
        </span>
      </button>
      <span className="t-mono t-muted truncate" dir="auto" style={{ fontSize: "var(--text-xs)", maxWidth: "calc(var(--space-6) * 6)", flexShrink: 0 }}>
        {preview}
      </span>
      {shared > 0 ? (
        <span
          className="flex items-center t-muted"
          style={{ gap: "calc(var(--space-1) / 2)", fontSize: "var(--text-xs)", flexShrink: 0 }}
          title={`Used in ${shared} groups`}
        >
          <Ix icon={Link2} size="sm" />
          {shared}
        </span>
      ) : null}
      <span className="flex items-center" style={{ gap: "calc(var(--space-1) / 2)", flexShrink: 0 }}>
        <button
          type="button"
          onClick={onMoveUp}
          disabled={disabled || !canMoveUp}
          aria-label={`Move ${name} up`}
          title="Move up"
          className="clavis-btn clavis-btn-ghost"
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
          className="clavis-btn clavis-btn-ghost"
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
          className="clavis-btn clavis-btn-ghost"
          style={{ padding: "var(--space-1)", color: "var(--color-danger-text)" }}
        >
          <Ix icon={X} size="sm" />
        </button>
      </span>
    </div>
  );
}
