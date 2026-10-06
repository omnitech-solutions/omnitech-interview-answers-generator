import type { ProductMember } from "@omnitech/platform-contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  open: false,
  end: vi.fn(async () => ({ ok: true }) as { ok: boolean; code?: string }),
  goTo: vi.fn(),
  signOut: vi.fn(async () => ({ ok: true }) as { ok: boolean }),
}));
vi.mock("../live/use-session-open", () => ({
  useSessionOpen: () => mocks.open,
}));
vi.mock("../live/session-registry", () => ({
  getSessionStore: () => ({ actions: { end: mocks.end } }),
  tenantFromLocation: () => "local",
}));
vi.mock("./navigate", () => ({ goTo: mocks.goTo }));
vi.mock("./sign-out", async (original) => ({
  ...(await original<typeof import("./sign-out")>()),
  signOutOfBrowser: mocks.signOut,
}));

const { AccountMenu } = await import("./account-menu");
const { WelcomeBanner } = await import("./welcome-banner");
const { initialsOf, identityOf } = await import("./account-model");

const account: ProductMember = {
  name: "Alex Morgan",
  email: "alex@example.test",
  kind: "account",
  canSignOut: true,
};
const local: ProductMember = {
  name: "Local User",
  email: "local@omnitech.test",
  kind: "local",
  canSignOut: true,
};

beforeEach(() => {
  mocks.open = false;
});
afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
});

const renderMenu = (member = account) =>
  render(<AccountMenu member={member} tenant="acme" secondary="main" />);
const openMenu = () => {
  fireEvent.click(screen.getByRole("button", { name: /^Account:/ }));
  return screen.getByRole("menu", { name: "Account" });
};

describe("identity", () => {
  it("makes initials from the name, falling back to the e-mail", () => {
    expect(initialsOf({ name: "Alex Morgan", email: "a@x.test" })).toBe("AM");
    expect(initialsOf({ name: "Prince", email: "a@x.test" })).toBe("PR");
    expect(initialsOf({ name: "", email: "zed@x.test" })).toBe("Z");
  });
  it("names the local user plainly and says they have no account", () => {
    expect(identityOf(local)).toEqual({
      name: "Local user",
      detail: "No account · this computer",
      initials: "LU",
    });
  });
});

describe("the account menu", () => {
  it("shows who is signed in in the footer, not a hard-coded name", () => {
    renderMenu();
    const trigger = screen.getByRole("button", {
      name: "Account: Alex Morgan",
    });
    expect(trigger.textContent).toContain("alex@example.test");
    expect(trigger.textContent).toContain("AM");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens a menu with the account's items and only those", () => {
    renderMenu();
    const menu = openMenu();
    const names = [...menu.querySelectorAll('[role="menuitem"]')].map(
      (item) => item.textContent,
    );
    expect(names).toEqual(["Connected accounts", "Sign out"]);
    expect(
      screen
        .getByRole("menuitem", { name: "Connected accounts" })
        .getAttribute("href"),
    ).toBe("/t/acme/settings/integrations");
    expect(menu.textContent).toContain("alex@example.test");
  });

  it("offers a local user a way to sign in with a real account, returning here", () => {
    window.history.replaceState({}, "", "/t/acme/p/interview/live");
    renderMenu(local);
    openMenu();
    expect(
      screen
        .getByRole("menuitem", { name: "Sign in with an account" })
        .getAttribute("href"),
    ).toBe("/sign-in?next=%2Ft%2Facme%2Fp%2Finterview%2Flive");
    expect(screen.getByText("local · main")).toBeTruthy();
  });

  it("hides Sign out where there is no session to end", () => {
    renderMenu({ ...local, canSignOut: false });
    openMenu();
    expect(screen.queryByRole("menuitem", { name: "Sign out" })).toBeNull();
  });

  it("moves focus to the first item and cycles with the arrow keys", () => {
    renderMenu(local);
    const menu = openMenu();
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
  });

  it("opens from the keyboard and closes on Escape, returning focus", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: /^Account:/ });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on a click outside, and on Tab", () => {
    renderMenu();
    openMenu();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    const menu = openMenu();
    fireEvent.keyDown(menu, { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps the menu open for a click inside it", () => {
    renderMenu();
    const menu = openMenu();
    fireEvent.pointerDown(menu);
    expect(screen.getByRole("menu")).toBeTruthy();
  });
});

