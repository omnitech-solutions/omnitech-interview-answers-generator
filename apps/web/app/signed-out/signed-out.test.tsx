import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import SignedOutPage from "./page";
import { SignedOutView } from "./signed-out-view";

it("says the browser is signed out, and that other devices keep their own sign-in", () => {
  render(<SignedOutView local={false} />);
  expect(
    screen.getByRole("heading", { name: "You’re signed out" }),
  ).toBeTruthy();
  expect(screen.getByText(/This browser is signed out/)).toBeTruthy();
  expect(screen.getByText(/keep their own sign-in/)).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Sign in again" }).getAttribute("href"),
  ).toBe("/sign-in");
});

it("tells a local user their data is still on this computer", () => {
  render(<SignedOutView local />);
  expect(
    screen.getByText("Your local data is still on this computer."),
  ).toBeTruthy();
  expect(screen.queryByText(/Mac app/)).toBeNull();
});

it("reads the kind from ?as=local, and defaults to an account", async () => {
  const { unmount } = render(
    await SignedOutPage({ searchParams: Promise.resolve({ as: "local" }) }),
  );
  expect(screen.getByText(/local data is still/)).toBeTruthy();
  unmount();
  render(await SignedOutPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText(/This browser is signed out/)).toBeTruthy();
});
