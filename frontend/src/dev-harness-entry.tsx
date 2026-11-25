/**
 * CLAVIS — dev harness entry (UNSHIPPED dev tool, v1.12.0 DECISIONS §53).
 * Renders the real Manager in a plain browser with an in-memory fake
 * store, mirroring manager-entry's shell (desk frame, theme, toaster)
 * minus the Wails wiring. Built only through vite.harness.config.ts; the
 * production build never references this file. Fake data only — the
 * FAKE-* convention from the test suites.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { Manager } from "@/components/clavis/manager";
import { applyTheme } from "@/components/clavis/glass";
import { useMaximized } from "@/components/clavis/ui-bits";
import type { CallFn } from "@/lib/clavis/client";
import type { ClavisState, Group, Item } from "@/lib/clavis/types";
import type { Creating, ListFilter, Selection } from "@/components/clavis/app-types";

import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono";
import "@/globals.css";

const T0 = "2026-11-24T10:00:00.000Z";

function fakeItem(partial: Partial<Item> & Pick<Item, "id" | "name">): Item {
  return {
    key: "",
    value: "",
    valueLast4: "",
    note: "",
    categoryId: null,
    tags: [],
    isSecret: false,
    pinned: false,
    useCount: 0,
    lastUsedAt: null,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...partial,
  };
}

interface HarnessVault {
  state: ClavisState;
  /** True values — the state snapshot is redacted like the real backend's. */
  values: Map<string, string>;
  /** Whole-document groups' stored documents (never in the state snapshot,
     mirroring the backend's redaction — fetched via getGroupDocument). */
  docs: Map<string, string>;
  undo: Map<string, { kind: "item" | "group"; id: string }>;
  nextId: number;
}

/** The FAKE document group's stored content (v1.14.0 §56 harness data). */
const FAKE_DOC = `FAKE credentials file
=====================

Source: https://github.com/assadigit/FAKE-project

Cloudflare:
  CLOUDFLARE_API_TOKEN=FAKE-cf-token-abcdef123456
  CLOUDFLARE_ACCOUNT_ID=FAKE-account-id-998877

GitHub:
  GITHUB_TOKEN=FAKE-ghp-token-000111222333
  GITHUB_ORG=assadigit

Notes:
  Rotate every 90 days.
  Never paste this into a chat window.
  The tail line exists so the full editor's scroll is exercised.
`;

function makeVault(): HarnessVault {
  const values = new Map<string, string>();
  values.set("fake-item-1", "FAKE-ghp_1234567890abcdefGITHUB");
  values.set(
    "fake-item-2",
    "FAKE prompt — a cinematic wide shot of a lighthouse at dawn,\nslow dolly forward, volumetric fog, warm rim light on the rocks,\nshot on 35mm film, muted teal-and-amber palette, gentle grain.\n\n(Negative: text, watermark, oversaturated colors.)",
  );
  values.set("fake-item-3", "FAKE-grafana-token-9988776655");
  const docs = new Map<string, string>();
  docs.set("fake-doc-group-1", FAKE_DOC);
  const state: ClavisState = {
    data: {
      schemaVersion: 1,
      appVersion: "dev-harness",
      encryption: { enabled: false },
      settings: {
        shortcut: "Ctrl+Shift+Space",
        startWithWindows: false,
        solidMode: false,
        glassIntensity: 100,
        showLast4: true,
        managerBounds: null,
      },
      categories: [
        { id: "c1", name: "Credentials", sortOrder: 0 },
        { id: "c2", name: "Prompts", sortOrder: 1 },
      ],
      items: [
        fakeItem({
          id: "fake-item-1",
          name: "FAKE GitHub token",
          key: "GITHUB_TOKEN",
          valueLast4: "GITH",
          categoryId: "c1",
          tags: ["github"],
          isSecret: true,
          shared: true,
          useCount: 12,
          lastUsedAt: T0,
        }),
        fakeItem({
          id: "fake-item-2",
          name: "FAKE Lighthouse prompt",
          categoryId: "c2",
          tags: ["image", "cinematic"],
          useCount: 4,
          lastUsedAt: T0,
        }),
        fakeItem({
          id: "fake-item-3",
          name: "FAKE Grafana token",
          valueLast4: "7665",
          categoryId: "c1",
          tags: [],
          isSecret: true,
          useCount: 1,
        }),
      ],
      groups: [
        fakeGroup("fake-group-1", "FAKE Deploy set", ["fake-item-1"]),
        fakeGroup("fake-group-2", "FAKE Side project", ["fake-item-1"]),
        {
          id: "fake-doc-group-1",
          name: "FAKE Credentials file",
          categoryId: "c1",
          tags: [],
          itemIds: [],
          mode: "document",
          isSecret: true,
          docChars: [...FAKE_DOC].length,
          docLines: FAKE_DOC.split("\n").length,
          pinned: false,
          useCount: 5,
          lastUsedAt: T0,
          createdAt: T0,
          updatedAt: T0,
          deletedAt: null,
        },
      ],
    },
    backups: [],
    readOnly: false,
    readOnlyReason: null,
    recoveredNotice: null,
    dataDir: "C:\\fake\\data",
    appVersion: "dev-harness",
    osTransparency: true,
  };
  return { state, values, docs, undo: new Map(), nextId: 10 };
}

