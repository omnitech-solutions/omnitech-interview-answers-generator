// The Studio session UI end to end, through the real shell, the real store and
// the real routes' wire shapes (a scripted service, no browser): setup, consent,
// start, pairing, the live stream, navigation, reload, the degraded states,
// End and Delete. Browser rendering, the real companion and a real model are
// outside what this can show.
import type { AssistantConfig } from "@omnitech-assistant/react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Studio } from "../studio";
import {
  CANDIDACY_ID,
  INTERVIEW_ID,
  installScriptedService,
  type ScriptedService,
} from "./live-script-kit";
import {
  action,
  disconnected,
  minutesAfter,
  sessionView,
  snapshot,
  transcript,
} from "./session-fixtures";
import { resetSessionStores } from "./session-registry";
import {
  answerResult,
  codeResult,
  codingAnswer,
} from "./session-result-fixtures";

vi.mock("@omnitech-assistant/react", () => ({
  AssistantRoot: ({
    children,
  }: {
    config: AssistantConfig;
    children: React.ReactNode;
  }) => <div className="oa-root">{children}</div>,
  useAssistantHost: () => ({
    open: false,
    shortcut: "⌘J",
    toggle: () => undefined,
  }),
  Icon: () => <svg />,
}));
// The other views are stand-ins: this file is about the session, not them.
vi.mock("../workspace/workspace-view", () => ({
  WorkspaceView: () => <div>Workspace view</div>,
}));
vi.mock("../briefings/briefings-view", () => ({
  BriefingsView: () => <div>Briefings view</div>,
}));
vi.mock("../documents/documents-view", () => ({
  DocumentsView: () => <div>Documents view</div>,
}));
vi.mock("../home/home-view", () => ({ HomeView: () => <div>Home view</div> }));
vi.mock("../rehearsal/rehearsal-view", () => ({
  RehearsalView: () => <div>Rehearsal view</div>,
}));
vi.mock("../../library", () => ({ Library: () => <div>Library view</div> }));

const assistant = {
  client: {} as never,
  workspaceId: "interview",
  profileId: "local-interview",
};

let service: ScriptedService;

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

