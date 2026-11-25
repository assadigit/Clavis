/**
 * CLAVIS — the WYSIWYG rich-text editor for whole-document groups (v1.15.0,
 * DECISIONS §57). Basic formatting only, by the owner's request: Bold,
 * Italic, Underline, Strikethrough · Align left / center / right · bullet
 * and numbered lists · the full emoji pack · Undo / Redo / Clear formatting.
 *
 * Built on contentEditable + document.execCommand — deprecated but shipped
 * (and stable) in every Chromium, which is the only renderer Clavis runs on
 * (WebView2); zero dependencies for the core toolbar.
 *
 * The value contract is HTML without the storage sentinel (see
 * editors/rich-text.ts): the caller loads SANITIZED html, the editor emits
 * its raw innerHTML on every input, and the caller sanitizes at the
 * boundaries (save, copy formatted, mode switches). innerHTML is only
 * rewritten from outside when the incoming value differs from the last one
 * this editor emitted — that keeps the caret still while typing.
 */
"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Ix } from "../icons";
import { useDismiss } from "../ui/dismiss";
import { EmojiPanel, EmojiTrigger } from "./emoji-picker";

export interface RichTextEditorProps {
  /** HTML body, no sentinel. Sanitized by the caller on load. */
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  placeholder?: string;
  /** Minimum height in text lines — the plain editor's `rows`. */
  rows?: number;
  id?: string;
}

interface ToolDef {
  cmd: string;
  icon: LucideIcon;
  label: string;
  /** Active-state key; omit for commands without one (undo/redo/clear). */
  stateKey?: string;
}

const INLINE_TOOLS: ToolDef[] = [
  { cmd: "bold", icon: Bold, label: "Bold", stateKey: "bold" },
  { cmd: "italic", icon: Italic, label: "Italic", stateKey: "italic" },
  { cmd: "underline", icon: Underline, label: "Underline", stateKey: "underline" },
  { cmd: "strikeThrough", icon: Strikethrough, label: "Strikethrough", stateKey: "strikeThrough" },
];

const ALIGN_TOOLS: ToolDef[] = [
  { cmd: "justifyLeft", icon: AlignLeft, label: "Align left", stateKey: "justifyLeft" },
  { cmd: "justifyCenter", icon: AlignCenter, label: "Align center", stateKey: "justifyCenter" },
  { cmd: "justifyRight", icon: AlignRight, label: "Align right", stateKey: "justifyRight" },
];

const LIST_TOOLS: ToolDef[] = [
  { cmd: "insertUnorderedList", icon: List, label: "Bulleted list", stateKey: "insertUnorderedList" },
  { cmd: "insertOrderedList", icon: ListOrdered, label: "Numbered list", stateKey: "insertOrderedList" },
];

const HISTORY_TOOLS: ToolDef[] = [
  { cmd: "undo", icon: Undo2, label: "Undo" },
  { cmd: "redo", icon: Redo2, label: "Redo" },
  { cmd: "removeFormat", icon: Eraser, label: "Clear formatting" },
];

type ActiveMap = Partial<Record<string, boolean>>;

function ToolButton({ tool, pressed, disabled, onExec }: { tool: ToolDef; pressed?: boolean; disabled?: boolean; onExec: (cmd: string) => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={tool.label}
      aria-label={tool.label}
      aria-pressed={tool.stateKey ? (pressed === true ? "true" : "false") : undefined}
      /* mousedown is swallowed so the editor's selection survives the click */
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onExec(tool.cmd)}
      className="clavis-btn clavis-btn-ghost clavis-tool"
    >
      <Ix icon={tool.icon} size="sm" />
    </button>
  );
}

function ToolDivider() {
  return <span aria-hidden className="clavis-tool-sep" />;
}

