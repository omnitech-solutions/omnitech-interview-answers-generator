// The overlay route draws the panels UI and nothing else: the compact window
// unless the URL names the Settings window. There is no card page any more.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./panels/panels-root", () => ({
  PanelsRoot: ({ panel }: { panel: string }) => (
    <div data-testid="panels" data-panel={panel} />
  ),
}));

import { OverlayPage } from "./overlay-page";

const at = (search: string) => {
  window.history.replaceState(
    null,
    "",
    `/t/local/p/interview/live/overlay${search}`,
  );
  render(<OverlayPage />);
};
afterEach(cleanup);

describe("the overlay route", () => {
  it("draws the compact panel for a native host that names none", () => {
    at("?host=native");
    expect(screen.getByTestId("panels").dataset["panel"]).toBe("single");
    expect(screen.queryByTestId("overlay-root")).toBeNull();
  });

  it("keeps the panel a native host names", () => {
    at("?host=native&panel=settings");
    expect(screen.getByTestId("panels").dataset["panel"]).toBe("settings");
  });

  it("draws the compact panel for any other load too: the browser tab is redirected before it gets here", () => {
    at("");
    expect(screen.getByTestId("panels").dataset["panel"]).toBe("single");
    cleanup();
    at("?host=pip");
    expect(screen.getByTestId("panels").dataset["panel"]).toBe("single");
    expect(screen.queryByTestId("overlay-root")).toBeNull();
  });
});
