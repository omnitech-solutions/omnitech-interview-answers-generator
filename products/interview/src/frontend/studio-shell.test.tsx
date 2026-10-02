import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { StudioBrand, ThemeToggle, useStudioTheme } from "./studio-shell";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset["theme"];
});

describe("Studio shell", () => {
  it("links the brand to the knowledge base", () => {
    render(<StudioBrand subtitle="Reference Library" />);
    expect(
      screen.getByRole("link", { name: "Interview product home" }),
    ).toHaveAttribute("href", "./knowledge");
    expect(screen.getByText("Reference Library")).toBeVisible();
  });

  it("shares the persisted theme and navigation control", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("interview-playground.theme", "dark");

    function Harness() {
      const { theme, toggleTheme } = useStudioTheme();
      return (
        <>
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

    await user.click(
      screen.getByRole("button", { name: "Switch to light theme" }),
    );
    expect(document.documentElement.dataset["theme"]).toBe("light");
    expect(window.localStorage.getItem("interview-playground.theme")).toBe(
      "light",
    );
  });
});
