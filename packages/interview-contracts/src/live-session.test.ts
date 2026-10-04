import { describe, expect, it } from "vitest";
import {
  LIVE_SESSION_ERROR_CODES,
  LIVE_SESSION_ERROR_STATUS,
  liveCompanionCapabilityResponseSchema,
  liveOwnerInputRequestSchema,
  liveSessionControlRequestSchema,
  liveSessionErrorBodySchema,
  liveSessionListQuerySchema,
  liveSessionStartRequestSchema,
  liveSessionViewSchema,
  liveStreamResponseSchema,
  liveWithheldResultSchema,
} from "./live-session.js";

const ID = "6f1c1d1e-2b0f-4f43-9a55-7d6f3c0c9a10";
const view = {
  id: ID,
  status: "active",
  retention: "delete-at-end",
  processingPolicy: "permitted-remote",
  createdAt: "2026-10-03T10:00:00.000Z",
  expiresAt: "2026-10-03T14:00:00.000Z",
  credentialExpiresAt: "2026-10-03T12:00:00.000Z",
  credentialRevoked: false,
  captureSources: ["microphone"],
  liveAssistance: true,
  strict: false,
  rehearsalRunId: null,
  interviewId: null,
  candidacyId: null,
  profile: null,
  workspaceDraft: null,
  lastHeartbeatAt: null,
  endedAt: null,
  purged: false,
  purgeOutcome: null,
  shownDraftCount: 0,
};