function fakeGroup(id: string, name: string, itemIds: string[]): Group {
  return {
    id,
    name,
    categoryId: null,
    tags: [],
    itemIds,
    pinned: false,
    useCount: 0,
    lastUsedAt: null,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
  };
}

function HarnessRoot() {
  const vaultRef = useRef<HarnessVault>(makeVault());
  const [state, setState] = useState<ClavisState>(() => vaultRef.current.state);
  const [filter, setFilter] = useState<ListFilter>({ view: "all" });
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [creating, setCreating] = useState<Creating | null>(null);
  const maximized = useMaximized();

  useEffect(() => {
    applyTheme(state.data.settings.solidMode);
  }, [state.data.settings.solidMode]);

  /* The fake backend: mutates the in-memory vault, then publishes a fresh
     state object — the same data-changed loop the real app runs. */
  const call = useCallback<CallFn>(async (action: string, payload?: Record<string, unknown>) => {
    const vault = vaultRef.current;
    const p = payload ?? {};
    const now = new Date().toISOString();
    const publish = () => {
      setState({ ...vault.state, data: { ...vault.state.data } });
    };
    switch (action) {
      case "getValue": {
        const value = vault.values.get(String(p.id)) ?? "";
        return { ok: true, status: 200, value };
      }
      case "updateItem": {
        const item = vault.state.data.items.find((i) => i.id === p.id);
        if (!item) return { ok: false, status: 404, error: "not found" };
        const patch = p.patch as Record<string, unknown>;
        Object.assign(item, patch, { updatedAt: now });
        if (typeof patch.value === "string") {
          vault.values.set(item.id, patch.value);
          item.valueLast4 = patch.value.slice(-4);
        }
        publish();
        return { ok: true, status: 200 };
      }
      case "createItem": {
        const input = p.input as Record<string, unknown>;
        const id = `fake-item-${vault.nextId++}`;
        const item = fakeItem({
          id,
          name: String(input.name ?? "Untitled"),
          key: String(input.key ?? ""),
          categoryId: (input.categoryId as string | null) ?? null,
          tags: (input.tags as string[]) ?? [],
          isSecret: Boolean(input.isSecret),
          shared: Boolean(input.shared),
          note: String(input.note ?? ""),
          createdAt: now,
          updatedAt: now,
        });
        vault.state.data.items.push(item);
        vault.values.set(id, String(input.value ?? ""));
        publish();
        return { ok: true, status: 200, id };
      }
      case "duplicateItem": {
        const src = vault.state.data.items.find((i) => i.id === p.id);
        if (!src) return { ok: false, status: 404, error: "not found" };
        const id = `fake-item-${vault.nextId++}`;
        const copy = fakeItem({ ...src, id, name: `${src.name} (copy)`, createdAt: now, updatedAt: now, useCount: 0 });
        vault.state.data.items.push(copy);
        vault.values.set(id, vault.values.get(src.id) ?? "");
        publish();
        return { ok: true, status: 200, id };
      }
      case "deleteEntry": {
        const kind = p.kind as "item" | "group";
        const entry =
          kind === "item"
            ? vault.state.data.items.find((i) => i.id === p.id)
            : vault.state.data.groups.find((g) => g.id === p.id);
        if (!entry) return { ok: false, status: 404, error: "not found" };
        entry.deletedAt = now;
        const token = `undo-${vault.nextId++}`;
        vault.undo.set(token, { kind, id: entry.id });
        publish();
        return { ok: true, status: 200, undoToken: token };
      }
      case "undoDelete": {
        const undo = vault.undo.get(String(p.undoToken));
        if (!undo) return { ok: false, status: 404, error: "unknown token" };
        vault.undo.delete(String(p.undoToken));
        const entry =
          undo.kind === "item"
            ? vault.state.data.items.find((i) => i.id === undo.id)
            : vault.state.data.groups.find((g) => g.id === undo.id);
        if (entry) entry.deletedAt = null;
        publish();
        return { ok: true, status: 200 };
      }
      case "copy": {
        if (p.kind === "item") {
          const item = vault.state.data.items.find((i) => i.id === p.id);
          if (!item) return { ok: false, status: 404, error: "not found" };
          item.useCount += 1;
          item.lastUsedAt = now;
          publish();
          return { ok: true, status: 200, copied: true, containsSecret: item.isSecret };
        }
        const group = vault.state.data.groups.find((g) => g.id === p.id);
        if (!group) return { ok: false, status: 404, error: "not found" };
        return { ok: true, status: 200, copied: true, lineCount: group.itemIds.length };
      }
      case "addItemsToGroup": {
        const group = vault.state.data.groups.find((g) => g.id === p.groupId);
        if (!group) return { ok: false, status: 404, error: "not found" };
        for (const id of (p.itemIds as string[]) ?? []) if (!group.itemIds.includes(id)) group.itemIds.push(id);
        group.updatedAt = now;
        publish();
        return { ok: true, status: 200 };
      }
      case "removeItemFromGroup": {
        const group = vault.state.data.groups.find((g) => g.id === p.groupId);
        if (!group) return { ok: false, status: 404, error: "not found" };
        group.itemIds = group.itemIds.filter((id) => id !== p.itemId);
        group.updatedAt = now;
        publish();
        return { ok: true, status: 200 };
      }
      case "reorderGroupItems": {
        const group = vault.state.data.groups.find((g) => g.id === p.groupId);
        if (!group) return { ok: false, status: 404, error: "not found" };
        group.itemIds = (p.itemIds as string[]) ?? group.itemIds;
        group.updatedAt = now;
        publish();
        return { ok: true, status: 200 };
      }
      case "splitItemForGroup": {
        const src = vault.state.data.items.find((i) => i.id === p.id);
        const group = vault.state.data.groups.find((g) => g.id === p.groupId);
        if (!src || !group) return { ok: false, status: 404, error: "not found" };
        const patch = p.patch as Record<string, unknown>;
        const id = `fake-item-${vault.nextId++}`;
        const copy = fakeItem({ ...src, id, createdAt: now, updatedAt: now, useCount: 0, ...patch });
        vault.state.data.items.push(copy);
        vault.values.set(id, String(patch.value ?? ""));
        group.itemIds = group.itemIds.map((mid) => (mid === src.id ? id : mid));
        group.updatedAt = now;
        publish();
        return { ok: true, status: 200, id };
      }
      case "getGroupDocument": {
        const doc = vault.docs.get(String(p.id));
        if (doc === undefined) return { ok: false, status: 404, error: "not found" };
        return { ok: true, status: 200, document: doc };
      }
      case "setGroupDocument": {
        const group = vault.state.data.groups.find((g) => g.id === p.id);
        if (!group) return { ok: false, status: 404, error: "not found" };
        const doc = String(p.document ?? "");
        vault.docs.set(group.id, doc);
        group.docChars = [...doc].length;
        group.docLines = doc === "" ? 0 : doc.split("\n").length;
        group.updatedAt = now;
        publish();
        return { ok: true, status: 200 };
      }
      case "updateGroup": {
        const group = vault.state.data.groups.find((g) => g.id === p.id);
        if (!group) return { ok: false, status: 404, error: "not found" };
        Object.assign(group, p.patch as Record<string, unknown>, { updatedAt: now });
        publish();
        return { ok: true, status: 200 };
      }
      default:
        return { ok: true, status: 200 };
    }
  }, []);

  const deleteEntry = useCallback(
    (kind: "item" | "group", id: string) => {
      void call("deleteEntry", { kind, id });
    },
    [call],
  );

  return (
    <>
      <div className={maximized ? "clavis-desk-manager is-max" : "clavis-desk-manager"}>
        <div className="clavis-window-frame clavis-desk-frame">
          <Manager
            state={state}
            call={call}
            readOnly={false}
            filter={filter}
            setFilter={setFilter}
            query={query}
            setQuery={setQuery}
            selection={selection}
            setSelection={setSelection}
            creating={creating}
            setCreating={setCreating}
            onHide={() => undefined}
            deleteEntry={deleteEntry}
          />
        </div>
      </div>
      <Toaster position="bottom-center" duration={4000} />
    </>
  );
}

const mountPoint = document.getElementById("root");
if (mountPoint) {
  createRoot(mountPoint).render(<HarnessRoot />);
}
