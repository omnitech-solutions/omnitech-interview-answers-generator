// The native window before a session runs, over the real overlay route, the real
// store and a scripted Studio: the sign-in screen with the locked toolbar and
// footer, the waiting and local steps, the idle start screen and its gates, the
// account menu, and the hand-off to the live window that is not changed.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AccountPermissions,
  AccountSignInState,
} from "@omnitech/interview-contracts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativeSignInRoute } from "../../../../native-sign-in-route";
import { presentation } from "../../focus-presentation";
import {
  configureSessionStores,
  resetSessionStores,
} from "../../session-registry";
import {
  jsonResponse,
  minutesAfter,
  sessionView,
  snapshot,
  streamPage,
} from "../../testing/session-fixtures";
import {
  createTestServer,
  type TestServer,
} from "../../testing/session-test-server";
import { OverlayPage } from "../overlay-page";
import { resetCommandClaims } from "./commands";
import { navigation } from "./use-account";

let server: TestServer;
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const settle = async () => {
  for (let i = 0; i < 4; i++) await flush();
};

const CANDIDACY = "22222222-2222-4222-8222-222222222222";
const INTERVIEW = "11111111-1111-4111-8111-111111111111";
const CHOICES = (scheduledAt: string | null) => ({
  candidacies: [
    {
      id: CANDIDACY,
      title: "Staff Engineer",
      companyName: "Example Corp",
      createdAt: minutesAfter(0),
      interviews: [
        { id: INTERVIEW, label: "Technical", kind: "technical", scheduledAt },
      ],
    },
  ],
  profiles: [
    {
      profileId: "main",
      name: "Main matrix",
      revision: 3,
      createdAt: minutesAfter(0),
      entryCount: 4,
      latest: true,
    },
  ],
});

type Providers = { providers?: string[]; configured?: boolean };
let providers: Providers = { providers: ["google", "linkedin"] };
let choices = CHOICES(null);
let globalFetch: ReturnType<typeof vi.fn>;

// A negotiable native bridge whose account object records its calls.
function bridge(
  options: {
    state?: AccountSignInState;
    permissions?: AccountPermissions;
    consent?: boolean;
  } = {},
) {
  let state: AccountSignInState = options.state ?? { phase: "idle" };
  const listeners = new Set<(s: AccountSignInState) => void>();
  const calls: string[] = [];
  const opened: string[] = [];
  const account = {
    signIn: vi.fn(async (provider: string) => {
      calls.push(`signIn:${provider}`);
      return true;
    }),
    cancelSignIn: vi.fn(async () => {
      calls.push("cancel");
    }),
    reopenSignIn: vi.fn(async () => {
      calls.push("reopen");
      return true;
    }),
    copySignInLink: vi.fn(async () => {
      calls.push("copy");
      return true;
    }),
    signOut: vi.fn(async () => {
      calls.push("signOut");
      return true;
    }),
    state: () => state,
    onState: (listener: (s: AccountSignInState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    permissions: vi.fn(
      async () =>
        options.permissions ??
        ({ microphone: "granted", screen: "granted" } as const),
    ),
  };
  const settings = vi.fn(async () => true);
  (window as { studioHost?: unknown }).studioHost = {
    version: 1,
    hostKind: "native-macos",
    capabilities: ["open-external", "account"],
    captureScreen: async () => ({ ok: false, reason: "unsupported" }),
    pinOnTop: async () => true,
    openExternal: async (url: string) => {
      opened.push(url);
    },
    onHotkey: () => () => undefined,
    account,
    presentation: {
      capabilities: [],
      nativeToasts: false,
      openSettings: settings,
      closeSettings: async () => true,
      setVisible: async () => true,
      interactionMode: () => true,
      setInteractionMode: async () => true,
      onInteractionMode: () => () => undefined,
    },
    ...(options.consent === false
      ? {
          consent: { granted: () => false, open: vi.fn(async () => undefined) },
        }
      : {}),
  };
  if (options.consent !== false)
    window.localStorage.setItem("studio.shell.consented", "1");
  return {
    account,
    calls,
    opened,
    settings,
    emit: (next: AccountSignInState) =>
      act(() => {
        state = next;
        for (const listener of listeners) listener(next);
      }),
  };
}

// Studio refuses the session read: signed out.
function signedOutStudio() {
  server = createTestServer(() => streamPage());
  server.on("GET /current", () =>
    jsonResponse({ error: { code: "unauthorized" } }, 401),
  );
  server.on("GET /choices", () =>
    jsonResponse({ error: { code: "unauthorized" } }, 401),
  );
  configure();
}
// Signed in with nothing running.
function idleStudio() {
  server = createTestServer(() => streamPage());
  server.on("GET /current", () =>
    jsonResponse({ error: { code: "not_found" } }, 404),
  );
  server.on("GET /choices", () => jsonResponse(choices));
  configure();
}
function configure() {
  configureSessionStores({
    fetch: server.fetch,
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
  });
  globalFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/native-auth/providers"))
      return jsonResponse(providers);
    return server.fetch(url, init);
  });
  vi.stubGlobal("fetch", globalFetch);
}

