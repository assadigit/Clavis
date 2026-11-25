/**
 * CLAVIS — the whole-document group's full-modal editor test (v1.14.0,
 * DECISIONS §56). Pins: it fetches the stored document when opened without a
 * carried draft, seeds from the carried inline draft without fetching, saves
 * byte-exact through setGroupDocument and closes, refuses an empty draft, and
 * the dirty-close guard asks before discarding. Fake data only (FAKE-*).
 * Wails runtime mocked.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
