/**
 * CLAVIS — popup keyboard flow tests (SPEC §3.3b, §5.1, §5.2).
 *
 * The golden path: type letters → results rank → Enter dispatches the copy
 * (the backend writes the clipboard; the popup never sees the value) → the
 * popup hides. Plus: empty-results Enter creates, Esc hides, → drills into
 * a group and copies a member.
 *
 * The Wails runtime is mocked — these tests run in plain jsdom.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popup } from "./popup";
import type { ClavisState } from "@/lib/clavis/types";
import type { CallFn } from "@/lib/clavis/client";

vi.mock("@wailsio/runtime", () => ({
  Call: { ByName: vi.fn(async () => ({})) },
  Events: { On: vi.fn(() => () => {}) },
}));

// userEvent is pulled in via @testing-library/user-event; ensure it exists in
// devDependencies when CI installs.

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
        {
          id: "i2", name: "Grafana token", key: "", value: "", note: "",
          categoryId: "c1", tags: [], isSecret: true, pinned: false,
          useCount: 0, lastUsedAt: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
        },
      ],
      groups: [
        {
          id: "g1", name: "Acme API credentials", categoryId: "c1", tags: [],
          itemIds: ["i1", "i2"], pinned: false, useCount: 0, lastUsedAt: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
        },
      ],
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

function setup(overrides: Partial<Parameters<typeof Popup>[0]> = {}) {
  const call = vi.fn(async () => ({
    ok: true, status: 200, copied: true, lineCount: 1, containsSecret: true,
  })) as unknown as CallFn;
  const onHide = vi.fn();
  const onOpenManagerNewItem = vi.fn();
  const onOpenManager = vi.fn();
  const onReportSelection = vi.fn();
  const view = render(
    <Popup
      open
      onHide={onHide}
      state={state()}
      call={call}
      onOpenManagerNewItem={onOpenManagerNewItem}
      onOpenManager={onOpenManager}
      onReportSelection={onReportSelection}
      fill
      {...overrides}
    />,
  );
  const input = screen.getByLabelText("Search Clavis");
  return { call, onHide, onOpenManagerNewItem, onOpenManager, onReportSelection, input, container: view.container };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Popup golden path", () => {
  it("shows masked previews, never values", () => {
    setup();
    expect(screen.getByText("••••••••tOKn")).toBeTruthy();
  });

  it("Open Clavis is the primary CTA (v1.9.0: brand-blue button, not a ghost link)", () => {
    setup();
    const cta = screen.getByRole("button", { name: /Open Clavis/i });
    expect(cta.className).toContain("clavis-btn-primary");
    expect(cta.className).not.toContain("clavis-btn-ghost");
  });

  it("web edition: the panel floats at the vertical middle (v1.10.0: center + middle aligned, like the desktop)", () => {
    const { container } = setup({ fill: undefined });
    const holder = container.querySelector<HTMLElement>(".clavis-pop-in")?.parentElement;
    expect(holder).toBeTruthy();
    expect(holder?.style.top).toBe("50%");
    expect(holder?.style.transform).toBe("translateY(-50%)");
  });

  it("type letters → Enter dispatches the copy and hides the popup", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call, onHide } = setup();
    await user.type(screen.getByLabelText("Search Clavis"), "ghtk");
    await user.keyboard("{Enter}");
    expect(call).toHaveBeenCalledWith("copy", { kind: "item", id: "i1" });
    // auto-hide after the 500 ms feedback beat
    await vi.advanceTimersByTimeAsync(700);
    expect(onHide).toHaveBeenCalled();
  });

  it("Enter on an empty result set creates the item with the query prefilled", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onOpenManagerNewItem } = setup();
    await user.type(screen.getByLabelText("Search Clavis"), "zzzz");
    await user.keyboard("{Enter}");
    expect(onOpenManagerNewItem).toHaveBeenCalledWith("zzzz");
  });

  it("Esc hides the popup", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onHide } = setup();
    await user.type(screen.getByLabelText("Search Clavis"), "{Escape}");
    expect(onHide).toHaveBeenCalled();
  });

  it("→ drills into a group; Enter copies a member item; Backspace backs out", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call } = setup();
    await user.type(screen.getByLabelText("Search Clavis"), "acm"); // finds the group
    await user.keyboard("{ArrowRight}"); // drill in
    expect(screen.getByText("Acme API credentials")).toBeTruthy();
    await user.keyboard("{Enter}"); // copy the first member (GitHub token)
    expect(call).toHaveBeenCalledWith("copy", { kind: "item", id: "i1" });
  });

  it("Ctrl+Enter inside a group copies the whole group", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call } = setup();
    await user.type(screen.getByLabelText("Search Clavis"), "acm");
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(call).toHaveBeenCalledWith("copy", { kind: "group", id: "g1" });
  });
});

/* -------- v1.11.0 (DECISIONS.md §51): nested folder navigation -------- */

