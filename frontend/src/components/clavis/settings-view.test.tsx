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

function setup(callImpl?: (action: string) => Record<string, unknown> | Promise<Record<string, unknown>>) {
  const call = vi.fn(async (action: string) => {
    if (callImpl) return { ok: true, status: 200, ...(await callImpl(action)) };
    return { ok: true, status: 200 };
  }) as unknown as CallFn;
  render(<SettingsView state={state()} call={call} readOnly={false} />);
  return { call };
}

/** Upload JSON through the hidden Import-backup input (jsdom File). */
async function uploadBackup(user: ReturnType<typeof import("@testing-library/user-event")["default"]["setup"]>, json: string) {
  const input = document.querySelector('input[accept=".json,application/json"]') as HTMLInputElement;
  const file = new File([json], "clavis-group-fake-20260128-1200.json", { type: "application/json" });
  await user.upload(input, file);
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

  it("lists every backup with a distinct Restore name and the plaintext warning", () => {
    setup();
    /* F-005 fixed (Phase 5): each Restore button says which backup it
        restores — three distinct accessible names, not three "Restore"s. */
    const restores = screen.getAllByRole("button", { name: /^Restore backup from clavis-backup-/ });
    expect(restores.length).toBe(3);
    expect(
      screen.getByRole("button", { name: "Restore backup from clavis-backup-20250102-0900.json" })
    ).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: "Restore" }).length).toBe(0);
    expect(
      screen.getByText(/Exported files contain your real secrets in plain text/)
    ).toBeTruthy();
  });

  it("Restore on a backup calls restoreBackup with its name", async () => {
    const { call } = setup();
    const { userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "Restore backup from clavis-backup-20250101-0900.json" }));
    expect(call).toHaveBeenCalledWith("restoreBackup", {
      name: "clavis-backup-20250101-0900.json",
    });
  });

  it("the update status line is an announced live region (F-002)", () => {
    setup();
    const status = screen.getByRole("status");
    expect((status.textContent ?? "").startsWith("Version")).toBeTruthy();
  });

  it("a fragment preview shows the partial-export sentence and only Merge", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fragmentJSON = JSON.stringify({
      kind: "clavis-fragment",
      fragmentVersion: 1,
      exportedAt: "2026-01-28T10:00:00.000Z",
      sourceAppVersion: "1.2.0",
      scope: { type: "group", id: "g9", name: "FAKE Deploy set" },
      categories: [],
      groups: [{ id: "g9", name: "FAKE Deploy set" }],
      items: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
    });
    setup(async (action) => {
      if (action === "importBackupPreview") {
        return {
          preview: {
            valid: true,
            incoming: { items: 4, groups: 1, categories: 0 },
            fragment: { type: "group", id: "g9", name: "FAKE Deploy set" },
          },
        };
      }
      return {};
    });
    await uploadBackup(user, fragmentJSON);
    const dialog = await screen.findByRole("dialog");
    const text = dialog.textContent ?? "";
    expect(text).toContain("This is a partial export of the group");
    expect(text).toContain("“FAKE Deploy set”");
    expect(text).toContain("(4 items, 1 group)");
    expect(text).toContain("Merging adds anything you don't already have.");
    expect(screen.queryByRole("button", { name: "Replace everything" })).toBeNull();
    expect(screen.getByRole("button", { name: "Merge" })).toBeTruthy();
  });

  it("a full-backup preview keeps all three buttons", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fullJSON = JSON.stringify({
      schemaVersion: 1,
      appVersion: "1.2.0",
      items: [{ id: "a" }, { id: "b" }],
      groups: [{ id: "g9" }],
      categories: [{ id: "c1" }],
    });
    setup(async (action) => {
      if (action === "importBackupPreview") {
        return { preview: { valid: true, incoming: { items: 2, groups: 1, categories: 1 } } };
      }
      return {};
    });
    await uploadBackup(user, fullJSON);
    expect(await screen.findByText(/The backup contains/)).toBeTruthy();
    for (const name of ["Cancel", "Merge", "Replace everything"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });
});
