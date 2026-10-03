import type {
  LiveObservation,
  LiveSessionView,
} from "@omnitech/interview-contracts";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  disconnected,
  jsonResponse,
  minutesAfter,
  sessionView,
  streamPage,
  transcript,
} from "./session-fixtures";
import { resetSessionStores } from "./session-registry";
import { SessionBar } from "./session-bar";
import { createTestServer } from "./session-test-server";
import { resetTargetTitles } from "./use-session-target";

let server: ReturnType<typeof createTestServer>;
let session: LiveSessionView;
let observations: LiveObservation[];
const onOpen = vi.fn();

const INTERVIEW_ID = "7d6f1d0e-5b0a-4b52-9d43-0c3b7a1f2e10";
const CANDIDACY_ID = "3a1c9e4b-8f27-4d0a-b6c1-5e2f7d9a0b34";

function install() {
  server = createTestServer(() =>
    streamPage({ session, observations, serverNow: minutesAfter(1) }),
  );
  server.on("GET /current", () =>
    session.status === "ended"
      ? jsonResponse({ error: { code: "not_found" } }, 404)
      : jsonResponse({ session }),
  );
  server.on("GET /:id", () => jsonResponse({ session }));
  server.on("POST /:id/control", ({ body }) => {
    const action = (body as { action: string }).action;
    session = sessionView({
      ...session,
      status:
        action === "end" ? "ended" : action === "pause" ? "paused" : "active",
      ...(action === "end" ? { endedAt: minutesAfter(5) } : {}),
    });
    return jsonResponse({ session });
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/interview/t/local/sessions"))
        return server.fetch(url, init);
      return Response.json({}, { status: 404 });
    }),
  );
}

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

