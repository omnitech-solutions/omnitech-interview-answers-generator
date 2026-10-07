// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./studio/live/overlay/panels/panels-root", () => ({
  PanelsRoot: () => <div data-testid="panels-root" />,
}));
vi.mock("./studio/live/overlay/panels/use-account", () => ({
  accountHost: vi.fn(),
  navigation: { assign: vi.fn() },
}));

import { NativeSignInRoute } from "./native-sign-in-route";
import {
  accountHost,
  navigation,
} from "./studio/live/overlay/panels/use-account";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the public native sign-in route", () => {
  it("is the web sign-in page when opened in a plain browser: there is no Mac app to sign in", async () => {
    vi.mocked(accountHost).mockReturnValue(null);
    const view = render(<NativeSignInRoute />);
    await waitFor(() =>
      expect(navigation.assign).toHaveBeenCalledWith("/sign-in"),
    );
    expect(view.queryByTestId("panels-root")).toBeNull();
  });

  it("draws the Mac app's own sign-in screen inside the app", async () => {
    vi.mocked(accountHost).mockReturnValue(
      {} as ReturnType<typeof accountHost>,
    );
    const view = render(<NativeSignInRoute />);
    expect(await view.findByTestId("panels-root")).toBeInTheDocument();
    expect(navigation.assign).not.toHaveBeenCalled();
  });
});