async function openStudio(path = "/t/local/p/interview/live") {
  window.history.replaceState({}, "", path);
  const view = render(<Studio assistant={assistant} />);
  await flush();
  return view;
}
// findBy* waits on timers, which are fake here: settle fetches by hand instead.
async function ready<T>(find: () => T): Promise<T> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return find();
    } catch {
      await flush();
    }
  }
  return find();
}
const go = (view: string) => fireEvent.click(screen.getByTitle(view));
const bar = () => screen.getByTestId("session-bar");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  resetSessionStores();
  sessionStorage.clear();
  service = installScriptedService();
});
afterEach(() => {
  resetSessionStores();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Setup through Start: the interview, the consent box, the button.
async function startFromSetup() {
  await openStudio();
  fireEvent.click(await ready(() => screen.getByLabelText(/Recruiter screen/)));
  fireEvent.click(screen.getByLabelText(/Everyone in this interview/));
  fireEvent.click(screen.getByRole("button", { name: "Start session" }));
  await flush();
}

// The companion's first contact, stamped by the server on the server's clock.
async function companionContact() {
  service.patch({
    status: "active",
    lastHeartbeatAt: new Date(Date.now() + service.script.skewMs).toISOString(),
  });
  await advance(1_000);
}

describe("start", () => {
  it("is refused until the interview and the consent are chosen, then sends exactly the chosen request", async () => {
    await openStudio();
    expect(screen.getByTestId("live-setup")).toBeVisible();
    const start = () => screen.getByRole("button", { name: "Start session" });
    expect(start()).toBeDisabled();
    fireEvent.click(
      await ready(() => screen.getByLabelText(/Recruiter screen/)),
    );
    expect(start()).toBeDisabled();
    expect(screen.getByText("Confirm that everyone has agreed.")).toBeVisible();
    fireEvent.click(screen.getByLabelText(/Everyone in this interview/));
    expect(start()).toBeEnabled();
    fireEvent.click(start());
    await flush();

    expect(service.script.started).toEqual([
      {
        processingPolicy: "device-only",
        captureSources: ["microphone", "application-audio"],
        liveAssistance: true,
        retention: "delete-at-end",
        candidacyId: CANDIDACY_ID,
        interviewId: INTERVIEW_ID,
        profile: { id: "main", revision: 3 },
      },
    ]);
  });

  it("shows the pairing credential once, masked, and says the companion is not yet heard from", async () => {
    await startFromSetup();
    expect(screen.getByTestId("live-panel")).toBeVisible();
    expect(bar()).toHaveAttribute("data-variant", "header");
    const credential = screen.getByTestId("pairing-credential");
    expect(credential).not.toHaveTextContent("pair-credential-0001");
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(credential).toHaveTextContent("pair-credential-0001");
    expect(screen.getByTestId("pairing-status")).toHaveTextContent(
      "No contact yet",
    );
    // The companion is optional: one line says it is not connected, nothing waits.
    expect(screen.getByTestId("companion-chip")).toHaveTextContent(
      "Capture companion: not connected",
    );
    expect(bar()).not.toHaveTextContent(/Waiting|receiving/i);

    // Handed over: dismissed, it is gone and never comes back from the server.
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("pairing-credential")).toBeNull();
    expect(document.body).not.toHaveTextContent("pair-credential-0001");
  });
});

describe("a live session", () => {
  async function live() {
    await startFromSetup();
    await companionContact();
  }

  it("follows the stream: listening, an experience answer with its chips, then a coding task whose constraint changes", async () => {
    await live();
    expect(bar()).toHaveTextContent("Live");
    expect(screen.getByText("Ready")).toBeVisible();

    // A question and its source-backed answer.
    service.script.observations.push(
      transcript(1, "Tell me about a migration you led."),
    );
    service.script.actions.push(
      action({
        taskId: "task-1",
        taskRevision: 1,
        actionKind: "draft-answer",
        result: answerResult(),
        shown: true,
      }),
    );
    await advance(1_000);
    expect(screen.getByText("Experience question")).toBeVisible();
    expect(
      screen.getByText(
        "I led the migration at Example Corp and kept the service up.",
      ),
    ).toBeVisible();
    expect(screen.getAllByText(/From your matrix/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Suggested framing · not a claim/).length).toBe(
      1,
    );
    expect(
      screen.getAllByText(/General knowledge · not your experience/).length,
    ).toBe(1);

    // A coding task read from the screen, then a late constraint.
    service.script.observations.push(
      transcript(2, "Please implement a rate limiter."),
      snapshot(3),
    );
    service.script.actions.push(
      action({
        taskId: "task-2",
        taskRevision: 1,
        actionKind: "draft-answer",
        result: codingAnswer(["Single thread"]),
        createdAt: minutesAfter(1, 20),
        updatedAt: minutesAfter(1, 21),
      }),
      action({
        taskId: "task-2",
        taskRevision: 1,
        actionKind: "solve-code",
        result: codeResult(),
        createdAt: minutesAfter(1, 22),
        updatedAt: minutesAfter(1, 23),
      }),
    );
    await advance(1_000);
    expect(screen.getByText("Programming challenge")).toBeVisible();
    expect(screen.getByText("Single thread")).toBeVisible();

    // The interviewer adds a constraint: revision 2, and the revision 1
    // solution is superseded. A revision 1 result that lands late is discarded.
    service.script.observations.push(
      transcript(4, "It must also be O(1) per call."),
    );
    service.script.actions.push(
      action({
        taskId: "task-2",
        taskRevision: 2,
        actionKind: "draft-answer",
        result: codingAnswer(["Single thread", "O(1) per call"]),
        createdAt: minutesAfter(1, 30),
        updatedAt: minutesAfter(1, 31),
      }),
      action({
        taskId: "task-2",
        taskRevision: 1,
        actionKind: "solve-code",
        dispatchStatus: "suppressed",
        suppressionReason: "revision_stale",
        createdAt: minutesAfter(1, 32),
        updatedAt: minutesAfter(1, 33),
      }),
    );
    await advance(1_000);
    expect(screen.getByText("O(1) per call")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    const runs = within(screen.getByRole("list", { name: "Runs" }));
    expect(
      runs.getByText("The task changed before this finished."),
    ).toBeVisible();
    expect(
      runs
        .getAllByRole("listitem")
        .some((item) => item.getAttribute("data-state") === "discarded"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Transcript" }));
    expect(screen.getByText("It must also be O(1) per call.")).toBeVisible();
  });

  it("keeps the bar on every page, on the server's clock, with one poll loop, and pauses and resumes from any page", async () => {
    // The server's clock runs five minutes ahead of this browser's.
    service.script.skewMs = 5 * 60_000;
    await live();
    // The session began ten minutes ago on the server's clock. A bar that
    // subtracted from this browser's clock would read 5 or 15 minutes.
    service.patch({
      createdAt: new Date(
        Date.now() + service.script.skewMs - 10 * 60_000,
      ).toISOString(),
    });
    await advance(1_000);
    expect(bar().querySelector(".live-bar-elapsed")?.textContent).toMatch(
      /^10:0\d$/,
    );
    const streamReads = () => service.server.count("GET /:id/stream");
    const baseline = streamReads();

    const seen: string[] = [];
    for (const view of [
      "Workspace",
      "Briefings",
      "Knowledge",
      "Rehearsal",
      "Documents",
    ]) {
      go(view);
      expect(screen.getAllByTestId("session-bar")).toHaveLength(1);
      expect(bar()).toHaveAttribute("data-variant", "bar");
      await advance(1_000);
      seen.push(bar().querySelector(".live-bar-elapsed")?.textContent ?? "");
    }
    // Ticks forward on every page, one second at a time.
    const seconds = seen.map((label) => {
      const [m, s] = label.split(":").map(Number);
      return (m ?? 0) * 60 + (s ?? 0);
    });
    for (let index = 1; index < seconds.length; index += 1)
      expect((seconds[index] ?? 0) - (seconds[index - 1] ?? 0)).toBe(1);
    // Five pages, five seconds, five reads: one poll loop, never one per page.
    expect(streamReads() - baseline).toBe(5);
    expect(service.server.count("GET /current")).toBe(1);

    // Pause from Documents, resume from Workspace.
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await flush();
    expect(service.script.controls).toEqual(["pause"]);
    expect(bar()).toHaveTextContent("Paused");
    go("Workspace");
    expect(bar()).toHaveTextContent("Paused");
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await flush();
    expect(service.script.controls).toEqual(["pause", "resume"]);
    expect(bar()).toHaveTextContent("Live");
  });

  it("comes back after a hard reload from the server record, with the transcript and without the credential", async () => {
    await live();
    service.script.observations.push(transcript(1, "Tell me about yourself."));
    await advance(1_000);
    // The credential just issued keeps the Sources tab open: read the transcript.
    fireEvent.click(screen.getByRole("tab", { name: "Transcript" }));
    expect(screen.getByTestId("live-panel")).toHaveTextContent(
      "Tell me about yourself.",
    );

    // A reload: the page and every module-level store are gone.
    document.body.innerHTML = "";
    resetSessionStores();
    const reads = service.server.count("GET /current");
    await openStudio();
    expect(service.server.count("GET /current")).toBe(reads + 1);
    expect(screen.getByTestId("live-panel")).toHaveTextContent(
      "Tell me about yourself.",
    );
    expect(bar()).toHaveTextContent("Live");
    expect(screen.queryByTestId("pairing-credential")).toBeNull();
    expect(document.body).not.toHaveTextContent("pair-credential-0001");
    fireEvent.click(screen.getByRole("tab", { name: "Sources" }));
    expect(screen.getByTestId("pairing-panel")).toHaveTextContent(
      "no longer shown",
    );
  });

  it("reaches the degraded states from the stream, each saying only what the server knows", async () => {
    await live();

    // Permission revoked.
    service.script.observations.push(
      disconnected(1, "microphone", "permission-revoked"),
    );
    await advance(1_000);
    expect(bar()).toHaveTextContent("Permission revoked");
    expect(
      screen.getByText(/permission for Microphone was revoked/),
    ).toBeVisible();

    // Another source's capture is lost, and the earlier loss still stands.
    service.script.observations.push(
      disconnected(2, "application-audio", "device-lost"),
    );
    await advance(1_000);
    expect(bar()).toHaveTextContent("Permission revoked");
    expect(screen.getByText(/App audio was lost/)).toBeVisible();

    // The companion goes quiet: its heartbeat is now stale.
    service.patch({ lastHeartbeatAt: minutesAfter(0, 5) });
    service.script.observations = [];
    await advance(3 * 60_000);
    fireEvent.click(screen.getByRole("tab", { name: "Sources" }));
    const row = screen.getByTestId("companion-row");
    expect(row).toHaveTextContent(/No contact for \d+ min/);
    expect(row).not.toHaveTextContent(/In contact/);
    expect(document.body).not.toHaveTextContent(/Connected/);

    // Device-only refusal of coding work, reachable from the stream.
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    service.script.actions.push(
      action({
        taskId: "task-9",
        actionKind: "solve-code",
        dispatchStatus: "suppressed",
        suppressionReason: "policy_refused",
      }),
    );
    await advance(1_000);
    expect(
      within(screen.getByRole("list", { name: "Runs" })).getByText(
        "The processing policy refused it.",
      ),
    ).toBeVisible();
  });

  it("names the microphone when only its capture is lost, and clears it when it speaks again", async () => {
    await live();
    service.script.observations.push(
      disconnected(1, "microphone", "device-lost"),
    );
    await advance(1_000);
    expect(bar()).toHaveTextContent("Microphone capture lost");
    expect(screen.getByText(/Microphone was lost/)).toBeVisible();
    service.script.observations.push(
      transcript(2, "Back again.", { sourceId: "microphone" }),
    );
    await advance(1_000);
    expect(bar()).not.toHaveTextContent("capture lost");
  });
});

describe("ending", () => {
  it("ends through the confirm popover, shows the summary, deletes the data and shows it deleted", async () => {
    await startFromSetup();
    await companionContact();
    service.script.observations.push(transcript(1, "A question was asked."));
    service.script.actions.push(
      action({ taskId: "task-1", result: answerResult(), shown: true }),
    );
    await advance(1_000);

    fireEvent.click(screen.getByRole("button", { name: "End" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("End this session?");
    // Keep going first: the session is untouched.
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep going" }));
    expect(service.script.controls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "End session",
      }),
    );
    await flush();
    expect(service.script.controls).toEqual(["end"]);

    // The ended summary: no bar, results kept, nothing promoted.
    expect(screen.getByTestId("live-ended")).toBeVisible();
    expect(screen.queryByTestId("session-bar")).toBeNull();
    expect(screen.getByTestId("ended-no-promotion")).toBeVisible();
    expect(screen.getByTestId("ended-retention")).toHaveTextContent(
      "Delete at end",
    );

    // Delete the data, behind a confirmation.
    fireEvent.click(
      screen.getByRole("button", { name: "Delete session data" }),
    );
    expect(
      screen.getByRole("group", { name: "Confirm deleting session data" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await flush();
    await advance(5_000);
    expect(service.script.session?.purged).toBe(true);
    expect(screen.getByTestId("ended-retention")).toHaveTextContent("Deleted");
    expect(screen.getByTestId("ended-tombstone")).toBeVisible();
    expect(document.body).not.toHaveTextContent("A question was asked.");

    // And a fresh setup is one click away.
    fireEvent.click(
      screen.getByRole("button", { name: "Start another session" }),
    );
    expect(screen.getByTestId("live-setup")).toBeVisible();
  });
});

describe("a rehearsal session", () => {
  it("starts with a run id and the strict flag, and strict turns assistance off", async () => {
    await openStudio();
    fireEvent.click(await ready(() => screen.getByLabelText(/Rehearsal/)));
    fireEvent.click(screen.getByLabelText(/Everyone in this interview/));
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    await flush();
    const [request] = service.script.started;
    expect(request?.rehearsal?.strict).toBe(false);
    expect(request?.rehearsal?.runId).toMatch(/\S{8,}/);
    expect(request?.liveAssistance).toBe(true);
    expect(request).not.toHaveProperty("candidacyId");
    // Not asserted here: the hint count, which the server derives.
    expect(sessionView().rehearsalRunId).toBeNull();
  });
});
