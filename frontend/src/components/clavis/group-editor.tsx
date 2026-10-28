/**
 * CLAVIS — group editor (SPEC §5.5): fields plus the member well (a
 * compact summary of the group's items). All member management — drag
 * reorder, add, remove — happens in the dedicated Manage items modal.
 */
"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, ClipboardPaste, Copy, FileJson, FileText, FilePlus2, KeyRound, Layers, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import type { CallFn } from "@/lib/clavis/client";
import { downloadExport } from "@/lib/clavis/client";
import { dedupeKeys, parseDotenvLine } from "@/lib/clavis/dotenv";
import { messages } from "@/lib/clavis/messages";
import type { ClavisState, Group } from "@/lib/clavis/types";
import { isDocumentGroup } from "@/lib/clavis/types";
import type { Selection } from "./app-types";
import { allTags, formatDateTime, groupMemberKeys, sharedCountMap } from "./derive";
import { DocumentPanel } from "./group-editor/document-panel";
import { GroupMemberRow } from "./group-editor/group-member-row";
import { QuickAddForm } from "./group-editor/quick-add-form";
import { ManualCopyModal } from "./manual-copy-modal";
import { EntryTile, Ix } from "./icons";
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
  /* Create mode: the two storage modes (v1.5.0 §40). "items" is the classic
     group of named credentials (with the optional whole-.env paste);
     "document" stores ONE pasted file verbatim. */
  const [createMode, setCreateMode] = useState<"items" | "document">("items");
  /* "items" create mode: paste a whole project's credentials as KEY=value
     lines and Clavis builds the group AND every member item in one shot. */
  const [envText, setEnvText] = useState("");
  /* "document" create mode: the whole pasted file, stored byte-exact —
     deliberately NEVER trimmed, parsed or re-formatted. */
  const [docText, setDocText] = useState("");
  const [docSecret, setDocSecret] = useState(true);

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
    if (mode !== "create" || createMode !== "items") return null;
    const keys: string[] = [];
    let bad = 0;
    for (const line of envText.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      const parsed = parseDotenvLine(line);
      if (parsed) keys.push(parsed.key);
      else bad++;
    }
    return { keys: dedupeKeys(keys), bad };
  }, [mode, createMode, envText]);

  /* Live size preview of the pasted document (byte-exact storage, so the
     preview counts exactly what will be saved). */
  const docPreview = useMemo(() => {
    if (mode !== "create" || createMode !== "document") return null;
    return {
      chars: docText.length,
      lines: docText === "" ? 0 : docText.split("\n").length,
    };
  }, [mode, createMode, docText]);

  /* Payload for the manual-copy fallback dialog (only set when the platform
     copy failed and the exact text has been fetched). */
  const [manualText, setManualText] = useState<string | null>(null);

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
      /* MODE 1 — whole document: the text goes to the store VERBATIM (no
         trim — byte-exact is the contract, §40). */
      if (createMode === "document") {
        if (docText === "") {
          setSaving(false);
          toast.error(messages.docEmptyWarning);
          return;
        }
        const res = await call("createGroupFromDoc", {
          input: { name, categoryId: draft.categoryId, tags: draft.tags, pinned: draft.pinned, isSecret: docSecret, text: docText },
        });
        setSaving(false);
        if (res.ok && res.id) {
          toast.success(messages.docCreated(name));
          onDone({ kind: "group", id: res.id });
        }
        return;
      }
      /* MODE 2 — items: with a pasted KEY=value block, group + all member
         items in one shot; otherwise an empty group to fill one-by-one. */
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
    /* Backend-side copy: the payload (verbatim document for document
       groups, KEY=value block otherwise) never enters the webview on the
       success path, and the §5.2 privacy formats are applied whenever the
       payload contains a secret. */
    const res = await call("copy", { kind: "group", id: group.id });
    if (res.ok) {
      if (res.copied) {
        toast.success(res.lineCount != null ? messages.copiedLines(res.lineCount) : messages.copied);
        if (res.containsSecret) {
          toast(messages.copiedSecretNote);
        }
      } else {
        /* Fallback: the platform blocked the copy — fetch the exact payload
           (getGroupCopyText) and show it pre-selected for a manual Ctrl+C. */
        const fb = await call("getGroupCopyText", { id: group.id });
        if (fb.ok && typeof fb.text === "string") setManualText(fb.text);
        else toast.error(messages.copyFailed);
      }
    }
  }

  async function copyGroupMarkdown() {
    if (!group) return;
    /* "Copy all as markdown" (§40 nice-to-have): the Clavis-markdown export
       (front-matter + NAME=value block) — or the verbatim document itself
       for document groups — written by the backend. */
    const res = await call("copyGroupMarkdown", { id: group.id });
    if (res.ok) {
      if (res.copied) {
        toast.success(messages.copied);
        toast(messages.copiedSecretNote);
      } else {
        const fb = await call("getGroupCopyText", { id: group.id });
        if (fb.ok && typeof fb.text === "string") setManualText(fb.text);
        else toast.error(messages.copyFailed);
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
          placeholder="Acme API credentials"
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

      {mode === "edit" && group && isDocumentGroup(group) ? (
        /* MODE 1 — whole-document group: one prominent Copy button, stats,
           secret toggle and the re-paste editor. No member list. */
        <DocumentPanel
          group={group}
          call={call}
          readOnly={readOnly}
          docChars={group.docChars ?? 0}
          docLines={group.docLines ?? 0}
        />
      ) : mode === "edit" && group ? (
        <section className="flex flex-col" style={{ gap: "var(--space-2)" }} aria-label="Members">
          <div className="flex items-center justify-between" style={{ gap: "var(--space-2)", minHeight: "var(--text-xl)" }}>
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
          {/* MODE 2 — the always-visible Name + Value + Add form (§40):
              adding an item happens HERE, inside the open group, through the
              atomic createItemInGroup action — it can never create a group. */}
          {!readOnly ? <QuickAddForm groupId={group.id} call={call} readOnly={readOnly} /> : null}
          <FieldHint>Copied as NAME=value lines, in this order. Each row copies its own value.</FieldHint>

          {members.length === 0 ? (
            <div className="clavis-members-box flex flex-col items-center" style={{ gap: "var(--space-2)", padding: "var(--space-4)", textAlign: "center" }}>
              <Ix icon={Layers} size="lg" style={{ color: "var(--color-accent-text)" }} />
              <span className="t-muted" style={{ fontSize: "var(--text-sm)" }}>
                No items yet. Add the first one above, or use “Add item” to manage existing ones.
              </span>
            </div>
          ) : (
            <div className="clavis-members-box clavis-scroll flex flex-col" style={{ gap: "var(--space-2)" }}>
              {members.map((m) => (
                <GroupMemberRow
                  key={m.item.id}
                  item={m.item}
                  valueKey={m.key}
                  sharedCount={shared.get(m.item.id) ?? 0}
                  call={call}
                  readOnly={readOnly}
                  onSelect={() => onSelectEntry({ kind: "item", id: m.item.id, groupContextId: group.id })}
                  onDelete={() => deleteEntry("item", m.item.id)}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="flex flex-col" style={{ gap: "var(--space-2)" }} aria-label="Members">
          {/* The two storage modes (§40) — chosen here, at creation. */}
          <FieldLabel>What goes into this group?</FieldLabel>
          <div className="flex flex-wrap" style={{ gap: "var(--space-2)" }} role="radiogroup" aria-label="Group storage mode">
            <button
              type="button"
              role="radio"
              aria-checked={createMode === "items"}
              className="clavis-focusable glass-row"
              onClick={() => setCreateMode("items")}
              data-selected={createMode === "items" ? "true" : "false"}
              style={{ flex: "1 1 calc(var(--space-6) * 6)", display: "flex", gap: "var(--space-2)", alignItems: "flex-start", padding: "var(--space-3)", cursor: "pointer", textAlign: "left" }}
            >
              <Ix icon={KeyRound} size="md" style={{ color: createMode === "items" ? "var(--color-accent-text)" : "var(--text-muted)", flexShrink: 0, marginTop: 2 }} />
              <span className="flex flex-col" style={{ gap: "calc(var(--space-1) / 2)", minWidth: 0 }}>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)" }}>Add items one by one</span>
                <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>
                  Named credentials (token, key, link) — each with its own Copy button.
                </span>
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={createMode === "document"}
              className="clavis-focusable glass-row"
              onClick={() => setCreateMode("document")}
              data-selected={createMode === "document" ? "true" : "false"}
              style={{ flex: "1 1 calc(var(--space-6) * 6)", display: "flex", gap: "var(--space-2)", alignItems: "flex-start", padding: "var(--space-3)", cursor: "pointer", textAlign: "left" }}
            >
              <Ix icon={FilePlus2} size="md" style={{ color: createMode === "document" ? "var(--color-accent-text)" : "var(--text-muted)", flexShrink: 0, marginTop: 2 }} />
              <span className="flex flex-col" style={{ gap: "calc(var(--space-1) / 2)", minWidth: 0 }}>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)" }}>Paste whole document</span>
                <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>
                  One markdown/text file stored byte-exact — one Copy button for all of it.
                </span>
              </span>
            </button>
          </div>

          {createMode === "items" ? (
            <>
              <FieldLabel>Credentials for the whole project — paste them here (optional)</FieldLabel>
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
              <FieldHint>Prefer to type them in later? Save the group empty — an always-visible “Name + Value + Add” form sits at the top of the group.</FieldHint>
            </>
          ) : (
            <>
              <FieldLabel htmlFor="clavis-group-doc">Paste the whole document — it is stored exactly as pasted</FieldLabel>
              <TextArea
                value={docText}
                onChange={(e) => setDocText(e.target.value)}
                disabled={readOnly}
                mono
                rows={12}
                id="clavis-group-doc"
                placeholder={"# Project notes / credentials\n\nToken: …\nLogin: …\n\n(Anything — markdown, .env, plain text.)"}
                aria-label="Paste the whole document — markdown or any text, stored verbatim"
                spellCheck={false}
                dir="auto"
                style={{ fontSize: "var(--text-sm)" }}
              />
              <FieldHint>
                Stored verbatim — every whitespace character, line break and blank line is kept. One prominent Copy button hands back the identical bytes; you can re-paste and save over it later.
              </FieldHint>
              {docPreview ? (
                <div className="glass-row flex flex-wrap items-center" style={{ gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--glass-border)" }} aria-live="polite">
                  <Ix icon={FilePlus2} size="sm" style={{ color: "var(--color-accent-text)" }} />
                  <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-medium)" }}>
                    {messages.docStats(docPreview.chars, docPreview.lines)}
                  </span>
                </div>
              ) : null}
              <Toggle
                checked={docSecret}
                onChange={setDocSecret}
                label="Secret"
                note="Copies stay out of clipboard history"
                disabled={readOnly}
              />
            </>
          )}
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
          {!readOnly ? (
            dirty ? (
              <Btn
                variant="primary"
                icon={mode === "create" && createMode === "document" ? FilePlus2 : mode === "create" ? ClipboardPaste : Check}
                label={
                  saving
                    ? "Saving…"
                    : mode === "create" && createMode === "document"
                      ? docText === ""
                        ? "Create group with document"
                        : `Create group with document`
                      : mode === "create" && envPreview && envPreview.keys.length > 0
                        ? `Create group + ${envPreview.keys.length} credential${envPreview.keys.length === 1 ? "" : "s"}`
                        : mode === "create"
                          ? "Create group"
                          : "Save"
                }
                onClick={() => void save()}
                disabled={saving}
              />
            ) : (
              /* F-020 (UI-audit round 1 Phase 7): a visible, disabled "Saved"
                 state when the form is clean. */
              <Btn
                variant="primary"
                icon={Check}
                label="Saved"
                disabled
                ariaLabel="Saved — no changes yet"
                title="No changes yet"
              />
            )
          ) : null}
          {mode === "create" ? <Btn variant="ghost" label="Cancel" onClick={onCancelCreate} /> : null}
        </div>
        {mode === "edit" && group ? (
          <div className="flex flex-1 flex-wrap items-center justify-end" style={{ gap: "var(--space-2)" }}>
            <Btn
              variant="glass"
              icon={Copy}
              label={isDocumentGroup(group) ? "Copy document" : "Copy group"}
              onClick={() => void copyGroup()}
              title={isDocumentGroup(group) ? "Copy the entire document, byte-identical" : "Copy the NAME=value block"}
              disabled={readOnly}
            />
            <Menu triggerIcon={MoreHorizontal} triggerTitle="More actions" align="end" triggerVariant="glass" disabled={readOnly}>
              {/* "Copy all as markdown" (§40): the whole group as one markdown
                  document on the clipboard. */}
              <MenuItem icon={Copy} label="Copy all as markdown" onClick={() => void copyGroupMarkdown()} />
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

      <ManualCopyModal
        open={manualText !== null}
        title={`Copy “${draft.name}” manually`}
        text={manualText ?? ""}
        onClose={() => setManualText(null)}
      />
    </div>
  );
}
