/**
 * CLAVIS — group editor smoke test (UI-audit round 1, Phase 1 safety net;
 * F-028). Pins today's behavior: member rows render in the well, and the
 * "More actions" → "Export Markdown" item calls downloadExport("group-md",
 * id). Fake data only (FAKE-* values). Wails runtime + downloadExport
 * mocked.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GroupEditor } from "./group-editor";
import { downloadExport } from "@/lib/clavis/client";
import type { ClavisState, Group } from "@/lib/clavis/types";
import type { CallFn } from "@/lib/clavis/client";

vi.mock("@wailsio/runtime", () => ({
  Call: { ByName: vi.fn(async () => ({})) },
  Events: { On: vi.fn(() => () => {}) },
}));

vi.mock("@/lib/clavis/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clavis/client")>();
  return { ...actual, downloadExport: vi.fn(async () => {}) };
});

function group(): Group {
  return {
    id: "fake-group-1",
    name: "FAKE Deploy set",
    categoryId: "c1",
    tags: ["deploy"],
    itemIds: ["fake-item-1", "fake-item-2"],
    pinned: false,
    useCount: 2,
    lastUsedAt: null,
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
      items: [
        {
          id: "fake-item-1", name: "FAKE GitHub token", key: "GITHUB_TOKEN", value: "",
          valueLast4: "tOKn", note: "", categoryId: "c1", tags: ["github"],
          isSecret: true, pinned: false, useCount: 3,
          lastUsedAt: "2025-01-02T00:00:00.000Z",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
        },
        {
          id: "fake-item-2", name: "FAKE Grafana token", key: "", value: "",
          valueLast4: "", note: "", categoryId: "c1", tags: [],
          isSecret: true, pinned: false, useCount: 0, lastUsedAt: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z", deletedAt: null,
        },
      ],
      groups: [group()],
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
  const call = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as CallFn;
  render(
    <GroupEditor
      mode="edit"
      state={state()}
      call={call}
      readOnly={false}
      group={group()}
      onDone={vi.fn()}
      onSelectEntry={vi.fn()}
      deleteEntry={vi.fn()}
      onManageItems={vi.fn()}
      onCancelCreate={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(downloadExport).mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("GroupEditor smoke", () => {
  it("renders the group with its member rows", () => {
    setup();
    expect(screen.getByRole("heading", { name: "FAKE Deploy set" })).toBeTruthy();
    expect(screen.getByText("FAKE GitHub token")).toBeTruthy();
    expect(screen.getByText("FAKE Grafana token")).toBeTruthy();
    expect(screen.getByText(/2 items · used 2× · updated/)).toBeTruthy();
    /* v1.5.0 (§40): every member row is editable by its accessible name and
       carries its own Copy / Reveal / Delete actions as sibling buttons. */
    expect(
      screen.getByRole("button", { name: "Edit FAKE GitHub token (secret)" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Edit FAKE Grafana token (secret)" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy FAKE GitHub token" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy FAKE Grafana token" })).toBeTruthy();
  });

  it("Export Markdown in the More actions menu calls downloadExport", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup();
    await user.click(screen.getByTitle("More actions"));
    await user.click(screen.getByRole("menuitem", { name: "Export Markdown" }));
    expect(downloadExport).toHaveBeenCalledWith("group-md", "fake-group-1");
  });

  /* v1.13.0 (DECISIONS §55): the member row's expand button pops the item
     into the full-modal editor WITH the group's context (SPEC §5.6). */
  it("the member row's full-editor button calls onOpenFullEditor with the group context", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onOpenFullEditor = vi.fn();
    const call = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as CallFn;
    cleanup();
    render(
      <GroupEditor
        mode="edit"
        state={state()}
        call={call}
        readOnly={false}
        group={group()}
        onDone={vi.fn()}
        onSelectEntry={vi.fn()}
        deleteEntry={vi.fn()}
        onManageItems={vi.fn()}
        onOpenFullEditor={onOpenFullEditor}
        onCancelCreate={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open FAKE GitHub token in the full editor" }));
    expect(onOpenFullEditor).toHaveBeenCalledWith({
      kind: "item",
      id: "fake-item-1",
      groupContextId: "fake-group-1",
    });
  });

  it("Export JSON (backup-safe) sits after the markdown copy and calls downloadExport with group-json (Phase 4)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup();
    await user.click(screen.getByTitle("More actions"));
    const items = screen.getAllByRole("menuitem");
    /* v1.5.0 (§40): "Copy all as markdown" leads the menu; the lossless
       JSON export follows it. */
    expect(items[0].textContent).toContain("Copy all as markdown");
    expect(items[1].textContent).toContain("Export JSON (backup-safe)");
    /* F-003: the plaintext warning is visible inside the menu. */
    expect(items[1].textContent).toContain("Contains your real value in plain text.");
    await user.click(items[1]);
    expect(downloadExport).toHaveBeenCalledWith("group-json", "fake-group-1");
  });
});

