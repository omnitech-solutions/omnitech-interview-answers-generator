// The companion-side speech state on the Sources tab and the session bar, and
// the permission states driven by the stream: no report, ready, speech
// unavailable, denied, permission revoked and capture lost. Nothing here may
// say the companion is connected without a heartbeat.
import type { LiveCompanionCapability } from "@omnitech/interview-contracts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioActions } from "../config/commands";
import { LiveSessionBody, LiveSessionPanel } from "./live-session-view";
import { build } from "./live-view-kit";
import { SessionBar } from "./session-bar";
import {
  capabilityReport,
  disconnected,
  jsonResponse,
  minutesAfter,
  sessionView,
  streamPage,
  transcript,
} from "./session-fixtures";
import { getSessionStore, resetSessionStores } from "./session-registry";
import type { SessionActions } from "./session-snapshot";
import { createTestServer } from "./session-test-server";
import { REPORTS } from "./setup-capability-fixtures";
import type { CompanionCapabilityState } from "./use-companion-capability";
import { resetTargetTitles } from "./use-session-target";

const ready = (
  capability: LiveCompanionCapability | null,
): CompanionCapabilityState => ({ status: "ready", capability });

function body(
  capability: CompanionCapabilityState | undefined,
  input: Parameters<typeof build>[0] = {},
) {
  const { view, model } = build(input);
  render(
    <LiveSessionBody
      session={view}
      model={model}
      actions={{} as SessionActions}
      busy={false}
      commandError={null}
      pairing={<div />}
      {...(capability ? { capability } : {})}
      initialTab="sources"
    />,
  );
}
const speechRow = () =>
  within(screen.getByRole("table")).getByText("Speech").closest("tr");

afterEach(cleanup);

describe("Sources tab: the companion's speech state", () => {
  it("says it is not known before any report was read", () => {
    body(undefined);
    expect(speechRow()).toHaveTextContent(
      "Not known: no capability report read",
    );
    expect(speechRow()).not.toHaveTextContent("On this Mac");
  });

  it("no report: says so honestly and claims no locality", () => {
    body(ready(null));
    expect(screen.getByTestId("companion-report")).toHaveTextContent(
      "No capability report yet: the companion checks on its first session and fails visibly if device-only speech is unavailable.",
    );
    expect(speechRow()).toHaveTextContent("No report yet");
    expect(speechRow()).not.toHaveTextContent("On this Mac");
  });

  it("ready: says on this Mac, in the companion, only because the report says on-device is available", () => {
    body(ready(REPORTS.ready));
    expect(speechRow()).toHaveTextContent("On this Mac, in the companion");
    expect(screen.getByTestId("companion-report")).toHaveTextContent(
      "Last capability report",
    );
    expect(screen.getByTestId("companion-report")).toHaveTextContent(
      "Microphone granted · Screen recording granted",
    );
  });

  it("speech unavailable: shows the true state, not the locality", () => {
    body(ready(REPORTS.unsupported));
    expect(speechRow()).toHaveTextContent("Not available on this Mac (en-GB)");
    expect(speechRow()).not.toHaveTextContent("On this Mac, in the companion");
    expect(speechRow()?.querySelector("td")).toHaveClass("refused");
  });

  it("denied: shows the permission problem", () => {
    body(ready(REPORTS.denied));
    expect(speechRow()).toHaveTextContent("Speech permission denied");
    expect(screen.getByTestId("companion-report")).toHaveTextContent(
      "denied for the companion",
    );
  });

  it("lists denied OS permissions from the report", () => {
    body(
      ready(
        capabilityReport({
          permissions: { microphone: "denied", screen: "not-determined" },
        }),
      ),
    );
    expect(screen.getByTestId("companion-report")).toHaveTextContent(
      "Microphone denied · Screen recording not asked yet",
    );
  });

  it("a report is history: the companion row stays 'No recent contact' without a heartbeat", () => {
    body(ready(REPORTS.ready), { session: { lastHeartbeatAt: null } });
    expect(screen.getByTestId("companion-row")).not.toHaveTextContent(
      /connected|In contact/,
    );
    expect(screen.getByTestId("companion-row")).toHaveTextContent(
      /No contact yet|never|Waiting|No recent contact/i,
    );
  });

  it("a read that failed says so", () => {
    body({ status: "error" });
    expect(screen.getByTestId("companion-report")).toHaveTextContent(
      "couldn’t read the companion’s last capability report",
    );
  });
});

