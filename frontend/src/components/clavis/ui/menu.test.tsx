/**
 * CLAVIS — Menu portal tests (v1.16.0, DECISIONS §58). Pins the overlay
 * contract that replaced the in-flow absolute panel: the open menu lives
 * in a fixed-position portal on document.body (never inside the editor
 * scroll containers, so it can never grow their overflow — the owner's
 * "more scroll and dead space" bug), it flips above the trigger when the
 * space below is short, clicks on its items are real clicks, and any
 * scroll closes it before it can detach from its anchor.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Menu, MenuItem } from "./menu";

function Harness() {
  return (
    <Menu triggerTitle="More actions" align="end">
      <MenuItem label="First action" onClick={() => {}} />
      <MenuItem label="Danger action" danger onClick={() => {}} />
    </Menu>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Menu (v1.16.0 portal)", () => {
  it("renders the open menu as a fixed panel on document.body and fires item clicks", async () => {
    const user = userEvent.setup();
    const onFirst = vi.fn();
    render(
      <Menu triggerTitle="More actions" align="end">
        <MenuItem label="First action" onClick={onFirst} />
      </Menu>,
    );
    await user.click(screen.getByTitle("More actions"));
    const menu = screen.getByRole("menu");
    /* The panel must NOT live inside the trigger's layout — it is a
       direct child of body, position fixed, above the modal layer. */
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.position).toBe("fixed");
    expect(menu.style.zIndex).toBe("100");
    /* Clicking an item is a real click: it fires AND closes. */
    await user.click(screen.getByRole("menuitem", { name: "First action" }));
    expect(onFirst).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("flips above the trigger when the space below is short (the editor-footer case)", async () => {
    const user = userEvent.setup();
    /* jsdom has no layout: stub the trigger's rect near the viewport
       bottom (768 default height) — below does not fit, above does. */
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 724,
      bottom: 764,
      left: 900,
      right: 940,
      width: 40,
      height: 40,
      x: 900,
      y: 724,
      toJSON: () => ({}),
    } as DOMRect);
    render(
      <Menu triggerTitle="More actions" align="end">
        <MenuItem label="Any action" onClick={() => {}} />
      </Menu>,
    );
    await user.click(screen.getByTitle("More actions"));
    const menu = screen.getByRole("menu");
    /* Measured panel height is 0 in jsdom, so the flip math is
       anchor.top - 8 = 716 — above the trigger (724), not below (772). */
    expect(menu.style.top).toBe("716px");
    expect(Number(menu.style.top.replace("px", ""))).toBeLessThan(724);
  });

  it("closes on an outside pointer-down and on any scroll (a fixed panel must never detach)", async () => {
    const user = userEvent.setup();
    const outside = document.createElement("button");
    outside.type = "button";
    outside.textContent = "Elsewhere";
    document.body.appendChild(outside);
    try {
      render(
        <Menu triggerTitle="More actions" align="end">
          <MenuItem label="Any action" onClick={() => {}} />
        </Menu>,
      );
      await user.click(screen.getByTitle("More actions"));
      expect(screen.getByRole("menu")).toBeTruthy();

      /* Scroll under an open fixed panel closes it (capture listener —
         scroll does not bubble, but the capture phase still reaches
         document from any scroller). The dispatch is act-wrapped: the
         listener's setState must flush before the assertion. */
      const scroller = document.createElement("div");
      document.body.appendChild(scroller);
      act(() => {
        scroller.dispatchEvent(new Event("scroll"));
      });
      expect(screen.queryByRole("menu")).toBeNull();

      /* Re-open: a pointer-down outside closes it. */
      await user.click(screen.getByTitle("More actions"));
      expect(screen.getByRole("menu")).toBeTruthy();
      await user.click(outside);
      expect(screen.queryByRole("menu")).toBeNull();
    } finally {
      outside.remove();
    }
  });

  it("keeps the closed Menu trigger in the layout (portal only when open)", () => {
    render(<Harness />);
    expect(screen.getByTitle("More actions")).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