/* -------- v1.6.0 (DECISIONS §45): tolerant paste in create mode -------- */

describe("GroupEditor tolerant paste (v1.6.0)", () => {
  function setupCreate() {
    const call = vi.fn(async (action: string, _payload?: { input?: { text?: string } }) => {
      if (action === "createGroupFromEnv") return { ok: true, status: 200, id: "fake-new-group" };
      return { ok: true, status: 200 };
    }) as unknown as CallFn;
    render(
      <GroupEditor
        mode="create"
        state={state()}
        call={call}
        readOnly={false}
        onDone={vi.fn()}
        onSelectEntry={vi.fn()}
        deleteEntry={vi.fn()}
        onCancelCreate={vi.fn()}
      />,
    );
    return { call };
  }

  it("colon-style pastes preview their keys and save through createGroupFromEnv (the empty-group bug)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call } = setupCreate();
    /* A paste that the old strict KEY=value parser rejected outright. */
    await user.type(screen.getByLabelText(/Paste your credentials/i), "GitHub token: ghp_abc\nOpenAI key: sk-xyz");
    /* Live preview recognizes both credentials (name → autoKey). */
    expect(await screen.findByText("2 credentials:")).toBeTruthy();
    expect(screen.getByText("GITHUB_TOKEN")).toBeTruthy();
    expect(screen.getByText("OPENAI_KEY")).toBeTruthy();
    /* Name + Save → createGroupFromEnv carries the pasted text. */
    await user.type(screen.getByLabelText("Name", { selector: "input" }), "FAKE Project");
    await user.click(screen.getByRole("button", { name: /Create group \+ 2 credentials/i }));
    const createCall = vi.mocked(call).mock.calls.find(([a]) => a === "createGroupFromEnv");
    expect(createCall).toBeTruthy();
    expect((createCall?.[1] as { input: { text: string } }).input.text).toContain("ghp_abc");
  });

  it("blocks saving when pasted text has no parsable credentials (no silent empty group)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call } = setupCreate();
    await user.type(screen.getByLabelText(/Paste your credentials/i), "just prose with no separator");
    expect(await screen.findByText(/No credentials recognized yet/i)).toBeTruthy();
    await user.type(screen.getByLabelText("Name", { selector: "input" }), "FAKE Oops");
    await user.click(screen.getByRole("button", { name: "Create group" }));
    /* The unparsable paste must NOT be discarded into an empty group. */
    expect(vi.mocked(call).mock.calls.find(([a]) => a === "createGroupFromEnv")).toBeUndefined();
    expect(vi.mocked(call).mock.calls.find(([a]) => a === "createGroup")).toBeUndefined();
  });
});

/* ---- v1.14.0 (DECISIONS §56): the document panel's Full editor button ---- */

