/**
 * CLAVIS — item editor smoke test (UI-audit round 1, Phase 1 safety net;
 * F-028). Pins today's behavior: fields render from the item, the value is
 * fetched once via "getValue", and the Save button appears only once the
 * form is dirty (F-020 pins this now; Phase 7 changes it deliberately).
 * Fake data only (FAKE-* values). Wails runtime mocked.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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

/* v1.12.0 (DECISIONS §53): the full-modal editor — the same editor in the
 * app's Modal shell, opened by the inline "Full editor" button. Fake data
 * only (FAKE-* values). */
function group(id: string, name: string): ClavisState["data"]["groups"][number] {
  return {
    id,
    name,
    categoryId: "c1",
    tags: [],
    itemIds: ["fake-item-1"],
    pinned: false,
    useCount: 0,
    lastUsedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    deletedAt: null,
  };
}

function setupModal(overrides?: {
  readOnly?: boolean;
  groupContextId?: string;
  state?: ClavisState;
}) {
  const st = overrides?.state ?? state();
  const onDone = vi.fn();
  const onSelectEntry = vi.fn();
  const deleteEntry = vi.fn();
  const onClose = vi.fn();
  const call = vi.fn(async (action: string) => {
    if (action === "getValue") {
      return { ok: true, status: 200, value: "FAKE-VALUE-1234567890" };
    }
    return { ok: true, status: 200 };
  }) as unknown as CallFn;
  render(
    <ItemEditor
      mode="edit"
      variant="modal"
      state={st}
      call={call}
      readOnly={overrides?.readOnly ?? false}
      item={st.data.items[0]}
      groupContextId={overrides?.groupContextId}
      onDone={onDone}
      onSelectEntry={onSelectEntry}
      deleteEntry={deleteEntry}
      onCancelCreate={vi.fn()}
      onClose={onClose}
    />,
  );
  return { call, onDone, onSelectEntry, deleteEntry, onClose };
}

describe("ItemEditor full-modal variant (v1.12.0)", () => {
  it("inline edit mode shows the Full editor button, and it fires the open callback", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onOpenFullEditor = vi.fn();
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
        item={state().data.items[0]}
        onOpenFullEditor={onOpenFullEditor}
        onDone={vi.fn()}
        onSelectEntry={vi.fn()}
        deleteEntry={vi.fn()}
        onCancelCreate={vi.fn()}
      />,
    );
    await screen.findByRole("heading", { name: "FAKE GitHub token" });
    /* Two launch affordances: the header's always-visible expand button
       (long values push the footer below the fold) and the footer's
       labeled button. */
    await user.click(screen.getByRole("button", { name: "Open the full editor" }));
    expect(onOpenFullEditor).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Full editor" }));
    expect(onOpenFullEditor).toHaveBeenCalledTimes(2);
  });

  it("renders the complete editor as a dialog — key field visible by default, name focused, value fetched", async () => {
    setupModal();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Edit item FAKE GitHub token");
    /* Advanced is expanded by default in the full editor (§53): the key
       field is visible without opening anything. */
    expect(await within(dialog).findByLabelText("Key — used as NAME=value when the group is copied")).toBeTruthy();
    const name = within(dialog).getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe("FAKE GitHub token");
    /* The full editor lands the focus on the first field, not the close
       button. */
    expect(document.activeElement).toBe(name);
    expect(within(dialog).getByText(/Secret · used 3×/)).toBeTruthy();
  });

  it("saving inside the modal calls updateItem with the patch and keeps the modal open", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call, onClose } = setupModal();
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText("Name");
    await user.type(name, "X");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("updateItem", {
        id: "fake-item-1",
        patch: expect.objectContaining({ name: "FAKE GitHub tokenX" }),
      }),
    );
    expect(onClose).not.toHaveBeenCalled();
    /* The dialog is still there after the save. */
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("closing with a dirty draft asks first — Keep editing stays, Discard closes", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = setupModal();
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "X");
    await user.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    /* The dirty-close guard appears on top of the editor. */
    const guard = await screen.findByRole("dialog", { name: "Discard changes?" });
    await user.click(within(guard).getByRole("button", { name: "Keep editing" }));
    expect(onClose).not.toHaveBeenCalled();
    /* Close again, discard this time. */
    await user.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    const guard2 = await screen.findByRole("dialog", { name: "Discard changes?" });
    await user.click(within(guard2).getByRole("button", { name: "Discard changes" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a clean draft closes directly — no guard", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = setupModal();
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).toBeNull();
  });

  it("a shared item (2 groups) saved from the modal still routes through the SPEC 5.6 choices", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const shared = state();
    shared.data.groups = [group("fake-group-1", "FAKE Alpha project"), group("fake-group-2", "FAKE Beta project")];
    const { call } = setupModal({ state: shared, groupContextId: "fake-group-1" });
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "X");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    /* The shared-item modal appears on top of the full editor. */
    const sharedModal = await screen.findByRole("dialog", { name: "This item is used in 2 groups" });
    expect(within(sharedModal).getByText("FAKE Alpha project")).toBeTruthy();
    expect(within(sharedModal).getByText("FAKE Beta project")).toBeTruthy();
    await user.click(within(sharedModal).getByRole("button", { name: "Update everywhere (2 groups)" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("updateItem", {
        id: "fake-item-1",
        patch: expect.objectContaining({ name: "FAKE GitHub tokenX" }),
      }),
    );
  });

  it("read-only: fields disabled and closing needs no guard", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = setupModal({ readOnly: true });
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText("Name") as HTMLInputElement;
    expect(name.disabled).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
