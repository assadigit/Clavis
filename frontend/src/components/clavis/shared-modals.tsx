/**
 * CLAVIS — shared-item modals (SPEC §5.6).
 * Only shown when an item belongs to two or more groups.
 */
"use client";

import { Link2 } from "lucide-react";
import type { Group } from "@/lib/clavis/types";
import { Btn, Modal } from "./ui-bits";
import { Ix } from "./icons";

function GroupList({ groups }: { groups: Group[] }) {
  return (
    <ul className="flex flex-col" style={{ gap: "var(--space-1)", margin: 0, padding: 0, listStyle: "none" }}>
      {groups.map((g) => (
        <li
          key={g.id}
          className="glass-row flex items-center"
          style={{ gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)" }}
        >
          <Ix icon={Link2} size="sm" style={{ color: "var(--color-accent-text)" }} />
          <span style={{ fontSize: "var(--text-sm)" }}>{g.name}</span>
        </li>
      ))}
    </ul>
  );
}

export function SharedEditModal({
  open,
  groups,
  currentGroupName,
  saving,
  onCancel,
  onUpdateEverywhere,
  onOnlyForGroup,
}: {
  open: boolean;
  groups: Group[];
  currentGroupName: string | null;
  saving?: boolean;
  onCancel: () => void;
  onUpdateEverywhere: () => void;
  onOnlyForGroup: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={`This item is used in ${groups.length} groups`}
      footer={
        <>
          <Btn variant="ghost" label="Cancel" onClick={onCancel} disabled={saving} />
          {currentGroupName ? (
            <Btn
              variant="glass"
              label={`Only for “${currentGroupName}” (keep a separate copy)`}
              onClick={onOnlyForGroup}
              disabled={saving}
            />
          ) : null}
          <Btn
            variant="primary"
            label={`Update everywhere (${groups.length} groups)`}
            onClick={onUpdateEverywhere}
            disabled={saving}
          />
        </>
      }
    >
      <p className="t-muted" style={{ margin: "0 0 var(--space-3) 0", fontSize: "var(--text-sm)" }}>
        Editing it here changes the value in every group that uses it:
      </p>
      <GroupList groups={groups} />
    </Modal>
  );
}

export function SharedDeleteModal({
  open,
  name,
  groups,
  saving,
  onCancel,
  onDeleteEverywhere,
}: {
  open: boolean;
  name: string;
  groups: Group[];
  saving?: boolean;
  onCancel: () => void;
  onDeleteEverywhere: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={`This item is used in ${groups.length} groups`}
      footer={
        <>
          <Btn variant="ghost" label="Cancel" onClick={onCancel} disabled={saving} />
          <Btn variant="danger" icon={undefined} label="Delete everywhere" onClick={onDeleteEverywhere} disabled={saving} />
        </>
      }
    >
      <p className="t-muted" style={{ margin: "0 0 var(--space-3) 0", fontSize: "var(--text-sm)" }}>
        Deleting “{name}” removes it from all of these groups:
      </p>
      <GroupList groups={groups} />
    </Modal>
  );
}