describe("GroupEditor document panel — Full editor hand-off", () => {
  function docGroup(): Group {
    return {
      id: "fake-doc-group-1",
      name: "FAKE Credentials file",
      categoryId: null,
      tags: [],
      itemIds: [],
      mode: "document",
      isSecret: true,
      docChars: 57,
      docLines: 3,
      pinned: false,
      useCount: 5,
      lastUsedAt: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      deletedAt: null,
    };
  }

  function setupDoc() {
    const call = vi.fn(async (action: string) => {
      if (action === "getGroupDocument") {
        return { ok: true, status: 200, document: "FAKE doc line 1\nFAKE doc line 2" };
      }
      return { ok: true, status: 200 };
    }) as unknown as CallFn;
    const onOpenDocumentEditor = vi.fn();
    const base = state();
    base.data.groups = [docGroup()];
    render(
      <GroupEditor
        mode="edit"
        state={base}
        call={call}
        readOnly={false}
        group={docGroup()}
        onDone={vi.fn()}
        onSelectEntry={vi.fn()}
        deleteEntry={vi.fn()}
        onManageItems={vi.fn()}
        onOpenDocumentEditor={onOpenDocumentEditor}
        onCancelCreate={vi.fn()}
      />,
    );
    return { call, onOpenDocumentEditor };
  }

  it("carries the inline draft (unsaved edits included) up with the group id and closes the inline session", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onOpenDocumentEditor } = setupDoc();
    /* Start the inline editor (the pencil on the stats row). */
    await user.click(screen.getByRole("button", { name: "Replace the stored document" }));
    const inline = await screen.findByLabelText("Document content — paste the whole file here");
    expect((inline as HTMLTextAreaElement).value).toContain("FAKE doc line 1");
    /* An unsaved inline edit must survive the move into the full editor. */
    await user.type(inline, " + edited inline");
    await user.click(screen.getByRole("button", { name: "Open the full document editor" }));
    expect(onOpenDocumentEditor).toHaveBeenCalledTimes(1);
    const [groupId, carried] = vi.mocked(onOpenDocumentEditor).mock.calls[0];
    expect(groupId).toBe("fake-doc-group-1");
    expect(carried).toContain(" + edited inline");
    /* The inline editing session is closed: its editor and the launch
       button are gone; the pencil is back. */
    expect(screen.queryByLabelText("Document content — paste the whole file here")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open the full document editor" })).toBeNull();
    expect(screen.getByRole("button", { name: "Replace the stored document" })).toBeTruthy();
  });

  it("renders no Full editor button when the handler is not wired", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const base = state();
    base.data.groups = [docGroup()];
    const call = vi.fn(async (action: string) => {
      if (action === "getGroupDocument") {
        return { ok: true, status: 200, document: "FAKE doc" };
      }
      return { ok: true, status: 200 };
    }) as unknown as CallFn;
    render(
      <GroupEditor
        mode="edit"
        state={base}
        call={call}
        readOnly={false}
        group={docGroup()}
        onDone={vi.fn()}
        onSelectEntry={vi.fn()}
        deleteEntry={vi.fn()}
        onManageItems={vi.fn()}
        onCancelCreate={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Replace the stored document" }));
    await screen.findByLabelText("Document content — paste the whole file here");
    expect(screen.queryByRole("button", { name: "Open the full document editor" })).toBeNull();
  });
});

/* ---- v1.15.0 (DECISIONS §57): the inline document editor is dual-mode ---- */

