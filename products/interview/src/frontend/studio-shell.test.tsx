import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NavigationToggle,
  StudioBrand,
  StudioNavigation,
  ThemeToggle,
  useStudioTheme,
} from "./studio-shell";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset["theme"];
});

describe("Studio shell", () => {
  it("navigates to nontechnical preparation independently from technical explanations", async () => {
    const select = vi.fn();
    render(
      <StudioNavigation
        active="playground"
        onSelect={select}
        onClose={() => {}}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Interview preparation/ }),
    );
    expect(select).toHaveBeenCalledWith("interview-preparation");
  });
  it("provides shared branding and deep links for every workspace", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(
      <>
        <StudioBrand subtitle="Reference Library" />
        <StudioNavigation active="library" onClose={close} />
      </>,
    );

    expect(
      screen.getByRole("link", { name: "Interview product home" }),
    ).toHaveAttribute("href", "./workspace");
    expect(screen.getByText("Reference Library")).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Solution Builder/ }),
    ).toHaveAttribute("href", "./workspace");
    expect(screen.getByRole("link", { name: /Briefing/ })).toHaveAttribute(
      "href",
      "./workspace?view=concept-lab",
    );
    expect(screen.getByRole("link", { name: /Knowledge/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen
        .getByRole("link", { name: /Knowledge/ })
        .compareDocumentPosition(
          screen.getByRole("link", { name: /Rehearsal/ }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(close).toHaveBeenCalled();
  });

  it("keeps in-app workspace selection stateful", async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    const close = vi.fn();
    render(
      <StudioNavigation
        active="playground"
        onSelect={select}
        onClose={close}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Briefing/ }));
    expect(select).toHaveBeenCalledWith("concept-lab");
    expect(close).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Knowledge/ })).toHaveAttribute(
      "href",
      "./knowledge",
    );
  });

  it("shares the persisted theme and navigation control", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    window.localStorage.setItem("interview-playground.theme", "dark");

    function Harness() {
      const { theme, toggleTheme } = useStudioTheme();
      return (
        <>
          <NavigationToggle open={false} onClick={open} />
          <ThemeToggle theme={theme} onClick={toggleTheme} />
        </>
      );
    }

    render(<Harness />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Switch to light theme" }),
      ).toBeVisible(),
    );
    expect(document.documentElement.dataset["theme"]).toBe("dark");

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(open).toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Switch to light theme" }),
    );
    expect(document.documentElement.dataset["theme"]).toBe("light");
    expect(window.localStorage.getItem("interview-playground.theme")).toBe(
      "light",
    );
  });
});
