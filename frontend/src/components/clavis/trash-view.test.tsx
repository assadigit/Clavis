/**
 * CLAVIS — trash view smoke test (UI-audit round 1, Phase 1 safety net;
 * F-028). Pins today's behavior: deleted entries render with a Restore
 * button whose accessible name includes the entry name (the in-repo pattern
 * F-005 wants propagated), and clicking it calls restoreEntry.
 * Fake data only (FAKE-* values). Wails runtime mocked.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrashView } from "./trash-view";
import type { ClavisState } from "@/lib/clavis/types";
import type { CallFn } from "@/lib/clavis/client";

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
      categories: [],
      items: [
        {
          id: "fake-item-1", name: "FAKE Old login", key: "", value: "",
          valueLast4: "", note: "", categoryId: null, tags: [],
          isSecret: true, pinned: false, useCount: 0, lastUsedAt: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          deletedAt: "2025-01-04T00:00:00.000Z",
        },
      ],
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

function setup() {
  const call = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as CallFn;
  render(<TrashView state={state()} call={call} readOnly={false} />);
  return { call };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TrashView smoke", () => {
  it("renders deleted entries with a per-entry Restore affordance", () => {
    setup();
    expect(screen.getByText("FAKE Old login")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restore FAKE Old login" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete FAKE Old login forever" })).toBeTruthy();
  });

  it("Restore calls restoreEntry for that entry", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call } = setup();
    await user.click(screen.getByRole("button", { name: "Restore FAKE Old login" }));
    expect(call).toHaveBeenCalledWith("restoreEntry", { kind: "item", id: "fake-item-1" });
  });

  it("shows the empty state when nothing is deleted", () => {
    const empty = state();
    empty.data.items = [];
    const call = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as CallFn;
    render(<TrashView state={empty} call={call} readOnly={false} />);
    expect(screen.getByText("Trash is empty. Deleted items rest here for 30 days.")).toBeTruthy();
  });
});
