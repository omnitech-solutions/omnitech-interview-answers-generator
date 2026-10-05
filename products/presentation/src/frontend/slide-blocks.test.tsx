import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SlideBlockEditor } from "./slide-blocks.js";

afterEach(cleanup);

it("updates the editor when a tool or undo changes the same slide source", () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <SlideBlockEditor
      source="<SECTION><H1>Before</H1></SECTION>"
      onChange={onChange}
    />,
  );
  rerender(
    <SlideBlockEditor
      source="<SECTION><H1>After undo</H1><P>Added by tool</P></SECTION>"
      onChange={onChange}
    />,
  );
  expect(
    screen
      .getAllByLabelText("Rich text content")
      .map((element) => (element as HTMLTextAreaElement).value),
  ).toEqual(["After undo", "Added by tool"]);
  fireEvent.change(screen.getAllByLabelText("Rich text content")[1]!, {
    target: { value: "Keep new title" },
  });
  expect(onChange).toHaveBeenLastCalledWith(
    '<SECTION layout="vertical"><H1>After undo</H1><P>Keep new title</P></SECTION>',
  );
});
