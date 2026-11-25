/**
 * CLAVIS — the whole-document group's full-modal editor (v1.14.0, DECISIONS
 * §56; dual-mode since v1.15.0, §57). The document panel's inline editor
 * (§40) stays as-is; its "Full editor" button moves the whole editing
 * session into this modal — the inline draft carries over as `initialText`,
 * so no unsaved edit is lost on the way up.
 *
 * The manager owns the open state (like the Manage items modal and the item
 * full editor): `setGroupDocument` bumps the group's `updatedAt`, which
 * re-keys the group editor behind this modal — a panel-owned modal would be
 * yanked away mid-session by its own save.
 *
 * v1.15.0: the editor is dual-mode. Plain mode is the byte-exact mono
 * TextArea of v1.14.0; rich mode is the WYSIWYG editor (editors/
 * rich-text-editor.tsx). The mode lives in the stored string itself (the
 * rich sentinel), so the inline ↔ modal carry needs no extra plumbing, and
 * a plain document never changes form until the owner deliberately flips
 * it. Rich → plain with formatting present asks first (the §53/§56 guard
 * pattern). "Copy formatted" puts styled text on the standard webview
 * clipboard; the backend "Copy document" stays the plain, privacy-guarded
 * path for every window.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, FileText, Save, X } from "lucide-react";
import type { CallFn } from "@/lib/clavis/client";
import { messages } from "@/lib/clavis/messages";
import type { Group } from "@/lib/clavis/types";
import { Ix } from "../icons";
import { Btn, FieldHint, Modal, TextArea } from "../ui-bits";
import { DocModeToggle, type DocMode } from "../editors/doc-mode-toggle";
import { RichTextEditor } from "../editors/rich-text-editor";
import { htmlFromRichDoc, isRichDoc, plainToRich, richDocFromHtml, richHasFormatting, richStats, richToPlain, sanitizeRich } from "../editors/rich-text";

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
  const [mode, setMode] = useState<DocMode>(initialText !== null && isRichDoc(initialText) ? "rich" : "plain");
  /* The draft as it entered this editor — the dirty baseline. A mode
     round-trip that lands on the identical string is not dirty. */
  const [baseline, setBaseline] = useState<string | null>(initialText);
  const [loading, setLoading] = useState(initialText === null);
  const [saving, setSaving] = useState(false);
  /* v1.12.0 (§53) pattern: the dirty-close guard — every close path (Esc,
     scrim, ×, Cancel) funnels here; a dirty draft asks first. */
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /* v1.15.0 (§57): the rich → plain formatting-loss guard. */
  const [confirmStrip, setConfirmStrip] = useState(false);

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
        setBaseline(res.document);
        setMode(isRichDoc(res.document) ? "rich" : "plain");
      } else {
        /* Nothing to edit: leave rather than show a dead editor. */
        onClose();
      }
    })();
    return () => {
      alive = false;
    };
  }, [initialText, group.id, call, onClose]);

  /* Dirty = the draft moved from what this editor opened with — whether by
     typing or by a mode switch (a switch that round-trips to the identical
     string lands clean, like the plain editor's untouched state). */
  const dirty = useMemo(() => draft !== null && baseline !== null && draft !== baseline, [draft, baseline]);

  function requestClose() {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }
  const cancelDiscard = () => setConfirmDiscard(false);
  const cancelStrip = () => setConfirmStrip(false);

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

  async function save() {
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
      onClose();
    }
  }

  /** Rich mode only: the current draft on the standard webview clipboard as
   *  text/html + text/plain, so pasting into Word/Gmail/Slack keeps the
   *  styling. This is deliberately NOT the backend copy path (§5.2 privacy
   *  formats apply to the plain "Copy document"); the hint says so. */
  async function copyFormatted() {
    if (mode !== "rich" || draft === null || saving) return;
    const html = sanitizeRich(htmlFromRichDoc(draft));
    const plain = richToPlain(html);
    if (plain.trim() === "") {
      toast.error(messages.docEmptyWarning);
      return;
    }
    try {
      const item = new ClipboardItem({
        "text/plain": new Blob([plain], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      });
      await navigator.clipboard.write([item]);
      toast.success(messages.copiedFormatted);
    } catch {
      try {
        await navigator.clipboard.writeText(plain);
        toast(messages.copyFormattedFallback);
      } catch {
        toast.error(messages.copyFailed);
      }
    }
  }

  const statsText =
    draft === null
      ? ""
      : mode === "rich"
        ? (() => {
            const s = richStats(htmlFromRichDoc(draft));
            return messages.docStats(s.chars, s.lines);
          })()
        : draftStats(draft);

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
            {mode === "rich" ? (
              <Btn variant="glass" icon={Copy} label="Copy formatted" onClick={() => void copyFormatted()} disabled={saving} title="Copy with styling (standard clipboard)" />
            ) : null}
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
            <div className="flex flex-wrap items-center justify-between" style={{ gap: "var(--space-2)" }}>
              <DocModeToggle mode={mode} onChange={switchMode} disabled={readOnly || saving} />
              <span className="t-muted" style={{ fontSize: "var(--text-xs)" }} aria-live="polite">
                {statsText}
              </span>
            </div>
            {mode === "plain" ? (
              <TextArea
                mono
                dir="auto"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={readOnly || saving}
                rows={24}
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
                rows={24}
              />
            )}
            <FieldHint>
              {mode === "rich"
                ? messages.docRichHint
                : "Save overwrites the stored document with exactly this text (byte-exact)."}
            </FieldHint>
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
      <Modal
        open={confirmStrip}
        onClose={cancelStrip}
        title={messages.docStripTitle}
        footer={
          <>
            <Btn variant="ghost" label={messages.docStripKeep} onClick={cancelStrip} />
            <Btn variant="danger" label={messages.docStripConfirm} onClick={stripFormatting} />
          </>
        }
      >
        <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-sm)", lineHeight: "var(--leading-relaxed)" }}>
          {messages.docStripBody(group.name)}
        </p>
      </Modal>
    </>
  );
}
