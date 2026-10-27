/**
 * CLAVIS — settings › data: the import flows (backup JSON incl. fragments,
 * Markdown/TXT files with conflict resolution, folder import) with their
 * dialogs. Moved move-only from settings-view.tsx in UI-audit round 1
 * Phase 11 (F-026); the buttons render in the same order inside the Data
 * section, so the DOM and every interaction are unchanged.
 */
"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Check, FileText, FolderInput, Info, Upload } from "lucide-react";
import type { BackupPreview, CallFn, FilesPreview } from "@/lib/clavis/client";
import { platform } from "@/desktop/platform";
import type { ImportConflict } from "@/lib/clavis/types";
import type { ClavisState } from "@/lib/clavis/types";
import { Ix } from "../icons";
import { Btn, CheckBox, Modal } from "../ui-bits";
import { ChoicePair, type FileChoice } from "./choice-pair";

interface FilesImportState {
  files: { name: string; content: string }[];
  conflicts: ImportConflict[];
  parsedCount: number;
  choices: Record<number, FileChoice>;
  applyAll: boolean;
  globalChoice: FileChoice;
}

export function ImportFlows({
  state,
  call,
  readOnly,
}: {
  state: ClavisState;
  call: CallFn;
  readOnly: boolean;
}) {
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const [backupImport, setBackupImport] = useState<{ json: string; preview: BackupPreview } | null>(null);
  const [filesImport, setFilesImport] = useState<FilesImportState | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  async function onBackupFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!f || readOnly) return;
    const json = await f.text();
    const res = await call("importBackupPreview", { json });
    if (!res.ok) return;
    const preview = res.preview as BackupPreview;
    if (!preview.valid) {
      toast.error(preview.error ?? "Not a valid Clavis backup file.");
      return;
    }
    setBackupImport({ json, preview });
  }

  async function applyBackupImport(mode: "replace" | "merge") {
    if (!backupImport || importBusy) return;
    setImportBusy(true);
    const res = await call("importBackup", { mode, json: backupImport.json });
    if (res.ok && res.summary) {
      toast.success(
        `Imported — added ${res.summary.added}, updated ${res.summary.updated}, skipped ${res.summary.skipped}.`
      );
      setBackupImport(null);
    }
    setImportBusy(false);
  }

  async function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (list.length === 0 || readOnly) return;
    const files: { name: string; content: string }[] = [];
    for (const f of list) {
      files.push({ name: f.name, content: await f.text() });
    }
    await startFilesImport(files);
  }

  async function startFilesImport(files: { name: string; content: string }[]) {
    const res = await call("importFilesPreview", { files });
    if (!res.ok) return;
    const preview = res.preview as FilesPreview;
    if (preview.parsedCount === 0) {
      toast.error("No importable Clavis markdown or text files were found.");
      return;
    }
    if (preview.conflicts.length === 0) {
      const r2 = await call("importFilesApply", {
        files,
        resolution: { choice: "reuse", applyAll: true },
      });
      if (r2.ok && r2.summary) {
        toast.success(
          `Imported — added ${r2.summary.added}, updated ${r2.summary.updated}, skipped ${r2.summary.skipped}.`
        );
      }
      return;
    }
    setFilesImport({
      files,
      conflicts: preview.conflicts,
      parsedCount: preview.parsedCount,
      choices: {},
      applyAll: false,
      globalChoice: "reuse",
    });
  }

  async function onImportFolderPicked() {
    if (readOnly) return;
    const res = await platform.pickImportFolder();
    if (!res.ok || !res.files) {
      if (res.error) toast.error(res.error);
      return;
    }
    await startFilesImport(res.files);
  }

  async function applyFilesImport() {
    if (!filesImport || importBusy) return;
    setImportBusy(true);
    const fileIndexes = [...new Set(filesImport.conflicts.map((c) => c.fileIndex))];
    const perFile = filesImport.applyAll
      ? undefined
      : fileIndexes.map((fi) => ({
          fileIndex: fi,
          choice: filesImport.choices[fi] ?? filesImport.globalChoice,
        }));
    const resolution = {
      choice: filesImport.applyAll
        ? filesImport.globalChoice
        : (filesImport.choices[fileIndexes[0] ?? 0] ?? filesImport.globalChoice),
      applyAll: filesImport.applyAll,
    };
    const res = await call("importFilesApply", {
      files: filesImport.files,
      resolution,
      perFile,
    });
    if (res.ok && res.summary) {
      toast.success(
        `Imported — added ${res.summary.added}, updated ${res.summary.updated}, skipped ${res.summary.skipped}.`
      );
      setFilesImport(null);
    }
    setImportBusy(false);
  }

  /* Conflicts grouped per file. */
  const conflictGroups: Map<number, ImportConflict[]> = new Map();
  if (filesImport) {
    for (const c of filesImport.conflicts) {
      const arr = conflictGroups.get(c.fileIndex) ?? [];
      arr.push(c);
      conflictGroups.set(c.fileIndex, arr);
    }
  }

  const choiceFor = (fi: number): FileChoice =>
    filesImport?.choices[fi] ?? filesImport?.globalChoice ?? "reuse";

  return (
    <>
      <Btn variant="glass" icon={Upload} label="Import backup" onClick={() => backupInputRef.current?.click()} disabled={readOnly} title="Import a clavis-backup .json" />
      <Btn variant="glass" icon={FileText} label="Import Markdown / TXT" onClick={() => filesInputRef.current?.click()} disabled={readOnly} title="Import .md or .txt files" />
      <Btn variant="glass" icon={FolderInput} label="Import folder" onClick={() => void onImportFolderPicked()} disabled={readOnly} title="Import every .md and .txt file in a folder you pick" />
      <input ref={backupInputRef} type="file" accept=".json,application/json" hidden tabIndex={-1} aria-hidden onChange={(e) => void onBackupFileChosen(e)} />
      <input ref={filesInputRef} type="file" accept=".md,.txt,.markdown,text/plain,text/markdown" multiple hidden tabIndex={-1} aria-hidden onChange={(e) => void onFilesChosen(e)} />

      {/* ---------------- Import backup dialog ---------------- */}
      <Modal
        open={backupImport !== null}
        onClose={() => setBackupImport(null)}
        title="Import backup"
        footer={
          backupImport?.preview.fragment ? (
            /* UI-audit round 1 Phase 4: a partial export can only merge — it
               is not a vault, so Replace-everything would be a lie. */
            <>
              <Btn variant="ghost" label="Cancel" onClick={() => setBackupImport(null)} disabled={importBusy} />
              <Btn
                variant="primary"
                label="Merge"
                onClick={() => void applyBackupImport("merge")}
                disabled={importBusy}
                title="Add missing entries; keep the newer version of each"
              />
            </>
          ) : (
            <>
              <Btn variant="ghost" label="Cancel" onClick={() => setBackupImport(null)} disabled={importBusy} />
              <Btn
                variant="glass"
                label="Merge"
                onClick={() => void applyBackupImport("merge")}
                disabled={importBusy}
                title="Add missing entries; keep the newer version of each"
              />
              <Btn
                variant="danger"
                label="Replace everything"
                onClick={() => void applyBackupImport("replace")}
                disabled={importBusy}
              />
            </>
          )
        }
      >
        {backupImport ? (
          <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
            {backupImport.preview.fragment ? (
              <p style={{ margin: 0, fontSize: "var(--text-sm)" }}>
                This is a partial export of the{" "}
                {backupImport.preview.fragment.type === "group" ? "group" : "item"}{" "}
                <strong dir="auto">“{backupImport.preview.fragment.name}”</strong> (
                {backupImport.preview.incoming.items}{" "}
                {backupImport.preview.incoming.items === 1 ? "item" : "items"},{" "}
                {backupImport.preview.incoming.groups}{" "}
                {backupImport.preview.incoming.groups === 1 ? "group" : "groups"}). Merging adds
                anything you don't already have.
              </p>
            ) : (
              <>
                <p style={{ margin: 0, fontSize: "var(--text-sm)" }}>
                  The backup contains{" "}
                  <strong>
                    {backupImport.preview.incoming.items} items, {backupImport.preview.incoming.groups} groups and{" "}
                    {backupImport.preview.incoming.categories} categories
                  </strong>
                  .
                </p>
                <p style={{ margin: 0, fontSize: "var(--text-sm)" }}>
                  Replacing discards your current {state.data.items.filter((i) => !i.deletedAt).length} items and{" "}
                  {state.data.groups.filter((g) => !g.deletedAt).length} groups. Merging keeps both sides.
                </p>
              </>
            )}
            <p className="t-muted flex items-center" style={{ gap: "var(--space-2)", margin: 0, fontSize: "var(--text-xs)" }}>
              <Ix icon={Info} size="sm" />
              A backup of your current data is made first, either way.
            </p>
          </div>
        ) : null}
      </Modal>

      {/* ---------------- Import files conflict dialog ---------------- */}
      <Modal
        open={filesImport !== null}
        onClose={() => setFilesImport(null)}
        title="Resolve import conflicts"
        width="min(640px, calc(100vw - var(--space-6)))"
        footer={
          <>
            <Btn variant="ghost" label="Cancel" onClick={() => setFilesImport(null)} disabled={importBusy} />
            <Btn
              variant="primary"
              icon={Check}
              label={`Import ${filesImport?.parsedCount ?? 0} file${(filesImport?.parsedCount ?? 0) === 1 ? "" : "s"}`}
              onClick={() => void applyFilesImport()}
              disabled={importBusy}
            />
          </>
        }
      >
        {filesImport ? (
          <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
            <CheckBox
              checked={filesImport.applyAll}
              onChange={(v) => setFilesImport((s) => (s ? { ...s, applyAll: v } : s))}
              label="Apply to all"
            />
            {filesImport.applyAll ? (
              <div className="glass-row flex items-center" style={{ gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)" }}>
                <span className="flex-1" style={{ fontSize: "var(--text-sm)" }}>
                  For every conflict below:
                </span>
                <ChoicePair
                  value={filesImport.globalChoice}
                  onChange={(c) => setFilesImport((s) => (s ? { ...s, globalChoice: c } : s))}
                />
              </div>
            ) : null}
            {[...conflictGroups.entries()].map(([fi, conflicts]) => (
              <div key={fi} className="flex flex-col" style={{ gap: "var(--space-1)" }}>
                <span className="t-muted flex items-center" style={{ gap: "var(--space-2)", fontSize: "var(--text-xs)" }}>
                  <Ix icon={FileText} size="sm" />
                  {filesImport.files[fi]?.name ?? `File ${fi + 1}`}
                </span>
                {conflicts.map((c, k) => (
                  <div
                    key={`${c.fileIndex}-${k}-${c.name}`}
                    className="glass-row flex flex-wrap items-center"
                    style={{ gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)" }}
                  >
                    <span className="flex min-w-0 flex-1 flex-col" style={{ gap: "calc(var(--space-1) / 2)" }}>
                      <span className="truncate" style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-medium)" }} dir="auto">
                        “{c.name}”
                      </span>
                      <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>
                        {c.reason === "key" ? "same key as" : "same name as"} “{c.existingName}” ({c.kind})
                      </span>
                    </span>
                    {filesImport.applyAll ? (
                      <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>
                        {filesImport.globalChoice === "reuse" ? "Reuse existing" : "Keep both"}
                      </span>
                    ) : (
                      <ChoicePair
                        value={choiceFor(fi)}
                        onChange={(c2) =>
                          setFilesImport((s) =>
                            s ? { ...s, choices: { ...s.choices, [fi]: c2 } } : s
                          )
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
