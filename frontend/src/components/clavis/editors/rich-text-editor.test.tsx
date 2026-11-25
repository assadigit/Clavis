/**
 * CLAVIS — the WYSIWYG rich-text editor test (v1.15.0, DECISIONS §57). Pins:
 * the toolbar renders the basic set, clicks run their execCommand, the
 * contentEditable loads and emits its HTML, external value changes reload
 * the DOM while echoes of its own emission never touch it, active states
 * follow queryCommandState, and the emoji picker loads the full pack,
 * searches it, inserts at the caret and keeps recents. jsdom provides no
 * execCommand/queryCommandState — both are mocked per test. FAKE data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RichTextEditor } from "./rich-text-editor";

let execMock: ReturnType<typeof vi.fn>;
let queryMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  execMock = vi.fn(() => true);
  queryMock = vi.fn(() => false);
  document.execCommand = execMock as unknown as typeof document.execCommand;
  document.queryCommandState = queryMock as unknown as typeof document.queryCommandState;
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function typeInto(editable: HTMLElement, html: string) {
  /* jsdom has no real contentEditable caret — apply the DOM change the way
     a browser would, then let React's onInput read it. */
  editable.innerHTML = html;
  fireEvent.input(editable);
}

describe("RichTextEditor", () => {
  it("renders the basic toolbar and the editable area", () => {
    render(<RichTextEditor value="<div>hello</div>" onChange={() => {}} ariaLabel="Document content" />);
    for (const label of [
      "Bold",
      "Italic",
      "Underline",
      "Strikethrough",
      "Align left",
      "Align center",
      "Align right",
      "Bulleted list",
      "Numbered list",
      "Insert an emoji",
      "Undo",
      "Redo",
      "Clear formatting",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    const ed = screen.getByRole("textbox", { name: "Document content" });
    expect(ed.getAttribute("contentEditable")).toBe("true");
    expect(ed.innerHTML).toBe("<div>hello</div>");
    expect(ed.getAttribute("aria-multiline")).toBe("true");
  });

  it("loads the value into the DOM and emits its HTML on input", () => {
    const onChange = vi.fn();
    render(<RichTextEditor value="" onChange={onChange} ariaLabel="Document content" />);
    const ed = screen.getByRole("textbox", { name: "Document content" });
    typeInto(ed, "<div>typed 🎉</div>");
    expect(onChange).toHaveBeenCalledWith("<div>typed 🎉</div>");
  });

  it("runs each toolbar command through execCommand", async () => {
    const user = userEvent.setup();
    render(<RichTextEditor value="<div>t</div>" onChange={() => {}} ariaLabel="Document content" />);
    await user.click(screen.getByRole("button", { name: "Bold" }));
    expect(execMock).toHaveBeenCalledWith("bold", false, undefined);
    await user.click(screen.getByRole("button", { name: "Align center" }));
    expect(execMock).toHaveBeenCalledWith("justifyCenter", false, undefined);
    await user.click(screen.getByRole("button", { name: "Bulleted list" }));
    expect(execMock).toHaveBeenCalledWith("insertUnorderedList", false, undefined);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(execMock).toHaveBeenCalledWith("undo", false, undefined);
  });

  it("reflects the active states from queryCommandState", () => {
    queryMock = vi.fn((cmd: string) => cmd === "bold" || cmd === "justifyCenter");
    document.queryCommandState = queryMock as unknown as typeof document.queryCommandState;
    render(<RichTextEditor value="<div>t</div>" onChange={() => {}} ariaLabel="Document content" />);
    fireEvent(document, new Event("selectionchange"));
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Align center" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Italic" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("reloads the DOM only when the value changes from outside", () => {
    function Harness(props: { value: string }) {
      return <RichTextEditor value={props.value} onChange={() => {}} ariaLabel="Document content" />;
    }
    const { rerender } = render(<Harness value="<div>a</div>" />);
    const ed = screen.getByRole("textbox", { name: "Document content" });

    /* An echo of what the editor emitted (typed locally, parent bounced it
       back unchanged) must not rewrite the DOM. */
    typeInto(ed, "<div>a<strong>typed</strong></div>");
    rerender(<Harness value="<div>a<strong>typed</strong></div>" />);
    expect(ed.innerHTML).toBe("<div>a<strong>typed</strong></div>");

    /* A genuinely external change (a fetch landing, a mode switch) does. */
    rerender(<Harness value="<div>replaced</div>" />);
    expect(ed.innerHTML).toBe("<div>replaced</div>");
  });

  it("shows the placeholder only while empty", () => {
    const { rerender } = render(
      <RichTextEditor value="" onChange={() => {}} ariaLabel="Document content" placeholder="Write here…" />,
    );
    const ed = screen.getByRole("textbox", { name: "Document content" });
    expect(ed.getAttribute("data-empty")).toBe("true");
    expect(ed.getAttribute("data-placeholder")).toBe("Write here…");
    rerender(<RichTextEditor value="<div>x</div>" onChange={() => {}} ariaLabel="Document content" placeholder="Write here…" />);
    expect(ed.getAttribute("data-empty")).toBe("false");
  });

  it("disables the toolbar and the area when disabled", () => {
    render(<RichTextEditor value="" onChange={() => {}} ariaLabel="Document content" disabled />);
    expect(screen.getByRole("button", { name: "Bold" }).hasAttribute("disabled")).toBe(true);
    const ed = screen.getByRole("textbox", { name: "Document content" });
    expect(ed.getAttribute("contentEditable")).toBe("false");
  });
});

describe("RichTextEditor emoji picker", () => {
  it("loads the full pack, inserts at the caret and keeps recents", async () => {
    const user = userEvent.setup();
    render(<RichTextEditor value="<div>t</div>" onChange={() => {}} ariaLabel="Document content" />);

    await user.click(screen.getByRole("button", { name: "Insert an emoji" }));
    /* The dataset chunk loads asynchronously — tabs appear when it lands. */
    await waitFor(() => expect(screen.getByRole("tab", { name: "Smileys" })).toBeTruthy());
    expect(screen.getByRole("tab", { name: "Flags" })).toBeTruthy();

    /* First cell of the Smileys group is grinning face in the dataset. */
    await user.click(screen.getByRole("option", { name: "grinning face emoji" }));
    expect(execMock).toHaveBeenCalledWith("insertText", false, "😀");

    /* Reopen: a Recent tab exists and holds the pick (the panel remounts
       per open — the cached dataset resolves a beat later). */
    await user.click(screen.getByRole("button", { name: "Insert an emoji" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Recent" })).toBeTruthy());
    await user.click(screen.getByRole("tab", { name: "Recent" }));
    expect(screen.getByRole("option", { name: "grinning face emoji" })).toBeTruthy();
    expect(localStorage.getItem("clavis.recentEmoji")).toContain("😀");
  });

  it("searches the whole pack by name", async () => {
    const user = userEvent.setup();
    render(<RichTextEditor value="" onChange={() => {}} ariaLabel="Document content" />);
    await user.click(screen.getByRole("button", { name: "Insert an emoji" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Smileys" })).toBeTruthy());
    await user.type(screen.getByRole("searchbox", { name: "Search emoji by name" }), "fire");
    await user.click(screen.getByRole("option", { name: "fire emoji" }));
    expect(execMock).toHaveBeenCalledWith("insertText", false, "🔥");
  });

  it("closes on Escape and on an outside click", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <RichTextEditor value="" onChange={() => {}} ariaLabel="Document content" />
        <button type="button">Outside</button>
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Insert an emoji" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Smileys" })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("tab", { name: "Smileys" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Insert an emoji" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Smileys" })).toBeTruthy());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tab", { name: "Smileys" })).toBeNull();
  });
});
