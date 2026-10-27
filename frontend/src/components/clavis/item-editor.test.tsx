/**
 * CLAVIS — item editor smoke test (UI-audit round 1, Phase 1 safety net;
 * F-028). Pins today's behavior: fields render from the item, the value is
 * fetched once via "getValue", and the Save button appears only once the
 * form is dirty (F-020 pins this now; Phase 7 changes it deliberately).
 * Fake data only (FAKE-* values). Wails runtime mocked.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ItemEditor } from "./item-editor";
import type { ClavisState, Item } from "@/lib/clavis/types";
import type { CallFn } from "@/lib/clavis/client";

vi.mock("@wailsio/runtime", () => ({
  Call: { ByName: vi.fn(async () => ({})) },
  Events: { On: vi.fn(() => () => {}) },
}));

function item(): Item {
  return {
    id: "fake-item-1",
    name: "FAKE GitHub token",
    key: "GITHUB_TOKEN",
    value: "",
    valueLast4: "tOKn",
    note: "fake note",
    categoryId: "c1",
    tags: ["github"],
    isSecret: true,
    pinned: false,
    useCount: 3,
    lastUsedAt: "2025-01-02T00:00:00.000Z",
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
      items: [item()],
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
  const call = vi.fn(async (action: string) => {
    if (action === "getValue") {
      return { ok: true, status: 200, value: "FAKE-VALUE-1234567890" };
    }
    return { ok: true, status: 200 };
  }) as unknown as CallFn;
  render(
    <ItemEditor
      mode="edit"
      state={state()}
      call={call}
      readOnly={false}
      item={item()}
      onDone={vi.fn()}
      onSelectEntry={vi.fn()}
      deleteEntry={vi.fn()}
      onCancelCreate={vi.fn()}
    />,
  );
  return { call };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ItemEditor smoke", () => {
  it("renders fields from the item and fetches the value once", async () => {
    const { call } = setup();
    /* Edit mode fetches the value on mount — wait for the form. */
    expect(await screen.findByRole("heading", { name: "FAKE GitHub token" })).toBeTruthy();
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe("FAKE GitHub token");
    expect(screen.getByText(/Secret · used 3×/)).toBeTruthy();
    expect(call).toHaveBeenCalledWith("getValue", { id: "fake-item-1" });
  });

  it("the save affordance exists from the start — disabled Saved when clean (F-020)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup();
    const name = await screen.findByLabelText("Name");
    /* Clean form: a disabled "Saved" occupies the slot (Phase 7, F-020). */
    const saved = screen.getByRole("button", { name: "Saved — no changes yet" }) as HTMLButtonElement;
    expect(saved.disabled).toBe(true);
    await user.type(name, "X");
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("masked secret shows the Reveal affordance instead of the raw value", async () => {
    setup();
    /* The masked preview shows dots + the fetched value's last 4 chars. */
    expect(await screen.findByText("••••••••7890")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reveal value" })).toBeTruthy();
  });
});