describe("live session contract", () => {
  it("parses a session view and strips fields it does not know", () => {
    const parsed = liveSessionViewSchema.parse({ ...view, extra: "x" });
    expect(parsed).not.toHaveProperty("extra");
    expect(
      liveSessionViewSchema.safeParse({ ...view, status: "running" }).success,
    ).toBe(false);
  });

  it("rejects identity and unknown fields in a start request", () => {
    const start = {
      processingPolicy: "device-only",
      captureSources: ["microphone"],
    };
    expect(liveSessionStartRequestSchema.safeParse(start).success).toBe(true);
    expect(
      liveSessionStartRequestSchema.safeParse({ ...start, ownerUserId: ID })
        .success,
    ).toBe(false);
    expect(
      liveSessionStartRequestSchema.safeParse({ ...start, captureSources: [] })
        .success,
    ).toBe(false);
  });

  it("requires the versioned control message", () => {
    const control = { version: 1, kind: "session.control", action: "pause" };
    expect(liveSessionControlRequestSchema.safeParse(control).success).toBe(
      true,
    );
    expect(
      liveSessionControlRequestSchema.safeParse({ action: "pause" }).success,
    ).toBe(false);
  });

  it("bounds list paging", () => {
    expect(liveSessionListQuerySchema.parse({ limit: "50" }).limit).toBe(50);
    expect(liveSessionListQuerySchema.safeParse({ limit: "101" }).success).toBe(
      false,
    );
  });

  it("types a stored observation as the companion clock and sequence around the wire body", () => {
    const observation = {
      sequence: 1,
      sourceId: "microphone",
      eventId: "e1",
      kind: "transcript.final",
      receivedAt: "2026-10-03T10:00:00.000Z",
      screenshotArtifactId: null,
    };
    const page = (content: unknown) =>
      liveStreamResponseSchema.safeParse({
        session: view,
        observations: [{ ...observation, content }],
        actions: [],
        nextAfterSequence: 1,
        nextActionCursor: "c",
        hasMoreObservations: false,
        hasMoreActions: false,
        serverNow: "2026-10-03T10:00:01.000Z",
      });
    expect(
      page({
        occurredAt: "2026-10-03T10:00:00.000Z",
        sourceSequence: 0,
        body: { text: "x" },
      }).success,
    ).toBe(true);
    // The flat wire shape is not what is stored: it is refused, not guessed at.
    expect(page({ text: "x" }).success).toBe(false);
  });

  it("accepts a stream page with its cursors and the server clock", () => {
    const page = {
      session: view,
      observations: [],
      actions: [
        {
          id: ID,
          taskId: "t1",
          taskRevision: 1,
          actionKind: "draft-answer",
          dispatchStatus: "in_flight",
          attempt: 1,
          fenceAtDispatch: 1,
          jobId: null,
          jobCreated: false,
          result: null,
          shown: false,
          suppressionReason: null,
          createdAt: "2026-10-03T10:00:00.000Z",
          updatedAt: "2026-10-03T10:00:01.000Z",
        },
      ],
      nextAfterSequence: 0,
      nextActionCursor: "abc",
      hasMoreObservations: false,
      hasMoreActions: false,
      serverNow: "2026-10-03T10:00:02.000Z",
    };
    expect(liveStreamResponseSchema.safeParse(page).success).toBe(true);
    expect(
      liveStreamResponseSchema.safeParse({ ...page, serverNow: undefined })
        .success,
    ).toBe(false);
  });

  it("closes the error code list and gives each code a status", () => {
    expect(
      liveSessionErrorBodySchema.safeParse({ error: { code: "not_found" } })
        .success,
    ).toBe(true);
    expect(
      liveSessionErrorBodySchema.safeParse({ error: { code: "boom" } }).success,
    ).toBe(false);
    for (const code of LIVE_SESSION_ERROR_CODES)
      expect(LIVE_SESSION_ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
  });
});

describe("liveWithheldResultSchema", () => {
  it("accepts a count and codes and rejects a negative count", () => {
    const withheld = {
      rejectedClaimCount: 2,
      codes: ["unsupported_reference"],
    };
    expect(liveWithheldResultSchema.parse({ withheld })).toEqual({ withheld });
    expect(
      liveWithheldResultSchema.safeParse({
        withheld: { rejectedClaimCount: -1, codes: [] },
      }).success,
    ).toBe(false);
  });
});

describe("companion capability response", () => {
  const capability = {
    reportedAt: "2026-10-03T10:00:00.000Z",
    speech: {
      locale: "en-GB",
      onDeviceAvailable: false,
      recognizerAvailable: true,
      authorizationStatus: "authorized",
    },
    permissions: { microphone: "granted", screen: "not-determined" },
  };

  it("parses a report and a null before the first report", () => {
    expect(
      liveCompanionCapabilityResponseSchema.safeParse({ capability }).success,
    ).toBe(true);
    expect(
      liveCompanionCapabilityResponseSchema.parse({ capability: null }),
    ).toEqual({ capability: null });
  });

  it("refuses a state outside the closed sets and carries no identity", () => {
    const bad = {
      capability: {
        ...capability,
        permissions: { microphone: "maybe", screen: "granted" },
      },
    };
    expect(liveCompanionCapabilityResponseSchema.safeParse(bad).success).toBe(
      false,
    );
    const parsed = liveCompanionCapabilityResponseSchema.parse({
      capability: { ...capability, ownerUserId: ID },
    });
    expect(JSON.stringify(parsed)).not.toContain(ID);
  });
});

describe("owner input request", () => {
  const shot = { sourceId: "screen", eventId: "evt-2" };
  const ok = (body: unknown) => liveOwnerInputRequestSchema.safeParse(body);

  it("takes an analyze that names snapshots, and a follow-up that carries text", () => {
    expect(
      ok({ requestId: "r-1", operation: "analyze", snapshots: [shot] }).success,
    ).toBe(true);
    expect(
      ok({
        requestId: "r-2",
        operation: "follow-up",
        text: "and the cost?",
        target: { taskId: "task-q1", revision: 2 },
        snapshots: [],
      }).success,
    ).toBe(true);
  });

  it("refuses an analyze with no snapshot, a follow-up with no text or with images, and extras", () => {
    for (const body of [
      { requestId: "r", operation: "analyze", snapshots: [] },
      { requestId: "r", operation: "follow-up", snapshots: [] },
      { requestId: "r", operation: "follow-up", text: "x", snapshots: [shot] },
      {
        requestId: "r",
        operation: "analyze",
        snapshots: [shot],
        bytes: "AAAA",
      },
      {
        requestId: "r",
        operation: "analyze",
        snapshots: [shot],
        ownerUserId: ID,
      },
      {
        requestId: "r",
        operation: "analyze",
        snapshots: [shot, shot, shot, shot, shot],
      },
      { requestId: "bad id!", operation: "analyze", snapshots: [shot] },
      {
        requestId: "r",
        operation: "follow-up",
        text: "x".repeat(2_001),
        snapshots: [],
      },
      {
        requestId: "r",
        operation: "analyze",
        snapshots: [{ sourceId: "../x", eventId: "e" }],
      },
    ])
      expect(ok(body).success).toBe(false);
  });
});
