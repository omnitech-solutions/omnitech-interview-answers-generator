import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "../documents/documents-ui";
import { Dialog } from "./dialog";

// The parent re-renders on every keystroke and hands the dialog a fresh
// inline onClose each time, as the new-document dialog does.
function Harness({ onClosed }: { onClosed?: () => void }) {
  const [text, setText] = useState("");
  return (
    <Modal
      title="New document"
      width={400}
      footer={null}
      onClose={() => onClosed?.()}
    >
      <input
        aria-label="Company"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    </Modal>
  );
}

describe("Dialog", () => {
  it("keeps focus in the field being typed in while the parent re-renders", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const field = screen.getByLabelText("Company");
    await user.click(field);
    await user.keyboard("Acme");
    expect(field).toHaveValue("Acme");
    expect(field).toHaveFocus();
  });

  it("is a labelled modal dialog that closes on Escape and returns focus to its opener", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          {open && (
            <Dialog
              title="Import"
              onClose={() => {
                onClose();
                setOpen(false);
              }}
            >
              <input aria-label="Name" />
            </Dialog>
          )}
        </>
      );
    }
    render(<Opener />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Import" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("closes on a press on the scrim but not inside the panel", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(
      <Dialog title="Pick" onClose={onClose} scrimClassName="the-scrim">
        <input aria-label="Inside" />
      </Dialog>,
    );
    await user.click(screen.getByLabelText("Inside"));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(container.querySelector(".the-scrim") as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
