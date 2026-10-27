/**
 * CLAVIS — manager window (SPEC §3.4, §5.3): custom title bar + the
 * three-column body (sidebar / list / detail), or the settings panel.
 * "Windowed" mode mimics the desktop's floating 1000×680 window.
 */
"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Key, Maximize2, Minimize2, Minus, Plus, Lock, X } from "lucide-react";
import { platform } from "@/desktop/platform";
import type { Creating, ListFilter, Selection } from "./app-types";
import { EntryList } from "./entry-list";
import { GroupEditor } from "./group-editor";
import { Ix, ShortcutKeycaps } from "./icons";
import { ItemEditor } from "./item-editor";
import { ManageItemsModal } from "./manage-items-modal";
import { SettingsView } from "./settings-view";
import { Sidebar } from "./sidebar";
import { TrashView } from "./trash-view";
import { Btn, useMaximized } from "./ui-bits";
import { liveGroups, liveItems } from "./derive";
import type { CallFn } from "@/lib/clavis/client";
import { messages } from "@/lib/clavis/messages";
import type { ClavisState } from "@/lib/clavis/types";

export interface ManagerProps {
  state: ClavisState;
  call: CallFn;
  readOnly: boolean;
  filter: ListFilter;
  setFilter: React.Dispatch<React.SetStateAction<ListFilter>>;
  query: string;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  selection: Selection | null;
  setSelection: React.Dispatch<React.SetStateAction<Selection | null>>;
  creating: Creating | null;
  setCreating: React.Dispatch<React.SetStateAction<Creating | null>>;
  onHide: () => void;
  deleteEntry: (kind: "item" | "group", id: string) => void;
}

