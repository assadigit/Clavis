/**
 * CLAVIS — manual-copy fallback dialog (v1.5.0, DECISIONS.md §40).
 *
 * When the platform copy fails (the shell could not write the clipboard, or
 * a browser blocked the programmatic copy), the user still gets their bytes:
 * this dialog shows the EXACT payload pre-selected in a read-only textarea —
 * one keystroke (Ctrl+C / ⌘C) copies it. The content is fetched on demand,
 * only for this dialog, exactly like the edit form's getValue fetch.
 */
"use client";

import { useEffect, useRef } from "react";
import { CheckCheck } from "lucide-react";
import { messages } from "@/lib/clavis/messages";
import { Btn, FieldHint, Modal } from "./ui-bits";

export interface ManualCopyModalProps {
  open: boolean;
  /** What is being copied (e.g. the group or item name). */
  title: string;
  /** The EXACT payload the user should end up with — byte for byte. */
  text: string;
  onClose: () => void;
}

export function ManualCopyModal({ open, title, text, onClose }: ManualCopyModalProps) {
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  /* Select the whole payload whenever the dialog opens (and on re-focus) so
     Ctrl+C copies everything without any further clicks. */
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      const el = areaRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, text]);

  return (
    <Modal
      open={open}
      title={messages.manualCopyTitle}
      onClose={onClose}
      width="min(720px, calc(100vw - var(--space-6)))"
      footer={
        <>
          <Btn
            variant="glass"
            icon={CheckCheck}
            label="Select all"
            onClick={() => areaRef.current?.select()}
            ariaLabel="Select the whole content"
          />
          <Btn variant="primary" label="Done" onClick={onClose} />
        </>
      }
    >
      <div className="flex flex-col" style={{ gap: "var(--space-2)" }} onKeyDown={(e) => e.stopPropagation()}>
        <p style={{ margin: 0, fontSize: "var(--text-sm)", fontWeight: "var(--weight-medium)" }} dir="auto">
          {title}
        </p>
        <FieldHint>{messages.manualCopyHint}</FieldHint>
        <textarea
          ref={areaRef}
          readOnly
          value={text}
          rows={12}
          dir="auto"
          aria-label={`Content to copy manually: ${title}`}
          onFocus={(e) => e.currentTarget.select()}
          className="glass-input clavis-scroll"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-sm)",
            width: "100%",
            resize: "vertical",
            whiteSpace: "pre",
            overflowX: "auto",
          }}
        />
      </div>
    </Modal>
  );
}