describe("GroupEditor document panel — dual mode", () => {
  function richDocGroup(): Group {
    return {
      id: "fake-doc-group-2",
      name: "FAKE Launch brief",
      categoryId: null,
      tags: [],
      itemIds: [],
      mode: "document",
      isSecret: false,
      docChars: 40,
      docLines: 3,
      docRich: true,
      pinned: true,
      useCount: 2,
      lastUsedAt: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      deletedAt: null,
    };
  }

  function setupRichDoc() {
    const call = vi.fn(async (action: string) => {
      if (action === "getGroupDocument") {
        return {
          ok: true,
          status: 200,
          document: "<!--clavis-rich--><div><b>FAKE</b> launch brief 🚀</div><div>line two</div>",
        };
      }
      return { ok: true, status: 200 };
    }) as unknown as CallFn;
    const onOpenDocumentEditor = vi.fn();
    const base = state();
    base.data.groups = [richDocGroup()];
    render(
      <GroupEditor
        mode="edit"
        state={base}
        call={call}
        readOnly={false}
        group={richDocGroup()}
        onDone={vi.fn()}
        onSelectEntry={vi.fn()}
        deleteEntry={vi.fn()}
        onManageItems={vi.fn()}
        onOpenDocumentEditor={onOpenDocumentEditor}
        onCancelCreate={vi.fn()}
      />,
    );
    return { call, onOpenDocumentEditor };
  }

  /** A PLAIN document group (same shape as the hand-off suite's setupDoc). */
  function setupPlainDoc() {
    const call = vi.fn(async (action: string) => {
      if (action === "getGroupDocument") {
        return { ok: true, status: 200, document: "FAKE doc line 1\nFAKE doc line 2" };
      }
      return { ok: true, status: 200 };
    }) as unknown as CallFn;
    const onOpenDocumentEditor = vi.fn();
    const base = state();
    base.data.groups = [
      {
        ...richDocGroup(),
        id: "fake-doc-group-1",
        name: "FAKE Credentials file",
        isSecret: true,
        docRich: undefined,
        pinned: false,
      },
    ];
    render(
      <GroupEditor
        mode="edit"
        state={base}
        call={call}
        readOnly={false}
        group={base.data.groups[0]}
        onDone={vi.fn()}
        onSelectEntry={vi.fn()}
        deleteEntry={vi.fn()}
        onManageItems={vi.fn()}
        onOpenDocumentEditor={onOpenDocumentEditor}
        onCancelCreate={vi.fn()}
      />,
    );
    return { call, onOpenDocumentEditor };
  }

  it("shows the rich hint for a rich document and opens the inline editor in rich mode", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setupRichDoc();
    expect(screen.getByText(/Rich text — formatting is kept in Clavis/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Replace the stored document" }));
    const ed = await screen.findByRole("textbox", { name: "Document content" });
    expect(ed.textContent).toContain("FAKE launch brief 🚀");
    expect(screen.getByRole("button", { name: "Bold" })).toBeTruthy();
  });

  it("flips a plain inline draft to rich and carries the mode up to the full editor", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onOpenDocumentEditor } = setupPlainDoc();
    await user.click(screen.getByRole("button", { name: "Replace the stored document" }));
    await screen.findByLabelText("Document content — paste the whole file here");
    /* The stored FAKE doc is plain: flip it to rich — the words become one
       div per line, toolbar appears. */
    await user.click(screen.getByRole("radio", { name: "Rich text" }));
    const ed = await screen.findByRole("textbox", { name: "Document content" });
    expect(ed.innerHTML).toBe("<div>FAKE doc line 1</div><div>FAKE doc line 2</div>");
    /* The carry up to the full editor keeps the mode: the sentinel rides
       inside the draft string itself. */
    await user.click(screen.getByRole("button", { name: "Open the full document editor" }));
    expect(onOpenDocumentEditor).toHaveBeenCalledTimes(1);
    const [, carried] = vi.mocked(onOpenDocumentEditor).mock.calls[0];
    expect(String(carried).startsWith("<!--clavis-rich-->")).toBe(true);
  });

  it("saves an inline rich draft under the sentinel through setGroupDocument", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call } = setupRichDoc();
    await user.click(screen.getByRole("button", { name: "Replace the stored document" }));
    const ed = await screen.findByRole("textbox", { name: "Document content" });
    ed.innerHTML = "<div><b>FAKE</b> edited inline ✅</div>";
    fireEvent.input(ed);
    await user.click(screen.getByRole("button", { name: "Save document" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("setGroupDocument", {
        id: "fake-doc-group-2",
        document: "<!--clavis-rich--><div><b>FAKE</b> edited inline ✅</div>",
      }),
    );
  });
});