// The library menu opens on the press, as Radix does (a bare click does not).
const openMenu = (trigger: HTMLElement) =>
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });

async function show(
  query = "?host=native&panel=single&handsfree=1",
  path = "/t/local/p/interview/live/overlay",
  member?: {
    name: string;
    email: string;
    kind: "account" | "local";
    canSignOut: boolean;
  },
) {
  window.history.replaceState({}, "", `${path}${query}`);
  render(<OverlayPage {...(member ? { member } : {})} />);
  await settle();
}

// The public sign-in route: it needs no session and opens signed out.
async function showRoute(query = "?tenant=local") {
  window.history.replaceState({}, "", `/native/sign-in${query}`);
  render(<NativeSignInRoute />);
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  await settle();
}

const ACCOUNT = {
  name: "Alex Morgan",
  email: "alex@example.test",
  kind: "account" as const,
  canSignOut: true,
};
const LOCAL = {
  name: "Local User",
  email: "local@omnitech.test",
  kind: "local" as const,
  canSignOut: true,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetSessionStores();
  presentation.reset();
  resetCommandClaims();
  providers = { providers: ["google", "linkedin"] };
  choices = CHOICES(null);
});
afterEach(() => {
  cleanup();
  resetSessionStores();
  delete (window as { studioHost?: unknown }).studioHost;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("signed out", () => {
  it("draws the sign-in card inside the same chrome: locked toolbar, 'Not signed in' chip, footer", async () => {
    bridge();
    signedOutStudio();
    await show();
    const card = screen.getByTestId("pn-start");
    expect(card).toHaveAttribute("data-stage", "out");
    expect(
      within(card).getByText("Sign in", {
        selector: '[data-slot="panel-title"]',
      }),
    ).toBeVisible();
    expect(
      within(card).getByRole("heading", { name: "Sign in to start a session" }),
    ).toBeVisible();
    // The toolbar is the real one, every session control disabled and naming why.
    const bar = screen.getByTestId("pn-pill");
    // The window's own dots (quit, hide, size) are not session controls.
    const controls = within(bar)
      .getAllByRole("button")
      .filter((button) => !button.classList.contains("pn-window-dot"));
    const locked = controls.filter(
      (button) => (button as HTMLButtonElement).disabled,
    );
    expect(locked.length).toBeGreaterThanOrEqual(7);
    for (const button of locked)
      expect(button.outerHTML.slice(0, 200), button.outerHTML).toContain(
        'title="Sign in first"',
      );
    expect(
      within(bar).getByRole("button", { name: "Analyze screen" }),
    ).toBeDisabled();
    expect(within(bar).getByTestId("pn-chip-out")).toHaveTextContent(
      "Not signed in",
    );
    // The footer keeps the build id, with the status at its end (and no visible-window note).
    expect(screen.queryByText(/Visible window/)).toBeNull();
    expect(screen.getByRole("button", { name: /^Copy build/ })).toBeVisible();
    expect(screen.getByTestId("ov-status")).toHaveTextContent("Not signed in");
    // Nothing has "ended": the capture control's status says there is no session.
    expect(screen.getByTestId("pn-status")).toHaveTextContent(
      "No live session",
    );
    expect(screen.queryByRole("button", { name: /Pause|End/ })).toBeNull();
  });

  it("says the session expired when a working window loses it (the tenant route), not on a first launch", async () => {
    bridge();
    signedOutStudio();
    await show();
    expect(screen.getByText(/Your session expired/)).toBeVisible();
    cleanup();
    await showRoute();
    expect(screen.queryByText(/Your session expired/)).toBeNull();
    cleanup();
    await showRoute("?tenant=local&notice=expired");
    expect(screen.getByText(/Your session expired/)).toBeVisible();
  });

  it("the public sign-in route needs no session at all and opens on the sign-in card", async () => {
    bridge();
    idleStudio();
    await showRoute();
    expect(screen.getByTestId("pn-start")).toHaveAttribute("data-stage", "out");
  });

  it("always draws the designed sign-in: Google, LinkedIn, an `or` rule, then this Mac; one Studio has not set up is disabled and says so", async () => {
    bridge();
    signedOutStudio();
    providers = { providers: ["local"] };
    await show();
    const google = screen.getByRole("button", { name: /Continue with Google/ });
    const linkedin = screen.getByRole("button", {
      name: /Continue with LinkedIn/,
    });
    expect(google).toBeDisabled();
    expect(linkedin).toBeDisabled();
    expect(screen.getByText(/set up on this Studio/)).toBeVisible();
    expect(screen.getByText("or")).toBeInTheDocument();
    expect(screen.getByTestId("pn-start-local")).toHaveTextContent(
      "Continue on this Mac, no account",
    );
    cleanup();
    providers = { providers: ["google", "linkedin", "local"] };
    await show();
    expect(
      screen.getByRole("button", { name: /Continue with Google/ }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /Continue with LinkedIn/ }),
    ).toBeEnabled();
    expect(screen.queryByText(/set up on this Studio/)).toBeNull();
    cleanup();
    // No local sign-in offered (not this computer): no `or` rule, no Mac button.
    providers = { providers: ["google"] };
    await show();
    expect(
      screen.getByRole("button", { name: /Continue with Google/ }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /Continue with LinkedIn/ }),
    ).toBeDisabled();
    expect(screen.queryByTestId("pn-start-local")).toBeNull();
    expect(screen.queryByText("or")).toBeNull();
  });

  it("an unanswered providers read says so and offers Try again", async () => {
    bridge();
    signedOutStudio();
    globalFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/api/native-auth/providers"))
          throw new Error("down");
        return server.fetch(String(input), init);
      },
    );
    vi.stubGlobal("fetch", globalFetch);
    await show();
    expect(screen.getByText(/Studio didn’t answer/)).toBeVisible();
    providers = { providers: ["google"] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes("/api/native-auth/providers")
          ? jsonResponse(providers)
          : server.fetch(String(input), init),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settle();
    expect(
      screen.getByRole("button", { name: /Continue with Google/ }),
    ).toBeVisible();
  });

  it("Continue with Google asks the shell to open the browser, then the waiting card shows by itself", async () => {
    const host = bridge();
    signedOutStudio();
    await show();
    fireEvent.click(
      screen.getByRole("button", { name: /Continue with Google/ }),
    );
    await settle();
    expect(host.calls).toEqual(["signIn:google"]);
    await host.emit({ phase: "waiting", provider: "google" });
    const card = screen.getByTestId("pn-start");
    expect(card).toHaveAttribute("data-stage", "waiting");
    expect(
      within(card).getByRole("heading", {
        name: "Finish signing in in your browser",
      }),
    ).toBeVisible();
    expect(card).toHaveTextContent("We opened Google in your default browser");
    fireEvent.click(
      within(card).getByRole("button", { name: /Open browser again/ }),
    );
    fireEvent.click(within(card).getByRole("button", { name: /Copy link/ }));
    await settle();
    expect(screen.getByTestId("pn-start-toast")).toHaveTextContent(
      "Sign-in link copied",
    );
    fireEvent.click(within(card).getByRole("button", { name: "Cancel" }));
    await settle();
    expect(host.calls).toEqual(["signIn:google", "reopen", "copy", "cancel"]);
    // The shell says the attempt is over: back to the choices.
    await host.emit({ phase: "idle" });
    expect(screen.getByTestId("pn-start")).toHaveAttribute("data-stage", "out");
  });

  it("names LinkedIn for a LinkedIn attempt, and says a timed-out attempt changed nothing", async () => {
    const host = bridge();
    signedOutStudio();
    await show();
    await host.emit({ phase: "waiting", provider: "linkedin" });
    expect(screen.getByTestId("pn-start")).toHaveTextContent(
      "We opened LinkedIn",
    );
    await host.emit({ phase: "timed-out" });
    expect(screen.getByTestId("pn-start")).toHaveAttribute("data-stage", "out");
    expect(screen.getByText(/Sign-in timed out/)).toBeVisible();
  });

  it("a shell that cannot open the browser says so", async () => {
    const host = bridge();
    host.account.signIn.mockResolvedValueOnce(false);
    signedOutStudio();
    await show();
    fireEvent.click(
      screen.getByRole("button", { name: /Continue with LinkedIn/ }),
    );
    await settle();
    expect(screen.getByTestId("pn-start-toast")).toHaveTextContent(
      /Couldn’t open your browser/,
    );
  });

  it("this Mac: a confirm step with facts that are true, Back, then signs in here and goes to the panel", async () => {
    bridge();
    signedOutStudio();
    providers = { providers: ["google", "local"] };
    const go = vi
      .spyOn(navigation, "assign")
      .mockImplementation(() => undefined);
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/native-auth/providers"))
          return jsonResponse(providers);
        if (url === "/api/auth/csrf") {
          calls.push("csrf");
          return jsonResponse({ csrfToken: "tok" });
        }
        if (url === "/api/auth/callback/local") {
          calls.push(`callback:${String(init?.body)}`);
          return new Response(null, { status: 200 });
        }
        if (url === "/api/auth/session") {
          calls.push("session");
          return jsonResponse({ user: { email: "local@omnitech.test" } });
        }
        return server.fetch(url, init);
      }),
    );
    await show();
    fireEvent.click(screen.getByTestId("pn-start-local"));
    const card = screen.getByTestId("pn-start");
    expect(card).toHaveAttribute("data-stage", "local");
    expect(
      within(card).getByRole("heading", {
        name: "Use Studio on this Mac only",
      }),
    ).toBeVisible();
    // Honest facts: no "nothing leaves this Mac", no "stored on this Mac", no on-device AI.
    expect(card.textContent).not.toMatch(
      /leaves this Mac|stored on this Mac|on device/i,
    );
    expect(card).toHaveTextContent("No account and no password.");
    expect(card).toHaveTextContent("Studio is running on this Mac.");
    fireEvent.click(within(card).getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("pn-start")).toHaveAttribute("data-stage", "out");
    fireEvent.click(screen.getByTestId("pn-start-local"));
    fireEvent.click(
      screen.getByRole("button", { name: "Continue on this Mac" }),
    );
    await settle();
    expect(calls).toEqual([
      "csrf",
      "callback:csrfToken=tok&callbackUrl=%2F",
      "session",
    ]);
    expect(go).toHaveBeenCalledWith(
      "/t/local/p/interview/live/overlay?host=native&panel=single&handsfree=1",
    );
  });

  it("a local sign-in Studio refuses changes nothing and says so", async () => {
    bridge();
    signedOutStudio();
    providers = { providers: ["local"] };
    const go = vi
      .spyOn(navigation, "assign")
      .mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/native-auth/providers"))
          return jsonResponse(providers);
        if (url === "/api/auth/csrf") return jsonResponse({ csrfToken: "tok" });
        if (url === "/api/auth/callback/local")
          return new Response(null, { status: 401 });
        if (url === "/api/auth/session") return jsonResponse(null);
        return server.fetch(url, init);
      }),
    );
    await show();
    fireEvent.click(screen.getByTestId("pn-start-local"));
    fireEvent.click(
      screen.getByRole("button", { name: "Continue on this Mac" }),
    );
    await settle();
    expect(go).not.toHaveBeenCalled();
    expect(screen.getByTestId("pn-start-toast")).toHaveTextContent(
      /Couldn’t sign in on this Mac/,
    );
    expect(screen.getByTestId("pn-start")).toHaveAttribute(
      "data-stage",
      "local",
    );
  });

  it("a browser (no shell) keeps the plain message with a link to sign in on the web", async () => {
    signedOutStudio();
    await show("?panel=single", "/t/local/p/interview/live/overlay");
    expect(screen.queryByTestId("pn-start")).toBeNull();
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/sign-in",
    );
  });

  it("a signed-out notice from a sign-out is said once as 'Signed out'", async () => {
    bridge();
    signedOutStudio();
    await showRoute("?tenant=local&notice=signed-out");
    expect(screen.getByTestId("pn-start-toast")).toHaveTextContent(
      "Signed out",
    );
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(screen.queryByTestId("pn-start-toast")).toBeNull();
  });
});

