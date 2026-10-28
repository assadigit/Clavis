/**
 * CLAVIS — sidebar hierarchy tests (v1.4.0, DECISIONS.md §41): the category
 * tree renders nested, collapses via the chevron, filters on click, and the
 * per-category menu creates subcategories / deletes with the lift-up hint.
 * Fake data only (FAKE-* values). Wails runtime mocked.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "./sidebar";
import type { ClavisState } from "@/lib/clavis/types";
import type { CallFn } from "@/lib/clavis/client";
import type { ListFilter } from "./app-types";

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
      categories: [
        { id: "c1", name: "Credentials", sortOrder: 0 },
        { id: "p", name: "Projects", sortOrder: 1 },
        { id: "h", name: "Hibana", sortOrder: 2, parentId: "p" },
        { id: "y", name: "Younblock", sortOrder: 3, parentId: "p" },
      ],
      items: [
        {
          id: "fake-item-1", name: "FAKE GitHub token", key: "GITHUB_TOKEN", value: "",
          valueLast4: "tOKn", note: "", categoryId: "c1", tags: [],
          isSecret: true, pinned: false, useCount: 3,
          lastUsedAt: "2025-01-02T00:00:00.000Z",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
        },
        {
          id: "fake-item-2", name: "FAKE Hibana key", key: "", value: "",
          valueLast4: "", note: "", categoryId: "h", tags: [],
          isSecret: true, pinned: false, useCount: 0, lastUsedAt: null,
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

function setup(filter: ListFilter = { view: "all" }) {
  const call = vi.fn(async (action: string) => {
    if (action === "createCategory") return { ok: true, status: 200, id: "new-cat" };
    return { ok: true, status: 200 };
  }) as unknown as CallFn;
  const setFilter = vi.fn();
  render(
    <Sidebar state={state()} call={call} readOnly={false} filter={filter} setFilter={setFilter} />,
  );
  return { call, setFilter };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Sidebar category tree", () => {
  it("renders subcategories under their parent, with a disclosure chevron on parents only", () => {
    setup();
    expect(screen.getByText("Projects")).toBeTruthy();
    expect(screen.getByText("Hibana")).toBeTruthy();
    expect(screen.getByText("Younblock")).toBeTruthy();
    /* The parent carries the chevron; leaves carry none. */
    expect(screen.getByRole("button", { name: "Collapse Projects" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Collapse Hibana" })).toBeNull();
  });

  it("shows subtree counts on parents (own + descendants)", () => {
    setup();
    /* Projects itself has no direct entries; Hibana's one entry must roll up. */
    const row = screen.getByText("Projects").closest("button");
    expect(row?.textContent).toContain("1");
    const leaf = screen.getByText("Hibana").closest("button");
    expect(leaf?.textContent).toContain("1");
  });

  it("collapses and expands via the chevron", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup();
    const chevron = screen.getByRole("button", { name: "Collapse Projects" });
    await user.click(chevron);
    expect(screen.queryByText("Hibana")).toBeNull();
    expect(screen.queryByText("Younblock")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand Projects" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Expand Projects" }));
    expect(screen.getByText("Hibana")).toBeTruthy();
  });

  it("clicking a subcategory filters the list by it", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { setFilter } = setup();
    await user.click(screen.getByText("Hibana"));
    expect(setFilter).toHaveBeenCalledWith({ view: "category", categoryId: "h" });
  });

  it("New subcategory creates inside the parent (createCategory with parentId)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call } = setup();
    await user.click(screen.getByTitle("Category options for Projects"));
    await user.click(screen.getByText("New subcategory"));
    expect(screen.getByText("Inside “Projects”")).toBeTruthy();
    await user.type(screen.getByLabelText("Category name"), "Clavis");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(call).toHaveBeenCalledWith("createCategory", { name: "Clavis", parentId: "p" });
  });

  it("the plain + button creates a top-level category (parentId null)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call } = setup();
    await user.click(screen.getByRole("button", { name: "Add category" }));
    await user.type(screen.getByLabelText("Category name"), "Servers");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(call).toHaveBeenCalledWith("createCategory", { name: "Servers", parentId: null });
  });

  it("delete on a parent warns that subcategories move up, then calls deleteCategory", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call } = setup();
    await user.click(screen.getByTitle("Category options for Projects"));
    expect(
      screen.getByText("Subcategories move up one level; entries stay, uncategorized."),
    ).toBeTruthy();
    await user.click(screen.getByText("Delete"));
    expect(call).toHaveBeenCalledWith("deleteCategory", { id: "p" });
  });
});
