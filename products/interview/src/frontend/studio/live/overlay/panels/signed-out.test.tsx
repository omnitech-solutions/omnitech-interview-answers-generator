// A signed-out panel in a plain browser is a message WITH a way forward: a "Sign
// in" link to the web sign-in. (The Mac app's window draws the sign-in screen
// instead: see start-panel.test.tsx.)
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../float-access", () => ({ overlayAccess: () => "signed-out" }));
vi.mock("../../use-live-session", () => ({
  useLiveSession: () => ({
    snapshot: { hydration: "ready", session: null },
    actions: {},
  }),
}));
vi.mock("./use-panel-session", () => ({ usePanelSession: () => ({}) }));
vi.mock("./auto-session", () => ({
  useAutoSession: () => ({ state: "idle", announceStarted: () => {} }),
}));
vi.mock("./hit-regions", () => ({
  useHitRegions: () => {},
  canPassThrough: () => false,
}));
vi.mock("./panel-glass", () => ({
  usePanelGlass: () => ({ clear: false, toggle: () => {} }),
  glassAttributes: () => ({}),
}));
vi.mock("./window-mode", () => ({ usePanelWindowMode: () => ({}) }));
vi.mock("./single-panel", () => ({
  usePanes: () => ({ shown: { analysis: false } }),
  SinglePanel: () => null,
}));

import { PanelsRoot } from "./panels-root";

afterEach(cleanup);

describe("the compact panel when signed out, in a browser", () => {
  it("says so and offers a Sign in link to the web sign-in", () => {
    window.history.replaceState(
      null,
      "",
      "/t/local/p/interview/live/overlay?panel=single",
    );
    render(<PanelsRoot panel="single" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/signed out/i);
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/sign-in",
    );
  });
});
