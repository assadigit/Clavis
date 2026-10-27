/**
 * CLAVIS — shared types.
 * Mirrors SPEC.md §4.2 file format exactly so the JSON on disk stays
 * compatible with the desktop edition.
 */

export const CURRENT_SCHEMA_VERSION = 1;
// Bumped by the release workflow (release.yml compares the tag with this).
export const APP_VERSION = "1.2.0";

export type EntryKind = "item" | "group";

export interface Category {
  id: string;
  name: string;
  sortOrder: number;
}

export interface Item {
  id: string;
  name: string;
  /** Variable name used when a group is copied as NAME=value. May be "". */
  key: string;
  /** Always "" in the state snapshot — values are redacted at the backend
   *  boundary; the edit form fetches one value via the "getValue" action.
   *  NEVER logged, NEVER searched. */
  value: string;
  /** Masked hint (§5.2): last 4 chars, only when showLast4 is on and the
   *  value is ≥ 12 characters; "" otherwise. */
  valueLast4?: string;
  note: string;
  categoryId: string | null;
  tags: string[];
  isSecret: boolean;
  pinned: boolean;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
  deletedAt: string | null; // soft delete (trash)
}

export interface Group {
  id: string;
  name: string;
  categoryId: string | null;
  tags: string[];
  /** References to items (shared items), in group order. */
  itemIds: string[];
  pinned: boolean;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ManagerBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Settings {
  shortcut: string;
  startWithWindows: boolean;
  solidMode: boolean;
  /** 0–100, scales glass opacity and blur. (Reserved, unused — the slider
   *  feature is gone; the field stays so old data files keep loading. The
   *  Go model mirrors this comment: see internal/store/model.go.) */
  glassIntensity: number;
  showLast4: boolean;
  managerBounds: ManagerBounds | null;
}

export interface VaultData {
  schemaVersion: number;
  appVersion: string;
  encryption: { enabled: boolean };
  settings: Settings;
  categories: Category[];
  items: Item[];
  groups: Group[];
}

export interface BackupInfo {
  name: string;
  /** ISO date string of when the backup was taken (from its filename). */
  takenAt: string;
  sizeBytes: number;
}

/** Full state payload returned by the Go service and after mutations. */
export interface ClavisState {
  data: VaultData;
  backups: BackupInfo[];
  readOnly: boolean;
  readOnlyReason: string | null;
  recoveredNotice: string | null;
  dataDir: string;
  appVersion: string;
  /** Desktop only: whether Windows "Transparency effects" is on (§5.9). */
  osTransparency: boolean;
}

export interface ImportConflict {
  fileIndex: number;
  fileName: string;
  kind: EntryKind;
  name: string;
  /** What already exists with this name/key. */
  existingName: string;
  existingId: string;
  reason: "name" | "key";
}

export interface ImportSummary {
  added: number;
  updated: number;
  skipped: number;
}

/** Light view of an item or a group used by the frontend list & popup. */
export type AnyEntry =
  | ({ kind: "item" } & Item)
  | ({ kind: "group" } & Group);
