/**
 * CLAVIS — manager-entry cross-window sync tests (v1.3.2).
 *
 * The Manager's snapshot used to be load-once: copies made in the popup
 * (useCount / lastUsedAt — the "Recent" view) never reached this window,
 * because the popup is a separate webview. These tests pin the re-sync
 * contract: the snapshot re-fetches on the clavis:manager-shown event
 * (tray / popup button), on the clavis:data-changed broadcast (any
 * mutation, from either window) and on visibilitychange → visible
 * (taskbar / Alt-Tab restores that bypass ShowManager).
 *
 * The Wails runtime is mocked — these tests run in plain jsdom. Fake data
 * only (FAKE-* values).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Call, Events } from "@wailsio/runtime";
import { ManagerRoot } from "@/manager-entry";
import type { ClavisState } from "@/lib/clavis/types";

vi.mock("@wailsio/runtime", () => ({
  Call: { ByName: vi.fn(async () => ({})) },
  Events: { On: vi.fn(() => () => {}) },
}));

/** A one-item vault whose single item is named `name`. */
function state(name = "FAKE GitHub token"): ClavisState {
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
          id: "fake-item-1", name, key: "GITHUB_TOKEN", value: "",
          valueLast4: "tOKn", note: "", categoryId: "c1", tags: ["github"],
          isSecret: true, pinned: false, useCount: 3,
          lastUsedAt: "2025-01-02T00:00:00.000Z",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
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

function setVisibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** The latest callback registered for an event name (Events.On mock). */
function eventCallback(name: string): () => void {
  const calls = vi.mocked(Events.On).mock.calls as unknown as [string, () => void][];
  const last = calls.filter(([n]) => n === name).pop();
  if (!last) throw new Error(`no ${name} listener registered`);
  return last[1];
}

beforeEach(() => {
  vi.mocked(Call.ByName).mockReset();
});

afterEach(() => {
  cleanup();
  // jsdom starts "visible"; restore after any hidden-show simulation.
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

describe("Manager cross-window sync (v1.3.2)", () => {
  it("re-fetches the snapshot when shown again (clavis:manager-shown)", async () => {
    /* The manager window was hidden while the vault changed elsewhere
       (e.g. an import finished, or popup copies bumped counters) — coming
       back through the tray / "Open Clavis" must re-fetch, not reuse the
       mount-time snapshot. */
    vi.mocked(Call.ByName)
      .mockResolvedValueOnce(state() as never) // initial (mount) load
      .mockResolvedValue(state("FAKE Renamed entry") as never); // later fetches

    render(<ManagerRoot />);
    expect(await screen.findByText("FAKE GitHub token")).toBeTruthy();

    await act(async () => {
      eventCallback("clavis:manager-shown")();
    });
    await waitFor(() => {
      expect(screen.getByText("FAKE Renamed entry")).toBeTruthy();
    });
    expect(screen.queryByText("FAKE GitHub token")).toBeNull();
  });

  it("re-fetches on the clavis:data-changed broadcast (popup copy bumped counters)", async () => {
    vi.mocked(Call.ByName)
      .mockResolvedValueOnce(state() as never)
      .mockResolvedValue(state("FAKE Renamed entry") as never);

    render(<ManagerRoot />);
    expect(await screen.findByText("FAKE GitHub token")).toBeTruthy();

    // Any mutation, from either window, is broadcast by Go.
    await act(async () => {
      eventCallback("clavis:data-changed")();
    });
    await waitFor(() => {
      expect(screen.getByText("FAKE Renamed entry")).toBeTruthy();
    });
  });

  it("re-fetches on visibilitychange → visible (taskbar / Alt-Tab restore)", async () => {
    vi.mocked(Call.ByName)
      .mockResolvedValueOnce(state() as never)
      .mockResolvedValue(state("FAKE Renamed entry") as never);

    render(<ManagerRoot />);
    expect(await screen.findByText("FAKE GitHub token")).toBeTruthy();

    setVisibility("hidden"); // minimized / covered — no reload while hidden
    await act(async () => {});
    expect(screen.getByText("FAKE GitHub token")).toBeTruthy();

    setVisibility("visible"); // restored WITHOUT ShowManager (taskbar click)
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByText("FAKE Renamed entry")).toBeTruthy();
    });
  });
});
