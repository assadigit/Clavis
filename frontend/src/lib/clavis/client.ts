/**
 * CLAVIS — desktop transport (Wails runtime).
 *
 * Same exported API as the web client so the UI components work unchanged:
 * fetchState, apiCall, downloadExport. All calls go through Call.ByName to
 * the Go service (package main, struct Clavis). Item values never cross to
 * the UI: copying is executed by the backend, which also applies the
 * Windows clipboard-privacy formats; nothing here is logged.
 */
import { Call } from "@wailsio/runtime";
import { messages } from "@/lib/clavis/messages";
import type { ClavisState } from "@/lib/clavis/types";

export interface BackupPreview {
  valid: boolean;
  error?: string;
  incoming: { items: number; groups: number; categories: number };
  /** UI-audit round 1 Phase 4: set when the file is a clavis-fragment
   * (a partial export that merges). */
  fragment?: { type: "item" | "group"; id?: string; name: string };
}

export interface FilesPreview {
  conflicts: import("@/lib/clavis/types").ImportConflict[];
  parsedCount: number;
}

/** Envelope returned by every API call (mirrors the web edition). */
export interface ApiResult {
  ok: boolean;
  status: number;
  error?: string;
  state?: ClavisState;
  id?: string;
  undoToken?: string;
  /** "copy": did the value reach the clipboard (written by the backend)? */
  copied?: boolean;
  lineCount?: number;
  containsSecret?: boolean;
  /** "getValue" / "getGroupDocument" / "getGroupCopyText": on-demand
   *  payloads for the edit form and the manual-copy fallback. */
  value?: string;
  document?: string;
  text?: string;
  summary?: { added: number; updated: number; skipped: number };
  preview?: BackupPreview | FilesPreview;
}

export type CallFn = (
  action: string,
  payload?: Record<string, unknown>
) => Promise<ApiResult>;

export async function fetchState(): Promise<ClavisState> {
  try {
    const state = (await Call.ByName("main.Clavis.GetState")) as ClavisState & {
      osTransparency?: boolean;
    };
    if (!state || !state.data) throw new Error("no state");
    return state;
  } catch {
    throw new Error("Could not load your Clavis data.");
  }
}

export async function apiCall(
  action: string,
  payload: Record<string, unknown> = {}
): Promise<ApiResult> {
  try {
    const res = (await Call.ByName(
      "main.Clavis.Dispatch",
      action,
      JSON.stringify(payload)
    )) as ApiResult;
    return { ...res, status: res.ok ? 200 : res.status ?? 400 };
  } catch (err) {
    return { ok: false, status: 0, error: String((err as Error)?.message ?? err) };
  }
}

export type ExportWhat =
  | "backup"
  | "item-md"
  | "group-md"
  | "item-txt"
  | "group-txt"
  | "item-json"
  | "group-json";

/** Export through the Windows save dialog. */
export async function downloadExport(what: ExportWhat, id?: string): Promise<void> {
  const { toast } = await import("sonner");
  try {
    const res = (await Call.ByName("main.Clavis.ExportSave", what, id ?? "")) as {
      ok: boolean;
      canceled?: boolean;
      savedPath?: string;
      error?: string;
    };
    if (res?.ok && res.savedPath) {
      toast.success(messages.exportSaved(res.savedPath));
    } else if (res && !res.ok && !res.canceled && res.error) {
      toast.error(res.error);
    }
  } catch {
    toast.error(messages.exportFailed);
  }
}
