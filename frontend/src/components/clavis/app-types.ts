/**
 * CLAVIS — app-level view state types shared between the components.
 */

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
