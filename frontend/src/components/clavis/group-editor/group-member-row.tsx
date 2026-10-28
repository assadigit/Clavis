/**
 * CLAVIS — one member row inside an open ITEMS group (v1.5.0, DECISIONS.md
 * §40). Per-item instant copy, fixed-length masked value with an on-demand
 * reveal (the value is fetched from the backend only when revealed — the
 * state snapshot never carries it), URL detection with a clickable open
 * action, edit (the row body) and delete — every action stops propagation
 * so the row's own edit click still works.
 */
"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Check,
  ClipboardCopy,
  Eye,
  EyeOff,
  ExternalLink,
  Trash2,
} from "lucide-react";
import type { CallFn } from "@/lib/clavis/client";
import { messages } from "@/lib/clavis/messages";
import type { Item } from "@/lib/clavis/types";
import { isHttpUrl } from "../derive";
import { EntryTypeIcon, Ix } from "../icons";
import { ManualCopyModal } from "../manual-copy-modal";
import { MemberRowBody } from "../ui-bits";

/** Fixed-length mask — exactly eight dots, no matter how long the value is,
 *  so even the length of a secret never leaks into the UI. */
const FIXED_MASK = "••••••••";

export interface GroupMemberRowProps {
  item: Item;
  /** The member's dotenv key (autoKey + dedupe) shown under the name. */
  valueKey: string;
  sharedCount: number;
  call: CallFn;
  readOnly: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

export function GroupMemberRow({ item, valueKey, sharedCount, call, readOnly, onSelect, onDelete }: GroupMemberRowProps) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [value, setValue] = useState<string | null>(null);
  const [manual, setManual] = useState<string | null>(null); // manual-copy fallback payload

  async function ensureValue(): Promise<string | null> {
    if (value !== null) return value;
    const res = await call("getValue", { id: item.id });
    if (res.ok && typeof res.value === "string") {
      setValue(res.value);
      return res.value;
    }
    return null;
  }

  async function copyValue() {
    if (readOnly || copied) return;
    /* Backend-side copy: the value never enters the webview on the success
       path; §5.2 privacy formats apply for secrets. */
    const res = await call("copy", { kind: "item", id: item.id });
    if (res.ok && res.copied) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      if (res.containsSecret) {
        toast(messages.copiedSecretNote);
      }
      return;
    }
    /* Fallback: the platform blocked the copy — fetch the payload and show
       it pre-selected for a manual Ctrl+C. */
    const v = await ensureValue();
    if (v !== null) setManual(v);
  }

  async function toggleReveal() {
    if (revealed) {
      setRevealed(false);
      return;
    }
    const v = await ensureValue();
    if (v !== null) setRevealed(true);
  }

  const url = revealed && value !== null && isHttpUrl(value) ? value.trim() : null;

  const rowLabel = `Edit ${item.name}${item.isSecret ? " (secret)" : ""}`;

  /* Structure note: the edit target is its OWN button (flex-1) and the
     copy/reveal/delete actions are SIBLING buttons — no interactive element
     is ever nested inside another (axe-clean), and the row keeps the same
     look as the rest of the app's member rows. */
  return (
    <div
      className="clavis-member-row flex items-center"
      style={{ gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", textAlign: "left" }}
    >
      <button
        type="button"
        className="clavis-focusable flex min-w-0 flex-1 items-center"
        onClick={onSelect}
        title={`Edit ${item.name}`}
        aria-label={rowLabel}
        style={{ gap: "var(--space-2)", cursor: "pointer", textAlign: "left", background: "none", border: "none", padding: 0 }}
      >
        <EntryTypeIcon kind="item" isSecret={item.isSecret} size="md" />
        <span className="flex min-w-0 flex-1 flex-col items-start" style={{ gap: "calc(var(--space-1) / 2)" }}>
          <MemberRowBody
            name={item.name}
            shared={sharedCount}
            valueKey={valueKey}
            preview={item.isSecret && !revealed ? FIXED_MASK : ""}
            nameSize="var(--text-sm)"
          />
          {revealed && value !== null ? (
            <span className="t-mono flex w-full min-w-0 items-center" dir="auto" style={{ fontSize: "var(--text-xs)", gap: "var(--space-2)" }}>
              <span className="truncate" style={{ maxWidth: "100%" }}>
                {value.split("\n")[0]}
                {value.includes("\n") ? "…" : ""}
              </span>
            </span>
          ) : null}
        </span>
      </button>

      {/* Open link — appears only when the revealed value is an http(s) URL. */}
      {url ? (
        <button
          type="button"
          className="clavis-btn clavis-btn-ghost clavis-focusable clavis-row-action"
          title="Open this link in your browser"
          aria-label={`Open ${url} in your browser`}
          style={{ padding: "var(--space-1)", flexShrink: 0 }}
          onClick={() => void call("openUrl", { url })}
        >
          <Ix icon={ExternalLink} size="sm" style={{ color: "var(--color-accent-text)" }} />
        </button>
      ) : null}

      {/* Copy — the row's whole point: one click puts exactly this value on
          the clipboard (✓ beat on success, manual fallback on failure). */}
      <button
        type="button"
        className="clavis-btn clavis-btn-ghost clavis-focusable clavis-row-action"
        aria-label={copied ? `Copied ${item.name}` : `Copy ${item.name}`}
        title="Copy this value"
        style={{ padding: "var(--space-1)", flexShrink: 0, color: copied ? "var(--color-success-text)" : undefined }}
        onClick={() => void copyValue()}
      >
        <Ix icon={copied ? Check : ClipboardCopy} size="sm" />
      </button>

      {/* Reveal / hide — fetches the value once, on demand. */}
      <button
        type="button"
        className="clavis-btn clavis-btn-ghost clavis-focusable clavis-row-action"
        role="switch"
        aria-checked={revealed}
        aria-label={revealed ? `Hide ${item.name}` : `Reveal ${item.name}`}
        title={revealed ? "Hide value" : "Reveal value"}
        style={{ padding: "var(--space-1)", flexShrink: 0 }}
        onClick={() => void toggleReveal()}
      >
        <Ix icon={revealed ? EyeOff : Eye} size="sm" />
      </button>

      {/* Delete — the app-wide soft delete with the central Undo toast. */}
      {!readOnly ? (
        <button
          type="button"
          className="clavis-btn clavis-btn-ghost clavis-focusable clavis-row-action"
          aria-label={`Delete ${item.name}`}
          title="Delete item (Undo from the toast)"
          style={{ padding: "var(--space-1)", flexShrink: 0 }}
          onClick={onDelete}
        >
          <Ix icon={Trash2} size="sm" />
        </button>
      ) : null}

      <ManualCopyModal
        open={manual !== null}
        title={`Copy “${item.name}” manually`}
        text={manual ?? ""}
        onClose={() => setManual(null)}
      />
    </div>
  );
}
