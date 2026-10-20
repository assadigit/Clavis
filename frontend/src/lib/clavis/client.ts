/**
 * CLAVIS — desktop transport (Wails runtime).
 *
 * Same exported API as the web client so the UI components work unchanged:
 * fetchState, apiCall, copyToClipboard, downloadExport. All calls go
 * through Call.ByName to the Go service (package main, struct Clavis).
 * Item values travel only in copy/export payloads; they are never logged.
 */
import { Call } from "@wailsio/runtime";
import type { ClavisState } from "@/lib/clavis/types";

export interface BackupPreview {
  valid: boolean;
  error?: string;
  incoming: { items: number; groups: number; categories: number };
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
  text?: string;
  lineCount?: number;
  containsSecret?: boolean;
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

/**
 * Clipboard write through Go: secret payloads also set the Windows privacy
 * formats (kept out of Win+V history and cloud sync). Never logs the text.
 */
export async function copyToClipboard(text: string, containsSecret = false): Promise<boolean> {
  try {
    return (await Call.ByName("main.Clavis.WriteClipboard", text, containsSecret)) as boolean;
  } catch {
    return false;
  }
}

export type ExportWhat =
  | "backup"
  | "item-md"
  | "group-md"
  | "item-txt"
  | "group-txt";

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
      toast.success(`Saved: ${res.savedPath}`);
    } else if (res && !res.ok && !res.canceled && res.error) {
      toast.error(res.error);
    }
  } catch {
    toast.error("The export was not saved.");
  }
}
