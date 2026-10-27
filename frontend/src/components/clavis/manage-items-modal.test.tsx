/**
 * CLAVIS — manage-items modal smoke test (UI-audit round 1, Phase 1 safety
 * net; F-028). Pins today's behavior: the modal renders its group and
 * member rows, Done closes it, and Esc closes it through the shared
 * esc-stack. Fake data only (FAKE-* values). Wails runtime mocked.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ManageItemsModal } from "./manage-items-modal";
import type { ClavisState, Group } from "@/lib/clavis/types";
import type { CallFn } from "@/lib/clavis/client";

vi.mock("@wailsio/runtime", () => ({
  Call: { ByName: vi.fn(async () => ({})) },
  Events: { On: vi.fn(() => () => {}) },
}));

function group(): Group {
  return {
    id: "fake-group-1",
    name: "FAKE Deploy set",
    categoryId: null,
    tags: [],
    itemIds: ["fake-item-1", "fake-item-2"],
    pinned: false,
    useCount: 2,
    lastUsedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    deletedAt: null,
  };
}

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
      categories: [],
      items: [
        {
          id: "fake-item-1", name: "FAKE GitHub token", key: "GITHUB_TOKEN", value: "",
          valueLast4: "tOKn", note: "", categoryId: null, tags: [],
          isSecret: true, pinned: false, useCount: 3,
          lastUsedAt: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
        },
        {
          id: "fake-item-2", name: "FAKE Grafana token", key: "", value: "",
          valueLast4: "", note: "", categoryId: null, tags: [],
          isSecret: true, pinned: false, useCount: 0, lastUsedAt: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
        },
      ],
      groups: [group()],
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

function setup() {
  const call = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as CallFn;
  const onClose = vi.fn();
  render(
    <ManageItemsModal
      group={group()}
      state={state()}
      call={call}
      readOnly={false}
      onClose={onClose}
      onCreateItemHere={vi.fn()}
    />,
  );
  return { call, onClose };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ManageItemsModal smoke", () => {
  it("renders open with the group's member rows and add-search", () => {
    setup();
    /* Modal's aria-label falls back to "Clavis dialog" for JSX titles. */
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Manage items")).toBeTruthy();
    expect(screen.getByText("Group “FAKE Deploy set”")).toBeTruthy();
    expect(screen.getByText("FAKE GitHub token")).toBeTruthy();
    expect(screen.getByText("FAKE Grafana token")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });

  it("Done closes the modal", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = setup();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Esc closes the modal through the esc-stack", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = setup();
    await user.click(screen.getByLabelText("Search items to add"));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("Remove on a member row calls removeItemFromGroup", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call } = setup();
    await user.click(screen.getByRole("button", { name: "Remove FAKE Grafana token from group" }));
    expect(call).toHaveBeenCalledWith("removeItemFromGroup", {
      groupId: "fake-group-1",
      itemId: "fake-item-2",
    });
  });
});
