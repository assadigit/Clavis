/**
 * CLAVIS — modal focus-trap tests (UI-audit round 1, Phase 3; F-004).
 * Pins the contract: opening a dialog moves focus inside it, Tab and
 * Shift+Tab cycle within the dialog (never behind the scrim), and closing
 * it — by Esc — returns focus to the element that opened it.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Modal } from "./modal";

vi.mock("@wailsio/runtime", () => ({
  Call: { ByName: vi.fn(async () => ({})) },
  Events: { On: vi.fn(() => () => {}) },
}));

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" id="opener" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      {/* A focusable behind the scrim — the trap must never let Tab land here. */}
      <button type="button" id="behind" onClick={() => {}}>
        Behind the scrim
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Test dialog">
        <button type="button" id="first">
          First
        </button>
        <button type="button" id="second">
          Second
        </button>
      </Modal>
    </>
  );
}

function activeId(): string | null {
  return document.activeElement ? document.activeElement.id || null : null;
}

afterEach(() => {
  cleanup();
});

describe("Modal focus trap (F-004)", () => {
  it("focus starts inside the dialog when it opens", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Open dialog"));
    /* Focus must land inside the panel (on its first focusable). */
    const panel = screen.getByRole("dialog");
    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it("Tab cycles within the dialog — five Taps never leave it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Open dialog"));
    const panel = screen.getByRole("dialog");
    for (let i = 0; i < 5; i++) {
      await user.keyboard("{Tab}");
      expect(
        panel.contains(document.activeElement),
        `Tab #${i + 1} left the dialog (active id: ${activeId()})`
      ).toBe(true);
    }
  });

  it("Shift+Tab from the first control wraps to the last", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Open dialog"));
    /* Initial focus = first focusable; Shift+Tab must wrap to the last. */
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(activeId()).toBe("second");
  });

  it("Esc closes the dialog and focus returns to the opener", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Open dialog"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(activeId()).toBe("opener");
  });
});
