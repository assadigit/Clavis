/**
 * CLAVIS — a11y test (UI-audit round 1, Phase 12, F-016). Renders each
 * major screen with fake data and runs axe-core against the rendered
 * container. Color-contrast is disabled here (jsdom can't measure it;
 * `scripts/check-contrast.mjs` owns that). Fails on any other serious
 * violation. Fake data only — no real secrets. Wails runtime mocked.
 */
import { describe, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("@wailsio/runtime", () => ({
  Call: { ByName: vi.fn(async () => ({})) },
  Events: { On: vi.fn(() => () => {}) },
}));

vi.mock("@/lib/clavis/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clavis/client")>();
  return { ...actual, downloadExport: vi.fn(async () => {}) };
});

import { Manager } from "./manager";
import { SettingsView } from "./settings-view";
import { ItemEditor } from "./item-editor";
import { GroupEditor } from "./group-editor";
import { TrashView } from "./trash-view";
import { ManageItemsModal } from "./manage-items-modal";
import { Popup } from "./popup";
import { expectNoViolations } from "@/test/a11y";
import type { ClavisState, Group, Item } from "@/lib/clavis/types";
import type { CallFn } from "@/lib/clavis/client";
import type { ListFilter, Selection } from "./app-types";

function item(id: string, name: string, isSecret: boolean = true, deletedAt: string | null = null): Item {
  return {
    id, name, key: id === "fake-item-1" ? "GITHUB_TOKEN" : "", value: "",
    valueLast4: id === "fake-item-1" ? "tOKn" : "", note: "", categoryId: "c1",
    tags: ["github"], isSecret, pinned: false, useCount: 3,
    lastUsedAt: "2025-01-02T00:00:00.000Z",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z", deletedAt,
  };
}

function group(): Group {
  return {
    id: "fake-group-1", name: "FAKE Deploy set", categoryId: "c1", tags: ["deploy"],
    itemIds: ["fake-item-1", "fake-item-2"], pinned: false, useCount: 2,
    lastUsedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
  };
}

function state(opts: { withDeleted?: boolean } = {}): ClavisState {
  return {
    data: {
      schemaVersion: 1,
      appVersion: "test",
      encryption: { enabled: false },
      settings: {
        shortcut: "Ctrl+Shift+Space",
        startWithWindows: false,
        solidMode: false,
        glassIntensity: 100,
        showLast4: true,
        managerBounds: null,
      },
      categories: [{ id: "c1", name: "Credentials", sortOrder: 0 }],
      items: [
        item("fake-item-1", "FAKE GitHub token"),
        item("fake-item-2", "FAKE Grafana token"),
        ...(opts.withDeleted ? [item("fake-item-3", "FAKE Old login", true, "2025-01-04T00:00:00.000Z")] : []),
      ],
      groups: [group()],
    },
    backups: [
      { name: "clavis-backup-20250101-0900.json", takenAt: "2025-01-01T09:00:00.000Z", sizeBytes: 1234 },
    ],
    readOnly: false,
    readOnlyReason: null,
    recoveredNotice: null,
    dataDir: "C:\\fake\\data",
    appVersion: "test",
    osTransparency: true,
  };
}

const call = vi.fn(async (action: string) => {
  if (action === "getValue") return { ok: true, status: 200, value: "FAKE-VALUE-1234567890" };
  return { ok: true, status: 200 };
}) as unknown as CallFn;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a11y: every major screen passes axe (color-contrast disabled — owned by check-contrast.mjs)", () => {
  it("Manager (three-column) passes axe", async () => {
    render(
      <Manager
        state={state()}
        call={call}
        readOnly={false}
        filter={{ view: "all" } as ListFilter}
        setFilter={vi.fn()}
        query=""
        setQuery={vi.fn()}
        selection={{ kind: "item", id: "fake-item-1" } as Selection}
        setSelection={vi.fn()}
        creating={null}
        setCreating={vi.fn()}
        onHide={vi.fn()}
        deleteEntry={vi.fn()}
      />,
    );
    await expectNoViolations(document.body);
  });

  it("Settings passes axe", async () => {
    render(<SettingsView state={state()} call={call} readOnly={false} />);
    await expectNoViolations(document.body);
  });

  it("ItemEditor (edit mode) passes axe", async () => {
    render(
      <ItemEditor
        mode="edit"
        state={state()}
        call={call}
        readOnly={false}
        item={state().data.items[0]}
        onDone={vi.fn()}
        onSelectEntry={vi.fn()}
        deleteEntry={vi.fn()}
        onCancelCreate={vi.fn()}
      />,
    );
    await expectNoViolations(document.body);
  });

  it("GroupEditor (edit mode) passes axe", async () => {
    render(
      <GroupEditor
        mode="edit"
        state={state()}
        call={call}
        readOnly={false}
        group={group()}
        onDone={vi.fn()}
        onSelectEntry={vi.fn()}
        deleteEntry={vi.fn()}
        onManageItems={vi.fn()}
        onCancelCreate={vi.fn()}
      />,
    );
    await expectNoViolations(document.body);
  });

  it("TrashView passes axe", async () => {
    render(<TrashView state={state({ withDeleted: true })} call={call} readOnly={false} />);
    await expectNoViolations(document.body);
  });

  it("ManageItemsModal passes axe", async () => {
    render(
      <ManageItemsModal
        group={group()}
        state={state()}
        call={call}
        readOnly={false}
        onClose={vi.fn()}
        onCreateItemHere={vi.fn()}
      />,
    );
    await expectNoViolations(document.body);
  });

  it("Popup (quick palette) passes axe", async () => {
    render(
      <Popup
        open
        onHide={vi.fn()}
        state={state()}
        call={call}
        onOpenManagerNewItem={vi.fn()}
        onOpenManager={vi.fn()}
        onReportSelection={vi.fn()}
        fill
      />,
    );
    await expectNoViolations(document.body);
  });
});
