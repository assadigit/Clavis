/**
 * CLAVIS — settings view (SPEC §5.9): shortcut capture, toggles, glass
 * intensity + solid mode, data import/export with conflict resolution,
 * backups with Restore, about. The self-update card and the import-choice
 * buttons live in settings/ (split move-only).
 */
"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Download,
  Eye,
  Files,
  FolderOpen,
  HardDrive,
  Info,
  Keyboard,
  MoonStar,
  Palette,
  RotateCcw,
} from "lucide-react";
import type { CallFn } from "@/lib/clavis/client";
import { downloadExport } from "@/lib/clavis/client";
import { platform } from "@/desktop/platform";
import type { ClavisState } from "@/lib/clavis/types";
import { applyTheme } from "./glass";
import {
  activeModifiers,
  displayKey,
  isBrowserReservedShortcut,
  isModifierKey,
} from "./hotkey";
import { Ix } from "./icons";
import { Btn, FieldLabel, SectionHeader, Toggle } from "./ui-bits";
import { formatDateTime } from "./derive";
import { UpdateCard } from "./settings/update-card";
import { ImportFlows } from "./settings/import-flows";

export interface SettingsViewProps {
  state: ClavisState;
  call: CallFn;
  readOnly: boolean;
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

  async function onExportAllMarkdown() {
    const res = await platform.exportAllMarkdown();
    if (res.ok && res.count) {
      toast.success(`Exported ${res.count} Markdown files.`);
    } else if (res.error) {
      toast.error(res.error);
    }
  }

  async function restoreBackup(name: string) {
    const res = await call("restoreBackup", { name });
    if (res.ok) toast.success(`Backup “${name}” restored.`);
  }

  return (
    <section
      aria-label="Settings"
      className="clavis-col clavis-scroll flex flex-col"
      style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "var(--space-5)", gap: "var(--space-5)", borderLeft: "1px solid var(--glass-border)", background: "var(--glass-bg)" }}
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
        <Toggle
          checked={settings.solidMode}
          onChange={(v) => {
            applyTheme(v);
            if (!readOnly) void call("updateSettings", { patch: { solidMode: v } });
          }}
          label={<span className="flex items-center" style={{ gap: "var(--space-2)" }}><Ix icon={MoonStar} size="sm" /> Dark mode</span>}
          note="Bitwarden-style dark theme"
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
          {/* UI-audit round 1 Phase 11 (F-026): the import flows moved
              move-only to settings/import-flows.tsx (buttons, hidden inputs
              and both dialogs — same DOM order, same behavior). */}
          <ImportFlows state={state} call={call} readOnly={readOnly} />
          <Btn variant="glass" icon={Files} label="Export all as Markdown" onClick={() => void onExportAllMarkdown()} title="Save one .md file per item and group into a folder you pick" />
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
                    ariaLabel={`Restore backup from ${b.name}`}
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

    </section>
  );
}