describe("signing out", () => {
  const startSignOut = () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    return screen.getByRole("alertdialog");
  };

  it("asks first, with Cancel focused, and signing out leaves for the signed-out page", async () => {
    const dialog = startSignOut();
    expect(dialog.textContent).toContain("Sign out of Interview Studio?");
    expect(dialog.textContent).toContain(
      "Other devices, including the Mac app, stay signed in.",
    );
    expect(dialog.textContent).not.toContain("live session is running");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(mocks.goTo).toHaveBeenCalledWith("/signed-out"));
    expect(mocks.end).not.toHaveBeenCalled();
  });

  it("is titled and worded for a local user, who goes to the local signed-out page", async () => {
    renderMenu(local);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Leave local session?");
    expect(dialog.textContent).toContain("Your local data is kept.");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() =>
      expect(mocks.goTo).toHaveBeenCalledWith("/signed-out?as=local"),
    );
  });

  it("cancels with the button, Escape or the scrim, without signing out", () => {
    startSignOut();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    fireEvent.click(screen.getByTestId("sign-out-scrim"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.goTo).not.toHaveBeenCalled();
  });

  it("keeps Tab inside the dialog", () => {
    const dialog = startSignOut();
    const confirm = screen.getByRole("button", { name: "Sign out" });
    confirm.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it("warns about a live session, and confirming ends it before signing out", async () => {
    mocks.open = true;
    const order: string[] = [];
    mocks.end.mockImplementation(async () => {
      order.push("end");
      return { ok: true };
    });
    mocks.signOut.mockImplementation(async () => {
      order.push("signOut");
      return { ok: true };
    });
    const dialog = startSignOut();
    expect(dialog.textContent).toContain(
      "A live session is running. Signing out ends it and stops capture.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "End session and sign out" }),
    );
    await waitFor(() => expect(mocks.goTo).toHaveBeenCalled());
    expect(order).toEqual(["end", "signOut"]);
  });

  it("stays signed in, and says so, when the live session cannot be ended", async () => {
    mocks.open = true;
    mocks.end.mockResolvedValueOnce({ ok: false, code: "network" });
    startSignOut();
    fireEvent.click(
      screen.getByRole("button", { name: "End session and sign out" }),
    );
    expect((await screen.findByText(/still signed in/)).textContent).toContain(
      "could not be ended",
    );
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.goTo).not.toHaveBeenCalled();
  });

  it("says so when signing out fails, and does not leave the page", async () => {
    mocks.signOut.mockResolvedValueOnce({ ok: false });
    startSignOut();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(
      await screen.findByText("Signing out did not work. Try again."),
    ).toBeTruthy();
    expect(mocks.goTo).not.toHaveBeenCalled();
  });
});

describe("the welcome banner", () => {
  const visit = (search: string) =>
    window.history.replaceState({}, "", `/t/local/p/interview${search}`);

  it("welcomes an account by e-mail once, remembers the provider and cleans the URL", () => {
    visit("?signed-in=google&artifact=q1");
    render(<WelcomeBanner member={account} />);
    expect(screen.getByRole("status").textContent).toContain(
      "Signed in as alex@example.test",
    );
    expect(window.location.search).toBe("?artifact=q1");
    expect(window.localStorage.getItem("studio.last-provider")).toBe("google");
  });

  it("welcomes the local user without remembering a provider", () => {
    visit("?signed-in=local");
    render(<WelcomeBanner member={local} />);
    expect(screen.getByRole("status").textContent).toContain(
      "Continuing as local user on this computer",
    );
    expect(window.localStorage.getItem("studio.last-provider")).toBeNull();
  });

  it("shows nothing without the sign-in marker, or for an unknown provider value", () => {
    visit("");
    const { unmount } = render(<WelcomeBanner member={account} />);
    expect(screen.queryByRole("status")).toBeNull();
    unmount();
    visit("?signed-in=<script>");
    render(<WelcomeBanner member={account} />);
    expect(window.localStorage.getItem("studio.last-provider")).toBeNull();
  });

  it("is dismissible", () => {
    visit("?signed-in=linkedin");
    render(<WelcomeBanner member={account} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss welcome message" }),
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});
