/**
 * CLAVIS — the document panel of an open whole-document group (v1.5.0,
 * DECISIONS.md §40).
 *
 * MODE 1 "Paste whole document": the group IS one verbatim pasted file.
 * This panel shows the ONE prominent Copy button that hands back the
 * EXACT stored bytes (backend-side copy; on failure the manual-copy dialog
 * opens with the payload pre-selected), the size stats, the Secret toggle
 * (clipboard-history exclusion) and the re-paste editor that saves over
 * the stored document byte-exact.
 */
"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Copy, FileText, Pencil, RefreshCw, Save, X } from "lucide-react";
import type { CallFn } from "@/lib/clavis/client";
import { messages } from "@/lib/clavis/messages";
import type { Group } from "@/lib/clavis/types";
import { ManualCopyModal } from "../manual-copy-modal";
import { Ix } from "../icons";
import { Btn, FieldHint, TextArea, Toggle } from "../ui-bits";

export interface DocumentPanelProps {
  group: Group;
  call: CallFn;
  readOnly: boolean;
  /** Live doc stats from the redacted state (no text travels in state). */
  docChars: number;
  docLines: number;
}

export function DocumentPanel({ group, call, readOnly, docChars, docLines }: DocumentPanelProps) {
  /* The document text lives in the backend only; both the copy fallback and
     the editor fetch it on demand ("getGroupDocument"), mirroring how the
     item editor fetches one value. */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const editRequestId = useRef(0);

  async function copyDocument() {
    /* Backend-side copy: the document's bytes never enter the webview on
       the success path; the §5.2 privacy formats apply when Secret is on. */
    const res = await call("copy", { kind: "group", id: group.id });
    if (res.ok && res.copied) {
      toast.success(
        res.lineCount != null
          ? messages.copiedEntryLines(group.name, res.lineCount)
          : messages.copiedEntry(group.name)
      );
      if (res.containsSecret) {
        toast(messages.copiedSecretNote);
      }
      return;
    }
    /* Fallback: fetch the exact payload and hand it over pre-selected. */
    const doc = await call("getGroupDocument", { id: group.id });
    if (doc.ok && typeof doc.document === "string") {
      setManual(doc.document);
    }
  }

  async function startEditing() {
    if (editing) return;
    setEditing(true);
    setLoading(true);
    const req = ++editRequestId.current;
    const res = await call("getGroupDocument", { id: group.id });
    if (req !== editRequestId.current) return;
    setLoading(false);
    if (res.ok && typeof res.document === "string") {
      setDraft(res.document);
      setDirty(false);
    } else {
      setEditing(false);
    }
  }

  function cancelEditing() {
    editRequestId.current++;
    setEditing(false);
    setDraft(null);
    setDirty(false);
  }

  async function saveDocument() {
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
      setEditing(false);
      setDraft(null);
      setDirty(false);
    }
  }

  return (
    <section className="flex flex-col" style={{ gap: "var(--space-2)" }} aria-label="Stored document">
      {/* THE copy button — one prominent affordance for the whole payload. */}
      <Btn
        variant="primary"
        icon={Copy}
        label="Copy document"
        onClick={() => void copyDocument()}
        disabled={readOnly}
        title="Copy the entire pasted document, byte-identical to the original"
        ariaLabel="Copy the entire document"
        style={{ alignSelf: "flex-start", minWidth: "calc(var(--space-6) * 8)" }}
      />
      <FieldHint>
        The whole pasted file is stored verbatim — every character, line break and blank line. Copy hands back the identical bytes.
      </FieldHint>

      <div className="glass-row flex flex-wrap items-center" style={{ gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)" }}>
        <Ix icon={FileText} size="sm" style={{ color: "var(--color-accent-text)", flexShrink: 0 }} />
        <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-medium)" }}>
          {messages.docStats(docChars, docLines)}
        </span>
        {!readOnly && !editing ? (
          <Btn
            variant="ghost"
            icon={Pencil}
            label="Edit document"
            onClick={() => void startEditing()}
            ariaLabel="Replace the stored document"
            style={{ marginLeft: "auto", padding: "calc(var(--space-1) / 2) var(--space-2)" }}
          />
        ) : null}
      </div>

      <Toggle
        checked={group.isSecret ?? true}
        onChange={(v) => void call("updateGroup", { id: group.id, patch: { isSecret: v } })}
        label="Secret"
        note="Copies stay out of clipboard history"
        disabled={readOnly}
      />

      {editing ? (
        <div className="flex flex-col" style={{ gap: "var(--space-2)" }}>
          <div className="flex items-center justify-between" style={{ gap: "var(--space-2)" }}>
            <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)" }}>Replace document</span>
            <Btn
              variant="ghost"
              icon={RefreshCw}
              label={dirty ? "Edited" : "Loaded"}
              disabled
              ariaLabel={dirty ? "The document has local edits" : "The stored document is loaded below"}
            />
          </div>
          {loading || draft === null ? (
            <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-sm)" }} role="status">
              Loading…
            </p>
          ) : (
            <>
              <TextArea
                mono
                dir="auto"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setDirty(true);
                }}
                disabled={readOnly || saving}
                rows={12}
                spellCheck={false}
                aria-label="Document content — paste the whole file here"
                placeholder="Paste the whole file — it will be stored exactly as pasted…"
                style={{ fontSize: "var(--text-sm)" }}
              />
              <FieldHint>Save overwrites the stored document with exactly this text (byte-exact).</FieldHint>
              <div className="flex items-center" style={{ gap: "var(--space-2)" }}>
                <Btn
                  variant="primary"
                  icon={Save}
                  label={saving ? "Saving…" : "Save document"}
                  onClick={() => void saveDocument()}
                  disabled={saving || !dirty}
                />
                <Btn variant="ghost" icon={X} label="Cancel" onClick={cancelEditing} disabled={saving} />
              </div>
            </>
          )}
        </div>
      ) : null}

      <ManualCopyModal
        open={manual !== null}
        title={`Copy “${group.name}” manually`}
        text={manual ?? ""}
        onClose={() => setManual(null)}
      />
    </section>
  );
}
