// The Code panel's empty and waiting states: the library Panel (title Code)
// holding the tile Empty with the board's one line, never a second header.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CodeEmpty } from "./code-card";
import { WAITS_FOR_APPROACH } from "./panel-model";

afterEach(cleanup);

describe("the empty Code panel", () => {
  it("is the Code region with the board's sentence and no code controls", () => {
    render(
      <CodeEmpty
        text="Code appears once the approach is drafted."
        busy={false}
      />,
    );
    const region = screen.getByRole("region", { name: "Code" });
    expect(region).toHaveAttribute("data-slot", "panel");
    expect(screen.getByTestId("pn-code-placeholder")).toHaveTextContent(
      "Code appears once the approach is drafted.",
    );
    expect(within(region).queryByRole("button")).toBeNull();
  });

  it("says it starts automatically after the approach while waiting", () => {
    render(<CodeEmpty text={WAITS_FOR_APPROACH} busy={false} />);
    expect(screen.getByTestId("pn-code-placeholder")).toHaveTextContent(
      "Starts automatically after the approach.",
    );
  });

  it("shows a spinner instead of an icon while the code is written", () => {
    render(<CodeEmpty text="Writing code… 7s" busy />);
    expect(
      screen.getByTestId("pn-code-placeholder").querySelector(".pn-spinner"),
    ).not.toBeNull();
  });
});
