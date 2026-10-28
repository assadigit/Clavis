/**
 * CLAVIS — manager sidebar (SPEC §5.3): All, Pinned, Categories (+ / rename /
 * delete / subcategories), Tags, Trash, Settings at the bottom.
 *
 * v1.4.0 (DECISIONS.md §41): categories render as a collapsible tree, like
 * Obsidian's folders — a category created "inside" another nests under it.
 * Rows stay plain buttons with aria-current (v1.3.1 a11y hardening); the
 * chevron is a separate disclosure button with aria-expanded, so no
 * interactive element ever nests inside another.
 */
"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Hash,
  History,
  Inbox,
  Key,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Settings,
  Trash2,
} from "lucide-react";
import type { ListFilter } from "./app-types";
import {
  allTags,
  categoryTree,
  deletedEntries,
  liveGroups,
  liveItems,
  subtreeCounts,
  tagCounts,
  type CatNode,
} from "./derive";
import { Ix } from "./icons";
import { Btn, Menu, MenuItem, Modal, TextInput } from "./ui-bits";
import type { CallFn } from "@/lib/clavis/client";
import type { ClavisState } from "@/lib/clavis/types";

export interface SidebarProps {
  state: ClavisState;
  call: CallFn;
  readOnly: boolean;
  filter: ListFilter;
  setFilter: (f: ListFilter) => void;
}

interface NavRowProps {
  icon: typeof Inbox;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}

