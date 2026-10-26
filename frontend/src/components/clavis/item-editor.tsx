/**
 * CLAVIS — item editor (SPEC §5.4, §5.6, §5.7).
 * Enter saves; Ctrl+Enter inserts a newline inside the value field.
 * Secret values are masked until revealed; reveal resets on item change.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Link2,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import type { CallFn } from "@/lib/clavis/client";
import { downloadExport } from "@/lib/clavis/client";
import { autoKey } from "@/lib/clavis/dotenv";
import type { ClavisState, Group, Item } from "@/lib/clavis/types";
import type { Selection } from "./app-types";
import { allTags, formatDateTime, groupsContaining, maskValue } from "./derive";
import { EntryTile, Ix } from "./icons";
import { SharedDeleteModal, SharedEditModal } from "./shared-modals";
import { Btn, CategorySelect, FieldHint, FieldLabel, Menu, MenuItem, TagInput, TextArea, TextInput, Toggle } from "./ui-bits";

interface ItemDraft {
  name: string;
  key: string;
  value: string;
  note: string;
  categoryId: string | null;
  tags: string[];
  isSecret: boolean | undefined;
  pinned: boolean;
}

export interface ItemEditorProps {
  mode: "create" | "edit";
  state: ClavisState;
  call: CallFn;
  readOnly: boolean;
  item?: Item;
  prefillName?: string;
  /** Create form opened from a group editor: add to this group on save. */
  forGroupId?: string;
  /** Reached through this group (shared-item modal gets the split option). */
  groupContextId?: string;
  onDone: (sel: Selection) => void;
  onSelectEntry: (sel: Selection) => void;
  deleteEntry: (kind: "item" | "group", id: string) => void;
  onCancelCreate: () => void;
}

function draftFromItem(item: Item): ItemDraft {
  return {
    name: item.name,
    key: item.key,
    value: item.value,
    note: item.note,
    categoryId: item.categoryId,
    tags: item.tags,
    isSecret: item.isSecret,
    pinned: item.pinned,
  };
}

