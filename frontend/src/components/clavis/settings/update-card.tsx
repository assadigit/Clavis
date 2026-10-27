/**
 * CLAVIS — settings › about: the self-update card (GitHub self-update,
 * user-requested; DECISIONS.md §34). Moved from settings-view.tsx
 * (move-only).
 */
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, Download, ExternalLink, RefreshCw } from "lucide-react";
import { platform } from "@/desktop/platform";
import { Btn } from "../ui-bits";
import { Ix } from "../icons";

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

export function UpdateCard({ currentVersion }: { currentVersion: string }) {
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
        {/* F-002 (UI-audit round 1): the async status lives in a polite live
            region so screen-reader users hear the check/install result. */}
        <span role="status" style={{ fontSize: "var(--text-sm)" }}>{status}</span>
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
          aria-valuenow={Math.max(0, Math.min(100, Math.round(progress.pct)))}
          aria-valuemin={0}
          aria-valuemax={100}
          className="glass-input"
          style={{ height: "var(--space-2)", overflow: "hidden", position: "relative" }}
        >
          <div
            style={{
              width: `${Math.max(2, Math.min(100, progress.pct))}%`,
              height: "100%",
              background: "var(--color-primary)",
              /* F-024 (UI-audit round 1 Phase 7): the one hardcoded transition
                 goes through the motion tokens — the reduced-motion block
                 zeroes --motion-* and this stops animating accordingly. */
              transition: "width var(--motion-toast) var(--ease)",
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
