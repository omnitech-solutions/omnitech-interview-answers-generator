// The native shell must never show the bare card page: it has no toolbar and no
// background of its own, so on the shell's clear window it was a see-through
// "No live session." with nothing to press. Any native-host load of the overlay
// route draws the panels UI (the compact window unless it names another).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./panels/panels-root", () => ({
  PanelsRoot: ({ panel }: { panel: string }) => (
    <div data-testid="panels" data-panel={panel} />
  ),
}));
vi.mock("../use-live-session", () => ({
  useLiveSession: () => ({
    snapshot: { hydration: "loading", session: null },
    actions: {},
  }),
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

  it("still draws the card for a browser tab and the picture-in-picture window", () => {
    at("");
    expect(screen.getByTestId("overlay-root")).toBeTruthy();
    cleanup();
    at("?host=pip");
    expect(screen.getByTestId("overlay-root")).toBeTruthy();
    expect(screen.queryByTestId("panels")).toBeNull();
  });
});
