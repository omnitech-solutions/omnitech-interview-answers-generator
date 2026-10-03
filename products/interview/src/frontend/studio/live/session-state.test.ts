import type {
  LiveAction,
  LiveObservation,
  LiveSessionView,
} from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { CAP_NEAR_MS } from "./session-banners";
import {
  action,
  disconnected,
  gap,
  minutesAfter,
  sessionView,
  snapshot,
  stored,
  transcript,
} from "./session-fixtures";
import {
  answerResult,
  codeResult,
  codingAnswer,
} from "./session-result-fixtures";
import { deriveLiveModel } from "./session-state";

// The server and the browser agree on "now" unless a test moves the offset.
const NOW = Date.parse(minutesAfter(10));
const online = (overrides: Partial<LiveSessionView> = {}) =>
  sessionView({
    lastHeartbeatAt: new Date(NOW - 5_000).toISOString(),
    ...overrides,
  });

function model(
  session: LiveSessionView | null,
  observations: LiveObservation[] = [],
  actions: LiveAction[] = [],
  offset = 0,
) {
  return deriveLiveModel({
    session,
    observations,
    actions,
    serverClockOffsetMs: offset,
    nowMs: NOW - offset,
  });
}
const kinds = (m: ReturnType<typeof model>) => m.banners.map((b) => b.kind);

describe("phase and bar", () => {
  it("has nothing for no session", () => {
    expect(model(null)).toMatchObject({
      phase: "none",
      tasks: [],
      banners: [],
      locality: null,
    });
  });

  it("is live for an active session in contact", () => {
    expect(model(online())).toMatchObject({
      phase: "open",
      barState: "live",
      barLabel: "Live",
      activity: { key: "listening", text: "Listening" },
    });
  });

  it("waits for the companion while created, without claiming a connection", () => {
    const m = model(sessionView({ status: "created" }));
    expect(m.barState).toBe("waiting");
    expect(m.companion.status).toBe("never-seen");
    expect(m.activity.key).toBe("companion-waiting");
  });

  it("shows paused and source lost", () => {
    expect(model(online({ status: "paused" })).barState).toBe("paused");
    expect(
      model(online(), [disconnected(1, "application-audio", "device-lost")])
        .barState,
    ).toBe("source-lost");
  });

  it("is finished for ended and for purging", () => {
    expect(
      model(online({ status: "ended", endedAt: minutesAfter(8) })).phase,
    ).toBe("finished");
    expect(model(online({ status: "purging" })).phase).toBe("finished");
    expect(model(online({ status: "ended" })).banners).toEqual([]);
  });
});

describe("elapsed", () => {
  it("comes from the server's clock, not the browser's alone", () => {
    // Browser reads 12:09:00 but the server says 12:10:00 (offset +60 s).
    const m = deriveLiveModel({
      session: online({ createdAt: minutesAfter(0) }),
      observations: [],
      actions: [],
      serverClockOffsetMs: 60_000,
      nowMs: Date.parse(minutesAfter(9)),
    });
    expect(m.serverNowMs).toBe(NOW);
    expect(m.elapsedMs).toBe(10 * 60_000);
    expect(m.elapsedLabel).toBe("10:00");
  });
});

describe("banners in priority order", () => {
  it("orders paused, permission, companion, lost, gap, credential, cap", () => {
    const session = sessionView({
      status: "paused",
      lastHeartbeatAt: new Date(NOW - 600_000).toISOString(),
      credentialExpiresAt: new Date(NOW - 1).toISOString(),
      expiresAt: new Date(NOW + 60_000).toISOString(),
      captureSources: ["microphone", "application-audio", "screen"],
    });
    const m = model(session, [
      gap(1, "screen", "buffer-overflow", 3000),
      disconnected(2, "microphone", "device-lost"),
      disconnected(3, "application-audio", "permission-revoked"),
    ]);
    // Paused suppresses the companion-offline banner (nothing should be captured).
    expect(kinds(m)).toEqual([
      "paused",
      "permission-revoked",
      "source-lost",
      "gap",
      "credential-expired",
      "cap-near",
    ]);
  });

  it("includes the companion banner while the session is live", () => {
    const m = model(
      sessionView({
        lastHeartbeatAt: new Date(NOW - 600_000).toISOString(),
        credentialRevoked: true,
      }),
      [disconnected(1, "microphone", "device-lost")],
    );
    expect(kinds(m)).toEqual([
      "companion-offline",
      "source-lost",
      "credential-revoked",
    ]);
    expect(m.banners[0]).toMatchObject({ tone: "red", neverSeen: false });
  });

  it("says the companion has never been seen, as its own case", () => {
    const m = model(sessionView({ lastHeartbeatAt: null }));
    expect(m.banners[0]).toMatchObject({
      kind: "companion-offline",
      neverSeen: true,
      tone: "amber",
    });
  });

  it("raises no companion banner while it is in contact", () => {
    expect(kinds(model(online()))).toEqual([]);
  });

  it("reports each source's problem separately, with its source", () => {
    const m = model(online({ captureSources: ["microphone", "screen"] }), [
      disconnected(1, "microphone", "user-stopped"),
      disconnected(2, "screen", "error"),
    ]);
    expect(m.banners.map((b) => [b.kind, b.source])).toEqual([
      ["source-lost", "microphone"],
      ["source-lost", "screen"],
    ]);
  });

  it("carries the gap's duration and when it began", () => {
    const m = model(online(), [
      gap(4, "application-audio", "source-interrupted", 9000),
    ]);
    expect(m.banners[0]).toMatchObject({
      kind: "gap",
      source: "application-audio",
      durationMs: 9000,
      since: minutesAfter(0, 4),
    });
  });

  it("warns as the credential nears expiry", () => {
    const m = model(
      online({ credentialExpiresAt: new Date(NOW + 5 * 60_000).toISOString() }),
    );
    expect(kinds(m)).toEqual(["credential-expiring"]);
  });

  it("warns near the duration cap, and again when it is reached", () => {
    const near = model(
      online({ expiresAt: new Date(NOW + CAP_NEAR_MS).toISOString() }),
    );
    expect(near.banners).toEqual([
      { kind: "cap-near", tone: "amber", remainingMs: CAP_NEAR_MS },
    ]);
    const reached = model(
      online({ expiresAt: new Date(NOW - 1).toISOString() }),
    );
    expect(kinds(reached)).toEqual(["cap-reached"]);
    expect(reached.cap).toMatchObject({ reached: true, remainingMs: 0 });
  });
});

