/**
 * CLAVIS — settings view smoke test (UI-audit round 1, Phase 1 safety net;
 * F-028). Pins today's behavior: four sections render, the five data
 * buttons exist, and each backup row has a Restore button (F-005 pins the
 * identical names; Phase 5 makes them distinct). Fake data only.
 * Wails runtime mocked.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SettingsView } from "./settings-view";
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
      ],
      groups: [],
    },
    backups: [
      { name: "clavis-backup-20250101-0900.json", takenAt: "2025-01-01T09:00:00.000Z", sizeBytes: 1234 },
      { name: "clavis-backup-20250102-0900.json", takenAt: "2025-01-02T09:00:00.000Z", sizeBytes: 2345 },
      { name: "clavis-backup-20250103-0900.json", takenAt: "2025-01-03T09:00:00.000Z", sizeBytes: 3456 },
    ],
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
  render(<SettingsView state={state()} call={call} readOnly={false} />);
  return { call };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SettingsView smoke", () => {
  it("renders the four sections", () => {
    setup();
    for (const title of ["Shortcut", "Appearance", "Data", "About"]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it("renders the five data buttons", () => {
    setup();
    for (const name of [
      "Export everything",
      "Import backup",
      "Import Markdown / TXT",
      "Import folder",
      "Export all as Markdown",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("lists every backup with a Restore button and the plaintext warning", () => {
    setup();
    const restores = screen.getAllByRole("button", { name: "Restore" });
    expect(restores.length).toBe(3);
    expect(
      screen.getByText(/Exported files contain your real secrets in plain text/)
    ).toBeTruthy();
  });

  it("Restore on a backup calls restoreBackup with its name", async () => {
    const { call } = setup();
    const { userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getAllByRole("button", { name: "Restore" })[0]);
    expect(call).toHaveBeenCalledWith("restoreBackup", {
      name: "clavis-backup-20250101-0900.json",
    });
  });
});
