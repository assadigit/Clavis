/**
 * CLAVIS — the whole-document group's full-modal editor (v1.14.0, DECISIONS
 * §56). The document panel's inline editor (§40) stays as-is; its "Full
 * editor" button moves the whole editing session into this modal — the
 * inline draft carries over as `initialText`, so no unsaved edit is lost on
 * the way up.
 *
 * The manager owns the open state (like the Manage items modal and the item
 * full editor): `setGroupDocument` bumps the group's `updatedAt`, which
 * re-keys the group editor behind this modal — a panel-owned modal would be
 * yanked away mid-session by its own save.
 */
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText, Save, X } from "lucide-react";
import type { CallFn } from "@/lib/clavis/client";
import { messages } from "@/lib/clavis/messages";
import type { Group } from "@/lib/clavis/types";
import { Ix } from "../icons";
import { Btn, FieldHint, Modal, TextArea } from "../ui-bits";

export interface DocumentFullEditorProps {
  group: Group;
  call: CallFn;
  readOnly: boolean;
  /** The inline draft carried up by the launch button; null = fetch the
   * stored document on open (the modal is keyed by group id, so this seeds
   * exactly once per open). */
  initialText: string | null;
  onClose: () => void;
}

/** The backend's stats rule (service.go): rune count, newline+1 lines. */
function draftStats(text: string): string {
  return messages.docStats([...text].length, text === "" ? 0 : text.split("\n").length);
}

export function DocumentFullEditor({ group, call, readOnly, initialText, onClose }: DocumentFullEditorProps) {
  const [draft, setDraft] = useState<string | null>(initialText);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(initialText === null);
  const [saving, setSaving] = useState(false);
  /* v1.12.0 (§53) pattern: the dirty-close guard — every close path (Esc,
     scrim, ×, Cancel) funnels here; a dirty draft asks first. */
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  /* No carried draft: fetch the stored document once per open. */
  useEffect(() => {
    if (initialText !== null) return;
    let alive = true;
    setLoading(true);
    void (async () => {
      const res = await call("getGroupDocument", { id: group.id });
      if (!alive) return;
      setLoading(false);
      if (res.ok && typeof res.document === "string") {
        setDraft(res.document);
      } else {
        /* Nothing to edit: leave rather than show a dead editor. */
        onClose();
      }
    })();
    return () => {
      alive = false;
    };
  }, [initialText, group.id, call, onClose]);

  function requestClose() {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }
  const cancelDiscard = () => setConfirmDiscard(false);

  async function save() {
    if (readOnly || saving || draft === null) return;
    if (draft === "") {
      /* Byte-exact means byte-exact in both directions: saving an empty
         editor would wipe the document — require the user to re-paste. */
      toast.error(messages.docEmptyWarning);
      return;
    }
    setSaving(true);
    const res = await call("setGroupDocument", { id: group.id, document: draft });
    setSaving(false);
    if (res.ok) {
      toast.success(messages.docSaved(group.name));
      onClose();
    }
  }

  return (
    <>
      <Modal
        open
        onClose={requestClose}
        width="min(900px, calc(100vw - var(--space-6)))"
        ariaLabel={`Edit document ${group.name}`}
        title={
          <span className="flex min-w-0 items-center" style={{ gap: "var(--space-2)" }}>
            <Ix icon={FileText} size="md" style={{ color: "var(--color-accent-text)", flexShrink: 0 }} />
            <span className="truncate" dir="auto">
              {group.name}
            </span>
          </span>
        }
        footer={
          <>
            <Btn
              variant="primary"
              icon={Save}
              label={saving ? "Saving…" : "Save document"}
              onClick={() => void save()}
              disabled={saving || !dirty}
            />
            <Btn variant="ghost" icon={X} label="Cancel" onClick={requestClose} disabled={saving} />
          </>
        }
      >
        {loading || draft === null ? (
          <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-sm)" }} role="status">
            Loading…
          </p>
        ) : (
          <div className="flex flex-col" style={{ gap: "var(--space-2)" }}>
            <TextArea
              mono
              dir="auto"
              autoFocus
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setDirty(true);
              }}
              disabled={readOnly || saving}
              rows={24}
              spellCheck={false}
              aria-label="Document content — paste the whole file here"
              placeholder="Paste the whole file — it will be stored exactly as pasted…"
              style={{ fontSize: "var(--text-sm)" }}
            />
            <div className="flex flex-wrap items-center justify-between" style={{ gap: "var(--space-2)" }}>
              <FieldHint>Save overwrites the stored document with exactly this text (byte-exact).</FieldHint>
              <span className="t-muted" style={{ fontSize: "var(--text-xs)" }} aria-live="polite">
                {draftStats(draft)}
              </span>
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={confirmDiscard}
        onClose={cancelDiscard}
        title="Discard changes?"
        footer={
          <>
            <Btn variant="ghost" label="Keep editing" onClick={cancelDiscard} />
            <Btn
              variant="danger"
              label="Discard changes"
              onClick={() => {
                setConfirmDiscard(false);
                onClose();
              }}
            />
          </>
        }
      >
        <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-sm)", lineHeight: "var(--leading-relaxed)" }}>
          “{group.name}” has unsaved changes. Closing the editor discards them.
        </p>
      </Modal>
    </>
  );
}
