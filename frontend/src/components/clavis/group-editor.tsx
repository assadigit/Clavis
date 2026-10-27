/**
 * CLAVIS — group editor (SPEC §5.5): fields plus the member well (a
 * compact summary of the group's items). All member management — drag
 * reorder, add, remove — happens in the dedicated Manage items modal.
 */
"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronRight, ClipboardPaste, Copy, FileJson, FileText, Layers, Link2, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import type { CallFn } from "@/lib/clavis/client";
import { downloadExport } from "@/lib/clavis/client";
import { dedupeKeys, parseDotenvLine } from "@/lib/clavis/dotenv";
import type { ClavisState, Group } from "@/lib/clavis/types";
import type { Selection } from "./app-types";
import { allTags, formatDateTime, groupMemberKeys, maskFromLast4, sharedCountMap } from "./derive";
import { EntryTile, EntryTypeIcon, Ix } from "./icons";
import { Btn, CategorySelect, FieldHint, FieldLabel, Menu, MenuItem, TagInput, TextArea, TextInput, Toggle } from "./ui-bits";

export interface GroupEditorProps {
  mode: "create" | "edit";
  state: ClavisState;
  call: CallFn;
  readOnly: boolean;
  group?: Group;
  onDone: (sel: Selection) => void;
  onSelectEntry: (sel: Selection) => void;
  deleteEntry: (kind: "item" | "group", id: string) => void;
  onManageItems?: () => void;
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
  const { mode, state, call, readOnly, group, onDone, onSelectEntry, deleteEntry, onManageItems, onCancelCreate } = props;

  const [draft, setDraft] = useState<GroupDraft>(() =>
    group
      ? draftFromGroup(group)
      : { name: "", categoryId: null, tags: [], pinned: false }
  );
  const [saving, setSaving] = useState(false);
  /* Create mode: paste a whole project's credentials as KEY=value lines and
     Clavis builds the group AND every member item in one shot. */
  const [envText, setEnvText] = useState("");

  /* The manager remounts this editor with a fresh key whenever the group or
     its updatedAt changes, so the draft resets by remounting. */

  const members = useMemo(() => (group ? groupMemberKeys(group, state.data) : []), [group, state.data]);
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

  async function copyGroup() {
    if (!group) return;
    /* Backend-side copy: the KEY=value block never enters the webview, and
       the §5.2 privacy formats are applied whenever any member is a secret
       (this was previously missed here — group copies could land in the
       Win+V clipboard history). */
    const res = await call("copy", { kind: "group", id: group.id });
    if (res.ok) {
      if (res.copied) {
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
        <EntryTile kind="group" isSecret={false} lg />
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
          <div className="flex items-center justify-between" style={{ gap: "var(--space-2)" }}>
            <FieldLabel>Members</FieldLabel>
            {!readOnly ? (
              <Btn
                variant="primary"
                icon={Plus}
                label="Add item"
                onClick={() => onManageItems?.()}
                ariaLabel="Add and manage items in this group"
              />
            ) : null}
          </div>
          <FieldHint>Copied as NAME=value lines, in this order.</FieldHint>

          {members.length === 0 ? (
            <div className="clavis-members-box flex flex-col items-center" style={{ gap: "var(--space-2)", padding: "var(--space-4)", textAlign: "center" }}>
              <Ix icon={Layers} size="lg" style={{ color: "var(--color-accent-text)" }} />
              <span className="t-muted" style={{ fontSize: "var(--text-sm)" }}>
                No items yet. Add the items you want to copy together.
              </span>
            </div>
          ) : (
            <div className="clavis-members-box clavis-scroll flex flex-col" style={{ gap: "var(--space-2)" }}>
              {members.map((m) => {
                const sharedCount = shared.get(m.item.id) ?? 0;
                const preview = maskFromLast4(m.item.valueLast4);
                /* F-007 (UI-audit round 1): an explicit accessible name instead
                   of concatenated name + count + key + mask. */
                const rowLabel =
                  sharedCount > 0
                    ? `${m.item.name}, used in ${sharedCount} ${sharedCount === 1 ? "group" : "groups"}, key ${m.key}`
                    : `${m.item.name}, key ${m.key}`;
                return (
                  <button
                    key={m.item.id}
                    type="button"
                    className="clavis-member-row clavis-focusable flex items-center"
                    onClick={() => onSelectEntry({ kind: "item", id: m.item.id, groupContextId: group.id })}
                    title={`Edit ${m.item.name}`}
                    aria-label={rowLabel}
                    style={{ gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", cursor: "pointer", textAlign: "left" }}
                  >
                    <EntryTypeIcon kind="item" isSecret={m.item.isSecret} size="md" />
                    <span className="flex min-w-0 flex-1 flex-col items-start" style={{ gap: "calc(var(--space-1) / 2)" }}>
                      <span className="flex w-full min-w-0 items-center" style={{ gap: "var(--space-2)", minWidth: 0 }}>
                        <span className="truncate" style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)", minWidth: 0 }}>
                          {m.item.name}
                        </span>
                        {sharedCount > 0 ? (
                          <span
                            className="flex items-center t-muted"
                            style={{ gap: "calc(var(--space-1) / 2)", fontSize: "var(--text-xs)", flexShrink: 0 }}
                            title={`Used in ${sharedCount} groups`}
                          >
                            <Ix icon={Link2} size="sm" />
                            {sharedCount}
                          </span>
                        ) : null}
                      </span>
                      <span className="t-mono t-muted truncate w-full" dir="auto" style={{ fontSize: "var(--text-xs)", maxWidth: "100%" }}>
                        {m.key}
                        {preview ? <span aria-hidden>{" · "}</span> : null}
                        {preview}
                      </span>
                    </span>
                    <Ix icon={ChevronRight} size="sm" style={{ color: "var(--color-neutral)", flexShrink: 0 }} />
                  </button>
                );
              })}
            </div>
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
          <FieldHint>
            One <span className="t-mono">KEY=value</span> per line (.env format). Saving creates the group and an item for every line — each masked as a secret, ready to copy together or one by one.
          </FieldHint>
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
          <FieldHint>Prefer to bundle entries you already have? Save this group empty, then use “Add item” inside it.</FieldHint>
        </section>
      )}

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
        </div>
        {mode === "edit" && group ? (
          <div className="flex flex-1 flex-wrap items-center justify-end" style={{ gap: "var(--space-2)" }}>
            <Btn variant="glass" icon={Copy} label="Copy group" onClick={() => void copyGroup()} title="Copy the NAME=value block" disabled={readOnly} />
            <Menu triggerIcon={MoreHorizontal} triggerTitle="More actions" align="end" triggerVariant="glass" disabled={readOnly}>
              {/* UI-audit round 1 Phase 4 (F-017/F-003): lossless JSON export
                  first, plaintext warning included (same sentence as
                  Settings, singular — the menu is for this one entry). */}
              <MenuItem
                icon={FileJson}
                label="Export JSON (backup-safe)"
                hint="Contains your real value in plain text."
                onClick={() => downloadExport("group-json", group.id)}
              />
              <MenuItem icon={FileText} label="Export Markdown" onClick={() => downloadExport("group-md", group.id)} />
              <MenuItem icon={FileText} label="Export Text" onClick={() => downloadExport("group-txt", group.id)} />
              <div aria-hidden style={{ borderTop: "1px solid var(--glass-border)", margin: "var(--space-1) 0" }} />
              <MenuItem
                icon={Trash2}
                label="Delete group"
                danger
                onClick={() => deleteEntry("group", group.id)}
              />
            </Menu>
          </div>
        ) : null}
      </footer>
    </div>
  );
}
