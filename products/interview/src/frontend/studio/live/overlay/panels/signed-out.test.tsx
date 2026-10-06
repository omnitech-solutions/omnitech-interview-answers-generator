// A signed-out compact panel is a message WITH a way forward: a "Sign in" link.
// The native shell starts its sign-in when its web view goes to /sign-in, so the
// panel never strands the person on a card that only says they are signed out.
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
  useAutoSession: () => ({ state: "idle", retry: () => {} }),
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

describe("the compact panel when signed out", () => {
  it("says so and offers Sign in, which the shell turns into its own sign-in", () => {
    window.history.replaceState(
      null,
      "",
      "/t/local/p/interview/live/overlay?host=native&panel=single",
    );
    render(<PanelsRoot panel="single" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/signed out/i);
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/sign-in",
    );
  });
});