export function RichTextEditor({ value, onChange, disabled, ariaLabel, placeholder, rows = 12, id }: RichTextEditorProps) {
  const edRef = useRef<HTMLDivElement | null>(null);
  /* null = "never synced"; the first effect pass writes the initial HTML. */
  const lastEmitted = useRef<string | null>(null);
  /* The caret position to restore when focus went elsewhere (e.g. the emoji
     search box) and an insert arrives. */
  const savedRange = useRef<Range | null>(null);
  const [active, setActive] = useState<ActiveMap>({});
  /* The emoji picker: the trigger rides in the toolbar, the panel is
     rendered against the toolbar wrapper (anchoring it to the 28px trigger
     squeezed the panel to a sliver — harness round v1.15.0), and one dismiss
     ref covers both. When the toolbar sits too low for the panel to fit
     below (the inline editor at the bottom of the detail column), the panel
     flips open ABOVE the toolbar. */
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiFlip, setEmojiFlip] = useState(false);
  const toolbarWrapRef = useRef<HTMLDivElement | null>(null);
  const closeEmoji = () => setEmojiOpen(false);
  const dismissRef = useDismiss(emojiOpen, closeEmoji);

  function toggleEmoji() {
    if (!emojiOpen) {
      const wrap = toolbarWrapRef.current;
      if (wrap) {
        const r = wrap.getBoundingClientRect();
        /* The panel is ~9 space-6 rows tall (search + tabs + 5-row grid);
           flip up only when below does not fit and above does. */
        const need = 9 * 32;
        setEmojiFlip(r.bottom + need > window.innerHeight && r.top >= need);
      }
    }
    setEmojiOpen((o) => !o);
  }

  /* External value → DOM. Only when it is not the echo of our own input. */
  useLayoutEffect(() => {
    const ed = edRef.current;
    if (!ed) return;
    if (lastEmitted.current === null || value !== lastEmitted.current) {
      ed.innerHTML = value;
      lastEmitted.current = value;
    }
  }, [value]);

  /* Active toolbar states follow the selection. */
  useEffect(() => {
    const refresh = () => {
      const ed = edRef.current;
      if (!ed) return;
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && ed.contains(sel.anchorNode)) {
        savedRange.current = sel.getRangeAt(0).cloneRange();
      }
      if (typeof document.queryCommandState !== "function") return;
      try {
        setActive({
          bold: document.queryCommandState("bold"),
          italic: document.queryCommandState("italic"),
          underline: document.queryCommandState("underline"),
          strikeThrough: document.queryCommandState("strikeThrough"),
          justifyLeft: document.queryCommandState("justifyLeft"),
          justifyCenter: document.queryCommandState("justifyCenter"),
          justifyRight: document.queryCommandState("justifyRight"),
          insertUnorderedList: document.queryCommandState("insertUnorderedList"),
          insertOrderedList: document.queryCommandState("insertOrderedList"),
        });
      } catch {
        /* queryCommandState throws on a detached document — leave as-is */
      }
    };
    document.addEventListener("selectionchange", refresh);
    return () => document.removeEventListener("selectionchange", refresh);
  }, []);

  function emit() {
    const ed = edRef.current;
    if (!ed) return;
    lastEmitted.current = ed.innerHTML;
    onChange(ed.innerHTML);
  }

  function handleInput() {
    emit();
  }

  function exec(cmd: string, value_?: string) {
    if (disabled) return;
    edRef.current?.focus();
    if (typeof document.execCommand === "function") {
      try {
        document.execCommand(cmd, false, value_);
      } catch {
        /* unsupported command — the editor just stays as it was */
      }
    }
    /* execCommand fires input in Chromium; emit anyway so non-Chromium
       test environments stay in sync with the DOM. */
    emit();
  }

  function insertEmoji(emoji: string) {
    if (disabled) return;
    const ed = edRef.current;
    if (!ed) return;
    const sel = window.getSelection();
    const inEditor = sel !== null && sel.rangeCount > 0 && ed.contains(sel.anchorNode);
    if (!inEditor && savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    ed.focus();
    exec("insertText", emoji);
  }

  const areaStyle: CSSProperties = {
    minHeight: `calc(var(--text-sm) * var(--leading-normal) * ${rows} + var(--space-2) + var(--space-2))`,
  };

  return (
    <div ref={dismissRef} className="relative flex flex-col" style={{ gap: "var(--space-1)" }}>
      {/* The picker anchors to the toolbar wrapper (top: 100% = directly
          under the toolbar, over the editable area) and spans the editor's
          full width — never the 28px trigger (harness round v1.15.0). */}
      <div ref={toolbarWrapRef} className="relative">
        <div className="clavis-tool-bar" role="toolbar" aria-label="Text formatting">
          {INLINE_TOOLS.map((t) => (
            <ToolButton key={t.cmd} tool={t} pressed={active[t.stateKey as string]} disabled={disabled} onExec={exec} />
          ))}
          <ToolDivider />
          {ALIGN_TOOLS.map((t) => (
            <ToolButton key={t.cmd} tool={t} pressed={active[t.stateKey as string]} disabled={disabled} onExec={exec} />
          ))}
          <ToolDivider />
          {LIST_TOOLS.map((t) => (
            <ToolButton key={t.cmd} tool={t} pressed={active[t.stateKey as string]} disabled={disabled} onExec={exec} />
          ))}
          <ToolDivider />
          <EmojiTrigger open={emojiOpen} onToggle={toggleEmoji} disabled={disabled} />
          <ToolDivider />
          {HISTORY_TOOLS.map((t) => (
            <ToolButton key={t.cmd} tool={t} disabled={disabled} onExec={exec} />
          ))}
        </div>
        {emojiOpen ? <EmojiPanel onInsert={insertEmoji} onClose={closeEmoji} flip={emojiFlip} /> : null}
      </div>
      <div
        ref={edRef}
        id={id}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        dir="auto"
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck={false}
        className="clavis-rich-area clavis-scroll"
        data-placeholder={placeholder}
        data-empty={value === "" ? "true" : "false"}
        onInput={handleInput}
        style={areaStyle}
      />
    </div>
  );
}
