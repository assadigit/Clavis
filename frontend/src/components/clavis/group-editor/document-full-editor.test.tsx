/**
 * CLAVIS — the whole-document group's full-modal editor test (v1.14.0,
 * DECISIONS §56). Pins: it fetches the stored document when opened without a
 * carried draft, seeds from the carried inline draft without fetching, saves
 * byte-exact through setGroupDocument and closes, refuses an empty draft, and
 * the dirty-close guard asks before discarding. Fake data only (FAKE-*).
 * Wails runtime mocked.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentFullEditor } from "./document-full-editor";
import type { Group } from "@/lib/clavis/types";
import type { CallFn } from "@/lib/clavis/client";

vi.mock("@wailsio/runtime", () => ({
  Call: { ByName: vi.fn(async () => ({})) },
  Events: { On: vi.fn(() => () => {}) },
}));

const FAKE_DOC = "FAKE doc line 1\nFAKE doc line 2\nFAKE doc line 3";

function docGroup(): Group {
  return {
    id: "fake-doc-group-1",
    name: "FAKE Credentials file",
    categoryId: null,
    tags: [],
    itemIds: [],
    mode: "document",
    isSecret: true,
    docChars: [...FAKE_DOC].length,
    docLines: 3,
    pinned: false,
    useCount: 5,
    lastUsedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    deletedAt: null,
  };
}

function setup(initialText: string | null) {
  const call = vi.fn(async (action: string) => {
    if (action === "getGroupDocument") {
      return { ok: true, status: 200, document: FAKE_DOC };
    }
    return { ok: true, status: 200 };
  }) as unknown as CallFn;
  const onClose = vi.fn();
  render(
    <DocumentFullEditor
      group={docGroup()}
      call={call}
      readOnly={false}
      initialText={initialText}
      onClose={onClose}
    />,
  );
  return { call, onClose };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DocumentFullEditor", () => {
  it("opens as a dialog and fetches the stored document when no draft is carried", async () => {
    const { call } = setup(null);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Edit document FAKE Credentials file");
    const editor = await within(dialog).findByLabelText(
      "Document content — paste the whole file here",
    );
    expect((editor as HTMLTextAreaElement).value).toBe(FAKE_DOC);
    expect(call).toHaveBeenCalledWith("getGroupDocument", { id: "fake-doc-group-1" });
  });

  it("seeds from the carried inline draft without fetching", async () => {
    const { call } = setup("FAKE carried inline draft");
    const editor = await screen.findByLabelText("Document content — paste the whole file here");
    expect((editor as HTMLTextAreaElement).value).toBe("FAKE carried inline draft");
    expect(call).not.toHaveBeenCalledWith("getGroupDocument", expect.anything());
  });

  it("saves the draft byte-exact through setGroupDocument and closes", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call, onClose } = setup("FAKE doc");
    const editor = await screen.findByLabelText("Document content — paste the whole file here");
    await user.type(editor, " + more");
    await user.click(screen.getByRole("button", { name: "Save document" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("setGroupDocument", {
        id: "fake-doc-group-1",
        document: "FAKE doc + more",
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("refuses to save an empty document", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call } = setup("FAKE doc");
    const editor = await screen.findByLabelText("Document content — paste the whole file here");
    await user.clear(editor);
    await user.click(screen.getByRole("button", { name: "Save document" }));
    expect(call).not.toHaveBeenCalledWith("setGroupDocument", expect.anything());
    /* The editor stays open with the empty-draft warning toast. */
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("asks before discarding a dirty draft, and can keep editing", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = setup("FAKE doc");
    const editor = await screen.findByLabelText("Document content — paste the whole file here");
    await user.type(editor, "X");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    const confirm = await screen.findByRole("dialog", { name: "Discard changes?" });
    await user.click(within(confirm).getByRole("button", { name: "Keep editing" }));
    /* Back in the editor; the draft is intact. */
    expect((screen.getByLabelText("Document content — paste the whole file here") as HTMLTextAreaElement).value).toBe(
      "FAKE docX",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("discards and closes after the confirmation", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = setup("FAKE doc");
    const editor = await screen.findByLabelText("Document content — paste the whole file here");
    await user.type(editor, "X");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    const confirm = await screen.findByRole("dialog", { name: "Discard changes?" });
    await user.click(within(confirm).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("a clean draft closes directly, without the confirmation", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = setup("FAKE doc");
    await screen.findByLabelText("Document content — paste the whole file here");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).toBeNull();
  });

  it("shows the live draft stats using the backend's rule", async () => {
    setup("ab\ncd");
    await screen.findByLabelText("Document content — paste the whole file here");
    /* 5 runes (one newline), 2 lines. */
    expect(screen.getByText("5 characters · 2 lines")).toBeTruthy();
  });
});

/* ---- v1.15.0 (DECISIONS §57): dual-mode (plain ↔ rich) ---- */

const FAKE_RICH_DOC = "<!--clavis-rich--><div><b>FAKE</b> launch brief 🚀</div><div>line two</div>";

function setupRich(initialText: string | null, fetchDoc = FAKE_RICH_DOC) {
  const call = vi.fn(async (action: string) => {
    if (action === "getGroupDocument") {
      return { ok: true, status: 200, document: fetchDoc };
    }
    return { ok: true, status: 200 };
  }) as unknown as CallFn;
  const onClose = vi.fn();
  render(
    <DocumentFullEditor
      group={docGroup()}
      call={call}
      readOnly={false}
      initialText={initialText}
      onClose={onClose}
    />,
  );
  return { call, onClose };
}

