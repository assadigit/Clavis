/**
 * CLAVIS — "Start from scratch" (v1.7.0, DECISIONS.md §47): the reset the
 * user asked for ("a clean slate, or at least a reset button to start
 * everything from scratch"). Erases every credential, group and category,
 * the Trash, the deletion memory AND every automatic backup — after it no
 * file in the data folder can bring a previous-version credential back.
 * App settings stay unless the confirmation dialog's box is checked.
 */
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Eraser } from "lucide-react";
import type { CallFn } from "@/lib/clavis/client";
import type { ClavisState } from "@/lib/clavis/types";
import { Ix } from "../icons";
import { Btn, CheckBox, FieldLabel, Modal, SectionHeader } from "../ui-bits";

export function StartFromScratchCard({
  state,
  call,
  readOnly,
}: {
  state: ClavisState;
  call: CallFn;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [alsoResetSettings, setAlsoResetSettings] = useState(false);
  const [working, setWorking] = useState(false);

  async function doReset() {
    if (working) return;
    setWorking(true);
    const res = await call("resetAllData", { keepSettings: !alsoResetSettings });
    setWorking(false);
    if (res.ok) {
      setOpen(false);
      toast.success("Everything was erased. Starting fresh.");
    }
  }

  const nBackups = state.backups.length;

  return (
    <div className="flex flex-col" style={{ gap: "var(--space-2)" }}>
      <SectionHeader icon={Eraser} title="Start from scratch" />
      <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-sm)" }}>
        Erase everything and begin with the empty first-run state — nothing is left that could
        bring deleted or previous-version credentials back.
      </p>
      <div className="flex flex-wrap items-center" style={{ gap: "var(--space-2)" }}>
        <Btn
          variant="danger"
          label="Erase all data…"
          onClick={() => {
            setAlsoResetSettings(false);
            setOpen(true);
          }}
          disabled={readOnly}
          title="Erase every credential, group, category, backup and the deletion memory"
        />
      </div>

      <Modal
        open={open}
        onClose={() => {
          if (!working) setOpen(false);
        }}
        title="Start from scratch?"
        footer={
          <>
            <Btn variant="ghost" label="Cancel" onClick={() => setOpen(false)} disabled={working} />
            <Btn
              variant="danger"
              label="Erase everything"
              onClick={() => void doReset()}
              disabled={working}
            />
          </>
        }
      >
        <p className="t-muted" style={{ margin: "0 0 var(--space-3) 0", fontSize: "var(--text-sm)" }}>
          This erases, permanently:
        </p>
        <ul
          className="flex flex-col"
          style={{ gap: "var(--space-1)", margin: "0 0 var(--space-3) 0", padding: 0, paddingLeft: "var(--space-4)", listStyle: "disc", fontSize: "var(--text-sm)" }}
        >
          <li>Every credential, group and category — the Trash, recent and pinned state too</li>
          <li>The deletion memory (what keeps deleted entries deleted)</li>
          <li>
            {nBackups === 0
              ? "The automatic backups (none exist yet — and none will survive this)"
              : `All ${nBackups} automatic ${nBackups === 1 ? "backup" : "backups"} — nothing old is left anywhere to restore from`}
          </li>
        </ul>
        <div className="flex flex-col" style={{ gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
          <FieldLabel>Your app settings stay (shortcut, dark mode, window position)</FieldLabel>
          <CheckBox
            checked={alsoResetSettings}
            onChange={setAlsoResetSettings}
            label="Also reset app settings (shortcut, dark mode, Start with Windows, window position)"
          />
        </div>
        <p
          className="t-warning flex items-center"
          style={{ gap: "var(--space-2)", margin: 0, fontSize: "var(--text-xs)" }}
        >
          <Ix icon={AlertTriangle} size="sm" />
          This cannot be undone. If you might want anything back, export a backup first.
        </p>
      </Modal>
    </div>
  );
}