function NavRow({ icon, label, count, active, onClick }: NavRowProps) {
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      data-selected={active ? "true" : "false"}
      onClick={onClick}
      className="glass-row clavis-focusable flex w-full items-center"
      style={{ gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", cursor: "pointer", textAlign: "left" }}
    >
      <Ix icon={icon} size="sm" style={{ color: active ? "var(--color-accent-text)" : "var(--text-muted)" }} />
      <span className="flex-1 truncate" style={{ fontSize: "var(--text-sm)", fontWeight: active ? "var(--weight-medium)" : "var(--weight-regular)" }}>
        {label}
      </span>
      {count !== undefined ? (
        <span className="t-muted" style={{ fontSize: "var(--text-xs)", flexShrink: 0 }}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

function SectionTitle({ children, action }: { children: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between" style={{ padding: "0 var(--space-3)", minHeight: "var(--text-xl)" }}>
      <span className="t-muted" style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-medium)", letterSpacing: "var(--tracking-label)", textTransform: "uppercase" }}>
        {children}
      </span>
      {action}
    </div>
  );
}

/** Width reserved for the disclosure chevron so every tree row aligns. */
const CHEVRON_SLOT = "calc(var(--text-md) + 2 * var(--space-1))";

type CatModal =
  | { mode: "add"; parentId: string | null }
  | { mode: "rename"; id: string; name: string };

export function Sidebar({ state, call, readOnly, filter, setFilter }: SidebarProps) {
  const [catModal, setCatModal] = useState<CatModal | null>(null);
  const [catName, setCatName] = useState("");
  const [busy, setBusy] = useState(false);
  /* Collapsed category ids — the tree starts fully expanded. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const data = state.data;
  const liveCount = liveItems(data).length + liveGroups(data).length;
  const recentCount =
    liveItems(data).filter((i) => i.lastUsedAt !== null).length +
    liveGroups(data).filter((g) => g.lastUsedAt !== null).length;
  const pinnedCount =
    liveItems(data).filter((i) => i.pinned).length + liveGroups(data).filter((g) => g.pinned).length;
  const trashCount = deletedEntries(data).length;
  const tree = categoryTree(data);
  const sCounts = subtreeCounts(data);
  const catNameOf = (id: string | null): string =>
    id ? (data.categories.find((c) => c.id === id)?.name ?? "") : "";
  const tags = allTags(data);
  const tCounts = tagCounts(data);

  const pick = useCallback(
    (f: ListFilter) => {
      setFilter(f);
    },
    [setFilter]
  );

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  async function submitCategory() {
    const name = catName.trim();
    if (name === "" || busy) return;
    setBusy(true);
    if (catModal && catModal.mode === "add") {
      const res = await call("createCategory", { name, parentId: catModal.parentId });
      if (res.ok && res.id) {
        pick({ view: "category", categoryId: res.id });
        toast.success(
          catModal.parentId
            ? `Subcategory “${name}” added inside “${catNameOf(catModal.parentId)}”.`
            : `Category “${name}” added.`
        );
        setCatModal(null);
        setCatName("");
      }
    } else if (catModal && catModal.mode === "rename") {
      const res = await call("renameCategory", { id: catModal.id, name });
      if (res.ok) {
        toast.success(`Category renamed to “${name}”.`);
        setCatModal(null);
        setCatName("");
      }
    }
    setBusy(false);
  }

  const renderCatNode = (node: CatNode): React.ReactNode => {
    const c = node.cat;
    const active = filter.view === "category" && filter.categoryId === c.id;
    const isCollapsed = collapsed.has(c.id);
    const hasChildren = node.children.length > 0;
    return (
      <div key={c.id}>
        <div
          className="flex items-center"
          style={{
            gap: "var(--space-1)",
            /* Visual nesting: one indent step per level under the top. */
            paddingLeft: `calc(var(--space-2) * ${node.depth})`,
          }}
        >
          {hasChildren ? (
            <button
              type="button"
              className="clavis-btn clavis-btn-ghost clavis-focusable"
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? `Expand ${c.name}` : `Collapse ${c.name}`}
              title={isCollapsed ? `Expand ${c.name}` : `Collapse ${c.name}`}
              onClick={() => toggleCollapse(c.id)}
              style={{ padding: "var(--space-1)", width: CHEVRON_SLOT, flexShrink: 0, display: "inline-flex", justifyContent: "center" }}
            >
              <Ix icon={isCollapsed ? ChevronRight : ChevronDown} size="sm" style={{ color: "var(--text-muted)" }} />
            </button>
          ) : (
            <span aria-hidden style={{ width: CHEVRON_SLOT, flexShrink: 0 }} />
          )}
          <div className="min-w-0 flex-1">
            <NavRow
              icon={Folder}
              label={c.name}
              count={sCounts.get(c.id) ?? 0}
              active={active}
              onClick={() => pick({ view: "category", categoryId: c.id })}
            />
          </div>
          {!readOnly ? (
            <Menu
              triggerIcon={MoreHorizontal}
              triggerTitle={`Category options for ${c.name}`}
              triggerStyle={{ padding: "var(--space-1)", flexShrink: 0 }}
              triggerVariant="ghost"
            >
              <MenuItem
                icon={FolderPlus}
                label="New subcategory"
                onClick={() => {
                  setCatName("");
                  setCatModal({ mode: "add", parentId: c.id });
                }}
              />
              <MenuItem
                icon={Pencil}
                label="Rename"
                onClick={() => {
                  setCatName(c.name);
                  setCatModal({ mode: "rename", id: c.id, name: c.name });
                }}
              />
              <MenuItem
                icon={Trash2}
                label="Delete"
                danger
                hint={hasChildren ? "Subcategories move up one level; entries stay, uncategorized." : undefined}
                onClick={async () => {
                  const res = await call("deleteCategory", { id: c.id });
                  if (res.ok) {
                    toast(
                      hasChildren
                        ? `Deleted category “${c.name}” — its subcategories moved up one level; its entries are now uncategorized.`
                        : `Deleted category “${c.name}” — its entries are now uncategorized.`
                    );
                    if (filter.view === "category" && filter.categoryId === c.id) setFilter({ view: "all" });
                  }
                }}
              />
            </Menu>
          ) : null}
        </div>
        {!isCollapsed ? node.children.map(renderCatNode) : null}
      </div>
    );
  };

  return (
    <aside
      aria-label="Clavis navigation"
      className="clavis-sidebar-col clavis-col clavis-scroll flex flex-col"
      style={{ width: "calc(var(--space-6) * 7)", flexShrink: 0, padding: "var(--space-3)", gap: "var(--space-1)", overflowY: "auto", borderRight: "1px solid var(--glass-border)" }}
    >
      <NavRow icon={Inbox} label="All" count={liveCount} active={filter.view === "all"} onClick={() => pick({ view: "all" })} />
      <NavRow icon={History} label="Recent" count={recentCount} active={filter.view === "recent"} onClick={() => pick({ view: "recent" })} />
      <NavRow icon={Pin} label="Pinned" count={pinnedCount} active={filter.view === "pinned"} onClick={() => pick({ view: "pinned" })} />

      <div style={{ height: "var(--space-2)" }} />
      <SectionTitle
        action={
          readOnly ? null : (
            <button
              type="button"
              className="clavis-btn clavis-btn-ghost"
              onClick={() => {
                setCatName("");
                setCatModal({ mode: "add", parentId: null });
              }}
              aria-label="Add category"
              title="Add category"
              style={{ padding: "var(--space-1)" }}
            >
              <Ix icon={Plus} size="sm" />
            </button>
          )
        }
      >
        Categories
      </SectionTitle>
      {tree.map(renderCatNode)}

      {tags.length > 0 ? (
        <>
          <div style={{ height: "var(--space-2)" }} />
          <SectionTitle>Tags</SectionTitle>
          {tags.map((t) => {
            const active = filter.view === "tag" && filter.tag === t;
            return (
              <NavRow
                key={t}
                icon={Hash}
                label={t}
                count={tCounts.get(t.toLowerCase()) ?? 0}
                active={active}
                onClick={() => pick(active ? { view: "all" } : { view: "tag", tag: t })}
              />
            );
          })}
        </>
      ) : null}

      <div style={{ marginTop: "auto", paddingTop: "var(--space-3)", borderTop: "1px solid var(--glass-border)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        <NavRow
          icon={Trash2}
          label="Trash"
          count={trashCount}
          active={filter.view === "trash"}
          onClick={() => pick({ view: "trash" })}
        />
        <NavRow
          icon={Settings}
          label="Settings"
          active={filter.view === "settings"}
          onClick={() => pick({ view: "settings" })}
        />
        <div className="flex items-center t-muted" style={{ gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", fontSize: "var(--text-xs)" }}>
          <Ix icon={Key} size="sm" style={{ color: "var(--color-accent-text)" }} />
          <span>
            {liveItems(data).length} items · {liveGroups(data).length} groups
          </span>
        </div>
      </div>

      <Modal
        open={catModal !== null}
        onClose={() => setCatModal(null)}
        title={
          catModal?.mode === "rename"
            ? "Rename category"
            : catModal?.mode === "add" && catModal.parentId
              ? "New subcategory"
              : "New category"
        }
        width="min(440px, calc(100vw - var(--space-6)))"
        footer={
          <>
            <Btn variant="ghost" label="Cancel" onClick={() => setCatModal(null)} disabled={busy} />
            <Btn
              variant="primary"
              label={catModal?.mode === "rename" ? "Rename" : "Add"}
              onClick={() => void submitCategory()}
              disabled={busy || catName.trim() === ""}
            />
          </>
        }
      >
        {catModal?.mode === "add" && catModal.parentId ? (
          <p className="t-muted" style={{ margin: "0 0 var(--space-2)", fontSize: "var(--text-sm)" }}>
            Inside “{catNameOf(catModal.parentId)}”
          </p>
        ) : null}
        <TextInput
          value={catName}
          onChange={(e) => setCatName(e.target.value)}
          placeholder={catModal?.mode === "add" && catModal.parentId ? "Subcategory name" : "Category name"}
          dir="auto"
          aria-label="Category name"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && catName.trim() !== "") {
              e.preventDefault();
              void submitCategory();
            }
          }}
        />
      </Modal>

    </aside>
  );
}