async function openBar(variant: "bar" | "header" = "bar") {
  window.history.replaceState({}, "", "/t/local/p/interview");
  render(<SessionBar variant={variant} onOpen={onOpen} />);
  await flush();
}
const bar = () => screen.getByTestId("session-bar");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  resetSessionStores();
  resetTargetTitles();
  onOpen.mockClear();
  session = sessionView({ lastHeartbeatAt: minutesAfter(1) });
  observations = [];
  install();
});
afterEach(() => {
  resetSessionStores();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("visibility", () => {
  it("renders nothing without a session", async () => {
    server.on("GET /current", () =>
      jsonResponse({ error: { code: "not_found" } }, 404),
    );
    await openBar();
    expect(screen.queryByTestId("session-bar")).toBeNull();
  });

  it("renders nothing for an ended session", async () => {
    session = sessionView({ status: "ended", endedAt: minutesAfter(5) });
    server.on("GET /current", () => jsonResponse({ session }));
    await openBar();
    expect(screen.queryByTestId("session-bar")).toBeNull();
  });

  it("shows for created, active and paused sessions", async () => {
    session = sessionView({ status: "paused" });
    await openBar();
    expect(bar()).toHaveAttribute("data-state", "paused");
  });

  it("is the live header on the Live view, without Open", async () => {
    await openBar("header");
    expect(bar()).toHaveAttribute("data-variant", "header");
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
  });
});

describe("states", () => {
  it("shows Live with the elapsed time and activity", async () => {
    observations = [transcript(1, "Hello there", { sourceId: "microphone" })];
    await openBar();
    expect(bar()).toHaveAttribute("data-state", "live");
    expect(within(bar()).getAllByRole("status").length).toBe(2);
    expect(bar()).toHaveTextContent("Live");
    expect(bar()).toHaveTextContent("1:00");
    expect(bar()).toHaveTextContent("Listening");
  });

  it("says Studio cannot be reached after the stream fails, keeping Pause and End offered", async () => {
    await openBar();
    expect(bar()).toHaveAttribute("data-state", "live");
    // The service goes away: every further read fails.
    server.on("GET /:id/stream", () =>
      jsonResponse({ error: { code: "session_unavailable" } }, 503),
    );
    await advance(3_000);
    expect(bar()).toHaveAttribute("data-state", "unreachable");
    const state = within(bar())
      .getAllByRole("status")
      .find((element) => /Can't reach Studio/.test(element.textContent ?? ""));
    expect(state).toBeDefined();
    expect(bar()).not.toHaveTextContent(/\bLive\b/);
    expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "End" })).toBeEnabled();
    // Elapsed time does not run on while nothing can be read.
    const elapsed = bar().querySelector(".live-bar-elapsed")?.textContent;
    await advance(60_000);
    expect(bar().querySelector(".live-bar-elapsed")?.textContent).toBe(elapsed);
    // And a silent companion is not inferred from an unread stream.
    expect(bar()).not.toHaveTextContent(/offline/i);
  });

  it("shows Paused", async () => {
    session = sessionView({ status: "paused" });
    await openBar();
    expect(bar()).toHaveTextContent("Paused");
    expect(screen.getByRole("button", { name: "Resume" })).toBeVisible();
  });

  it("shows Source lost for app audio, framed in red", async () => {
    observations = [disconnected(1, "application-audio", "device-lost")];
    await openBar();
    expect(bar()).toHaveAttribute("data-state", "source-lost");
    expect(bar()).toHaveTextContent("Source lost");
    expect(bar().className).toContain("bordered");
    expect(bar()).toHaveTextContent("App audio lost");
  });

  it("names a lost microphone and a lost screen capture", async () => {
    observations = [disconnected(1, "microphone", "error")];
    await openBar();
    expect(bar()).toHaveTextContent("Microphone capture lost");
  });

  it("shows a revoked permission under its own label", async () => {
    observations = [disconnected(1, "microphone", "permission-revoked")];
    await openBar();
    expect(bar()).toHaveAttribute("data-state", "permission-revoked");
    expect(bar()).toHaveTextContent("Permission revoked");
    expect(bar()).toHaveTextContent("Microphone permission revoked");
  });

  it("shows Companion offline once contact has gone quiet", async () => {
    session = sessionView({ lastHeartbeatAt: minutesAfter(-5) });
    await openBar();
    expect(bar()).toHaveAttribute("data-state", "companion-offline");
    expect(bar()).toHaveTextContent("Companion offline");
  });

  it("waits for the companion and never claims it is connected", async () => {
    session = sessionView({ status: "created", lastHeartbeatAt: null });
    await openBar();
    expect(bar()).toHaveAttribute("data-state", "waiting");
    expect(bar()).toHaveTextContent("Waiting for companion");
    expect(bar()).not.toHaveTextContent(/connected|receiving|Live/);
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });

  it("shows the processing locality, on this Mac only", async () => {
    await openBar();
    const chip = screen.getByTestId("locality-chip");
    expect(chip).toHaveTextContent("On this Mac only");
    expect(chip).toHaveAttribute("data-policy", "device-only");
    expect(chip.getAttribute("title")).toMatch(/refused, never sent elsewhere/);
  });

  it("shows when remote processing is allowed", async () => {
    session = sessionView({
      processingPolicy: "permitted-remote",
      lastHeartbeatAt: minutesAfter(1),
    });
    await openBar();
    const chip = screen.getByTestId("locality-chip");
    expect(chip).toHaveTextContent("Remote allowed");
    expect(chip).toHaveAttribute("data-policy", "permitted-remote");
    expect(chip.className).toContain("amber");
  });
});

describe("source chips", () => {
  it("has a chip per selected source with an accessible state", async () => {
    observations = [
      transcript(1, "Hello there", { sourceId: "microphone" }),
      transcript(2, "A question", { sourceId: "application-audio" }),
    ];
    await openBar();
    const list = screen.getByRole("list", { name: "Capture sources" });
    expect(within(list).getByTitle("Microphone · receiving")).toHaveTextContent(
      "Microphone, receiving",
    );
    expect(within(list).getByTitle("App audio · receiving")).toBeTruthy();
    expect(within(list).queryByTitle(/Screen/)).toBeNull();
  });

  it("marks the lost chip red and the revoked chip amber with its reason", async () => {
    observations = [
      disconnected(1, "application-audio", "device-lost"),
      disconnected(2, "microphone", "permission-revoked"),
    ];
    await openBar();
    const lost = screen.getByTitle("App audio · disconnected, device lost");
    expect(lost.className).toContain("red");
    const revoked = screen.getByTitle(/^Microphone · permission revoked/);
    expect(revoked.className).toContain("amber");
    expect(revoked).toHaveAttribute("data-reason", "permission-revoked");
  });
});

