/**
 * CLAVIS — SharedHome panel tests (v1.8.0, DECISIONS.md §48): the
 * backend-driven scan renders one card per detected duplicate cluster,
 * merging goes through the confirmation modal and dispatches EVERY member
 * id, the all-clear state renders when nothing is duplicated, and read-only
 * locks the merge. Fake data only (FAKE-* values). Wails runtime mocked.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SharedHome } from "./shared-duplicates";
import type { ApiResult, CallFn } from "@/lib/clavis/client";
import type { ClavisState } from "@/lib/clavis/types";

vi.mock("@wailsio/runtime", () => ({
  Call: { ByName: vi.fn(async () => ({})) },
  Events: { On: vi.fn(() => () => {}) },
}));

function state(): ClavisState {
  const item = (id: string, name: string) => ({
    id,
    name,
    key: "",
    value: "",
    note: "",
    categoryId: null,
    tags: [],
    isSecret: true,
    pinned: false,
    useCount: 0,
    lastUsedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    deletedAt: null,
  });
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
      items: [item("fake-item-1", "FAKE GitHub token"), item("fake-item-2", "FAKE GH_PAT"), item("fake-item-3", "FAKE repo token")],
      groups: [],
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

const cluster = {
  itemId: "fake-item-1",
  name: "FAKE GitHub token",
  key: "GITHUB_TOKEN",
  valueLast4: "tOKn",
  copies: 3,
  groupNames: ["FAKE Alpha", "FAKE Beta", "FAKE Gamma"],
  members: [
    { itemId: "fake-item-1", name: "FAKE GitHub token", key: "GITHUB_TOKEN", groupNames: ["FAKE Alpha"] },
    { itemId: "fake-item-2", name: "FAKE GH_PAT", key: "GH_PAT", groupNames: ["FAKE Beta"] },
    { itemId: "fake-item-3", name: "FAKE repo token", key: "", groupNames: ["FAKE Gamma"] },
  ],
};

function makeCall(clusters: unknown[] | null) {
  return vi.fn(async (action: string): Promise<ApiResult> => {
    if (action === "detectSharedDuplicates") {
      return { ok: true, status: 200, clusters: clusters ?? undefined } as ApiResult;
    }
    if (action === "mergeSharedDuplicates") {
      return { ok: true, status: 200, id: "fake-item-1" } as ApiResult;
    }
    return { ok: true, status: 200 } as ApiResult;
  }) as unknown as CallFn & ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("SharedHome (v1.8.0 duplicate detection)", () => {
  it("auto-scans on mount and renders one card per detected cluster", async () => {
    const call = makeCall([cluster]);
    render(<SharedHome state={state()} call={call} readOnly={false} />);

    // The scan fired on mount.
    await waitFor(() => {
      expect(call).toHaveBeenCalledWith("detectSharedDuplicates");
    });

    // The card: canonical name (also a member row), masked hint, copy
    // count, member rows with their group chips, and the merge action.
    expect((await screen.findAllByText("FAKE GitHub token")).length).toBeGreaterThan(0);
    expect(screen.getByText("••••••••tOKn")).toBeTruthy();
    expect(screen.getAllByText("3 copies").length).toBeGreaterThan(0);
    expect(screen.getByText("FAKE GH_PAT")).toBeTruthy();
    expect(screen.getByText("FAKE Beta")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Merge into one shared credential" })).toBeTruthy();
    // No value text ever renders — only the masked hint.
    expect(screen.queryByText(/ghp_/i)).toBeNull();
  });

  it("merges through the confirmation modal, dispatching every member id", async () => {
    const call = makeCall([cluster]);
    const user = userEvent.setup();
    render(<SharedHome state={state()} call={call} readOnly={false} />);

    await user.click(await screen.findByRole("button", { name: "Merge into one shared credential" }));

    // The confirmation modal: title, the surviving name, group list, the
    // trash note, and the action pair. (Group names also render in the
    // card's member chips behind the modal, so query all matches.)
    expect(await screen.findByText("Merge 3 copies into one shared credential")).toBeTruthy();
    expect(screen.getAllByText(/FAKE Alpha/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Trash/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Merge into one" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Merge into one" }));

    await waitFor(() => {
      expect(call).toHaveBeenCalledWith("mergeSharedDuplicates", {
        itemIds: ["fake-item-1", "fake-item-2", "fake-item-3"],
      });
    });
    // The modal closes after a successful merge.
    await waitFor(() => {
      expect(screen.queryByText("Merge 3 copies into one shared credential")).toBeNull();
    });
  });

  it("renders the all-clear line when the scan finds nothing", async () => {
    const call = makeCall([]);
    render(<SharedHome state={state()} call={call} readOnly={false} />);

    expect(
      await screen.findByText(/No duplicates detected — every value that appears in several groups is already one shared credential\./)
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Merge into one shared credential" })).toBeNull();
  });

  it("locks the merge behind read-only", async () => {
    const call = makeCall([cluster]);
    render(<SharedHome state={state()} call={call} readOnly={true} />);

    const merge = await screen.findByRole("button", { name: "Merge into one shared credential" });
    expect((merge as HTMLButtonElement).disabled).toBe(true);
  });
});