/** The user's exact tree: Prompts → Image generation → Artistic Picture
 *  Prompt, with "Prompts" the pinned folder that rides the default list. */
function folderState(): ClavisState {
  const s = state();
  s.data.categories.push(
    { id: "prompts", name: "Prompts", sortOrder: 1, pinned: true },
    { id: "imagegen", name: "Image generation", sortOrder: 2, parentId: "prompts" },
  );
  s.data.items.push({
    id: "i3", name: "Artistic seed", key: "", value: "", valueLast4: "",
    note: "", categoryId: "imagegen", tags: [], isSecret: false, pinned: false,
    useCount: 0, lastUsedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
  });
  s.data.groups.push({
    id: "gpp", name: "Artistic Picture Prompt", categoryId: "imagegen", tags: [],
    itemIds: ["i3"], pinned: false, useCount: 0, lastUsedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
  });
  return s;
}

describe("Popup nested folder navigation (v1.11.0 §51)", () => {
  it("a pinned folder rides the default list; unpinned folders don't", () => {
    setup({ state: folderState() });
    /* The pinned Prompts folder is on the home list (preview = its subtree
       count, "2 entries": the group + the standalone item inside). */
    expect(screen.getByText("Prompts")).toBeTruthy();
    expect(screen.getByText("2 entries")).toBeTruthy();
    /* The unpinned Credentials folder is NOT on the home list — its row
       would carry the "3 entries" preview (i1, i2 and the group). */
    expect(screen.queryByText("3 entries")).toBeNull();
  });

  it("typing finds unpinned folders by name, and → drills into them", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup({ state: folderState() });
    await user.type(screen.getByLabelText("Search Clavis"), "cred");
    /* The Credentials folder row appears in the search results. */
    expect(screen.getByText("3 entries")).toBeTruthy();
    await user.keyboard("{ArrowRight}");
    /* Drilled in: the back button and the folder view appear. */
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    await user.keyboard("{Backspace}");
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("the user's path: Prompts → Image generation → Artistic Picture Prompt → copy", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call } = setup({ state: folderState() });
    await user.type(screen.getByLabelText("Search Clavis"), "prom");
    /* Enter on a folder row drills (folders navigate, never copy). */
    await user.keyboard("{Enter}");
    expect(screen.getByText("Image generation")).toBeTruthy();
    /* Clicking a subfolder row drills too (the mouse path). */
    await user.click(screen.getByText("Image generation"));
    expect(screen.getByText("Artistic Picture Prompt")).toBeTruthy();
    /* → opens the group's member list (the classic §3.3b view). */
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("Artistic seed")).toBeTruthy();
    /* Enter copies the member item through the backend. */
    await user.keyboard("{Enter}");
    expect(call).toHaveBeenCalledWith("copy", { kind: "item", id: "i3" });
  });

  it("Backspace pops one level at a time, landing the selection on the row you left", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onHide } = setup({ state: folderState() });
    await user.type(screen.getByLabelText("Search Clavis"), "prom");
    await user.keyboard("{Enter}"); // inside Prompts
    await user.keyboard("{Enter}"); // inside Image generation
    /* Backspace (query empty) pops ONE level — back inside Prompts, with
       the selection landed on the row we left (the subfolder). */
    await user.keyboard("{Backspace}");
    const selRow = screen.getAllByRole("option").find((o) => o.getAttribute("aria-selected") === "true");
    expect(selRow?.textContent).toContain("Image generation");
    /* And again — back at the home list, landed on the Prompts row. */
    await user.keyboard("{Backspace}");
    const selRow2 = screen.getAllByRole("option").find((o) => o.getAttribute("aria-selected") === "true");
    expect(selRow2?.textContent).toContain("Prompts");
    /* Esc at the top level hides (Esc inside pops, as ever). */
    await user.keyboard("{Escape}");
    expect(onHide).toHaveBeenCalled();
  });

  it("the header shows the whole path, not just the leaf", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup({ state: folderState() });
    await user.type(screen.getByLabelText("Search Clavis"), "prom");
    await user.keyboard("{Enter}");
    await user.click(screen.getByText("Image generation"));
    await user.keyboard("{ArrowRight}");
    expect(
      screen.getByText("Prompts › Image generation › Artistic Picture Prompt"),
    ).toBeTruthy();
  });

  it("a folder selection reports null to Ctrl+E (folders have no editor)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onReportSelection } = setup({ state: folderState() });
    await user.type(screen.getByLabelText("Search Clavis"), "prom");
    await user.keyboard("{ArrowRight}");
    /* Inside Prompts the selected row is the SUBFOLDER — nothing Ctrl+E
       could open, so the selection reports null (v1.11.0 §51). */
    expect(onReportSelection).toHaveBeenLastCalledWith(null);
  });
});
