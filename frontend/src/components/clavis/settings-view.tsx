/**
 * CLAVIS — settings view (SPEC §5.9): shortcut capture, toggles, glass
 * intensity + solid mode, data import/export with conflict resolution,
 * backups with Restore, about.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Files,
  FolderInput,
  FolderOpen,
  HardDrive,
  Info,
  Keyboard,
  MoonStar,
  Palette,
  RefreshCw,
  RotateCcw,
  Upload,
} from "lucide-react";
import type { BackupPreview, CallFn, FilesPreview } from "@/lib/clavis/client";
import { downloadExport } from "@/lib/clavis/client";
import { platform } from "@/desktop/platform";
import type { ImportConflict } from "@/lib/clavis/types";
import type { ClavisState } from "@/lib/clavis/types";
import { applyGlassVars } from "./glass";
import {
  activeModifiers,
  displayKey,
  isBrowserReservedShortcut,
  isModifierKey,
} from "./hotkey";
import { Ix } from "./icons";
import { Btn, CheckBox, FieldLabel, Modal, SectionHeader, Toggle } from "./ui-bits";
import { formatDateTime } from "./derive";

export interface SettingsViewProps {
  state: ClavisState;
  call: CallFn;
  readOnly: boolean;
}

type FileChoice = "reuse" | "keepBoth";

interface FilesImportState {
  files: { name: string; content: string }[];
  conflicts: ImportConflict[];
  parsedCount: number;
  choices: Record<number, FileChoice>;
  applyAll: boolean;
  globalChoice: FileChoice;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function SettingsView({ state, call, readOnly }: SettingsViewProps) {
  const settings = state.data.settings;

  /* ---- Shortcut capture ---- */
  const [capturing, setCapturing] = useState(false);
  const [draftShortcut, setDraftShortcut] = useState<string | null>(null);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [savingShortcut, setSavingShortcut] = useState(false);

  /* ---- Glass slider (live preview, commit on release) ---- */
  const [glassLocal, setGlassLocal] = useState<number | null>(null);

  /* ---- Imports ---- */
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const [backupImport, setBackupImport] = useState<{ json: string; preview: BackupPreview } | null>(null);
  const [filesImport, setFilesImport] = useState<FilesImportState | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  function onCaptureKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!capturing) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setCapturing(true);
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setCapturing(false);
      return;
    }
    if (isModifierKey(e)) return;
    const mods = activeModifiers(e);
    if (mods.length === 0) {
      setShortcutError("Add at least one modifier — Ctrl, Alt or Shift.");
      return;
    }
    const key = displayKey(e);
    if (isBrowserReservedShortcut(mods, key)) {
      setShortcutError("This shortcut is used by another app. Choose a different one.");
      return;
    }
    setDraftShortcut([...mods, key].join("+"));
    setShortcutError(null);
    setCapturing(false);
  }

  async function saveShortcut() {
    if (!draftShortcut || savingShortcut) return;
    setSavingShortcut(true);
    const res = await call("updateSettings", { patch: { shortcut: draftShortcut } });
    if (res.ok) {
      toast.success(`Shortcut saved: ${draftShortcut}.`);
      setDraftShortcut(null);
    }
    setSavingShortcut(false);
  }

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

  async function onExportAllMarkdown() {
    const res = await platform.exportAllMarkdown();
    if (res.ok && res.count) {
      toast.success(`Exported ${res.count} Markdown files.`);
    } else if (res.error) {
      toast.error(res.error);
    }
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

  async function restoreBackup(name: string) {
    const res = await call("restoreBackup", { name });
    if (res.ok) toast.success(`Backup “${name}” restored.`);
  }

  const glassValue = glassLocal ?? settings.glassIntensity;

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
    <section
      aria-label="Settings"
      className="glass-panel clavis-scroll flex flex-col"
      style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "var(--space-5)", gap: "var(--space-5)" }}
    >
      {/* ---------------- Shortcut ---------------- */}
      <div className="flex flex-col" style={{ gap: "var(--space-2)" }}>
        <SectionHeader icon={Keyboard} title="Shortcut" />
        <div
          tabIndex={0}
          data-shortcut-capture="true"
          aria-label="Shortcut capture field"
          onKeyDown={onCaptureKeyDown}
          onClick={() => {
            if (!readOnly) setCapturing(true);
          }}
          className="glass-input clavis-focusable flex items-center justify-between"
          style={{ padding: "var(--space-2) var(--space-3)", gap: "var(--space-2)", cursor: readOnly ? "not-allowed" : "pointer" }}
        >
          <span style={{ fontSize: "var(--text-sm)" }}>
            {capturing ? (
              <span className="t-accent">Press keys now…</span>
            ) : (
              draftShortcut ?? settings.shortcut
            )}
          </span>
          <Btn
            variant="ghost"
            label={capturing ? "Stop" : "Change"}
            onClick={() => setCapturing((c) => !c)}
            disabled={readOnly}
            ariaLabel="Change shortcut"
          />
        </div>
        {shortcutError ? (
          <p className="t-danger flex items-center" style={{ gap: "var(--space-2)", margin: 0, fontSize: "var(--text-xs)" }}>
            <Ix icon={AlertTriangle} size="sm" />
            {shortcutError}
          </p>
        ) : null}
        <div className="flex items-center" style={{ gap: "var(--space-2)" }}>
          <Btn
            variant="primary"
            icon={Check}
            label="Save shortcut"
            onClick={() => void saveShortcut()}
            disabled={readOnly || !draftShortcut || draftShortcut === settings.shortcut || savingShortcut}
          />
        </div>
        <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-xs)" }}>
          Works everywhere — even when Clavis is not the focused app.
        </p>
      </div>

      {/* ---------------- Appearance ---------------- */}
      <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
        <SectionHeader icon={Palette} title="Appearance" />
        <div className="flex flex-col" style={{ gap: "var(--space-2)" }}>
          <div className="flex items-center justify-between">
            <FieldLabel>Glass intensity</FieldLabel>
            <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>
              {glassValue}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={glassValue}
            disabled={readOnly}
            aria-label="Glass intensity"
            className="clavis-slider"
            onChange={(e) => {
              const v = Number(e.target.value);
              setGlassLocal(v);
              applyGlassVars(v, settings.solidMode);
            }}
            onPointerUp={() => {
              if (glassLocal !== null && !readOnly) void call("updateSettings", { patch: { glassIntensity: glassLocal } });
              setGlassLocal(null);
            }}
            onKeyUp={() => {
              if (glassLocal !== null && !readOnly) void call("updateSettings", { patch: { glassIntensity: glassLocal } });
              setGlassLocal(null);
            }}
          />
        </div>
        <Toggle
          checked={settings.solidMode}
          onChange={(v) => {
            if (!readOnly) void call("updateSettings", { patch: { solidMode: v } });
          }}
          label="Solid mode"
          note="Swap glass for solid surfaces"
          disabled={readOnly}
        />
        <Toggle
          checked={settings.showLast4}
          onChange={(v) => {
            if (!readOnly) void call("updateSettings", { patch: { showLast4: v } });
          }}
          label={<span className="flex items-center" style={{ gap: "var(--space-2)" }}><Ix icon={Eye} size="sm" /> Show last 4 characters</span>}
          note="In masked previews, for values of 12+ characters"
          disabled={readOnly}
        />
        <Toggle
          checked={settings.startWithWindows}
          onChange={(v) => {
            if (!readOnly) void call("updateSettings", { patch: { startWithWindows: v } });
          }}
          label={<span className="flex items-center" style={{ gap: "var(--space-2)" }}><Ix icon={MoonStar} size="sm" /> Start with Windows</span>}
          note="(Windows desktop edition)"
          disabled={readOnly}
        />
      </div>

      {/* ---------------- Data ---------------- */}
      <div className="flex flex-col" style={{ gap: "var(--space-2)" }}>
        <SectionHeader icon={HardDrive} title="Data" />
        <div className="flex flex-wrap items-center" style={{ gap: "var(--space-2)" }}>
          <Btn variant="primary" icon={Download} label="Export everything" onClick={() => void downloadExport("backup")} title="Save a full backup" />
          <Btn variant="glass" icon={Upload} label="Import backup" onClick={() => backupInputRef.current?.click()} disabled={readOnly} title="Import a clavis-backup .json" />
          <Btn variant="glass" icon={FileText} label="Import Markdown / TXT" onClick={() => filesInputRef.current?.click()} disabled={readOnly} title="Import .md or .txt files" />
          <Btn variant="glass" icon={FolderInput} label="Import folder" onClick={() => void onImportFolderPicked()} disabled={readOnly} title="Import every .md and .txt file in a folder" />
          <Btn variant="glass" icon={Files} label="Export all as Markdown" onClick={() => void onExportAllMarkdown()} title="Save one .md file per item and group into a folder you pick" />
          <input ref={backupInputRef} type="file" accept=".json,application/json" hidden tabIndex={-1} aria-hidden onChange={(e) => void onBackupFileChosen(e)} />
          <input ref={filesInputRef} type="file" accept=".md,.txt,.markdown,text/plain,text/markdown" multiple hidden tabIndex={-1} aria-hidden onChange={(e) => void onFilesChosen(e)} />
        </div>
        <p className="t-warning flex items-center" style={{ gap: "var(--space-2)", margin: 0, fontSize: "var(--text-xs)" }}>
          <Ix icon={AlertTriangle} size="sm" />
          Exported files contain your real secrets in plain text. Keep them out of project folders you commit to Git.
        </p>

        <div className="flex flex-col" style={{ gap: "var(--space-1)", marginTop: "var(--space-2)" }}>
          <FieldLabel>Data folder</FieldLabel>
          <div className="flex flex-wrap items-center" style={{ gap: "var(--space-2)" }}>
            <p className="t-mono t-muted flex min-w-0 flex-1 items-center" style={{ gap: "var(--space-2)", margin: 0, fontSize: "var(--text-xs)", wordBreak: "break-all" }}>
              <Ix icon={HardDrive} size="sm" />
              {state.dataDir}
            </p>
            <Btn variant="glass" icon={FolderOpen} label="Open data folder" onClick={() => void platform.openDataFolder()} title="Open the folder in Windows Explorer" />
          </div>
        </div>

        <div className="flex flex-col" style={{ gap: "var(--space-1)", marginTop: "var(--space-2)" }}>
          <FieldLabel>Backups ({state.backups.length})</FieldLabel>
          {state.backups.length === 0 ? (
            <span className="t-muted" style={{ fontSize: "var(--text-sm)" }}>
              No backups yet — one is made automatically each day you change something.
            </span>
          ) : (
            <div className="clavis-scroll flex flex-col" style={{ gap: "var(--space-1)", maxHeight: "calc(var(--space-6) * 9)", overflowY: "auto", paddingRight: "var(--space-1)" }}>
              {state.backups.map((b) => (
                <div key={b.name} className="glass-row flex items-center" style={{ gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)" }}>
                  <span className="flex min-w-0 flex-1 flex-col" style={{ gap: "calc(var(--space-1) / 2)" }}>
                    <span className="t-mono truncate" style={{ fontSize: "var(--text-xs)" }}>
                      {b.name}
                    </span>
                    <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>
                      {formatDateTime(b.takenAt)} · {formatBytes(b.sizeBytes)}
                    </span>
                  </span>
                  <Btn
                    variant="glass"
                    icon={RotateCcw}
                    label="Restore"
                    onClick={() => void restoreBackup(b.name)}
                    disabled={readOnly}
                    title={`Restore ${b.name}`}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---------------- About ---------------- */}
      <div className="flex flex-col" style={{ gap: "var(--space-2)" }}>
        <SectionHeader icon={Info} title="About" />
        <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-sm)" }}>
          Clavis — your credentials, prompts and notes, one shortcut away.
        </p>
        <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-xs)" }}>
          Version {state.appVersion} · data folder {state.dataDir}
        </p>
        <UpdateCard currentVersion={state.appVersion} />
      </div>

      {/* ---------------- Import backup dialog ---------------- */}
      <Modal
        open={backupImport !== null}
        onClose={() => setBackupImport(null)}
        title="Import backup"
        footer={
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
        }
      >
        {backupImport ? (
          <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
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
    </section>
  );
}


/* ------------------------------------------------------------------ */
/* Update card — GitHub self-update (user-requested; DECISIONS.md §34).*/
/* ------------------------------------------------------------------ */

interface UpdateStatus {
  ok: boolean;
  error?: string;
  current: string;
  latest: string;
  available: boolean;
  notes: string;
  url: string;
  mode: string;
  installable: boolean;
  checkedAt: string;
}

/** Release notes are markdown; the card shows a plain-text preview. */
function plainNotes(md: string, max = 460): string {
  const t = md
    .replace(/\r/g, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[#*_>`|]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

function UpdateCard({ currentVersion }: { currentVersion: string }) {
  const [info, setInfo] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; pct: number } | null>(null);

  /* Go → JS progress/notice events. */
  useEffect(() => {
    const offs = [
      platform.onUpdateProgress((p) => {
        if (p.stage === "failed") {
          setInstalling(false);
          setProgress(null);
          toast.error("The update did not finish. Nothing was changed.");
        } else {
          setProgress({ stage: p.stage, pct: p.pct });
        }
      }),
      platform.onUpdateAvailable((a) => {
        toast(`Clavis ${a.latest} is available`, {
          duration: 10000,
          action: {
            label: "Update now",
            onClick: () => {
              void doInstall();
            },
          },
        });
      }),
    ];
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doCheck() {
    if (checking || installing) return;
    setChecking(true);
    setError(null);
    const res = await platform.checkUpdate(true);
    if (res.ok) {
      setInfo(res);
    } else {
      setError(res.error ?? "Could not check for updates.");
    }
    setChecking(false);
  }

  async function doInstall() {
    if (installing) return;
    setInstalling(true);
    setProgress({ stage: "starting", pct: 0 });
    const res = await platform.installUpdate();
    if (!res.ok) {
      setInstalling(false);
      setProgress(null);
      toast.error(res.error ?? "The update could not be installed.");
    }
    /* On success the app restarts into the new version; no else branch. */
  }

  const checked = info !== null;
  const busy = checking || installing;

  let status: React.ReactNode;
  if (checking) status = "Checking GitHub for a newer release…";
  else if (installing)
    status =
      progress?.stage === "downloading"
        ? `Downloading — ${Math.round(progress.pct)}%`
        : progress?.stage === "installing"
          ? "Installing — Clavis will restart…"
          : "Preparing the update…";
  else if (info?.available)
    status = (
      <span className="t-accent flex items-center" style={{ gap: "var(--space-2)" }}>
        <Ix icon={Download} size="sm" />
        Clavis {info.latest} is available
      </span>
    );
  else if (checked)
    status = (
      <span className="flex items-center" style={{ gap: "var(--space-2)" }}>
        <Ix icon={Check} size="sm" style={{ color: "var(--color-success-text, var(--color-accent-text))" }} />
        You're up to date — {info?.latest ?? currentVersion}
      </span>
    );
  else status = `Version ${currentVersion}`;

  return (
    <div className="flex flex-col" style={{ gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
      <div className="flex flex-wrap items-center justify-between" style={{ gap: "var(--space-2)", minHeight: "var(--space-5)" }}>
        <span style={{ fontSize: "var(--text-sm)" }}>{status}</span>
        <span className="flex items-center" style={{ gap: "var(--space-2)" }}>
          {info?.available && info.installable && !installing ? (
            <Btn
              variant="primary"
              icon={Download}
              label={`Update to ${info.latest}`}
              onClick={() => void doInstall()}
              ariaLabel="Install the update now"
              title="Download and install — your data is never touched"
            />
          ) : null}
          {info?.available && !info.installable ? (
            <Btn
              variant="primary"
              icon={Download}
              label="Get the installer"
              onClick={() => void platform.openReleasePage(info.url)}
              title="Open the release page in your browser"
            />
          ) : null}
          <Btn
            variant="glass"
            icon={RefreshCw}
            label={checking ? "Checking…" : "Check for updates"}
            onClick={() => void doCheck()}
            disabled={busy}
            ariaLabel="Check for updates"
            title="Compare your version with the latest GitHub release"
          />
        </span>
      </div>

      {installing && progress ? (
        <div
          role="progressbar"
          aria-label="Update progress"
          className="glass-input"
          style={{ height: "var(--space-2)", overflow: "hidden", position: "relative" }}
        >
          <div
            style={{
              width: `${Math.max(2, Math.min(100, progress.pct))}%`,
              height: "100%",
              background: "var(--color-primary)",
              transition: "width 200ms ease",
            }}
          />
        </div>
      ) : null}

      {error ? (
        <p className="t-danger flex items-center" style={{ gap: "var(--space-2)", margin: 0, fontSize: "var(--text-xs)" }}>
          <Ix icon={AlertTriangle} size="sm" />
          {error}
        </p>
      ) : null}

      {info?.available ? (
        <div className="glass-row flex flex-col" style={{ gap: "var(--space-2)", padding: "var(--space-3)", marginTop: "var(--space-1)" }}>
          {info.notes ? (
            <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-xs)", lineHeight: 1.5 }} dir="auto">
              {plainNotes(info.notes)}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center" style={{ gap: "var(--space-2)" }}>
            {!info.installable ? (
              <Btn
                variant="glass"
                icon={Download}
                label="Download installer"
                onClick={() => void platform.openReleasePage(info.url)}
                title="Open the release page in your browser"
              />
            ) : null}
            <Btn
              variant="ghost"
              icon={ExternalLink}
              label="Release page"
              onClick={() => void platform.openReleasePage(info.url)}
              title="Open the release page on GitHub"
            />
          </div>
          <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-xs)" }}>
            {info.mode === "installed"
              ? "Updating runs the new installer silently and relaunches Clavis."
              : "Updating swaps the portable exe in place and relaunches Clavis."}{" "}
            Your items, groups, categories and settings in %APPDATA%\Clavis stay exactly as they are.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ChoicePair({ value, onChange }: { value: FileChoice; onChange: (c: FileChoice) => void }) {
  const style = (active: boolean): React.CSSProperties => ({
    background: active ? "var(--color-primary)" : "var(--glass-bg)",
    color: active ? "var(--text-on-primary)" : "var(--text)",
    borderColor: active ? "transparent" : "var(--glass-border)",
  });
  return (
    <span className="flex items-center" style={{ gap: "var(--space-1)", flexShrink: 0 }} role="group" aria-label="Conflict resolution">
      <button
        type="button"
        className="clavis-btn"
        style={style(value === "reuse")}
        onClick={() => onChange("reuse")}
        aria-pressed={value === "reuse"}
      >
        Reuse existing
      </button>
      <button
        type="button"
        className="clavis-btn"
        style={style(value === "keepBoth")}
        onClick={() => onChange("keepBoth")}
        aria-pressed={value === "keepBoth"}
      >
        Keep both
      </button>
    </span>
  );
}
