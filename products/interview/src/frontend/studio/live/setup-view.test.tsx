import type { LiveSessionChoicesResponse } from "@omnitech/interview-contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioActions } from "../config/commands";
import { fakeStream } from "./overlay/capture-fixtures";
import { resetSessionStores } from "./session-registry";
import { SetupView } from "./setup-view";
import {
  jsonResponse,
  minutesAfter,
  sessionView,
} from "./testing/session-fixtures";
import {
  createTestServer,
  type TestServer,
} from "./testing/session-test-server";

const CANDIDACY = "22222222-2222-4222-8222-222222222222";
const INTERVIEW = "11111111-1111-4111-8111-111111111111";

const CHOICES: LiveSessionChoicesResponse = {
  candidacies: [
    {
      id: CANDIDACY,
      title: "Staff Engineer",
      companyName: "Example Corp",
      createdAt: minutesAfter(0),
      interviews: [
        {
          id: INTERVIEW,
          label: "Recruiter screen",
          kind: "screening",
          scheduledAt: null,
        },
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
    {
      profileId: "main",
      name: "Main matrix",
      revision: 2,
      createdAt: minutesAfter(0),
      entryCount: 3,
      latest: false,
    },
  ],
};

let server: TestServer;
let started: unknown[] = [];
const go = vi.fn();
const studio = { go } as unknown as StudioActions;

function install(choices: () => Response = () => jsonResponse(CHOICES)) {
  server = createTestServer();
  server.on("GET /current", () =>
    jsonResponse({ error: { code: "not_found" } }, 404),
  );
  server.on("GET /choices", choices);
  server.on("POST /", ({ body }) => {
    started.push(body);
    return jsonResponse(
      {
        session: sessionView({ status: "created" }),
        credential: { value: "pair-secret-123", expiresAt: minutesAfter(120) },
      },
      201,
    );
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      server.fetch(String(input), init),
    ),
  );
}

async function open(
  props: { blockers?: { title: string; body: string }[] } = {},
) {
  render(
    <SetupView
      studio={studio}
      {...(props.blockers ? { deviceOnlyBlockers: props.blockers } : {})}
    />,
  );
  // The choices have loaded when the interview card exists.
  await screen.findByLabelText(/Recruiter screen/);
}

const start = () =>
  screen.getByRole("button", { name: /Start session|Starting/ });
const pickMacApp = () =>
  fireEvent.click(screen.getByRole("radio", { name: /Mac app/ }));
const pickBrowser = () =>
  fireEvent.click(screen.getByRole("radio", { name: /This browser only/ }));
const pickRehearsal = () => fireEvent.click(screen.getByLabelText(/Rehearsal/));
const pickInterview = () =>
  fireEvent.click(screen.getByLabelText(/Recruiter screen/));
const consent = () =>
  fireEvent.click(screen.getByLabelText(/Everyone in this interview/));

beforeEach(() => {
  window.localStorage.clear();
  resetSessionStores();
  started = [];
  go.mockReset();
  install();
});
afterEach(() => {
  cleanup();
  resetSessionStores();
  vi.unstubAllGlobals();
});

describe("Setup defaults", () => {
  it("opens with nothing chosen, consent unticked and Start disabled", async () => {
    await open();
    expect(
      screen.getByRole("heading", { name: "Start a live session" }),
    ).toBeVisible();
    expect(start()).toBeDisabled();
    expect(
      screen.getByLabelText(/Everyone in this interview/),
    ).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Allow remote" })).toBeChecked();
    // One Start button, and no second processing control.
    expect(screen.getAllByRole("button", { name: /^Start / })).toHaveLength(1);
    expect(screen.queryByTestId("start-choice")).not.toBeInTheDocument();
    expect(screen.getAllByRole("radio", { name: "Device only" })).toHaveLength(
      1,
    );
    expect(screen.getByRole("radio", { name: "Delete at end" })).toBeChecked();
    expect(screen.getByTestId("live-setup")).toHaveTextContent(
      "Edited or revision-linked Workspace drafts may remain; delete them separately in Workspace.",
    );
    // A plain browser cannot hear app audio, so it starts without it.
    expect(
      screen.getByRole("radio", { name: /This browser only/ }),
    ).toBeChecked();
    expect(screen.getByRole("switch", { name: "Microphone" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "App audio" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Screen" })).toBeChecked();
    expect(
      screen.getByRole("switch", { name: "Live assistance" }),
    ).toBeChecked();
    // Focus moves to it once Start is possible, so Enter starts.
    pickRehearsal();
    consent();
    expect(start()).toHaveFocus();
  });

  it("makes no claim that the companion is connected before start", async () => {
    await open();
    const text = screen.getByTestId("setup-companion").textContent ?? "";
    expect(text).toContain("Pairing happens when you start");
    expect(text).not.toMatch(/companion connected/i);
    expect(screen.getByTestId("live-setup").textContent).not.toMatch(
      /renews every|undetectable/i,
    );
  });

  it("has no raw-audio toggle, only a static memory-only row", async () => {
    await open();
    const setup = screen.getByTestId("live-setup");
    expect(
      screen.queryByRole("switch", { name: /raw audio/i }),
    ).not.toBeInTheDocument();
    expect(setup).toHaveTextContent("Raw audio");
    expect(setup).toHaveTextContent("Memory only, never saved");
  });

  it("groups the choices with legends", async () => {
    await open();
    expect(screen.getByRole("group", { name: "Sources" })).toBeVisible();
    for (const name of [
      "1 · What it’s for",
      "2 · How Studio hears and sees",
      "3 · Help and privacy",
    ])
      expect(screen.getByRole("region", { name })).toBeVisible();
    expect(
      screen.getByRole("radiogroup", { name: "1 · What it’s for" }),
    ).toBeVisible();
    expect(
      screen.getByRole("radiogroup", { name: "2 · How Studio hears and sees" }),
    ).toBeVisible();
    expect(
      screen.getByRole("radiogroup", { name: "Where AI runs" }),
    ).toBeVisible();
    expect(
      screen.getByRole("radiogroup", { name: "Keep the session" }),
    ).toBeVisible();
  });
});

describe("Consent and start", () => {
  it("needs a target, consent and a source before Start works", async () => {
    await open();
    pickRehearsal();
    expect(start()).toBeDisabled();
    consent();
    expect(start()).toBeEnabled();
    fireEvent.click(screen.getByRole("switch", { name: "Microphone" }));
    fireEvent.click(screen.getByRole("switch", { name: "Screen" }));
    expect(start()).toBeDisabled();
    expect(screen.getByText("Choose at least one source.")).toBeVisible();
    expect(start()).toHaveAccessibleDescription("Choose at least one source.");
  });

  it("remembers the last processing choice per tenant, says so, and drops the note once chosen again", async () => {
    await open();
    expect(screen.queryByTestId("remembered-policy")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Device only" }));
    expect(screen.queryByTestId("remembered-policy")).not.toBeInTheDocument();
    cleanup();
    await open();
    expect(screen.getByRole("radio", { name: "Device only" })).toBeChecked();
    expect(screen.getByTestId("remembered-policy")).toHaveTextContent(
      "Remembered from your last choice: Device only.",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Allow remote" }));
    expect(screen.queryByTestId("remembered-policy")).not.toBeInTheDocument();
  });

  it("sends exactly the strict start body for an interview and pins the latest matrix", async () => {
    await open();
    pickMacApp();
    pickInterview();
    consent();
    fireEvent.click(start());
    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toEqual({
      processingPolicy: "permitted-remote",
      captureSources: ["microphone", "application-audio", "screen"],
      liveAssistance: true,
      retention: "delete-at-end",
      candidacyId: CANDIDACY,
      interviewId: INTERVIEW,
      profile: { id: "main", revision: 3 },
    });
  });

  it("sends each changed setting: screen, remote, retention, assistance off", async () => {
    await open();
    pickMacApp();
    pickInterview();
    consent();
    fireEvent.click(screen.getByRole("switch", { name: "Microphone" }));
    fireEvent.click(screen.getByRole("switch", { name: "Live assistance" }));
    fireEvent.click(screen.getByRole("radio", { name: "Device only" }));
    fireEvent.click(screen.getByRole("radio", { name: "Allow remote" }));
    fireEvent.click(screen.getByRole("radio", { name: "30 days" }));
    fireEvent.click(start());
    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({
      processingPolicy: "permitted-remote",
      captureSources: ["application-audio", "screen"],
      liveAssistance: false,
      retention: "thirty-days",
    });
  });

  it("sends until-deleted retention", async () => {
    await open();
    pickInterview();
    consent();
    fireEvent.click(screen.getByRole("radio", { name: "Until I delete" }));
    fireEvent.click(start());
    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({ retention: "until-deleted" });
  });

  it("sends a candidacy alone when it has no interview", async () => {
    install(() =>
      jsonResponse({
        ...CHOICES,
        candidacies: [{ ...CHOICES.candidacies[0], interviews: [] }],
      }),
    );
    cleanup();
    render(<SetupView studio={studio} />);
    fireEvent.click(await screen.findByLabelText(/Staff Engineer/));
    consent();
    fireEvent.click(start());
    await waitFor(() => expect(started).toHaveLength(1));
    const body = started[0] as Record<string, unknown>;
    expect(body["candidacyId"]).toBe(CANDIDACY);
    expect(body).not.toHaveProperty("interviewId");
  });

  it("flips the store to the open session and holds the credential once", async () => {
    await open();
    pickRehearsal();
    consent();
    fireEvent.click(start());
    await waitFor(() => expect(started).toHaveLength(1));
    const { getSessionStore } = await import("./session-registry");
    await waitFor(() =>
      expect(getSessionStore("local").getSnapshot().pairing?.value).toBe(
        "pair-secret-123",
      ),
    );
    expect(getSessionStore("local").getSnapshot().session).not.toBeNull();
  });
});

describe("Rehearsal", () => {
  it("always sends a rehearsal run id and the strict flag", async () => {
    await open();
    pickRehearsal();
    consent();
    fireEvent.click(start());
    await waitFor(() => expect(started).toHaveLength(1));
    const body = started[0] as {
      rehearsal: { runId: string; strict: boolean };
      candidacyId?: string;
    };
    expect(body.rehearsal.strict).toBe(false);
    expect(body.rehearsal.runId.length).toBeGreaterThan(8);
    expect(body).not.toHaveProperty("candidacyId");
    expect(body).not.toHaveProperty("interviewId");
  });

  it("explains hints when not strict", async () => {
    await open();
    pickRehearsal();
    expect(screen.getByTestId("live-setup")).toHaveTextContent(
      "Each draft shown counts as a hint at the usual hint cost.",
    );
  });

  it("strict disables assistance with the reason and sends none", async () => {
    await open();
    pickRehearsal();
    fireEvent.click(screen.getByLabelText(/Strict rehearsal/));
    const assistance = screen.getByRole("switch", { name: "Live assistance" });
    expect(assistance).toBeDisabled();
    expect(assistance).not.toBeChecked();
    expect(assistance).toHaveAccessibleDescription(
      "A strict rehearsal turns live assistance off.",
    );
    expect(screen.getByTestId("live-setup")).not.toHaveTextContent(
      "counts as a hint",
    );
    consent();
    fireEvent.click(start());
    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({
      liveAssistance: false,
      rehearsal: { strict: true },
    });
  });

  it("offers no strict option for an interview", async () => {
    await open();
    pickInterview();
    expect(screen.queryByLabelText(/Strict rehearsal/)).not.toBeInTheDocument();
  });
});

describe("Where processing runs", () => {
  it("states the device-only refusal and the remote scope truthfully", async () => {
    await open();
    const setup = screen.getByTestId("live-setup");
    fireEvent.click(screen.getByRole("radio", { name: "Device only" }));
    expect(setup).toHaveTextContent("never sent elsewhere");
    expect(setup).not.toHaveTextContent("the session won’t start");
    fireEvent.click(screen.getByRole("radio", { name: "Allow remote" }));
    expect(setup).toHaveTextContent(
      "Speech recognition still runs on this Mac.",
    );
  });

  it("an injected blocker shows an alert and disables Start", async () => {
    await open({
      blockers: [
        {
          title: "Not available on this Mac",
          body: "On-device recognition isn’t supported for English (UK) here.",
        },
      ],
    });
    pickRehearsal();
    consent();
    fireEvent.click(screen.getByRole("radio", { name: "Device only" }));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Not available on this Mac");
    expect(start()).toBeDisabled();
    // Allowing remote processing removes the device-only blocker.
    fireEvent.click(screen.getByRole("radio", { name: "Allow remote" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(start()).toBeEnabled();
  });

  it("shows no blocker by default", async () => {
    await open();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("segmented controls move and select with the arrow keys", async () => {
    await open();
    const remote = screen.getByRole("radio", { name: "Allow remote" });
    expect(remote).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Device only" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
    remote.focus();
    fireEvent.keyDown(remote, { key: "ArrowRight" });
    const device = screen.getByRole("radio", { name: "Device only" });
    expect(device).toBeChecked();
    expect(device).toHaveFocus();
    fireEvent.keyDown(device, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Allow remote" })).toBeChecked();
    const delete_ = screen.getByRole("radio", { name: "Delete at end" });
    fireEvent.keyDown(delete_, { key: "End" });
    expect(screen.getByRole("radio", { name: "Until I delete" })).toBeChecked();
    fireEvent.keyDown(screen.getByRole("radio", { name: "Until I delete" }), {
      key: "ArrowLeft",
    });
    expect(screen.getByRole("radio", { name: "30 days" })).toBeChecked();
  });
});

describe("Experience matrix", () => {
  it("defaults to the latest revision and can pin an older one or none", async () => {
    await open();
    const select = screen.getByRole("combobox", {
      name: /Matrix and revision/,
    });
    expect(select).toHaveValue("main@3");
    expect(screen.getByTestId("live-setup")).toHaveTextContent(
      "Answers can only claim what it says. Pinned for the whole session.",
    );
    pickRehearsal();
    consent();
    fireEvent.change(select, { target: { value: "main@2" } });
    fireEvent.click(start());
    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({ profile: { id: "main", revision: 2 } });
  });

  it("sends no profile when No matrix is chosen", async () => {
    await open();
    pickRehearsal();
    consent();
    fireEvent.change(screen.getByRole("combobox", { name: /Matrix/ }), {
      target: { value: "none" },
    });
    fireEvent.click(start());
    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).not.toHaveProperty("profile");
  });

  it("shows an honest empty state, links to Briefings and still starts", async () => {
    install(() => jsonResponse({ ...CHOICES, profiles: [] }));
    cleanup();
    render(<SetupView studio={studio} />);
    await screen.findByLabelText(/Recruiter screen/);
    expect(screen.getByTestId("live-setup")).toHaveTextContent(
      "no matrix, answers can’t claim your experience",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Import one in Briefings" }),
    );
    expect(go).toHaveBeenCalledWith("briefings");
    pickInterview();
    consent();
    fireEvent.click(start());
    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).not.toHaveProperty("profile");
  });
});

describe("Choices", () => {
  it("shows a loading note while the choices are read", async () => {
    install(() => new Response(null, { status: 500 }));
    cleanup();
    render(<SetupView studio={studio} />);
    expect(screen.getByText("Loading your interviews…")).toBeVisible();
    await screen.findByText(/Couldn’t load your interviews/);
  });

  it("an error leaves Rehearsal available and Try again reads again", async () => {
    let fail = true;
    install(() =>
      fail ? new Response(null, { status: 500 }) : jsonResponse(CHOICES),
    );
    cleanup();
    render(<SetupView studio={studio} />);
    await screen.findByText(/Couldn’t load your interviews/);
    expect(screen.getByLabelText(/Rehearsal/)).toBeVisible();
    pickRehearsal();
    consent();
    expect(start()).toBeEnabled();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByLabelText(/Recruiter screen/);
  });

  it("an empty list says so and keeps Rehearsal", async () => {
    install(() => jsonResponse({ candidacies: [], profiles: [] }));
    cleanup();
    render(<SetupView studio={studio} />);
    await screen.findByText(/No interviews to link yet/);
    expect(screen.getByLabelText(/Rehearsal/)).toBeVisible();
  });
});

describe("Start failures", () => {
  async function failWith(code: string, status: number) {
    server.on("POST /", () => jsonResponse({ error: { code } }, status));
    await open();
    pickRehearsal();
    consent();
    fireEvent.click(start());
    return screen.findByTestId("setup-failure");
  }

  it("open_session_exists offers Open it, which re-reads the current session", async () => {
    const alert = await failWith("open_session_exists", 409);
    expect(alert).toHaveTextContent("already have an open live session");
    const before = server.count("GET /current");
    fireEvent.click(within(alert).getByRole("button", { name: "Open it" }));
    await waitFor(() =>
      expect(server.count("GET /current")).toBeGreaterThan(before),
    );
  });

  it.each([
    ["link_refused", 422, "no longer available to you"],
    ["invalid_input", 400, "could not accept these settings"],
    ["unauthorized", 401, "signed out"],
    ["duration_cap_reached", 409, "duration_cap_reached"],
  ])("%s shows its own message", async (code, status, text) => {
    const alert = await failWith(code, status);
    expect(alert).toHaveTextContent(text);
    expect(
      within(alert).queryByRole("button", { name: "Open it" }),
    ).not.toBeInTheDocument();
  });

  it("link_refused reloads the choices", async () => {
    server.on("POST /", () =>
      jsonResponse({ error: { code: "link_refused" } }, 422),
    );
    await open();
    pickRehearsal();
    consent();
    const before = server.count("GET /choices");
    fireEvent.click(start());
    await screen.findByTestId("setup-failure");
    await waitFor(() =>
      expect(server.count("GET /choices")).toBeGreaterThan(before),
    );
  });

  it("disables Start while the request is pending", async () => {
    let release: (response: Response) => void = () => undefined;
    server.on(
      "POST /",
      () => new Promise<Response>((resolve) => (release = resolve)),
    );
    await open();
    pickRehearsal();
    consent();
    fireEvent.click(start());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled(),
    );
    release(jsonResponse({ error: { code: "invalid_input" } }, 400));
    await screen.findByTestId("setup-failure");
    expect(start()).toBeEnabled();
  });
});

describe("Start in a browser", () => {
  it("asks only for the microphone in the starting click, never opens the share picker, and remembers the choice", async () => {
    const shared = fakeStream();
    const stream = shared.stream;
    const mic = { getTracks: () => [{ stop: vi.fn() }] };
    const getDisplayMedia = vi.fn(async () => stream);
    const getUserMedia = vi.fn(async () => mic);
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getDisplayMedia, getUserMedia },
      configurable: true,
    });
    HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
    await open();
    pickInterview();
    consent();
    fireEvent.click(screen.getByRole("radio", { name: "Allow remote" }));
    fireEvent.click(start());
    await waitFor(() => expect(started).toHaveLength(1));
    // A browser would show its picker: that waits for the capture button.
    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(
      window.localStorage.getItem("interview-studio.live.auto.local"),
    ).toBe("on");
    // The card that mounts takes the announcement; there is no share to adopt.
    const { takeAnnouncement, takeParkedShare } = await import(
      "./overlay/share-handoff"
    );
    expect(takeAnnouncement()).toBe("Hands-free is on.");
    expect(takeParkedShare()).toBeNull();
  });

  it("asks for no screen in a device-only session, and says what is missing when the microphone is refused", async () => {
    const getDisplayMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getDisplayMedia,
        getUserMedia: vi.fn(async () => {
          throw Object.assign(new Error("x"), { name: "NotAllowedError" });
        }),
      },
      configurable: true,
    });
    await open();
    pickInterview();
    consent();
    fireEvent.click(screen.getByRole("radio", { name: "Device only" }));
    fireEvent.click(start());
    await waitFor(() => expect(started).toHaveLength(1));
    expect(getDisplayMedia).not.toHaveBeenCalled();
    const { takeAnnouncement } = await import("./overlay/share-handoff");
    expect(takeAnnouncement()).toMatch(/the microphone wasn’t allowed/);
  });

  it("opens no share when the session does not start either", async () => {
    const shared = fakeStream();
    const stop = shared.track.stop;
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getDisplayMedia: vi.fn(async () => shared.stream),
        getUserMedia: vi.fn(async () => ({ getTracks: () => [] })),
      },
      configurable: true,
    });
    HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
    server.on("POST /", () =>
      jsonResponse({ error: { code: "link_refused" } }, 422),
    );
    await open();
    pickInterview();
    consent();
    fireEvent.click(screen.getByRole("radio", { name: "Allow remote" }));
    fireEvent.click(start());
    await screen.findByTestId("setup-failure");
    expect(stop).not.toHaveBeenCalled();
  });
});

describe("Host cards", () => {
  const nativeHost = () => ({
    version: 1,
    hostKind: "native-macos",
    capabilities: ["capture-screen", "hotkeys"],
    captureScreen: vi.fn(),
    onHotkey: vi.fn(() => () => undefined),
  });
  afterEach(() => {
    delete window.studioHost;
  });
  const lines = (host: "mac" | "browser") =>
    screen.getByTestId(`host-lines-${host}`);

  it("a plain browser selects This browser only and cannot know the Mac app is installed", async () => {
    await open();
    expect(
      screen.getByRole("radio", { name: /This browser only/ }),
    ).toBeChecked();
    const status = screen.getByTestId("host-status-mac");
    expect(status).toHaveTextContent("Can’t tell from a browser");
    expect(screen.getByTestId("live-setup").textContent).not.toMatch(
      /installed/i,
    );
    expect(lines("mac")).toHaveTextContent("Sees the screen, no share picker");
    expect(lines("mac")).toHaveTextContent("known only inside the Mac app");
    expect(screen.getByTestId("browser-warning")).toHaveTextContent(
      "A plain browser can’t hear app audio",
    );
    expect(lines("browser")).toHaveTextContent("Can’t hear the other side");
  });

  it("inside the Mac app the Mac card is selected, running here, with real capabilities", async () => {
    window.studioHost = nativeHost();
    await open();
    expect(screen.getByRole("radio", { name: /Mac app/ })).toBeChecked();
    expect(screen.getByTestId("host-status-mac")).toHaveTextContent(
      "Running in this window",
    );
    expect(lines("mac")).not.toHaveTextContent("known only inside the Mac app");
    expect(screen.queryByTestId("browser-warning")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "App audio" })).toBeChecked();
  });

  it("choosing a host sets its default sources, which the switches still adjust", async () => {
    await open();
    pickMacApp();
    expect(screen.getByRole("switch", { name: "App audio" })).toBeChecked();
    expect(screen.queryByTestId("browser-warning")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Microphone" }));
    pickBrowser();
    expect(screen.getByRole("switch", { name: "App audio" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Microphone" })).toBeChecked();
    expect(screen.getByTestId("browser-warning")).toBeVisible();
  });

  it("says how the Mac app picks the session up, and starts without asking the browser for anything", async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    await open();
    pickMacApp();
    expect(screen.getByTestId("setup-footer")).toHaveTextContent(
      "The Mac app window picks it up while it is open.",
    );
    pickRehearsal();
    consent();
    fireEvent.click(start());
    await waitFor(() => expect(started).toHaveLength(1));
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});

describe("Footer", () => {
  it("names the one blocking reason, then says Ready", async () => {
    await open();
    const footer = screen.getByTestId("setup-footer");
    expect(footer).toHaveTextContent("Choose what the session is for.");
    expect(start()).toHaveAccessibleDescription(
      "Choose what the session is for.",
    );
    pickRehearsal();
    expect(footer).toHaveTextContent("Confirm everyone has agreed");
    consent();
    expect(footer).toHaveTextContent("Ready");
    expect(footer).toHaveTextContent(
      "This browser only · Microphone, Screen · Allow remote",
    );
    expect(start()).toBeEnabled();
  });

  it("a device-only blocker is the reason, and the device-only warning explains the limits", async () => {
    await open({ blockers: [{ title: "Blocked here", body: "No." }] });
    pickRehearsal();
    consent();
    fireEvent.click(screen.getByRole("radio", { name: "Device only" }));
    expect(screen.getByTestId("setup-footer")).toHaveTextContent(
      "Blocked here",
    );
    expect(screen.getByTestId("device-only-warning")).toHaveTextContent(
      "no screenshot analysis, no code generation",
    );
    expect(screen.getByTestId("device-only-warning")).toHaveTextContent(
      "stored for you, never sent to a model",
    );
    expect(screen.getByTestId("live-setup").textContent).not.toMatch(
      /everything stays on this mac/i,
    );
  });

  it("states the promise and the retention privacy line", async () => {
    await open();
    const setup = screen.getByTestId("live-setup");
    expect(setup).toHaveTextContent(
      "It never submits, sends or types anything for you.",
    );
    expect(setup).toHaveTextContent(
      "Private to you · raw audio is never saved · can only be shortened later",
    );
    expect(setup).toHaveTextContent(
      "Required to start. Studio asks on this screen and does not store your answer.",
    );
  });
});
