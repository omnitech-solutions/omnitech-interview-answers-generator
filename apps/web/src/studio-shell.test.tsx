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
      screen.getByRole("link", { name: "Interview Studio home" }),
    ).toHaveAttribute("href", "/");
    expect(screen.getByText("Reference Library")).toBeVisible();
    expect(screen.getByRole("link", { name: /Playground/ })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: /Concept Lab/ })).toHaveAttribute(
      "href",
      "/?view=concept-lab",
    );
    expect(screen.getByRole("link", { name: /Library/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen
        .getByRole("link", { name: /Library/ })
        .compareDocumentPosition(
          screen.getByRole("link", { name: /Mock Interview/ }),
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

    await user.click(screen.getByRole("button", { name: /Concept Lab/ }));
    expect(select).toHaveBeenCalledWith("concept-lab");
    expect(close).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Library/ })).toHaveAttribute(
      "href",
      "/library",
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
