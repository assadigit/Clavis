/**
 * CLAVIS — manager sidebar (SPEC §5.3): All, Pinned, Categories (+ / rename /
 * delete), Tags, Trash, Settings at the bottom.
 */
"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  Folder,
  Hash,
  Inbox,
  Key,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import type { ListFilter } from "./app-types";
import { allTags, categoryCounts, deletedEntries, liveGroups, liveItems, tagCounts } from "./derive";
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
  mobileOpen: boolean;
  onCloseMobile: () => void;
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
      role="treeitem"
      aria-selected={active}
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
      <span className="t-muted" style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-medium)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {children}
      </span>
      {action}
    </div>
  );
}

export function Sidebar({ state, call, readOnly, filter, setFilter, mobileOpen, onCloseMobile }: SidebarProps) {
  const [catModal, setCatModal] = useState<null | { mode: "add" } | { mode: "rename"; id: string; name: string }>(null);
  const [catName, setCatName] = useState("");
  const [busy, setBusy] = useState(false);

  const data = state.data;
  const liveCount = liveItems(data).length + liveGroups(data).length;
  const pinnedCount =
    liveItems(data).filter((i) => i.pinned).length + liveGroups(data).filter((g) => g.pinned).length;
  const trashCount = deletedEntries(data).length;
  const catCounts = categoryCounts(data);
  const tags = allTags(data);
  const tCounts = tagCounts(data);

  const pick = useCallback(
    (f: ListFilter) => {
      setFilter(f);
      onCloseMobile();
    },
    [setFilter, onCloseMobile]
  );

  async function submitCategory() {
    const name = catName.trim();
    if (name === "" || busy) return;
    setBusy(true);
    if (catModal && catModal.mode === "add") {
      const res = await call("createCategory", { name });
      if (res.ok && res.id) {
        pick({ view: "category", categoryId: res.id });
        toast.success(`Category “${name}” added.`);
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

  return (
    <aside
      role="tree"
      aria-label="Clavis navigation"
      className={`clavis-sidebar-col clavis-col clavis-scroll ${mobileOpen ? "flex" : "hidden md:flex"} flex-col`}
      style={{ width: "calc(var(--space-6) * 7)", flexShrink: 0, padding: "var(--space-3)", gap: "var(--space-1)", overflowY: "auto", borderRight: "1px solid var(--glass-border)" }}
    >
      {mobileOpen ? (
        <button
          type="button"
          className="clavis-btn clavis-btn-ghost self-end"
          onClick={onCloseMobile}
          aria-label="Close navigation"
          style={{ padding: "var(--space-1)" }}
        >
          <Ix icon={X} size="sm" />
        </button>
      ) : null}
      <NavRow icon={Inbox} label="All" count={liveCount} active={filter.view === "all"} onClick={() => pick({ view: "all" })} />
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
                setCatModal({ mode: "add" });
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
      {data.categories.map((c) => {
        const active = filter.view === "category" && filter.categoryId === c.id;
        return (
          <div key={c.id} className="flex items-center" style={{ gap: "var(--space-1)" }}>
            <div className="min-w-0 flex-1">
              <NavRow
                icon={Folder}
                label={c.name}
                count={catCounts.get(c.id) ?? 0}
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
                  onClick={async () => {
                    const res = await call("deleteCategory", { id: c.id });
                    if (res.ok) {
                      toast(`Deleted category “${c.name}” — its entries are now uncategorized.`);
                      if (filter.view === "category" && filter.categoryId === c.id) setFilter({ view: "all" });
                    }
                  }}
                />
              </Menu>
            ) : null}
          </div>
        );
      })}

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
        title={catModal?.mode === "rename" ? "Rename category" : "New category"}
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
        <TextInput
          value={catName}
          onChange={(e) => setCatName(e.target.value)}
          placeholder="Category name"
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