describe("permission revoked and capture lost, from stream data", () => {
  it("shows a revoked microphone permission as its own state on the Sources tab", () => {
    body(ready(REPORTS.ready), {
      session: { captureSources: ["microphone"] },
      observations: [
        transcript(1, "hello", { sourceId: "microphone" }),
        disconnected(2, "microphone", "permission-revoked"),
      ],
    });
    expect(screen.getByText("Permission revoked")).toBeVisible();
  });

  it("shows a lost screen capture as lost", () => {
    body(ready(REPORTS.ready), {
      session: { captureSources: ["screen"] },
      observations: [disconnected(1, "screen", "device-lost")],
    });
    expect(screen.getByText("Lost")).toBeVisible();
  });
});

// ---- The session bar and the live panel, over the routes -----------------------

let session = sessionView({ lastHeartbeatAt: minutesAfter(1) });
let capability: LiveCompanionCapability | null = null;
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

function install(
  observations = [transcript(1, "hi", { sourceId: "microphone" })],
) {
  const server = createTestServer(() =>
    streamPage({ session, observations, serverNow: minutesAfter(1) }),
  );
  server.on("GET /current", () => jsonResponse({ session }));
  server.on("GET /:id", () => jsonResponse({ session }));
  server.on("GET /companion-capability", () => jsonResponse({ capability }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      server.fetch(String(input), init),
    ),
  );
}

describe("the bar and the live panel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(minutesAfter(1)));
    resetSessionStores();
    resetTargetTitles();
    session = sessionView({ lastHeartbeatAt: minutesAfter(1) });
    capability = null;
    window.history.replaceState({}, "", "/t/local/p/interview/live");
  });
  afterEach(() => {
    resetSessionStores();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function openBar() {
    render(<SessionBar variant="bar" onOpen={() => undefined} />);
    await flush();
    await flush();
  }
  const chip = () => screen.queryByTestId("speech-chip");

  it.each([
    ["no report", null, "no-report", "No report yet"],
    ["ready", REPORTS.ready, "ready", "On this Mac, in the companion"],
    [
      "unsupported",
      REPORTS.unsupported,
      "on-device-unavailable",
      "Not available",
    ],
    ["denied", REPORTS.denied, "denied", "Speech permission denied"],
  ] as const)("bar speech chip: %s", async (_name, report, key, text) => {
    install();
    capability = report;
    await openBar();
    expect(chip()).toHaveAttribute("data-speech", key);
    expect(chip()).toHaveTextContent(text);
    expect(chip()?.getAttribute("title")).toContain("last capability report");
  });

  it("the bar's state still comes from the stream: a revoked permission stays 'Permission revoked' whatever speech says", async () => {
    install([
      transcript(1, "hi", { sourceId: "microphone" }),
      disconnected(2, "microphone", "permission-revoked"),
    ]);
    capability = REPORTS.ready;
    await openBar();
    expect(screen.getByTestId("session-bar")).toHaveAttribute(
      "data-state",
      "permission-revoked",
    );
    expect(screen.getByTestId("session-bar")).not.toHaveTextContent(/\bLive\b/);
  });

  it("capture lost on the screen is 'Screen capture lost' and not Live", async () => {
    session = sessionView({
      captureSources: ["microphone", "screen"],
      lastHeartbeatAt: minutesAfter(1),
    });
    install([disconnected(1, "screen", "device-lost")]);
    await openBar();
    expect(screen.getByTestId("session-bar")).toHaveAttribute(
      "data-state",
      "source-lost",
    );
    expect(screen.getByTestId("session-bar")).toHaveTextContent(
      "Screen capture lost",
    );
  });

  it("the panel re-reads the report: a report that arrives after the panel opened appears", async () => {
    install();
    render(<LiveSessionPanel studio={{} as StudioActions} />);
    getSessionStore("local").subscribe(() => undefined);
    await flush();
    await flush();
    fireEvent.click(screen.getByRole("tab", { name: "Sources" }));
    expect(screen.getByTestId("companion-report")).toHaveTextContent(
      "No capability report yet",
    );
    capability = REPORTS.unsupported;
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(screen.getByTestId("companion-report")).toHaveTextContent(
      "isn’t supported for en-GB",
    );
  });
});
