/**
 * CLAVIS — the group view's quick-add form (v1.5.0, DECISIONS.md §40).
 *
 * MODE 2 "Add items one by one": an ALWAYS-VISIBLE Name + Value + Add form
 * at the top of an open group's item list. Submitting calls the atomic
 * "createItemInGroup" action — the item is created AND appended to THIS
 * group in one backend save, so adding an item can never create a group as
 * a side effect (the reported bug: the old flow routed single-item adds
 * through group creation).
 */
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Link2, Plus } from "lucide-react";
import type { CallFn } from "@/lib/clavis/client";
import { messages } from "@/lib/clavis/messages";
import { isHttpUrl } from "../derive";
import { Btn, FieldHint, Toggle, TextInput } from "../ui-bits";

export interface QuickAddFormProps {
  groupId: string;
  call: CallFn;
  readOnly: boolean;
  /** Fresh items land at the bottom of the member list; the parent scrolls
   *  it into view after a successful add. */
  onAdded?: (id: string, name: string) => void;
}

export function QuickAddForm({ groupId, call, readOnly, onAdded }: QuickAddFormProps) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [isSecret, setIsSecret] = useState(true);
  const [secretTouched, setSecretTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  const looksLikeUrl = value.trim() !== "" && isHttpUrl(value);

  async function add() {
    if (readOnly || busy) return;
    const n = name.trim();
    if (n === "") {
      toast.error("Give the item a name first.");
      return;
    }
    setBusy(true);
    const res = await call("createItemInGroup", {
      groupId,
      input: { name: n, value, isSecret },
    });
    setBusy(false);
    if (res.ok && res.id) {
      toast.success(messages.itemAddedToGroup(n));
      setName("");
      setValue("");
      setSecretTouched(false);
      setIsSecret(true);
      onAdded?.(res.id, n);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter" || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "BUTTON") return; /* let buttons activate */
    e.preventDefault();
    e.stopPropagation();
    void add();
  }

  return (
    <form
      className="clavis-members-box flex flex-col"
      style={{ gap: "var(--space-2)", padding: "var(--space-3)" }}
      aria-label="Add an item to this group"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-baseline justify-between" style={{ gap: "var(--space-2)" }}>
        <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)" }}>Add an item</span>
        <FieldHint>Name + value — it joins THIS group, nothing else changes.</FieldHint>
      </div>
      <div className="flex flex-wrap items-center" style={{ gap: "var(--space-2)" }}>
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={readOnly || busy}
          dir="auto"
          placeholder="Name — e.g. GitHub token"
          aria-label="Item name"
          style={{ flex: "1 1 calc(var(--space-6) * 5)", minWidth: 0 }}
        />
        <TextInput
          mono
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            /* A pasted link is probably not a secret — flip the default
               unless the user already chose (§40 nice-to-have). */
            if (!secretTouched) setIsSecret(!isHttpUrl(e.target.value));
          }}
          disabled={readOnly || busy}
          dir="auto"
          spellCheck={false}
          placeholder="Value — token, key, password or URL"
          aria-label="Item value"
          style={{ flex: "2 1 calc(var(--space-6) * 7)", minWidth: 0 }}
        />
        <Btn
          type="submit"
          variant="primary"
          icon={Plus}
          label={busy ? "Adding…" : "Add"}
          onClick={() => void add()}
          disabled={readOnly || busy || name.trim() === ""}
          ariaLabel="Add this item to the group"
        />
      </div>
      <div className="flex flex-wrap items-center" style={{ gap: "var(--space-3)" }}>
        <Toggle
          checked={isSecret}
          onChange={(v) => {
            setIsSecret(v);
            setSecretTouched(true);
          }}
          label="Secret"
          note="Masked everywhere"
          disabled={readOnly || busy}
        />
        {looksLikeUrl ? (
          <span className="flex items-center t-muted" style={{ gap: "calc(var(--space-1) / 2)", fontSize: "var(--text-xs)" }}>
            <Link2 size="var(--text-xs)" style={{ color: "var(--color-accent-text)" }} />
            Will be clickable as a link
          </span>
        ) : null}
      </div>
    </form>
  );
}