describe("activity by priority", () => {
  const withActions = (
    actions: LiveAction[],
    extra: Partial<LiveSessionView> = {},
  ) => model(online(extra), [], actions).activity;

  it("puts paused first, then a lost source", () => {
    expect(
      model(online({ status: "paused" }), [
        disconnected(1, "application-audio", "device-lost"),
      ]).activity,
    ).toEqual({ key: "paused", text: "Paused" });
    expect(
      model(online(), [disconnected(1, "application-audio", "device-lost")])
        .activity,
    ).toEqual({ key: "source-lost", text: "App audio lost" });
    expect(
      model(online(), [disconnected(1, "microphone", "permission-revoked")])
        .activity.text,
    ).toBe("Microphone permission revoked");
  });

  it("reads coding drafts, the coding task, drafting, then ready states", () => {
    const codingTask = (overrides: Parameters<typeof action>[0]) =>
      action({ taskId: "c", ...overrides });
    expect(
      withActions([
        codingTask({ actionKind: "draft-answer", result: codingAnswer(["A"]) }),
        codingTask({
          actionKind: "solve-code",
          taskRevision: 1,
          dispatchStatus: "in_flight",
        }),
      ]),
    ).toEqual({ key: "coding-draft", text: "Coding draft · task rev 1" });
    expect(
      withActions([
        codingTask({
          actionKind: "draft-answer",
          result: codingAnswer(["A"]),
          taskRevision: 1,
        }),
        codingTask({
          actionKind: "draft-answer",
          dispatchStatus: "in_flight",
          taskRevision: 2,
        }),
      ]).text,
    ).toBe("Restating the coding task");
    expect(
      withActions([action({ taskId: "q", dispatchStatus: "in_flight" })]).text,
    ).toBe("Drafting an answer");
    expect(
      withActions([
        action({
          taskId: "q",
          dispatchStatus: "succeeded",
          result: answerResult(),
        }),
      ]).text,
    ).toBe("Answer ready");
    expect(
      withActions([
        action({ taskId: "c", actionKind: "solve-code", result: codeResult() }),
      ]).text,
    ).toBe("Code draft ready");
  });

  it("goes back to listening once the conversation moves past the result", () => {
    const published = action({
      taskId: "q",
      dispatchStatus: "succeeded",
      result: answerResult(),
      updatedAt: minutesAfter(1),
    });
    const later = transcript(9, "next question", {
      receivedAt: minutesAfter(2),
    });
    expect(model(online(), [later], [published]).activity.key).toBe(
      "listening",
    );
    const earlier = transcript(9, "before", {
      receivedAt: minutesAfter(0, 30),
    });
    expect(model(online(), [earlier], [published]).activity.key).toBe(
      "answer-ready",
    );
  });

  it("says when the companion has gone quiet instead of claiming to listen", () => {
    expect(
      model(
        sessionView({ lastHeartbeatAt: new Date(NOW - 900_000).toISOString() }),
      ).activity,
    ).toEqual({ key: "companion-offline", text: "Companion offline" });
  });
});

describe("locality", () => {
  it("says On this Mac only for device-only and cannot be tightened", () => {
    expect(
      model(online({ processingPolicy: "device-only" })).locality,
    ).toMatchObject({
      label: "On this Mac only",
      tone: "green",
      canTighten: false,
    });
  });

  it("says Remote allowed for permitted-remote, and offers to tighten while open", () => {
    expect(
      model(online({ processingPolicy: "permitted-remote" })).locality,
    ).toMatchObject({
      label: "Remote allowed",
      tone: "amber",
      canTighten: true,
    });
    expect(
      model(online({ processingPolicy: "permitted-remote", status: "ended" }))
        .locality?.canTighten,
    ).toBe(false);
  });
});