export function ItemEditor(props: ItemEditorProps) {
  const { mode, state, call, readOnly, item, prefillName, forGroupId, groupContextId, onDone, onSelectEntry, deleteEntry, onCancelCreate } = props;

  /* The state snapshot is redacted (values stripped), so the edit form
     fetches exactly this item's value on mount — one "getValue" round-trip,
     nothing else ever holds the value. */
  const [loadedValue, setLoadedValue] = useState<string | null>(mode === "edit" ? null : "");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ItemDraft>(() =>
    item ? draftFromItem(item) : { name: prefillName ?? "", key: "", value: "", note: "", categoryId: null, tags: [], isSecret: undefined, pinned: false }
  );

  useEffect(() => {
    if (mode !== "edit" || !item) return;
    let alive = true;
    void call("getValue", { id: item.id }).then((res) => {
      if (!alive) return;
      if (res.ok && typeof res.value === "string") {
        setLoadedValue(res.value);
        setDraft((d) => ({ ...d, value: res.value as string }));
      } else {
        setLoadError("This item could not be loaded. Please reopen it.");
      }
    });
    return () => {
      alive = false;
    };
    // The manager remounts this editor (key includes updatedAt) whenever the
    // item changes, so a per-item fetch effect is enough.
  }, [mode, item, call]);
  const [revealed, setRevealed] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingSave, setPendingSave] = useState<{ patch: Record<string, unknown>; groups: Group[] } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  /* The manager remounts this editor with a fresh key whenever the item or
     its updatedAt changes, so the draft/reveal state resets by remounting
     (SPEC §5.4: revealed state resets when the selection changes). */

  const showLast4 = state.data.settings.showLast4;
  const usedIn = useMemo(() => (item ? groupsContaining(state.data, item.id) : []), [state.data, item]);
  const currentGroup = groupContextId ? state.data.groups.find((g) => g.id === groupContextId) ?? null : null;
  const inCredentials =
    draft.categoryId != null &&
    (state.data.categories.find((c) => c.id === draft.categoryId)?.name ?? "") === "Credentials";
  const effectiveSecret = draft.isSecret ?? inCredentials;

  const dirty = useMemo(() => {
    if (!item) return true;
    if (loadedValue === null) return false; // still loading: never offer Save
    const o = draftFromItem({ ...item, value: loadedValue });
    return (
      o.name !== draft.name ||
      o.key !== draft.key ||
      o.value !== draft.value ||
      o.note !== draft.note ||
      o.categoryId !== draft.categoryId ||
      o.isSecret !== draft.isSecret ||
      o.pinned !== draft.pinned ||
      o.tags.join("\u0000") !== draft.tags.join("\u0000")
    );
  }, [item, draft, loadedValue]);

  const showKeyField = (mode === "edit" && usedIn.length >= 1) || advanced;

  function insertNewline(ta: HTMLTextAreaElement) {
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? start;
    const next = ta.value.slice(0, start) + "\n" + ta.value.slice(end);
    setDraft((d) => ({ ...d, value: next }));
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + 1;
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    const tag = (e.target as HTMLElement).tagName;
    if (e.ctrlKey || e.metaKey) {
      if (e.target instanceof HTMLTextAreaElement) {
        e.preventDefault();
        insertNewline(e.target);
      }
      return;
    }
    if (e.shiftKey || e.altKey) return; /* Shift+Enter = newline in textareas */
    if (tag === "BUTTON" || tag === "A" || tag === "KBD") return; /* let buttons activate */
    e.preventDefault();
    void save();
  }

  async function save() {
    if (readOnly || saving) return;
    const name = draft.name.trim();
    if (name === "") {
      toast.error("Give the item a name first.");
      return;
    }
    const base = {
      name,
      key: draft.key.trim(),
      value: draft.value,
      note: draft.note,
      categoryId: draft.categoryId,
      tags: draft.tags,
      pinned: draft.pinned,
    };

    if (mode === "create") {
      setSaving(true);
      const input = { ...base, isSecret: draft.isSecret };
      const res = await call("createItem", { input });
      if (res.ok && res.id) {
        if (forGroupId) {
          const r2 = await call("addItemsToGroup", { groupId: forGroupId, itemIds: [res.id] });
          if (r2.ok) {
            toast.success(`Added “${name}”.`);
            onDone({ kind: "item", id: res.id, groupContextId: forGroupId });
          }
        } else {
          toast.success(`Added “${name}”.`);
          onDone({ kind: "item", id: res.id });
        }
      }
      setSaving(false);
      return;
    }

    if (!item) return;
    const patch = { ...base, isSecret: draft.isSecret ?? false };
    if (usedIn.length >= 2) {
      /* Shared item: the modal decides where the edit lands (SPEC §5.6). */
      setPendingSave({ patch, groups: usedIn });
      return;
    }
    setSaving(true);
    const res = await call("updateItem", { id: item.id, patch });
    if (res.ok) toast.success(`Saved “${patch.name}”.`);
    setSaving(false);
  }

  async function updateEverywhere() {
    if (!item || !pendingSave) return;
    setSaving(true);
    const res = await call("updateItem", { id: item.id, patch: pendingSave.patch });
    if (res.ok) {
      toast.success(`Saved “${pendingSave.patch.name}”.`);
      setPendingSave(null);
    }
    setSaving(false);
  }

  async function onlyForGroup() {
    if (!item || !pendingSave || !groupContextId) return;
    setSaving(true);
    const res = await call("splitItemForGroup", { id: item.id, groupId: groupContextId, patch: pendingSave.patch });
    if (res.ok && res.id) {
      toast.success(`Saved a separate copy for “${currentGroup?.name ?? "this group"}”.`);
      setPendingSave(null);
      onSelectEntry({ kind: "item", id: res.id, groupContextId });
    }
    setSaving(false);
  }

  function onDeleteClick() {
    if (!item) return;
    if (usedIn.length >= 2) setConfirmDelete(true);
    else deleteEntry("item", item.id);
  }

  async function copyItem() {
    if (!item) return;
    /* Backend-side copy: the value never enters the webview, and the §5.2
       privacy formats are applied when the item is a secret. */
    const res = await call("copy", { kind: "item", id: item.id });
    if (res.ok) {
      if (res.copied) {
        toast.success("Copied.");
        if (res.containsSecret) {
          toast("Copied. (Windows edition also excludes it from clipboard history.)");
        }
      } else {
        toast.error("Could not copy to the clipboard.");
      }
    }
  }

  async function duplicate() {
    if (!item) return;
    const res = await call("duplicateItem", { id: item.id });
    if (res.ok && res.id) {
      toast.success(`Duplicated as “${item.name} (copy)”.`);
      onDone({ kind: "item", id: res.id });
    }
  }

  const editMasked = mode === "edit" && effectiveSecret && !revealed;

  if (mode === "edit" && loadedValue === null) {
    return (
      <div
        className="clavis-scroll flex flex-col items-center justify-center"
        style={{ flex: 1, gap: "var(--space-2)", padding: "var(--space-5)", textAlign: "center" }}
        role="status"
      >
        <p className={loadError ? "t-danger" : "t-muted"} style={{ margin: 0, fontSize: "var(--text-sm)" }}>
          {loadError ?? "Loading…"}
        </p>
      </div>
    );
  }

  return (
    <div
      className="clavis-scroll flex flex-col"
      style={{ gap: "var(--space-4)", overflowY: "auto", padding: "var(--space-4)", flex: 1, minHeight: 0 }}
      onKeyDown={handleKeyDown}
    >
      <header className="flex flex-col" style={{ gap: "var(--space-2)" }}>
        <div className="flex items-center" style={{ gap: "var(--space-3)" }}>
          <EntryTile kind="item" isSecret={effectiveSecret} lg />
          <h2 className="flex-1 truncate" style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: "var(--weight-semibold)" }} dir="auto">
            {mode === "create" ? (forGroupId ? "New item" : "New item") : draft.name}
          </h2>
        </div>
        <div className="flex flex-wrap items-center" style={{ gap: "var(--space-2)" }}>
          {currentGroup ? (
            <span className="glass-chip inline-flex items-center" style={{ gap: "var(--space-1)", padding: "calc(var(--space-1) / 2) var(--space-2)", fontSize: "var(--text-xs)" }}>
              <Ix icon={Link2} size="sm" style={{ width: "var(--text-xs)", height: "var(--text-xs)", color: "var(--color-accent-text)" }} />
              editing within “{currentGroup.name}”
            </span>
          ) : null}
          {forGroupId ? (
            <span className="glass-chip inline-flex items-center" style={{ gap: "var(--space-1)", padding: "calc(var(--space-1) / 2) var(--space-2)", fontSize: "var(--text-xs)" }}>
              <Ix icon={Link2} size="sm" style={{ width: "var(--text-xs)", height: "var(--text-xs)", color: "var(--color-accent-text)" }} />
              will be added to the group
            </span>
          ) : null}
          {mode === "edit" && item ? (
            <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>
              {effectiveSecret ? "Secret" : "Not secret"} · used {item.useCount}× · updated {formatDateTime(item.updatedAt)}
            </span>
          ) : null}
        </div>
      </header>

      <div className="flex flex-col" style={{ gap: "var(--space-1)" }}>
        <FieldLabel htmlFor="clavis-item-name">Name</FieldLabel>
        <TextInput
          id="clavis-item-name"
          value={draft.name}
          disabled={readOnly}
          dir="auto"
          autoFocus={mode === "create"}
          placeholder="GitHub token"
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
      </div>

      <button
        type="button"
        className="clavis-btn clavis-btn-ghost self-start"
        onClick={() => setAdvanced((a) => !a)}
        aria-expanded={advanced}
        disabled={readOnly}
        style={{ padding: "calc(var(--space-1) / 2) var(--space-2)", marginTop: "calc(var(--space-1) * -1)" }}
      >
        <Ix icon={advanced ? ChevronDown : ChevronRight} size="sm" />
        Advanced
      </button>

      {showKeyField ? (
        <div className="flex flex-col" style={{ gap: "var(--space-1)" }}>
          <FieldLabel htmlFor="clavis-item-key">Key — used as NAME=value when the group is copied</FieldLabel>
          <TextInput
            id="clavis-item-key"
            mono
            dir="auto"
            value={draft.key}
            disabled={readOnly}
            spellCheck={false}
            placeholder={autoKey(draft.name)}
            onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value }))}
          />
        </div>
      ) : null}

      <div className="flex flex-col" style={{ gap: "var(--space-1)" }}>
        <FieldLabel htmlFor="clavis-item-value">Value</FieldLabel>
        {editMasked ? (
          <div className="glass-input flex items-center justify-between" style={{ padding: "var(--space-2) var(--space-3)", gap: "var(--space-2)" }}>
            <span className="t-mono t-muted truncate" dir="auto" style={{ fontSize: "var(--text-sm)" }}>
              {maskValue(draft.value, showLast4)}
            </span>
            <Btn variant="glass" icon={Eye} label="Reveal" onClick={() => setRevealed(true)} ariaLabel="Reveal value" />
          </div>
        ) : (
          <div className="flex flex-col" style={{ gap: "var(--space-1)", width: "100%" }}>
            {mode === "edit" && effectiveSecret ? (
              <div className="flex justify-end">
                <Btn variant="ghost" icon={EyeOff} label="Hide" onClick={() => setRevealed(false)} ariaLabel="Hide value" />
              </div>
            ) : null}
            <TextArea
              id="clavis-item-value"
              mono
              dir="auto"
              value={draft.value}
              disabled={readOnly}
              spellCheck={false}
              aria-label="Value"
              placeholder="The token, prompt or note…"
              rows={6}
              onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
            />
            <FieldHint>Enter saves · Ctrl+Enter adds a line</FieldHint>
          </div>
        )}
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
          id="clavis-item-tags"
        />
      </div>

      <div className="flex flex-col" style={{ gap: "var(--space-1)" }}>
        <FieldLabel htmlFor="clavis-item-note">Note</FieldLabel>
        <TextArea
          id="clavis-item-note"
          mono
          dir="auto"
          value={draft.note}
          disabled={readOnly}
          rows={3}
          aria-label="Note"
          placeholder="Optional note…"
          onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
        />
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "var(--space-4) var(--space-6)" }}
      >
        <Toggle
          checked={effectiveSecret}
          onChange={(v) => setDraft((d) => ({ ...d, isSecret: v }))}
          label="Secret"
          note="Masked everywhere"
          disabled={readOnly}
        />
        <Toggle
          checked={draft.pinned}
          onChange={(v) => setDraft((d) => ({ ...d, pinned: v }))}
          label="Pinned"
          note="Shows first"
          disabled={readOnly}
        />
      </div>

      {mode === "edit" && item && usedIn.length > 0 ? (
        <div className="flex flex-col" style={{ gap: "var(--space-1)" }}>
          <FieldLabel>Used in {usedIn.length} {usedIn.length === 1 ? "group" : "groups"}</FieldLabel>
          {usedIn.map((g) => (
            <button
              key={g.id}
              type="button"
              className="glass-row clavis-focusable flex items-center"
              style={{ gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", cursor: "pointer" }}
              onClick={() => onSelectEntry({ kind: "group", id: g.id })}
            >
              <Ix icon={Link2} size="sm" style={{ color: "var(--color-accent-text)" }} />
              <span className="flex-1 truncate" style={{ fontSize: "var(--text-sm)" }}>
                {g.name}
              </span>
              <span className="t-muted" style={{ fontSize: "var(--text-xs)", flexShrink: 0 }}>
                {g.itemIds.length} items
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <footer
        className="flex flex-wrap items-center"
        style={{
          gap: "var(--space-2)",
          marginTop: "var(--space-1)",
          paddingTop: "var(--space-4)",
          borderTop: "1px solid var(--glass-border)",
        }}
      >
        <div className="flex flex-wrap items-center" style={{ gap: "var(--space-2)" }}>
          {dirty && !readOnly ? (
            <Btn variant="primary" icon={Check} label={saving ? "Saving…" : "Save"} onClick={() => void save()} disabled={saving} />
          ) : null}
          {mode === "create" ? <Btn variant="ghost" label="Cancel" onClick={onCancelCreate} /> : null}
        </div>
        {mode === "edit" && item ? (
          <div className="flex flex-1 flex-wrap items-center justify-end" style={{ gap: "var(--space-2)" }}>
            <Btn variant="glass" icon={Copy} label="Copy" onClick={() => void copyItem()} title="Copy value" disabled={readOnly} />
            <Btn variant="glass" icon={Copy} label="Duplicate" onClick={() => void duplicate()} title="Duplicate item" disabled={readOnly} />
            <Menu triggerIcon={MoreHorizontal} triggerTitle="More actions" align="end" triggerVariant="glass" disabled={readOnly}>
              <MenuItem icon={FileText} label="Export Markdown" onClick={() => downloadExport("item-md", item.id)} />
              <MenuItem icon={FileText} label="Export Text" onClick={() => downloadExport("item-txt", item.id)} />
              <div aria-hidden style={{ borderTop: "1px solid var(--glass-border)", margin: "var(--space-1) 0" }} />
              <MenuItem icon={Trash2} label="Delete item" danger onClick={onDeleteClick} disabled={readOnly} />
            </Menu>
          </div>
        ) : null}
      </footer>

      <SharedEditModal
        open={pendingSave !== null}
        groups={pendingSave?.groups ?? usedIn}
        currentGroupName={currentGroup?.name ?? null}
        saving={saving}
        onCancel={() => setPendingSave(null)}
        onUpdateEverywhere={() => void updateEverywhere()}
        onOnlyForGroup={() => void onlyForGroup()}
      />
      <SharedDeleteModal
        open={confirmDelete}
        name={item?.name ?? ""}
        groups={usedIn}
        saving={saving}
        onCancel={() => setConfirmDelete(false)}
        onDeleteEverywhere={() => {
          setConfirmDelete(false);
          if (item) deleteEntry("item", item.id);
        }}
      />
    </div>
  );
}
