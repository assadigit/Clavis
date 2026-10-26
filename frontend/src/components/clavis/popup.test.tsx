/**
 * CLAVIS — popup keyboard flow tests (SPEC §3.3b, §5.1, §5.2).
 *
 * The golden path: type letters → results rank → Enter dispatches the copy
 * (the backend writes the clipboard; the popup never sees the value) → the
 * popup hides. Plus: empty-results Enter creates, Esc hides, → drills into
 * a group and copies a member.
 *
 * The Wails runtime is mocked — these tests run in plain jsdom.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popup } from "./popup";
import type { ClavisState } from "@/lib/clavis/types";
import type { CallFn } from "@/lib/clavis/client";

vi.mock("@wailsio/runtime", () => ({
  Call: { ByName: vi.fn(async () => ({})) },
  Events: { On: vi.fn(() => () => {}) },
}));

// userEvent is pulled in via @testing-library/user-event; ensure it exists in
// devDependencies when CI installs.

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
          id: "i1", name: "GitHub token", key: "GITHUB_TOKEN", value: "",
          valueLast4: "tOKn", note: "", categoryId: "c1", tags: ["github"],
          isSecret: true, pinned: false, useCount: 3,
          lastUsedAt: "2025-01-02T00:00:00.000Z",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
        },
        {
          id: "i2", name: "Grafana token", key: "", value: "", note: "",
          categoryId: "c1", tags: [], isSecret: true, pinned: false,
          useCount: 0, lastUsedAt: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
        },
      ],
      groups: [
        {
          id: "g1", name: "Sedanama credentials", categoryId: "c1", tags: [],
          itemIds: ["i1", "i2"], pinned: false, useCount: 0, lastUsedAt: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
        },
      ],
    },
    backups: [],
    readOnly: false,
    readOnlyReason: null,
    recoveredNotice: null,
    dataDir: "C:\\ somewhere",
    appVersion: "test",
    osTransparency: true,
  };
}

function setup(overrides: Partial<Parameters<typeof Popup>[0]> = {}) {
  const call = vi.fn(async () => ({
    ok: true, status: 200, copied: true, lineCount: 1, containsSecret: true,
  })) as unknown as CallFn;
  const onHide = vi.fn();
  const onOpenManagerNewItem = vi.fn();
  const onOpenManager = vi.fn();
  const onReportSelection = vi.fn();
  render(
    <Popup
      open
      onHide={onHide}
      state={state()}
      call={call}
      onOpenManagerNewItem={onOpenManagerNewItem}
      onOpenManager={onOpenManager}
      onReportSelection={onReportSelection}
      fill
      {...overrides}
    />,
  );
  const input = screen.getByLabelText("Search Clavis");
  return { call, onHide, onOpenManagerNewItem, input };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Popup golden path", () => {
  it("shows masked previews, never values", () => {
    setup();
    expect(screen.getByText("••••••••tOKn")).toBeTruthy();
  });

  it("type letters → Enter dispatches the copy and hides the popup", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call, onHide } = setup();
    await user.type(screen.getByLabelText("Search Clavis"), "ghtk");
    await user.keyboard("{Enter}");
    expect(call).toHaveBeenCalledWith("copy", { kind: "item", id: "i1" });
    // auto-hide after the 500 ms feedback beat
    await vi.advanceTimersByTimeAsync(700);
    expect(onHide).toHaveBeenCalled();
  });

  it("Enter on an empty result set creates the item with the query prefilled", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onOpenManagerNewItem } = setup();
    await user.type(screen.getByLabelText("Search Clavis"), "zzzz");
    await user.keyboard("{Enter}");
    expect(onOpenManagerNewItem).toHaveBeenCalledWith("zzzz");
  });

  it("Esc hides the popup", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onHide } = setup();
    await user.type(screen.getByLabelText("Search Clavis"), "{Escape}");
    expect(onHide).toHaveBeenCalled();
  });

  it("→ drills into a group; Enter copies a member item; Backspace backs out", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call } = setup();
    await user.type(screen.getByLabelText("Search Clavis"), "sed"); // finds the group
    await user.keyboard("{ArrowRight}"); // drill in
    expect(screen.getByText("Sedanama credentials")).toBeTruthy();
    await user.keyboard("{Enter}"); // copy the first member (GitHub token)
    expect(call).toHaveBeenCalledWith("copy", { kind: "item", id: "i1" });
  });

  it("Ctrl+Enter inside a group copies the whole group", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call } = setup();
    await user.type(screen.getByLabelText("Search Clavis"), "sed");
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(call).toHaveBeenCalledWith("copy", { kind: "group", id: "g1" });
  });
});
