/**
 * CLAVIS — the two-line member body shared by the group editor's member
 * rows and the manage-items sortable rows (name + shared count over
 * key · masked preview). Extracted in UI-audit round 1 Phase 10 (F-027).
 * The manage-items *candidate* rows are deliberately NOT this component —
 * they show name + preview only (no key, no shared count), a different shape.
 */
"use client";

import { Link2 } from "lucide-react";
import { Ix } from "../icons";

export function MemberRowBody({
  name,
  shared,
  valueKey,
  preview,
  nameSize = "var(--text-md)",
}: {
  name: string;
  shared: number;
  valueKey: string;
  preview: string;
  /** The two call sites differ only in the name size token. */
  nameSize?: string;
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col items-start" style={{ gap: "calc(var(--space-1) / 2)" }}>
      <span className="flex w-full min-w-0 items-center" style={{ gap: "var(--space-2)", minWidth: 0 }}>
        <span className="truncate" style={{ fontSize: nameSize, fontWeight: "var(--weight-semibold)", minWidth: 0 }}>
          {name}
        </span>
        {shared > 0 ? (
          <span
            className="flex items-center t-muted"
            style={{ gap: "calc(var(--space-1) / 2)", fontSize: "var(--text-xs)", flexShrink: 0 }}
            title={`Used in ${shared} groups`}
          >
            <Ix icon={Link2} size="sm" />
            {shared}
          </span>
        ) : null}
      </span>
      <span className="t-mono t-muted truncate w-full" dir="auto" style={{ fontSize: "var(--text-xs)", maxWidth: "100%" }}>
        {valueKey}
        {preview ? <span aria-hidden>{" · "}</span> : null}
        {preview}
      </span>
    </span>
  );
}