export function Manager(props: ManagerProps) {
  const { state, call, readOnly, filter, setFilter, query, setQuery, selection, setSelection, creating, setCreating, onHide, deleteEntry } = props;
  /* Real window: the maximize state is mirrored for the button glyph.
     F-027 (UI-audit round 1 Phase 10): the shared hook replaces this
     component's own resize listener. */
  const maximized = useMaximized();
  /* The Manage items modal lives HERE (not inside the group editor) so it
     survives the editor remounts that every membership change triggers
     (the editor's key includes the group's updatedAt). */
  const [managingGroupId, setManagingGroupId] = useState<string | null>(null);

  const data = state.data;
  const liveCount = liveItems(data).length + liveGroups(data).length;
  const selItem = selection?.kind === "item" ? data.items.find((i) => i.id === selection.id && !i.deletedAt) : undefined;
  const selGroup = selection?.kind === "group" ? data.groups.find((g) => g.id === selection.id && !g.deletedAt) : undefined;
  const managingGroup = managingGroupId ? data.groups.find((g) => g.id === managingGroupId && !g.deletedAt) : undefined;
  const activeSelection: Selection | null =
    selItem || selGroup ? (selection as Selection) : null;

  function startCreating(kind: "item" | "group") {
    setSelection(null);
    setCreating({ kind });
  }

  /* Instant copy from a list row: the backend writes the clipboard (value
     for items, KEY=value block for groups) and applies the privacy formats
     for secret payloads. Returns true only when the write succeeded. */
  const copyEntry = useCallback(
    async (kind: "item" | "group", id: string): Promise<boolean> => {
      const res = await call("copy", { kind, id });
      if (res.ok && res.copied) {
        const name =
          kind === "item"
            ? data.items.find((i) => i.id === id)?.name
            : data.groups.find((g) => g.id === id)?.name;
        /* F-012 (UI-audit round 1 Phase 7): one voice — messages.ts. Item
           copies are one value (lineCount means nothing); groups report
           their block size. */
        toast.success(
          kind === "group" && res.lineCount != null && name
            ? messages.copiedEntryLines(name, res.lineCount)
            : messages.copiedEntry(name ?? "entry")
        );
        return true;
      }
      if (res.ok) {
        toast.error(messages.copyFailed);
      }
      return false;
    },
    [call, data.items, data.groups]
  );

  /* Pin/unpin straight from the row (SPEC §5.1: pinned entries show first). */
  const togglePin = useCallback(
    (kind: "item" | "group", id: string, pinned: boolean) => {
      const action = kind === "item" ? "updateItem" : "updateGroup";
      void call(action, { id, patch: { pinned } });
    },
    [call]
  );

  /* The mobile drawer was removed in UI-audit round 1 Phase 9 (F-021): the
     manager window cannot be resized below 800 DIP, so a <768px layout was
     unreachable in practice (only a high-DPI scaling edge case could show
     it) and had never been tested. */

  function detailContent() {
    if (filter.view === "trash") {
      return <TrashView state={state} call={call} readOnly={readOnly} />;
    }
    if (creating) {
      if (creating.kind === "item") {
        return (
          <ItemEditor
            key={`create-item-${creating.forGroupId ?? "root"}-${creating.prefillName ?? ""}`}
            mode="create"
            state={state}
            call={call}
            readOnly={readOnly}
            prefillName={creating.prefillName}
            forGroupId={creating.forGroupId}
            onDone={(sel) => {
              setSelection(sel);
              setCreating(null);
            }}
            onSelectEntry={(sel) => setSelection(sel)}
            deleteEntry={deleteEntry}
            onCancelCreate={() => setCreating(null)}
          />
        );
      }
      return (
        <GroupEditor
          key="create-group"
          mode="create"
          state={state}
          call={call}
          readOnly={readOnly}
          onDone={(sel) => {
            setSelection(sel);
            setCreating(null);
          }}
          onSelectEntry={(sel) => setSelection(sel)}
          deleteEntry={deleteEntry}
          onCancelCreate={() => setCreating(null)}
        />
      );
    }
    if (selItem && selection) {
      return (
        <ItemEditor
          key={`item-${selItem.id}-${selItem.updatedAt}`}
          mode="edit"
          state={state}
          call={call}
          readOnly={readOnly}
          item={selItem}
          groupContextId={selection.groupContextId}
          onDone={(sel) => setSelection(sel)}
          onSelectEntry={(sel) => setSelection(sel)}
          deleteEntry={deleteEntry}
          onCancelCreate={() => setCreating(null)}
        />
      );
    }
    if (selGroup && selection) {
      return (
        <GroupEditor
          key={`group-${selGroup.id}-${selGroup.updatedAt}`}
          mode="edit"
          state={state}
          call={call}
          readOnly={readOnly}
          group={selGroup}
          onDone={(sel) => setSelection(sel)}
          onSelectEntry={(sel) => setSelection(sel)}
          deleteEntry={deleteEntry}
          onManageItems={() => setManagingGroupId(selGroup.id)}
          onCancelCreate={() => setCreating(null)}
        />
      );
    }
    /* Empty store: orient a brand-new user instead of repeating the
       list column's call-to-action (which confused first-time users). */
    if (liveCount === 0) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center" style={{ gap: "var(--space-3)", padding: "var(--space-5)", textAlign: "center" }}>
          <Ix icon={Key} size="lg" style={{ color: "var(--color-accent-text)" }} />
          <p style={{ margin: 0, fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)" }}>Welcome to Clavis</p>
          <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-sm)", maxWidth: "calc(var(--space-6) * 15)", lineHeight: "var(--leading-relaxed)" }}>
            Your keys, prompts and notes will live here. Add your first item in the list, then press{" "}
            <ShortcutKeycaps shortcut={data.settings.shortcut} />{" "}
            anytime to summon it.
          </p>
        </div>
      );
    }
    return (
      <div className="flex flex-1 flex-col items-center justify-center" style={{ gap: "var(--space-3)", padding: "var(--space-5)", textAlign: "center" }}>
        <Ix icon={Key} size="lg" style={{ color: "var(--color-accent-text)" }} />
        <p style={{ margin: 0, fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)" }}>Nothing selected</p>
        <p className="t-muted" style={{ margin: 0, fontSize: "var(--text-sm)", maxWidth: "calc(var(--space-6) * 15)" }}>
          Pick an entry from the list to see it here.
        </p>
        {/* F-010 (UI-audit round 1 Phase 6): one row, one center line —
            alignItems centers the two variants so their glyphs sit level. */}
        <div className="flex flex-wrap justify-center" style={{ gap: "var(--space-2)", marginTop: "var(--space-2)", alignItems: "center" }}>
          <Btn variant="primary" icon={Plus} label="New item" onClick={() => startCreating("item")} disabled={readOnly} />
          <Btn variant="glass" icon={Key} label="New group" onClick={() => startCreating("group")} disabled={readOnly} />
        </div>
      </div>
    );
  }

  return (
    <div
      className="clavis-app-shell"
      style={{
        /* The desk frame already insets the window by the shadow pad; sizing
           to 100dvh here made the manager 2×pad taller than the visible frame,
           clipping the bottom of every view (Settings looked cut off). */
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        className="flex flex-col"
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
        }}
      >
        <header
          className="flex select-none items-center justify-between"
          style={{ height: "calc(var(--space-5) * 2)", padding: "0 var(--space-2)", borderBottom: "1px solid var(--glass-border)", background: "var(--glass-bg)", flexShrink: 0 }}
        >
          <div className="flex items-center" style={{ gap: "var(--space-2)" }}>
            <Ix icon={Key} size="md" style={{ color: "var(--color-accent-text)" }} />
            <span style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)" }}>Clavis</span>
          </div>
          <div className="flex items-center">
            <button
              type="button"
              className="clavis-titlebar-btn"
              onClick={() => platform.minimiseManager()}
              aria-label="Minimize Clavis"
              title="Minimize"
            >
              <Ix icon={Minus} size="sm" />
            </button>
            <button
              type="button"
              className="clavis-titlebar-btn"
              onClick={() => platform.toggleMaximiseManager()}
              aria-label={maximized ? "Restore window size" : "Maximize"}
              title={maximized ? "Restore" : "Maximize"}
            >
              <Ix icon={maximized ? Minimize2 : Maximize2} size="sm" />
            </button>
            <button
              type="button"
              className="clavis-titlebar-btn"
              data-close="true"
              onClick={onHide}
              aria-label="Close Clavis (it keeps running in the background)"
              title="Close"
            >
              <Ix icon={X} size="sm" />
            </button>
          </div>
        </header>

        {readOnly ? (
          <div
            className="flex flex-wrap items-center"
            role="alert"
            style={{ gap: "var(--space-2)", padding: "var(--space-2) var(--space-4)", borderBottom: "1px solid var(--glass-border)", background: "var(--glass-bg)", flexShrink: 0 }}
          >
            <Ix icon={Lock} size="sm" style={{ color: "var(--color-warning-text)" }} />
            <span className="t-warning" style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-medium)" }}>
              Read-only
            </span>
            <span style={{ fontSize: "var(--text-sm)" }}>{state.readOnlyReason}</span>
            <span className="t-muted" style={{ fontSize: "var(--text-xs)" }}>
              Editing is disabled.
            </span>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1" style={{ gap: 0, padding: 0 }}>
          <Sidebar
            state={state}
            call={call}
            readOnly={readOnly}
            filter={filter}
            setFilter={setFilter}
          />
          {filter.view === "settings" ? (
            <SettingsView state={state} call={call} readOnly={readOnly} />
          ) : (
            <>
              <EntryList
                state={state}
                query={query}
                setQuery={setQuery}
                filter={filter}
                selection={activeSelection}
                onSelect={(sel) => {
                  setSelection(sel);
                  setCreating(null);
                }}
                onCreate={startCreating}
                onOpenSettings={() => setFilter({ view: "settings" })}
                readOnly={readOnly}
                copyEntry={copyEntry}
                togglePin={togglePin}
              />
              <aside
                aria-label="Details"
                className="clavis-detail-col clavis-col flex flex-col"
                style={{ flex: 1, minWidth: 0, overflow: "hidden", background: "var(--glass-bg)" }}
              >
                {detailContent()}
              </aside>
            </>
          )}
        </div>
      </div>

      {managingGroup ? (
        <ManageItemsModal
          key={`manage-${managingGroup.id}`}
          group={managingGroup}
          state={state}
          call={call}
          readOnly={readOnly}
          onClose={() => setManagingGroupId(null)}
          onCreateItemHere={(gid) => {
            setManagingGroupId(null);
            setCreating({ kind: "item", forGroupId: gid });
          }}
        />
      ) : null}
    </div>
  );
}
