import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { StudioButton, StudioTextarea } from "./studio-controls";

describe("StudioButton", () => {
  it("defaults to a non-submitting button and composes its visual classes", () => {
    render(
      <StudioButton className="extra" variant="outline">
        Save
      </StudioButton>,
    );

    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute(
      "type",
      "button",
    );
    expect(screen.getByRole("button", { name: "Save" })).toHaveClass(
      "studio-button",
      "outline",
      "extra",
    );
  });
});

describe("StudioTextarea", () => {
  it("exposes a visible label and reports the current string value", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <StudioTextarea
        label="Private notes"
        description="Stored only when saved."
        defaultValue=""
        onChange={onChange}
      />,
    );

    const textarea = screen.getByRole("textbox", { name: "Private notes" });
    await user.type(textarea, "Prefer a map");

    expect(screen.getByText("Stored only when saved.")).toBeVisible();
    expect(onChange).toHaveBeenLastCalledWith("Prefer a map");
  });

  it("supports an aria-label without adding a wrapper label", () => {
    const { container } = render(
      <StudioTextarea aria-label="Interview question" value="" />,
    );

    expect(
      screen.getByRole("textbox", { name: "Interview question" }),
    ).toBeVisible();
    expect(container.querySelector("label")).not.toBeInTheDocument();
  });
});