describe("idle: signed in, no live session", () => {
  it("shows the start screen instead of starting by itself", async () => {
    bridge();
    idleStudio();
    await show(undefined, undefined, ACCOUNT);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    const card = screen.getByTestId("pn-start");
    expect(card).toHaveAttribute("data-stage", "idle");
    expect(
      within(card).getByText("No live session", {
        selector: '[data-slot="panel-title"]',
      }),
    ).toBeVisible();
    expect(server.calls.some((call) => call.startsWith("POST"))).toBe(false);
    // The toolbar is the same one, disabled, saying a session must start first.
    const analyze = within(screen.getByTestId("pn-pill")).getByRole("button", {
      name: "Analyze screen",
    });
    expect(analyze).toBeDisabled();
    expect(analyze).toHaveAttribute("title", "Start a session first");
    expect(screen.getByTestId("ov-status")).toHaveTextContent(
      "Signed in · no live session",
    );
    // See-through is the one control that stays on: it can always be turned off
    // with the mouse, even while the rest of the toolbar waits for a session.
    expect(
      within(screen.getByTestId("pn-pill")).getByTestId("pn-see-through"),
    ).toBeEnabled();
  });

  it("the account chip shows the initial and first name, and its menu lists the design's items", async () => {
    const host = bridge();
    idleStudio();
    await show(undefined, undefined, ACCOUNT);
    const chip = screen.getByTestId("pn-chip");
    expect(chip).toHaveTextContent("Alex");
    expect(chip).toHaveTextContent("A");
    expect(chip).toBeEnabled();
    openMenu(chip);
    const menu = screen.getByRole("menu", { name: "Account" });
    expect(menu).toHaveTextContent("Alex Morgan");
    expect(menu).toHaveTextContent("alex@example.test");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Open Studio on the web", "Settings", "Sign out"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Settings" }));
    expect(host.settings).toHaveBeenCalled();
    openMenu(chip);
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Open Studio on the web" }),
    );
    expect(host.opened.at(-1)).toMatch(/\/t\/local\/p\/interview\/live$/);
    openMenu(chip);
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(host.calls).toContain("signOut");
  });

  it("the account menu is drawn inside the window's panel root as a hit-tested surface, and Escape gives focus back to the chip", async () => {
    bridge();
    idleStudio();
    await show(undefined, undefined, ACCOUNT);
    const chip = screen.getByTestId("pn-chip");
    openMenu(chip);
    const menu = screen.getByRole("menu", { name: "Account" });
    expect(menu.closest(".pn-root")).toBe(screen.getByTestId("pn-start-root"));
    expect(menu).toHaveAttribute("data-oui-surface");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Account" })).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(chip).toHaveFocus();
  });

  it("Start stays clickable while blocked (pressing it says why), and the card keeps its hit region", async () => {
    bridge();
    idleStudio();
    await show(undefined, undefined, ACCOUNT);
    expect(screen.getByTestId("pn-start")).toHaveClass("pn-start-card");
    const css = readFileSync(join(__dirname, "start-panel.css"), "utf8");
    expect(css).toMatch(
      /button\.pn-start-go\[aria-disabled="true"\]\s*\{\s*pointer-events: auto;/,
    );
  });

  it("a local profile: 'This Mac' chip, Rehearsal only, honest footer, sign out of the local profile", async () => {
    const host = bridge();
    idleStudio();
    choices = CHOICES(new Date(Date.now() + 86_400_000).toISOString());
    await show(undefined, undefined, LOCAL);
    const chip = screen.getByTestId("pn-chip");
    expect(chip).toHaveTextContent("This Mac");
    const targets = screen.getAllByRole("radio");
    expect(targets).toHaveLength(1);
    expect(targets[0]).toHaveTextContent("Rehearsal");
    expect(screen.getByTestId("ov-status")).toHaveTextContent(
      "Local profile · no account",
    );
    expect(screen.getByTestId("ov-status").textContent).not.toMatch(
      /nothing leaves/i,
    );
    openMenu(chip);
    expect(
      within(screen.getByRole("menu", { name: "Account" }))
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Open Studio on the web",
      "Settings",
      "Sign in with Google or LinkedIn",
      "Sign out of local profile",
    ]);
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Sign out of local profile" }),
    );
    expect(host.calls).toContain("signOut");
  });

  it("a development Studio that signs everyone in offers no sign out", async () => {
    bridge();
    idleStudio();
    await show(undefined, undefined, { ...LOCAL, canSignOut: false });
    openMenu(screen.getByTestId("pn-chip"));
    const names = within(screen.getByRole("menu", { name: "Account" }))
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    expect(names).toEqual(["Open Studio on the web", "Settings"]);
  });

  it("welcomes the person once, after a sign-in from this window", async () => {
    bridge();
    idleStudio();
    window.sessionStorage.setItem("studio.native.welcome", "1");
    await show(undefined, undefined, ACCOUNT);
    expect(screen.getByText("Signed in as alex@example.test")).toBeVisible();
    cleanup();
    await show(undefined, undefined, ACCOUNT);
    expect(screen.queryByText(/Signed in as/)).toBeNull();
    cleanup();
    window.sessionStorage.setItem("studio.native.welcome", "1");
    await show(undefined, undefined, LOCAL);
    expect(screen.getByText("Using this Mac without an account")).toBeVisible();
  });

  it("offers the next interview and Rehearsal, the interview needs 'everyone has agreed', Rehearsal does not", async () => {
    bridge();
    idleStudio();
    choices = CHOICES(new Date(Date.now() + 3 * 86_400_000).toISOString());
    await show(undefined, undefined, ACCOUNT);
    const targets = screen.getAllByRole("radio");
    expect(targets.map((target) => target.textContent)).toEqual([
      expect.stringContaining("Technical"),
      expect.stringContaining("Rehearsal"),
    ]);
    expect(targets[0]).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("checkbox", { name: /Everyone has agreed/ }),
    ).toHaveAttribute("aria-checked", "false");
    fireEvent.click(targets[1] as HTMLElement);
    expect(
      screen.queryByRole("checkbox", { name: /Everyone has agreed/ }),
    ).toBeNull();
  });

  it("an interview in the past, or none, offers Rehearsal alone: no invented data", async () => {
    bridge();
    idleStudio();
    choices = CHOICES(new Date(Date.now() - 86_400_000).toISOString());
    await show(undefined, undefined, ACCOUNT);
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    cleanup();
    choices = CHOICES(null);
    await show(undefined, undefined, ACCOUNT);
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByRole("radio")).toHaveTextContent("Rehearsal");
  });

  it("shows each permission, with Allow… that opens the right settings pane", async () => {
    const host = bridge({
      permissions: { microphone: "denied", screen: "denied" },
    });
    idleStudio();
    await show(undefined, undefined, ACCOUNT);
    const group = screen.getByRole("region", { name: "This Mac" });
    expect(within(group).getByText("Microphone")).toBeVisible();
    expect(within(group).getByText("App audio")).toBeVisible();
    expect(within(group).getByText("Screen recording")).toBeVisible();
    const allows = within(group).getAllByRole("button", { name: "Allow…" });
    expect(allows).toHaveLength(3);
    fireEvent.click(allows[0] as HTMLElement);
    fireEvent.click(allows[2] as HTMLElement);
    expect(host.opened).toEqual([
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    ]);
  });

  it("allowed rows say Allowed; macOS not asked yet says so and offers no button", async () => {
    bridge({ permissions: { microphone: "undetermined", screen: "granted" } });
    idleStudio();
    await show(undefined, undefined, ACCOUNT);
    const group = screen.getByRole("region", { name: "This Mac" });
    expect(within(group).getAllByText("Allowed")).toHaveLength(2);
    expect(within(group).getByText("macOS asks when you start")).toBeVisible();
    expect(within(group).queryByRole("button")).toBeNull();
  });

  it("re-reads the permissions while it is open, so allowing in System Settings shows without a reload", async () => {
    const host = bridge({
      permissions: { microphone: "granted", screen: "denied" },
    });
    idleStudio();
    await show(undefined, undefined, ACCOUNT);
    expect(screen.getAllByRole("button", { name: "Allow…" })).toHaveLength(2);
    host.account.permissions.mockResolvedValue({
      microphone: "granted",
      screen: "granted",
    });
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(screen.queryByRole("button", { name: "Allow…" })).toBeNull();
  });

  it("Start is blocked, with the reason, until the screen is allowed and everyone has agreed", async () => {
    bridge({ permissions: { microphone: "granted", screen: "denied" } });
    idleStudio();
    choices = CHOICES(new Date(Date.now() + 86_400_000).toISOString());
    const post = vi.fn();
    server.on("POST /", ({ body }) => {
      post(body);
      return jsonResponse({}, 500);
    });
    await show(undefined, undefined, ACCOUNT);
    const start = screen.getByRole("button", { name: "Start session" });
    expect(start).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("pn-start-hint")).toHaveTextContent(
      "Allow screen recording first",
    );
    fireEvent.click(start);
    await settle();
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByTestId("pn-start-toast")).toHaveTextContent(
      "Allow screen recording first",
    );
  });

  it("with the screen allowed, an interview still needs the agreement; then Start sends the interview and the matrix", async () => {
    bridge();
    idleStudio();
    choices = CHOICES(new Date(Date.now() + 86_400_000).toISOString());
    const posted: unknown[] = [];
    server.on("POST /", ({ body }) => {
      posted.push(body);
      return jsonResponse(
        {
          session: sessionView({ processingPolicy: "permitted-remote" }),
          credential: { value: "c", expiresAt: minutesAfter(60) },
        },
        201,
      );
    });
    await show(undefined, undefined, ACCOUNT);
    expect(screen.getByTestId("pn-start-hint")).toHaveTextContent(
      "Confirm everyone has agreed",
    );
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    await settle();
    expect(posted).toEqual([]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Everyone has agreed/ }),
    );
    expect(screen.getByTestId("pn-start-hint")).toHaveTextContent(
      "Listening starts right away",
    );
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    await settle();
    expect(posted).toEqual([
      expect.objectContaining({
        processingPolicy: "permitted-remote",
        captureSources: ["microphone", "application-audio", "screen"],
        candidacyId: CANDIDACY,
        interviewId: INTERVIEW,
        profile: { id: "main", revision: 3 },
      }),
    ]);
  });

  it("Rehearsal starts with no agreement and carries no interview", async () => {
    bridge();
    idleStudio();
    const posted: Array<Record<string, unknown>> = [];
    server.on("POST /", ({ body }) => {
      posted.push(body as Record<string, unknown>);
      return jsonResponse(
        {
          session: sessionView({ processingPolicy: "permitted-remote" }),
          credential: { value: "c", expiresAt: minutesAfter(60) },
        },
        201,
      );
    });
    await show(undefined, undefined, LOCAL);
    expect(screen.getByTestId("pn-start-hint")).toHaveTextContent(
      "Listening starts right away",
    );
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    await settle();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual(
      expect.objectContaining({
        rehearsal: expect.objectContaining({ strict: false }),
      }),
    );
    expect(posted[0]).not.toHaveProperty("interviewId");
  });

  it("a refused start says what the server's fixed sentence says and stays on the screen", async () => {
    bridge();
    idleStudio();
    server.on("POST /", () =>
      jsonResponse({ error: { code: "invalid_input" } }, 400),
    );
    await show(undefined, undefined, LOCAL);
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    await settle();
    expect(screen.getByTestId("pn-start-hint")).toHaveTextContent(
      /Studio could not accept these settings/,
    );
    expect(screen.getByTestId("pn-start")).toBeVisible();
  });

  it("without the shell's consent it says Consent required and offers the shell's dialog; nothing starts", async () => {
    bridge({ consent: false });
    idleStudio();
    await show(undefined, undefined, LOCAL);
    expect(screen.getByTestId("pn-start-hint")).toHaveTextContent(
      "Consent required",
    );
    expect(
      screen.getByRole("button", { name: "Review consent" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    await settle();
    expect(server.calls.some((call) => call.startsWith("POST"))).toBe(false);
  });

  it("'Set up in Studio on the web' opens the browser, never inside this window", async () => {
    const host = bridge();
    idleStudio();
    await show(undefined, undefined, LOCAL);
    fireEvent.click(
      screen.getByRole("button", { name: "Set up in Studio on the web" }),
    );
    expect(host.opened.at(-1)).toMatch(/\/t\/local\/p\/interview\/live$/);
  });

  it("a session that is already running is adopted, not offered a second start", async () => {
    bridge();
    server = createTestServer(() =>
      streamPage({
        session: sessionView({ processingPolicy: "permitted-remote" }),
        observations: [snapshot(1)],
        nextAfterSequence: 1,
      }),
    );
    server.on("GET /current", () =>
      jsonResponse({
        session: sessionView({ processingPolicy: "permitted-remote" }),
      }),
    );
    configure();
    await show(undefined, undefined, ACCOUNT);
    expect(screen.queryByTestId("pn-start")).toBeNull();
    expect(screen.getByTestId("pn-root")).toBeVisible();
    // The live toolbar is the unlocked one.
    const analyze = within(screen.getByTestId("pn-pill")).getByRole("button", {
      name: "Analyze screen",
    });
    expect(analyze).toBeEnabled();
    expect(analyze.getAttribute("title")).not.toMatch(/first/);
  });
});