describe("pause and resume", () => {
  it("pauses, says what that does, and offers Resume", async () => {
    await openBar();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await flush();
    expect(server.count("POST /:id/control")).toBe(1);
    expect(bar()).toHaveTextContent("Paused");
    expect(bar()).toHaveTextContent(
      "Running work is being cancelled and nothing new will start",
    );
    expect(screen.getByRole("button", { name: "Resume" })).toBeVisible();
  });

  it("resumes", async () => {
    session = sessionView({ status: "paused" });
    await openBar();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await flush();
    expect(bar()).toHaveTextContent("Resumed.");
    expect(screen.getByRole("button", { name: "Pause" })).toBeVisible();
  });

  it("renews the credential and resumes when the server asks for it", async () => {
    session = sessionView({ status: "paused" });
    let attempts = 0;
    server.on("POST /:id/control", ({ body }) => {
      if ((body as { action: string }).action !== "resume")
        return jsonResponse({ session });
      attempts += 1;
      if (attempts === 1)
        return jsonResponse(
          { error: { code: "credential_renewal_required" } },
          409,
        );
      session = sessionView({ status: "active" });
      return jsonResponse({ session });
    });
    server.on("POST /:id/credential", () =>
      jsonResponse({
        credential: { value: "one-time", expiresAt: minutesAfter(120) },
      }),
    );
    await openBar();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await flush();
    expect(server.count("POST /:id/credential")).toBe(1);
    expect(server.count("POST /:id/control")).toBe(2);
    expect(bar()).toHaveTextContent(
      "Resumed with a renewed capture credential",
    );
    expect(screen.getByRole("button", { name: "Pause" })).toBeVisible();
  });

  it("shows the code-mapped error on a 409 and stays paused", async () => {
    session = sessionView({ status: "paused" });
    server.on("POST /:id/control", () =>
      jsonResponse({ error: { code: "duration_cap_reached" } }, 409),
    );
    await openBar();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await flush();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("This session reached its time limit.");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(bar()).toHaveTextContent("Paused");
  });

  it("clears a notice by itself", async () => {
    await openBar();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await flush();
    expect(bar()).toHaveTextContent("Running work is being cancelled");
    await advance(6_000);
    expect(bar()).not.toHaveTextContent("Running work is being cancelled");
  });

  it("disables the button and sets aria-busy while a command is pending", async () => {
    let release: () => void = () => undefined;
    server.on(
      "POST /:id/control",
      () =>
        new Promise<Response>((resolve) => {
          release = () => {
            session = sessionView({ status: "paused" });
            resolve(jsonResponse({ session }));
          };
        }),
    );
    await openBar();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await flush();
    const busy = screen.getByRole("button", { name: "Pause" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    release();
    await flush();
    expect(screen.getByRole("button", { name: "Resume" })).toBeEnabled();
  });
});

describe("end", () => {
  async function askEnd() {
    await openBar();
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    return screen.getByRole("alertdialog");
  }

  it("asks first, with copy that matches what the session does", async () => {
    const dialog = await askEnd();
    expect(dialog).toHaveAccessibleName("End this session?");
    expect(dialog).toHaveAccessibleDescription(
      "Studio stops accepting capture, cancels running work and discards any result that arrives later. This can’t be undone.",
    );
    expect(server.count("POST /:id/control")).toBe(0);
  });

  it("moves focus into the dialog, onto the safe choice", async () => {
    const dialog = await askEnd();
    expect(
      within(dialog).getByRole("button", { name: "Keep going" }),
    ).toHaveFocus();
  });

  it("Keep going closes it, returns focus to End and does nothing else", async () => {
    const dialog = await askEnd();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep going" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "End" })).toHaveFocus();
    expect(server.count("POST /:id/control")).toBe(0);
    expect(bar()).toHaveAttribute("data-state", "live");
  });

  it("Escape closes it and returns focus to End", async () => {
    const dialog = await askEnd();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "End" })).toHaveFocus();
    expect(server.count("POST /:id/control")).toBe(0);
  });

  it("keeps Tab inside the dialog", async () => {
    const dialog = await askEnd();
    const keep = within(dialog).getByRole("button", { name: "Keep going" });
    const end = within(dialog).getByRole("button", { name: "End session" });
    end.focus();
    fireEvent.keyDown(end, { key: "Tab" });
    expect(keep).toHaveFocus();
    fireEvent.keyDown(keep, { key: "Tab", shiftKey: true });
    expect(end).toHaveFocus();
  });

  it("a click outside keeps going and does not reach the page beneath", async () => {
    const underneath = vi.fn();
    window.history.replaceState({}, "", "/t/local/p/interview");
    render(
      <>
        <button type="button" onClick={underneath}>
          Page action
        </button>
        <SessionBar variant="bar" onOpen={onOpen} />
      </>,
    );
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    fireEvent.click(screen.getByTestId("end-scrim"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(underneath).not.toHaveBeenCalled();
    expect(server.count("POST /:id/control")).toBe(0);
  });

  it("End session ends the session and the bar goes away", async () => {
    const dialog = await askEnd();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "End session" }),
    );
    await flush();
    expect(server.count("POST /:id/control")).toBe(1);
    expect(screen.queryByTestId("session-bar")).toBeNull();
  });

  it("shows the reason and closes the dialog when ending fails", async () => {
    server.on("POST /:id/control", () =>
      jsonResponse({ error: { code: "job_cancellation_failed" } }, 503),
    );
    const dialog = await askEnd();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "End session" }),
    );
    await flush();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /couldn’t be cancelled/,
    );
    expect(screen.getByRole("button", { name: "End" })).toBeEnabled();
  });

  it("stays available while the stream is failing", async () => {
    server.on("GET /:id/stream", () => {
      throw new TypeError("offline");
    });
    await openBar();
    await advance(6_000);
    const end = screen.getByRole("button", { name: "End" });
    expect(end).toBeEnabled();
    fireEvent.click(end);
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    await flush();
    expect(server.count("POST /:id/control")).toBe(1);
  });
});

