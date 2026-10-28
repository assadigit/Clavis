/**
 * CLAVIS — group editor smoke test (UI-audit round 1, Phase 1 safety net;
 * F-028). Pins today's behavior: member rows render in the well, and the
 * "More actions" → "Export Markdown" item calls downloadExport("group-md",
 * id). Fake data only (FAKE-* values). Wails runtime + downloadExport
 * mocked.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GroupEditor } from "./group-editor";
import { downloadExport } from "@/lib/clavis/client";
import type { ClavisState, Group } from "@/lib/clavis/types";
import type { CallFn } from "@/lib/clavis/client";

vi.mock("@wailsio/runtime", () => ({
  Call: { ByName: vi.fn(async () => ({})) },
  Events: { On: vi.fn(() => () => {}) },
}));

vi.mock("@/lib/clavis/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clavis/client")>();
  return { ...actual, downloadExport: vi.fn(async () => {}) };
});

function group(): Group {
  return {
    id: "fake-group-1",
    name: "FAKE Deploy set",
    categoryId: "c1",
    tags: ["deploy"],
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
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(downloadExport).mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("GroupEditor smoke", () => {
  it("renders the group with its member rows", () => {
    setup();
    expect(screen.getByRole("heading", { name: "FAKE Deploy set" })).toBeTruthy();
    expect(screen.getByText("FAKE GitHub token")).toBeTruthy();
    expect(screen.getByText("FAKE Grafana token")).toBeTruthy();
    expect(screen.getByText(/2 items · used 2× · updated/)).toBeTruthy();
    /* v1.5.0 (§40): every member row is editable by its accessible name and
       carries its own Copy / Reveal / Delete actions as sibling buttons. */
    expect(
      screen.getByRole("button", { name: "Edit FAKE GitHub token (secret)" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Edit FAKE Grafana token (secret)" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy FAKE GitHub token" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy FAKE Grafana token" })).toBeTruthy();
  });

  it("Export Markdown in the More actions menu calls downloadExport", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup();
    await user.click(screen.getByTitle("More actions"));
    await user.click(screen.getByRole("menuitem", { name: "Export Markdown" }));
    expect(downloadExport).toHaveBeenCalledWith("group-md", "fake-group-1");
  });

  it("Export JSON (backup-safe) sits after the markdown copy and calls downloadExport with group-json (Phase 4)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup();
    await user.click(screen.getByTitle("More actions"));
    const items = screen.getAllByRole("menuitem");
    /* v1.5.0 (§40): "Copy all as markdown" leads the menu; the lossless
       JSON export follows it. */
    expect(items[0].textContent).toContain("Copy all as markdown");
    expect(items[1].textContent).toContain("Export JSON (backup-safe)");
    /* F-003: the plaintext warning is visible inside the menu. */
    expect(items[1].textContent).toContain("Contains your real value in plain text.");
    await user.click(items[1]);
    expect(downloadExport).toHaveBeenCalledWith("group-json", "fake-group-1");
  });
});
