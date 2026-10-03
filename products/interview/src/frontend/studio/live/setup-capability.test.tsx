// Setup against the companion's last capability report: no report, ready, speech
// unavailable, speech denied, the device-only block on Start, and remote allowed.
import type { LiveCompanionCapability } from "@omnitech/interview-contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioActions } from "../config/commands";
import {
  capabilityReport,
  jsonResponse,
  minutesAfter,
} from "./session-fixtures";
import { resetSessionStores } from "./session-registry";
import { createTestServer } from "./session-test-server";
import { CHOICES, REPORTS } from "./setup-capability-fixtures";
import { SetupView } from "./setup-view";

const studio = { go: vi.fn() } as unknown as StudioActions;

function install(
  report: () => Response = () => jsonResponse({ capability: null }),
) {
  const server = createTestServer();
  server.on("GET /current", () =>
    jsonResponse({ error: { code: "not_found" } }, 404),
  );
  server.on("GET /choices", () => jsonResponse(CHOICES));
  server.on("GET /companion-capability", report);
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      server.fetch(String(input), init),
    ),
  );
}
const withReport = (capability: LiveCompanionCapability | null) =>
  install(() => jsonResponse({ capability }));

async function open(
  props: { blockers?: { title: string; body: string }[] } = {},
) {
  render(
    <SetupView
      studio={studio}
      {...(props.blockers ? { deviceOnlyBlockers: props.blockers } : {})}
    />,
  );
  await screen.findByLabelText(/Recruiter screen/);
  // The report read settles with the choices.
  await screen.findByTestId("setup-capability");
  await vi.waitFor(() =>
    expect(screen.getByTestId("setup-capability").textContent).not.toMatch(
      /Reading the companion/,
    ),
  );
}
const start = () => screen.getByRole("button", { name: /Start session/ });
const readyToStart = () => {
  fireEvent.click(screen.getByLabelText(/Rehearsal/));
  fireEvent.click(screen.getByRole("checkbox", { name: /agreed to it/ }));
};
const capability = () => screen.getByTestId("setup-capability");

beforeEach(() => {
  resetSessionStores();
  window.history.replaceState({}, "", "/t/local/p/interview/live");
});
afterEach(() => {
  cleanup();
  resetSessionStores();
  vi.unstubAllGlobals();
});

describe("Setup and the companion's last report", () => {
  it("says honestly that there is no report, never that the companion is connected, and does not block", async () => {
    withReport(null);
    await open();
    expect(capability()).toHaveTextContent(
      "No capability report yet: the companion checks on its first session and fails visibly if device-only speech is unavailable.",
    );
    expect(screen.getByTestId("live-setup").textContent).not.toMatch(
      /companion connected|is connected/i,
    );
    readyToStart();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(start()).toBeEnabled();
  });

  it("ready: shows speech on this Mac, the permission states and the report's age, as a last report", async () => {
    withReport(REPORTS.ready);
    await open();
    expect(capability()).toHaveTextContent("not a live connection");
    expect(capability()).toHaveTextContent("On this Mac, in the companion");
    expect(within(capability()).getByText("Microphone")).toBeVisible();
    expect(capability()).toHaveTextContent("granted");
    readyToStart();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(start()).toBeEnabled();
  });

  it("speech unavailable on this Mac: shows a non-blocking advisory with the report's age, never an alert, and Start stays enabled", async () => {
    withReport(REPORTS.unsupported);
    await open();
    readyToStart();
    const advisory = screen.getByTestId("capability-advisory");
    expect(advisory).toHaveTextContent("Not available on this Mac");
    expect(advisory).toHaveTextContent(
      "On-device recognition isn’t supported for en-GB on this Mac",
    );
    expect(advisory).toHaveTextContent(
      "Studio won’t fall back to a remote service by itself",
    );
    expect(advisory).toHaveTextContent(/reported .+ ago/);
    expect(advisory).toHaveTextContent(
      "The companion’s own check when it starts decides",
    );
    // The stored report is advisory: the companion's own check is the authority.
    expect(advisory.textContent).not.toMatch(/won’t start until/);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(start()).toBeEnabled();
  });

  it.each([
    ["denied", REPORTS.denied, "Speech recognition isn’t allowed"],
    ["restricted", REPORTS.restricted, "Speech recognition isn’t allowed"],
    ["recognizer down", REPORTS.recognizerDown, "Not available on this Mac"],
  ])(
    "a stored %s report leaves device-only Start enabled and shows the advisory",
    async (_n, report, title) => {
      withReport(report);
      await open();
      readyToStart();
      expect(screen.getByTestId("capability-advisory")).toHaveTextContent(
        title,
      );
      expect(screen.queryByRole("alert")).toBeNull();
      expect(start()).toBeEnabled();
    },
  );

  it("an injected blocker still blocks device-only Start, whatever the report says", async () => {
    withReport(REPORTS.ready);
    await open({
      blockers: [{ title: "Blocked here", body: "This machine can’t." }],
    });
    readyToStart();
    expect(screen.getByRole("alert")).toHaveTextContent("Blocked here");
    expect(start()).toBeDisabled();
  });

  it("remote allowed: the page says allowing remote does not fix speech", async () => {
    withReport(REPORTS.unsupported);
    await open();
    readyToStart();
    fireEvent.click(screen.getByRole("radio", { name: "Allow remote" }));
    expect(start()).toBeEnabled();
    expect(screen.getByTestId("speech-warning")).toHaveTextContent(
      "Allowing remote processing doesn’t change that",
    );
  });

  it("shows a denied permission for a source that is selected", async () => {
    withReport(
      capabilityReport({
        permissions: { microphone: "denied", screen: "not-determined" },
      }),
    );
    await open();
    expect(capability()).toHaveTextContent(
      "Microphone access was denied for the companion on this Mac",
    );
    expect(capability()).not.toHaveTextContent(
      /Screen recording access was denied/,
    );
  });

  it("does not block when the report cannot be read, and says nothing is assumed", async () => {
    install(() =>
      jsonResponse({ error: { code: "session_unavailable" } }, 503),
    );
    render(<SetupView studio={studio} />);
    await screen.findByLabelText(/Recruiter screen/);
    await vi.waitFor(() =>
      expect(capability()).toHaveTextContent("nothing is assumed"),
    );
    readyToStart();
    expect(start()).toBeEnabled();
  });

  it("an old report is dated from its own timestamp", async () => {
    withReport(capabilityReport({ reportedAt: minutesAfter(-30) }));
    await open();
    expect(capability().textContent).toMatch(/reported .+ ago/);
  });
});
