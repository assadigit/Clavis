/**
 * CLAVIS — popup first-load failure tests (the blank-popup debt).
 *
 * The popup's very first data load used to run exactly once at mount: when
 * it failed, the window stayed blank until an app restart. These tests pin
 * the recovery contract — a retry panel instead of blank, Retry recovers
 * into the palette, and every later show retries silently while data is
 * still missing.
 *
 * v1.3.2 cross-window sync regression tests: the Manager is a separate
 * webview, and the popup snapshot used to be load-once — credentials
 * deleted in the Manager kept appearing in the popup's "Recent" and
 * "Pinned & frequent" sections until an app restart. The snapshot now
 * re-fetches on every show and on the clavis:data-changed broadcast.
 *
 * The Wails runtime is mocked — these tests run in plain jsdom.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Call, Events } from "@wailsio/runtime";
import { PopupRoot } from "./popup-root";
import { LoadErrorPanel } from "./ui-bits";
import type { ClavisState } from "@/lib/clavis/types";

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
          id: "i1", name: "GitHub token", key: "GITHUB_TOKEN", value: "",
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
    dataDir: "C:\\ somewhere",
    appVersion: "test",
    osTransparency: true,
  };
}

function setVisibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.mocked(Call.ByName).mockReset();
});

afterEach(() => {
  cleanup();
  // jsdom starts "visible"; restore after any hidden-show simulation.
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

describe("Popup first-load failure", () => {
  it("shows a retry panel instead of a blank window", async () => {
    vi.mocked(Call.ByName).mockRejectedValue(new Error("boom"));
    render(<PopupRoot />);
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry loading your data" })).toBeTruthy();
  });

  it("Retry recovers into the palette when the load succeeds", async () => {
    vi.mocked(Call.ByName)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(state() as never);
    const user = userEvent.setup();
    render(<PopupRoot />);
    const retry = await screen.findByRole("button", { name: "Retry loading your data" });
    await user.click(retry);
    expect(await screen.findByLabelText("Search Clavis")).toBeTruthy();
  });

  it("a later show retries silently while data is still missing", async () => {
    vi.mocked(Call.ByName).mockRejectedValue(new Error("boom"));
    render(<PopupRoot />);
    await screen.findByRole("alertdialog");
    const initialCalls = vi.mocked(Call.ByName).mock.calls.length;

    setVisibility("hidden"); // window hidden (open=false)
    await act(async () => {}); // let the open=false render land
    setVisibility("visible"); // shown again — must retry without a click
    await act(async () => {}); // open=true render → the auto-retry effect
    await waitFor(() => {
      expect(vi.mocked(Call.ByName).mock.calls.length).toBeGreaterThan(initialCalls);
    });
    // The retry failed too — the panel stays (no blank window).
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
  });
});

/* The latest callback registered for an event name (the Wails Events.On
   mock records every registration). */
function eventCallback(name: string): () => void {
  const calls = vi.mocked(Events.On).mock.calls as unknown as [string, () => void][];
  const last = calls.filter(([n]) => n === name).pop();
  if (!last) throw new Error(`no ${name} listener registered`);
  return last[1];
}

describe("Popup cross-window sync (v1.3.2)", () => {
  it("an entry deleted in the Manager disappears when the popup is shown again", async () => {
    /* The reported bug: delete credentials in the Manager, open the popup
       with the hotkey — they still sat under "Recent" / "Pinned & frequent"
       because the popup's snapshot was loaded once at window mount. */
    const live = state();
    const afterDelete = state();
    afterDelete.data.items[0].deletedAt = "2025-01-03T00:00:00.000Z";
    vi.mocked(Call.ByName)
      .mockResolvedValueOnce(live as never) // initial (mount) load
      .mockResolvedValue(afterDelete as never); // every fetch after the delete

    render(<PopupRoot />);
    // The used entry shows under "Recent" on the first open.
    expect(await screen.findByText("GitHub token")).toBeTruthy();
    expect(screen.getByText("Recent")).toBeTruthy();

    // Popup hidden (the user deletes the entry in the Manager window)…
    setVisibility("hidden");
    await act(async () => {});
    // …and shown again by the hotkey: the snapshot must re-fetch.
    setVisibility("visible");
    await act(async () => {});
    await waitFor(() => {
      expect(screen.queryByText("GitHub token")).toBeNull();
    });
  });

  it("re-fetches on the clavis:data-changed broadcast (delete while the popup is open)", async () => {
    const live = state();
    const afterDelete = state();
    afterDelete.data.items[0].deletedAt = "2025-01-03T00:00:00.000Z";
    vi.mocked(Call.ByName)
      .mockResolvedValueOnce(live as never)
      .mockResolvedValue(afterDelete as never);

    render(<PopupRoot />);
    expect(await screen.findByText("GitHub token")).toBeTruthy();

    // The Manager deletes the entry; Go broadcasts clavis:data-changed.
    await act(async () => {
      eventCallback("clavis:data-changed")();
    });
    await waitFor(() => {
      expect(screen.queryByText("GitHub token")).toBeNull();
    });
  });

  it("a failed copy re-syncs the snapshot (fast Enter on a since-deleted row)", async () => {
    const live = state();
    vi.mocked(Call.ByName)
      .mockResolvedValueOnce(live as never) // initial load
      .mockResolvedValueOnce({ ok: false, status: 400, error: "Item not found." }) // the copy
      .mockResolvedValue(state() as never); // the re-sync fetch

    render(<PopupRoot />);
    expect(await screen.findByText("GitHub token")).toBeTruthy();

    // Enter on the selected row → copy fails (entry was deleted in the
    // Manager a moment ago) → the wrapper must re-fetch, not keep the
    // dead row for the next keystroke.
    await act(async () => {
      const input = screen.getByLabelText("Search Clavis");
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
      );
    });
    await waitFor(() => {
      const calls = vi.mocked(Call.ByName).mock.calls;
      // Initial GetState + the Dispatch + the re-sync GetState.
      expect(calls.length).toBeGreaterThanOrEqual(3);
    });
  });
});

describe("Manager load-failure variant (F-001, Phase 2)", () => {
  it("the shared panel offers Try again and fires the retry callback", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <LoadErrorPanel
        title="Clavis could not load your data"
        body="The data folder could not be read. Check that it still exists and that Clavis can open it — then try again."
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("Clavis could not load your data")).toBeTruthy();
    const retry = screen.getByRole("button", { name: "Retry loading your data" });
    expect(retry.textContent).toContain("Try again");
    await user.click(retry);
    expect(onRetry).toHaveBeenCalled();
  });

  it("the panel itself binds no Esc handler — the caller owns Esc", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onHide = vi.fn();
    render(
      <>
        <LoadErrorPanel title="Clavis could not load your data" body="…" onRetry={onRetry} />
        <span onKeyDown={onHide} tabIndex={0}>
          focusable
        </span>
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Retry loading your data" }));
    await user.keyboard("{Escape}");
    /* No window-level Esc handler inside LoadErrorPanel: nothing hides. */
    expect(onHide).not.toHaveBeenCalled();
  });
});
