/**
 * CLAVIS — desktop platform bridge: window controls, cross-window events,
 * folder import/export, native dialogs. Thin wrappers over Call.ByName.
 */
import { Call, Events } from "@wailsio/runtime";

export interface ImportedFile {
  name: string;
  content: string;
}

export const platform = {
  hidePopup(): void {
    void Call.ByName("main.Clavis.HidePopup");
  },
  setPopupSize(w: number, h: number): void {
    void Call.ByName("main.Clavis.SetPopupSize", w, h);
  },
  showManager(): void {
    void Call.ByName("main.Clavis.ShowManager");
  },
  hideManager(): void {
    void Call.ByName("main.Clavis.HideManager");
  },
  minimiseManager(): void {
    void Call.ByName("main.Clavis.MinimiseManager");
  },
  toggleMaximiseManager(): void {
    void Call.ByName("main.Clavis.ToggleMaximiseManager");
  },
  openDataFolder(): void {
    void Call.ByName("main.Clavis.OpenDataFolder");
  },
  async exportAllMarkdown(): Promise<{ ok: boolean; count?: number; canceled?: boolean; error?: string }> {
    return (await Call.ByName("main.Clavis.ExportAllMarkdown")) as {
      ok: boolean;
      count?: number;
      canceled?: boolean;
      error?: string;
    };
  },
  async pickImportFolder(): Promise<{ ok: boolean; files?: ImportedFile[]; canceled?: boolean; error?: string }> {
    return (await Call.ByName("main.Clavis.PickImportFolder")) as {
      ok: boolean;
      files?: ImportedFile[];
      canceled?: boolean;
      error?: string;
    };
  },
  managerNewItem(prefillName?: string): void {
    void Call.ByName("main.Clavis.ManagerNewItem", prefillName ?? "");
  },
  managerOpenEntry(kind: "item" | "group", id: string): void {
    void Call.ByName("main.Clavis.ManagerOpenEntry", kind, id);
  },
  /* ---- self-update (DECISIONS.md §34) ---- */
  async checkUpdate(force: boolean): Promise<{
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
  }> {
    return (await Call.ByName("main.Clavis.CheckUpdate", force)) as {
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
    };
  },
  async installUpdate(): Promise<{ ok: boolean; error?: string; restarting?: boolean; mode?: string }> {
    return (await Call.ByName("main.Clavis.InstallUpdate")) as {
      ok: boolean;
      error?: string;
      restarting?: boolean;
      mode?: string;
    };
  },
  async openReleasePage(url: string): Promise<boolean> {
    return ((await Call.ByName("main.Clavis.OpenReleasePage", url)) as boolean) ?? false;
  },
  /** Go → JS events. */
  onPopupShown(cb: () => void): () => void {
    return Events.On("clavis:popup-shown", cb);
  },
  onPopupHidden(cb: () => void): () => void {
    return Events.On("clavis:popup-hidden", cb);
  },
  /* v1.3.2 cross-window sync: any dispatch that changed the vault is
     broadcast to every window (the Manager and the popup keep separate
     snapshots), and the Manager is told when it is shown again. */
  onDataChanged(cb: () => void): () => void {
    return Events.On("clavis:data-changed", cb);
  },
  onManagerShown(cb: () => void): () => void {
    return Events.On("clavis:manager-shown", cb);
  },
  onManagerNewItem(cb: (prefill: string) => void): () => void {
    return Events.On("clavis:manager-new-item", (e: { data: unknown }) => cb(String(e.data ?? "")));
  },
  onManagerOpenEntry(cb: (kind: string, id: string) => void): () => void {
    return Events.On("clavis:manager-open-entry", (e: { data: { kind?: string; id?: string } }) =>
      cb(String(e.data?.kind ?? "item"), String(e.data?.id ?? ""))
    );
  },
  onShortcutConflict(cb: (message: string) => void): () => void {
    return Events.On("clavis:shortcut-conflict", (e: { data: unknown }) => cb(String(e.data ?? "")));
  },
  onUpdateProgress(cb: (p: { stage: string; pct: number; error?: string }) => void): () => void {
    return Events.On("clavis:update-progress", (e: { data: { stage?: string; pct?: number; error?: string } }) =>
      cb({
        stage: String(e.data?.stage ?? ""),
        pct: Number(e.data?.pct ?? 0),
        error: e.data?.error,
      })
    );
  },
  /** Open an http(s) link in the default browser (§40). Only http/https
   *  pass — the Go side validates the scheme again. */
  openUrl(url: string): void {
    void Call.ByName("main.Clavis.OpenURL", url);
  },
  onUpdateAvailable(cb: (a: { current: string; latest: string; url: string; notes: string }) => void): () => void {
    return Events.On("clavis:update-available", (e: { data: { current?: string; latest?: string; url?: string; notes?: string } }) =>
      cb({
        current: String(e.data?.current ?? ""),
        latest: String(e.data?.latest ?? ""),
        url: String(e.data?.url ?? ""),
        notes: String(e.data?.notes ?? ""),
      })
    );
  },
};