describe("DocumentFullEditor dual mode (v1.15.0 §57)", () => {
  it("opens in rich mode for a sentinel-prefixed document, with the toolbar", async () => {
    const { call } = setupRich(null);
    const ed = await screen.findByRole("textbox", { name: "Document content" });
    expect(ed.textContent).toContain("FAKE launch brief 🚀");
    expect(screen.getByRole("button", { name: "Bold" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Insert an emoji" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy formatted" })).toBeTruthy();
    /* No mono plain textarea in rich mode. */
    expect(screen.queryByLabelText("Document content — paste the whole file here")).toBeNull();
    expect(call).toHaveBeenCalledWith("getGroupDocument", { id: "fake-doc-group-1" });
  });

  it("opens in rich mode from a carried rich draft without fetching", async () => {
    const { call } = setupRich(FAKE_RICH_DOC);
    const ed = await screen.findByRole("textbox", { name: "Document content" });
    expect(ed.textContent).toContain("launch brief");
    expect(call).not.toHaveBeenCalledWith("getGroupDocument", expect.anything());
  });

  it("keeps a plain document in plain mode — no toolbar, no Copy formatted", async () => {
    setupRich("FAKE plain doc");
    await screen.findByLabelText("Document content — paste the whole file here");
    expect(screen.queryByRole("button", { name: "Bold" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy formatted" })).toBeNull();
  });

  it("flips a plain document to rich (one div per line) and back cleanly", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setupRich("line one\nline two");
    await screen.findByLabelText("Document content — paste the whole file here");
    await user.click(screen.getByRole("radio", { name: "Rich text" }));
    const ed = await screen.findByRole("textbox", { name: "Document content" });
    expect(ed.innerHTML).toBe("<div>line one</div><div>line two</div>");
    /* No formatting present: flipping back converts silently (no guard). */
    await user.click(screen.getByRole("radio", { name: "Plain text" }));
    const plain = await screen.findByLabelText("Document content — paste the whole file here");
    expect((plain as HTMLTextAreaElement).value).toBe("line one\nline two");
    /* The mode round-trip landed on the identical string: not dirty. */
    expect((screen.getByRole("button", { name: "Save document" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks before stripping formatting on rich → plain, and can keep rich", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setupRich(FAKE_RICH_DOC);
    await screen.findByRole("textbox", { name: "Document content" });
    await user.click(screen.getByRole("radio", { name: "Plain text" }));
    const confirm = await screen.findByRole("dialog", { name: "Remove formatting?" });
    await user.click(within(confirm).getByRole("button", { name: "Keep rich text" }));
    /* Still rich: the toolbar is right there. */
    expect(screen.getByRole("button", { name: "Bold" })).toBeTruthy();
  });

  it("strips the formatting after the confirmation", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setupRich(FAKE_RICH_DOC);
    await screen.findByRole("textbox", { name: "Document content" });
    await user.click(screen.getByRole("radio", { name: "Plain text" }));
    const confirm = await screen.findByRole("dialog", { name: "Remove formatting?" });
    await user.click(within(confirm).getByRole("button", { name: "Remove formatting" }));
    const plain = await screen.findByLabelText("Document content — paste the whole file here");
    expect((plain as HTMLTextAreaElement).value).toBe("FAKE launch brief 🚀\nline two");
  });

  it("saves rich mode sanitized, under the sentinel", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call } = setupRich("<!--clavis-rich--><div>seed</div>");
    const ed = await screen.findByRole("textbox", { name: "Document content" });
    /* A paste that smuggles a script past the editor must not reach the
       vault: save runs the sanitizer over the draft. */
    ed.innerHTML = "<div><b>bold</b> words</div><script>alert(1)</script>";
    fireEvent.input(ed);
    await user.click(screen.getByRole("button", { name: "Save document" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("setGroupDocument", {
        id: "fake-doc-group-1",
        document: "<!--clavis-rich--><div><b>bold</b> words</div>",
      }),
    );
  });

  it("refuses to save a rich draft whose plain text is empty", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call } = setupRich("<!--clavis-rich--><div>words</div>");
    const ed = await screen.findByRole("textbox", { name: "Document content" });
    ed.innerHTML = "<div><br></div>";
    fireEvent.input(ed);
    await user.click(screen.getByRole("button", { name: "Save document" }));
    expect(call).not.toHaveBeenCalledWith("setGroupDocument", expect.anything());
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("shows the stats of the plain text for a rich draft", async () => {
    setupRich("<!--clavis-rich--><div><b>ab</b></div><div>cd</div>");
    await screen.findByRole("textbox", { name: "Document content" });
    /* 5 runes (one newline), 2 lines — of the PLAIN text, not the markup. */
    expect(screen.getByText("5 characters · 2 lines")).toBeTruthy();
  });

  it("Copy formatted puts html + plain text on the webview clipboard", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const write = vi.fn(async (_items: unknown[]) => {});
    Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
    (globalThis as unknown as { ClipboardItem: unknown }).ClipboardItem = class {
      map: Map<string, unknown>;
      constructor(map: Record<string, unknown>) {
        this.map = new Map(Object.entries(map));
      }
    };
    setupRich("<!--clavis-rich--><div><b>styled</b> words</div>");
    await screen.findByRole("textbox", { name: "Document content" });
    await user.click(screen.getByRole("button", { name: "Copy formatted" }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const items = write.mock.calls[0]?.[0] as unknown[];
    const item = items[0] as { map: Map<string, Blob> };
    expect(item.map.has("text/html")).toBe(true);
    expect(item.map.has("text/plain")).toBe(true);
  });
});
