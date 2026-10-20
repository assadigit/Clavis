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
  quit(): void {
    void Call.ByName("main.Clavis.QuitApp");
  },
  /** Go → JS events. */
  onPopupShown(cb: () => void): () => void {
    return Events.On("clavis:popup-shown", cb);
  },
  onPopupHidden(cb: () => void): () => void {
    return Events.On("clavis:popup-hidden", cb);
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
};
