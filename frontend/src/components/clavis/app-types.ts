/**
 * CLAVIS — app-level view state types shared between the components.
 */
import type { CallFn } from "@/lib/clavis/client";
import type { ClavisState } from "@/lib/clavis/types";

export type ListFilter =
  | { view: "all" }
  | { view: "recent" }
  | { view: "pinned" }
  | { view: "category"; categoryId: string }
  | { view: "tag"; tag: string }
  | { view: "trash" }
  | { view: "settings" };

export interface Selection {
  kind: "item" | "group";
  id: string;
  /** Set when the item editor was reached through this group (SPEC §5.6). */
  groupContextId?: string;
}

export interface Creating {
  kind: "item" | "group";
  /** Prefilled name (popup "Press Enter to create '<query>'"). */
  prefillName?: string;
  /** Item create form opened from a group editor: add to this group on save. */
  forGroupId?: string;
}

export interface EntryLike {
  kind: "item" | "group";
  id: string;
  name: string;
}

export interface AppActions {
  call: CallFn;
  state: ClavisState;
  readOnly: boolean;
  /** Central delete (soft) + undo toast. Modal logic stays with the caller. */
  deleteEntry: (kind: "item" | "group", id: string) => void;
}
