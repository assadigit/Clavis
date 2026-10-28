/**
 * CLAVIS — manager smoke test (UI-audit round 1, Phase 1 safety net; F-028).
 * Pins today's behavior: the three-column manager renders, a selected item
 * opens in the detail column, and clicking a list row hands the selection
 * back to the manager. Fake data only (FAKE-* values). Wails runtime mocked.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Manager } from "./manager";
import type { ClavisState } from "@/lib/clavis/types";
import type { CallFn } from "@/lib/clavis/client";
import type { ListFilter, Selection } from "./app-types";

vi.mock("@wailsio/runtime", () => ({
  Call: { ByName: vi.fn(async () => ({})) },
  Events: { On: vi.fn(() => () => {}) },
}));

function state(): ClavisState {
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
        {
          id: "fake-item-1", name: "FAKE GitHub token", key: "GITHUB_TOKEN", value: "",
          valueLast4: "tOKn", note: "", categoryId: "c1", tags: ["github"],
          isSecret: true, pinned: false, useCount: 3,
          lastUsedAt: "2025-01-02T00:00:00.000Z",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
        },
        {
          id: "fake-item-2", name: "FAKE Grafana token", key: "", value: "",
          valueLast4: "", note: "", categoryId: "c1", tags: [],
          isSecret: true, pinned: false, useCount: 0, lastUsedAt: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
        },
      ],
      groups: [
        {
          id: "fake-group-1", name: "FAKE Deploy set", categoryId: "c1", tags: [],
          itemIds: ["fake-item-1", "fake-item-2"], pinned: false, useCount: 0,
          lastUsedAt: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
        },
      ],
    },
    backups: [],
    readOnly: false,
    readOnlyReason: null,
    recoveredNotice: null,
    dataDir: "C:\\fake\\data",
    appVersion: "test",
    osTransparency: true,
  };
}

function setup(selection: Selection | null) {
  const call = vi.fn(async (action: string) => {
    if (action === "getValue") {
      return { ok: true, status: 200, value: "FAKE-VALUE-1234567890" };
    }
    return { ok: true, status: 200 };
  }) as unknown as CallFn;
  const setFilter = vi.fn();
  const setQuery = vi.fn();
  const setSelection = vi.fn();
  const setCreating = vi.fn();
  const onHide = vi.fn();
  const deleteEntry = vi.fn();
  render(
    <Manager
      state={state()}
      call={call}
      readOnly={false}
      filter={{ view: "all" } as ListFilter}
      setFilter={setFilter}
      query=""
      setQuery={setQuery}
      selection={selection}
      setSelection={setSelection}
      creating={null}
      setCreating={setCreating}
      onHide={onHide}
      deleteEntry={deleteEntry}
    />,
  );
  return { call, setSelection, onHide };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Manager smoke", () => {
  it("renders the three columns and opens a selected item in the detail column", async () => {
    setup({ kind: "item", id: "fake-item-1" });
    /* The editor fetches the value on mount — wait for it to appear. */
    expect(await screen.findByRole("heading", { name: "FAKE GitHub token" })).toBeTruthy();
    /* The other row is still visible in the list column. */
    expect(screen.getByText("FAKE Grafana token")).toBeTruthy();
  });

  it("clicking a list row hands the selection back", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { setSelection } = setup(null);
    /* Nothing selected yet: the detail column shows the empty panel. */
    expect(screen.getByText("Nothing selected")).toBeTruthy();
    await user.click(screen.getByText("FAKE Grafana token"));
    expect(setSelection).toHaveBeenCalledWith({ kind: "item", id: "fake-item-2" });
  });

  it("shows the read-only banner when the store is read-only", () => {
    // sanity pin for the readOnly prop path (B15 baseline)
    cleanup();
    const call = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as CallFn;
    render(
      <Manager
        state={state()}
        call={call}
        readOnly
        filter={{ view: "all" } as ListFilter}
        setFilter={vi.fn()}
        query=""
        setQuery={vi.fn()}
        selection={null}
        setSelection={vi.fn()}
        creating={null}
        setCreating={vi.fn()}
        onHide={vi.fn()}
        deleteEntry={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Read-only");
  });

  it("a category view lists the whole subtree's entries (v1.4.0 hierarchy)", async () => {
    cleanup();
    const nested: ClavisState = {
      ...state(),
      data: {
        ...state().data,
        categories: [
          { id: "c1", name: "Credentials", sortOrder: 0 },
          { id: "p", name: "Projects", sortOrder: 1 },
          { id: "h", name: "Hibana", sortOrder: 2, parentId: "p" },
        ],
        items: [
          {
            id: "fake-item-1", name: "FAKE Projects root key", key: "", value: "",
            valueLast4: "", note: "", categoryId: "p", tags: [],
            isSecret: true, pinned: false, useCount: 0, lastUsedAt: null,
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
          },
          {
            id: "fake-item-2", name: "FAKE Hibana key", key: "", value: "",
            valueLast4: "", note: "", categoryId: "h", tags: [],
            isSecret: true, pinned: false, useCount: 0, lastUsedAt: null,
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
          },
          {
            id: "fake-item-3", name: "FAKE unrelated key", key: "", value: "",
            valueLast4: "", note: "", categoryId: "c1", tags: [],
            isSecret: true, pinned: false, useCount: 0, lastUsedAt: null,
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
          },
        ],
        groups: [],
      },
    };
    const call = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as CallFn;
    render(
      <Manager
        state={nested}
        call={call}
        readOnly={false}
        filter={{ view: "category", categoryId: "p" } as ListFilter}
        setFilter={vi.fn()}
        query=""
        setQuery={vi.fn()}
        selection={null}
        setSelection={vi.fn()}
        creating={null}
        setCreating={vi.fn()}
        onHide={vi.fn()}
        deleteEntry={vi.fn()}
      />,
    );
    /* The parent's own entry AND the subcategory's entry appear… */
    expect(screen.getByText("FAKE Projects root key")).toBeTruthy();
    expect(screen.getByText("FAKE Hibana key")).toBeTruthy();
    /* …while entries outside the subtree stay out. */
    expect(screen.queryByText("FAKE unrelated key")).toBeNull();
  });
});
