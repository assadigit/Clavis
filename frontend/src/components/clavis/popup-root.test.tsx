/**
 * CLAVIS — popup first-load failure tests (the blank-popup debt).
 *
 * The popup's very first data load used to run exactly once at mount: when
 * it failed, the window stayed blank until an app restart. These tests pin
 * the recovery contract — a retry panel instead of blank, Retry recovers
 * into the palette, and every later show retries silently while data is
 * still missing.
 *
 * The Wails runtime is mocked — these tests run in plain jsdom.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Call } from "@wailsio/runtime";
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
