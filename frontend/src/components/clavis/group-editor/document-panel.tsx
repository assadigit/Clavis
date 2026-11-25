/**
 * CLAVIS — the document panel of an open whole-document group (v1.5.0,
 * DECISIONS.md §40; dual-mode since v1.15.0, §57).
 *
 * MODE 1 "Paste whole document": the group IS one verbatim pasted file.
 * This panel shows the ONE prominent Copy button that hands back the
 * document as clean PLAIN text (backend-side copy with the §5.2 privacy
 * formats; rich documents are stripped to their words by the backend), the
 * size stats, the Secret toggle (clipboard-history exclusion) and the
 * re-paste editor that saves over the stored document byte-exact.
 *
 * v1.15.0: the editor is dual-mode — the plain byte-exact TextArea, or the
 * rich WYSIWYG editor (Bold/Italic/Emoji/Alignment…). The mode lives in the
 * stored string (the rich sentinel), so the "Full editor" carry needs no
 * extra plumbing and a plain document never changes form until the owner
 * flips the switch. Rich → plain with formatting present asks first.
 */
"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Copy, FileText, Maximize2, Pencil, RefreshCw, Save, X } from "lucide-react";
import type { CallFn } from "@/lib/clavis/client";
import { messages } from "@/lib/clavis/messages";
import type { Group } from "@/lib/clavis/types";
import { ManualCopyModal } from "../manual-copy-modal";
import { Ix } from "../icons";
import { Btn, FieldHint, Modal, TextArea, Toggle } from "../ui-bits";
import { DocModeToggle, type DocMode } from "../editors/doc-mode-toggle";
import { RichTextEditor } from "../editors/rich-text-editor";
import { htmlFromRichDoc, isRichDoc, plainToRich, richDocFromHtml, richHasFormatting, richToPlain, sanitizeRich } from "../editors/rich-text";

export interface DocumentPanelProps {
  group: Group;
  call: CallFn;
  readOnly: boolean;
  /** Live doc stats from the redacted state (no text travels in state). */
  docChars: number;
  docLines: number;
  /** v1.14.0 (DECISIONS §56): opens the whole document in the full-modal
   *  editor. Receives the current inline draft so the session — including
   *  unsaved edits — continues in the bigger editor. */
  onOpenFullEditor?: (initialText: string | null) => void;
}