describe("controls and names", () => {
  it("Open returns to the session", async () => {
    await openBar();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("gives every control and region an accessible name", async () => {
    await openBar();
    expect(screen.getByRole("region", { name: "Session control" })).toBe(bar());
    for (const name of ["Open", "Pause", "End"])
      expect(screen.getByRole("button", { name })).toBeVisible();
    expect(screen.getByRole("list", { name: "Capture sources" })).toBeVisible();
    for (const button of within(bar()).getAllByRole("button"))
      expect(button).toHaveAccessibleName();
  });
});

describe("target title", () => {
  const choices = {
    candidacies: [
      {
        id: CANDIDACY_ID,
        title: "Senior Engineer",
        companyName: "Example Corp",
        createdAt: minutesAfter(-60),
        interviews: [
          {
            id: INTERVIEW_ID,
            label: "Technical screen",
            kind: "screening",
            scheduledAt: null,
          },
        ],
      },
    ],
    profiles: [],
  };

  it("falls back to Rehearsal for a session with no Interview", async () => {
    await openBar();
    expect(within(bar()).getByText("Rehearsal")).toBeVisible();
    expect(server.count("GET /choices")).toBe(0);
  });

  it("names the linked Interview from the setup choices", async () => {
    session = sessionView({
      interviewId: INTERVIEW_ID,
      candidacyId: CANDIDACY_ID,
      lastHeartbeatAt: minutesAfter(1),
    });
    server.on("GET /choices", () => jsonResponse(choices));
    await openBar();
    expect(
      within(bar()).getByText("Senior Engineer · Technical screen"),
    ).toBeVisible();
  });

  it("shows Live session when the choices cannot be read, without blocking", async () => {
    session = sessionView({
      interviewId: INTERVIEW_ID,
      candidacyId: CANDIDACY_ID,
      lastHeartbeatAt: minutesAfter(1),
    });
    server.on("GET /choices", () =>
      jsonResponse({ error: { code: "session_unavailable" } }, 500),
    );
    await openBar();
    expect(within(bar()).getByText("Live session")).toBeVisible();
    expect(screen.getByRole("button", { name: "End" })).toBeEnabled();
  });
});

describe("phone width", () => {
  const css = readFileSync(
    join(
      process.cwd(),
      "products/interview/src/frontend/studio/live/session-bar.css",
    ),
    "utf8",
  );
  it("wraps instead of scrolling", () => {
    const rule = /\.live-session-bar\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(rule).toContain("flex-wrap: wrap");
    expect(css).not.toMatch(/overflow-x/);
    expect(rule).not.toMatch(/(?<!-)width:\s*\d+px/);
  });
  it("collapses chips to icons under 560 px", () => {
    expect(css).toMatch(/@media \(max-width: 560px\)/);
    expect(css).toContain(".live-chip-text");
  });
  it("keeps touch targets at least 40 px and the popover inside the screen", () => {
    expect(css).toMatch(/\.live-bar-button\s*\{[^}]*min-height: 40px/);
    expect(css).toContain("min(320px, calc(100vw - 24px))");
  });
  it("uses Studio tokens, not colour literals", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,6}\b(?!\))/);
  });
});