describe("transcript rows", () => {
  it("labels each utterance by its capture source, not by a person", () => {
    const m = model(online(), [
      transcript(1, "Tell me about a project.", {
        sourceId: "application-audio",
        speaker: "speaker-1",
      }),
      transcript(2, "Sure.", { sourceId: "microphone", speaker: "speaker-2" }),
    ]);
    expect(
      m.transcript.map((r) => r.type === "utterance" && r.sourceLabel),
    ).toEqual(["App audio", "Microphone"]);
  });

  it("includes screenshots, gaps and disconnects as rows, in order", () => {
    const m = model(online(), [
      transcript(1, "Question one."),
      snapshot(2, "Shared editor"),
      gap(3, "application-audio", "source-interrupted", 4000),
      disconnected(4, "application-audio", "device-lost"),
    ]);
    expect(m.transcript.map((r) => r.type)).toEqual([
      "utterance",
      "screenshot",
      "gap",
      "disconnect",
    ]);
    expect(m.transcript[1]).toMatchObject({
      windowLabel: "Shared editor",
      artifactId: "artifact-2",
    });
  });

  it("marks a corrected segment superseded and keeps it", () => {
    const corrected = transcript(1, "npm audit", { eventId: "e1" });
    const fix = {
      ...transcript(2, "npm adit corrected"),
      content: stored(2, {
        speaker: "speaker-1",
        text: "npm audit",
        startMs: 0,
        endMs: 5,
        supersedes: "e1",
      }),
    };
    const rows = model(online(), [corrected, fix]).transcript;
    expect(rows[0]).toMatchObject({ type: "utterance", superseded: true });
    expect(rows[1]).toMatchObject({
      type: "utterance",
      superseded: false,
      correctsEventId: "e1",
    });
  });

  it("marks only the corrected segment of the same source: event ids repeat across sources", () => {
    const mic = transcript(1, "npm adit", {
      eventId: "e1",
      sourceId: "microphone",
    });
    const app = transcript(2, "A different line", {
      eventId: "e1",
      sourceId: "application-audio",
    });
    const fix = {
      ...transcript(3, "npm audit", {
        eventId: "e2",
        sourceId: "microphone",
      }),
      content: stored(3, {
        speaker: "speaker-1",
        text: "npm audit",
        startMs: 0,
        endMs: 5,
        supersedes: "e1",
      }),
    };
    const rows = model(online(), [mic, app, fix]).transcript;
    expect(
      rows.map((row) => row.type === "utterance" && row.superseded),
    ).toEqual([true, false, false]);
    // Rows are keyed by source and event together.
    const keys = rows.map((row) =>
      row.type === "utterance" ? `${row.sourceId}:${row.eventId}` : "",
    );
    expect(new Set(keys).size).toBe(3);
  });

  it("drops observations whose content is malformed", () => {
    const broken = {
      ...transcript(1, "x"),
      content: stored(1, { speaker: 3 }),
    };
    expect(model(online(), [broken]).transcript).toEqual([]);
  });

  it("marks where each task revision began, before the next line heard", () => {
    const rows = model(
      online(),
      [
        transcript(1, "Question", { receivedAt: minutesAfter(1) }),
        transcript(2, "Later chatter", { receivedAt: minutesAfter(3) }),
      ],
      [
        action({
          taskId: "t",
          taskRevision: 1,
          createdAt: minutesAfter(2),
          result: answerResult(),
        }),
        action({
          taskId: "t",
          taskRevision: 2,
          createdAt: minutesAfter(4),
          dispatchStatus: "in_flight",
        }),
      ],
    ).transcript;
    expect(
      rows.map((r) =>
        r.type === "new-task" ? `task rev ${r.revision}` : r.type,
      ),
    ).toEqual(["utterance", "task rev 1", "utterance", "task rev 2"]);
    expect(rows[3]).toMatchObject({ revised: true });
    expect(rows[1]).toMatchObject({
      revised: false,
      kind: "experience-question",
    });
  });
});

describe("stats", () => {
  it("counts what the ended view summarises", () => {
    const m = model(
      online({ status: "ended", shownDraftCount: 2 }),
      [
        transcript(1, "a"),
        transcript(2, "b"),
        snapshot(3),
        gap(4, "microphone", "error"),
      ],
      [
        action({ taskId: "q", result: answerResult() }),
        action({ taskId: "c", actionKind: "solve-code", result: codeResult() }),
        action({
          taskId: "z",
          dispatchStatus: "suppressed",
          suppressionReason: "session_ended",
        }),
      ],
    );
    expect(m.stats).toEqual({
      utterances: 2,
      screenshots: 1,
      gaps: 1,
      tasks: 3,
      answersPublished: 1,
      codeDraftsPublished: 1,
      hintsCounted: 2,
    });
    expect(m.runs).toHaveLength(3);
  });
});