export function DocumentPanel({ group, call, readOnly, docChars, docLines, onOpenFullEditor }: DocumentPanelProps) {
  /* The document text lives in the backend only; both the copy fallback and
     the editor fetch it on demand ("getGroupDocument"), mirroring how the
     item editor fetches one value. */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [mode, setMode] = useState<DocMode>("plain");
  /* The document as loaded — the dirty baseline (a mode round-trip that
     lands on the identical string is not dirty). */
  const [baseline, setBaseline] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  /* v1.15.0 (§57): the rich → plain formatting-loss guard. */
  const [confirmStrip, setConfirmStrip] = useState(false);
  const editRequestId = useRef(0);

  const dirty = draft !== null && baseline !== null && draft !== baseline;

  async function copyDocument() {
    /* Backend-side copy: the document's bytes never enter the webview on
       the success path; the §5.2 privacy formats apply when Secret is on.
       Rich documents are stripped to plain text by the backend (§57). */
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
      setBaseline(res.document);
      setMode(isRichDoc(res.document) ? "rich" : "plain");
    } else {
      setEditing(false);
    }
  }

  function cancelEditing() {
    editRequestId.current++;
    setEditing(false);
    setDraft(null);
    setBaseline(null);
    setConfirmStrip(false);
  }

  function switchMode(next: DocMode) {
    if (saving || next === mode || draft === null) return;
    if (next === "rich") {
      /* Lossless: the words are untouched, one paragraph per line. */
      setDraft(richDocFromHtml(plainToRich(draft)));
      setMode("rich");
      return;
    }
    const html = htmlFromRichDoc(draft);
    if (richHasFormatting(html)) {
      setConfirmStrip(true);
      return;
    }
    setDraft(richToPlain(html));
    setMode("plain");
  }

  function stripFormatting() {
    if (draft === null) return;
    setDraft(richToPlain(htmlFromRichDoc(draft)));
    setMode("plain");
    setConfirmStrip(false);
  }

  async function saveDocument() {
    if (readOnly || saving || draft === null) return;
    let payload = draft;
    if (mode === "rich") {
      const html = sanitizeRich(htmlFromRichDoc(draft));
      if (richToPlain(html).trim() === "") {
        /* Byte-exact means byte-exact in both directions: saving an empty
           editor would wipe the document — require the user to write. */
        toast.error(messages.docEmptyWarning);
        return;
      }
      payload = richDocFromHtml(html);
    } else if (draft === "") {
      toast.error(messages.docEmptyWarning);
      return;
    }
    setSaving(true);
    const res = await call("setGroupDocument", { id: group.id, document: payload });
    setSaving(false);
    if (res.ok) {
      toast.success(messages.docSaved(group.name));
      setEditing(false);
      setDraft(null);
      setBaseline(null);
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
        title="Copy the document as plain text (formatting is not included)"
        ariaLabel="Copy the entire document"
        style={{ alignSelf: "flex-start", minWidth: "calc(var(--space-6) * 8)" }}
      />
      <FieldHint>
        {group.docRich
          ? messages.docRichHint
          : "The whole pasted file is stored verbatim — every character, line break and blank line. Copy hands back the identical bytes."}
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
            <div className="flex items-center" style={{ gap: "var(--space-1)", flexShrink: 0 }}>
              <Btn
                variant="ghost"
                icon={RefreshCw}
                label={dirty ? "Edited" : "Loaded"}
                disabled
                ariaLabel={dirty ? "The document has local edits" : "The stored document is loaded below"}
              />
              {/* v1.14.0 (§56): the launch button at the owner's marked spot —
                  moves this editing session (draft included) into the
                  full-modal editor; the inline session closes so no stale
                  draft can overwrite a save made up there. The mode travels
                  inside the draft string itself (§57). */}
              {onOpenFullEditor ? (
                <Btn
                  variant="ghost"
                  icon={Maximize2}
                  label="Full editor"
                  onClick={() => {
                    const carry = draft;
                    onOpenFullEditor(carry);
                    cancelEditing();
                  }}
                  disabled={saving}
                  ariaLabel="Open the full document editor"
                  title="Open the full editor — the whole document, more room"
                />
              ) : null}
            </div>
          </div>
          {loading || draft === null ? (
            <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-sm)" }} role="status">
              Loading…
            </p>
          ) : (
            <>
              <DocModeToggle mode={mode} onChange={switchMode} disabled={readOnly || saving} />
              {mode === "plain" ? (
                <TextArea
                  mono
                  dir="auto"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={readOnly || saving}
                  rows={12}
                  spellCheck={false}
                  aria-label="Document content — paste the whole file here"
                  placeholder="Paste the whole file — it will be stored exactly as pasted…"
                  style={{ fontSize: "var(--text-sm)" }}
                />
              ) : (
                <RichTextEditor
                  value={htmlFromRichDoc(draft)}
                  onChange={(html) => setDraft(richDocFromHtml(html))}
                  disabled={readOnly || saving}
                  ariaLabel="Document content"
                  placeholder="Write the document — formatting is kept…"
                  rows={12}
                />
              )}
              <FieldHint>
                {mode === "rich"
                  ? messages.docRichHint
                  : "Save overwrites the stored document with exactly this text (byte-exact)."}
              </FieldHint>
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
      <Modal
        open={confirmStrip}
        onClose={() => setConfirmStrip(false)}
        title={messages.docStripTitle}
        footer={
          <>
            <Btn variant="ghost" label={messages.docStripKeep} onClick={() => setConfirmStrip(false)} />
            <Btn variant="danger" label={messages.docStripConfirm} onClick={stripFormatting} />
          </>
        }
      >
        <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-sm)", lineHeight: "var(--leading-relaxed)" }}>
          {messages.docStripBody(group.name)}
        </p>
      </Modal>
    </section>
  );
}
