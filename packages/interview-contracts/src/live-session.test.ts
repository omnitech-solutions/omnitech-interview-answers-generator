import { describe, expect, it } from "vitest";
import {
  LIVE_OCR_LIMITS,
  LIVE_OWNER_CAPTURE_MIN_SIDE,
  LIVE_OWNER_INPUT_MAX_SNAPSHOTS,
  LIVE_SESSION_ERROR_CODES,
  LIVE_SESSION_ERROR_STATUS,
  liveActionSchema,
  liveCaptureRequestSchema,
  liveCodeTestSchema,
  liveCompanionCapabilityResponseSchema,
  liveOwnerCaptureRequestSchema,
  liveOwnerCaptureResponseSchema,
  liveOwnerInputRequestSchema,
  liveRevisionReasonSchema,
  liveSessionControlRequestSchema,
  liveSessionErrorBodySchema,
  liveSessionListQuerySchema,
  liveSessionStartRequestSchema,
  liveSessionViewSchema,
  liveStreamResponseSchema,
  liveTaskIdSchema,
  liveTaskScreenshotsResponseSchema,
  liveWithheldResultSchema,
} from "./live-session";

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

describe("liveActionSchema sourceSnapshots", () => {
  const action = {
    id: ID,
    taskId: "t1",
    taskRevision: 1,
    actionKind: "draft-answer",
    dispatchStatus: "succeeded",
    attempt: 1,
    fenceAtDispatch: 1,
    jobId: null,
    jobCreated: false,
    result: null,
    shown: true,
    suppressionReason: null,
    createdAt: "2026-10-03T10:00:00.000Z",
    updatedAt: "2026-10-03T10:00:01.000Z",
  };

  it("is optional and carries only source and event ids", () => {
    expect(liveActionSchema.parse(action)).not.toHaveProperty(
      "sourceSnapshots",
    );
    const sourceSnapshots = [{ sourceId: "screen", eventId: "s1" }];
    expect(
      liveActionSchema.parse({ ...action, sourceSnapshots }).sourceSnapshots,
    ).toEqual(sourceSnapshots);
    expect(
      liveActionSchema.safeParse({
        ...action,
        sourceSnapshots: [{ sourceId: "screen" }],
      }).success,
    ).toBe(false);
  });
});

describe("liveTaskScreenshotsResponseSchema", () => {
  const shot = {
    ordinal: 2,
    sourceId: "screen",
    eventId: "e2",
    sequence: 7,
    capturedAt: "2026-10-03T10:00:00.000Z",
    artifactId: null,
    ocrEngine: null,
    revisions: [1, 2],
  };

  it("takes ids, ordinals and times, and a null artifact once the image is gone", () => {
    expect(
      liveTaskScreenshotsResponseSchema.parse({
        taskId: "task-1",
        screenshots: [shot],
      }).screenshots,
    ).toEqual([shot]);
    expect(
      liveTaskScreenshotsResponseSchema.parse({ taskId: "t", screenshots: [] })
        .screenshots,
    ).toEqual([]);
  });

  it("carries the engine that read a screenshot's text and nothing of the text", () => {
    const read = { ...shot, ocrEngine: "vision" };
    expect(
      liveTaskScreenshotsResponseSchema.parse({
        taskId: "t",
        screenshots: [read],
      }).screenshots[0]?.ocrEngine,
    ).toBe("vision");
    expect(
      liveTaskScreenshotsResponseSchema.safeParse({
        taskId: "t",
        screenshots: [{ ...shot, ocrEngine: "other" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a screenshot with no ordinal or no revision", () => {
    for (const broken of [
      { ...shot, ordinal: 0 },
      { ...shot, revisions: [] },
    ])
      expect(
        liveTaskScreenshotsResponseSchema.safeParse({
          taskId: "t",
          screenshots: [broken],
        }).success,
      ).toBe(false);
  });

  it("accepts only opaque task ids in the wire alphabet", () => {
    expect(liveTaskIdSchema.safeParse("task-a1.b:c-d").success).toBe(true);
    for (const bad of ["", "a b", "a/b", "x".repeat(161)])
      expect(liveTaskIdSchema.safeParse(bad).success).toBe(false);
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

describe("live capture request", () => {
  const region = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
  const parse = (body: unknown) => liveCaptureRequestSchema.safeParse(body);

  it("accepts each mode with its region rule, targets and hints", () => {
    expect(parse({ requestId: "r1", mode: "focused-window" }).success).toBe(
      true,
    );
    expect(parse({ requestId: "r1", mode: "display" }).success).toBe(true);
    expect(parse({ requestId: "r1", mode: "region", region }).success).toBe(
      true,
    );
    expect(
      parse({
        requestId: "r1",
        mode: "display",
        targetTaskId: "t1",
        targetRevision: 2,
        skill: "dsa",
        language: "typescript",
      }).success,
    ).toBe(true);
  });

  it("refuses a bad region rule, region bounds, half a target and unknown fields", () => {
    for (const body of [
      { requestId: "r1", mode: "region" },
      { requestId: "r1", mode: "display", region },
      { requestId: "r1", mode: "region", region: { ...region, x: 0.8 } },
      { requestId: "r1", mode: "region", region: { ...region, width: 0 } },
      { requestId: "r1", mode: "region", region: { ...region, y: -1 } },
      { requestId: "r1", mode: "display", targetTaskId: "t1" },
      { requestId: "r1", mode: "display", skill: "cooking" },
      { requestId: "bad id", mode: "display" },
      { requestId: "r1", mode: "display", windowTitle: "x" },
    ])
      expect(parse(body).success).toBe(false);
  });
});

describe("solve (generate the solution code)", () => {
  const solve = {
    requestId: "r-solve",
    operation: "solve",
    target: { taskId: "task-q1", revision: 2 },
    snapshots: [],
  };
  it("is bound to one task revision and carries no text or images", () => {
    expect(liveOwnerInputRequestSchema.safeParse(solve).success).toBe(true);
    const { target: _target, ...unbound } = solve;
    expect(liveOwnerInputRequestSchema.safeParse(unbound).success).toBe(false);
    expect(
      liveOwnerInputRequestSchema.safeParse({ ...solve, text: "anything" })
        .success,
    ).toBe(false);
    expect(
      liveOwnerInputRequestSchema.safeParse({
        ...solve,
        snapshots: [{ sourceId: "s", eventId: "e" }],
      }).success,
    ).toBe(false);
  });
});

describe("regenerate and apply (D28)", () => {
  const target = { taskId: "task-a", revision: 2 };
  const regenerate = {
    requestId: "r-1",
    operation: "regenerate",
    target,
    snapshots: [],
  };

  it("takes a regenerate bound to one task revision with no text and no images", () => {
    expect(liveOwnerInputRequestSchema.safeParse(regenerate).success).toBe(
      true,
    );
    for (const broken of [
      { ...regenerate, target: undefined },
      { ...regenerate, text: "again" },
      { ...regenerate, snapshots: [{ sourceId: "s", eventId: "e" }] },
    ])
      expect(liveOwnerInputRequestSchema.safeParse(broken).success).toBe(false);
  });

  it("takes up to the image limit with text aligned per image, and bounds the text per image and per request", () => {
    const fields = { requestId: "r-1", operation: "analyze" };
    const block = (length: number) => ({
      engine: "vision" as const,
      text: "x".repeat(length),
    });
    const per = LIVE_OCR_LIMITS.maxTextPerImage;
    const ok = (ocr: unknown) =>
      liveOwnerCaptureRequestSchema.safeParse({ ...fields, ocr }).success;
    expect(ok([block(per), null])).toBe(true);
    expect(ok([block(per + 1)])).toBe(false);
    expect(ok([block(per), block(per), block(per), block(1)])).toBe(false);
    expect(ok([{ engine: "other", text: "x" }])).toBe(false);
    expect(ok([{ engine: "vision", text: "x", confidence: 1.5 }])).toBe(false);
    expect(
      ok(
        Array.from({ length: LIVE_OWNER_INPUT_MAX_SNAPSHOTS + 1 }, () => null),
      ),
    ).toBe(false);
  });

  it("answers a capture with the stored images in order, at least one and at most the limit", () => {
    const ref = { sourceId: "s", eventId: "e" };
    const input = { requestId: "r", sequence: 1 };
    expect(
      liveOwnerCaptureResponseSchema.safeParse({ input, snapshots: [ref, ref] })
        .success,
    ).toBe(true);
    expect(
      liveOwnerCaptureResponseSchema.safeParse({ input, snapshots: [] })
        .success,
    ).toBe(false);
  });

  it("names the two reasons a revision can have from the owner's input", () => {
    expect(liveRevisionReasonSchema.options).toEqual([
      "regenerate",
      "added-screenshot",
    ]);
    expect(LIVE_OWNER_CAPTURE_MIN_SIDE).toBeGreaterThan(0);
  });
});

describe("liveActionSchema noQuestion (D36)", () => {
  const action = {
    id: ID,
    taskId: "t1",
    taskRevision: 1,
    actionKind: "draft-answer",
    dispatchStatus: "succeeded",
    attempt: 1,
    fenceAtDispatch: 1,
    jobId: null,
    jobCreated: false,
    result: null,
    shown: true,
    suppressionReason: null,
    createdAt: "2026-10-03T10:00:00.000Z",
    updatedAt: "2026-10-03T10:00:01.000Z",
  };

  it("is optional and only ever true", () => {
    expect(liveActionSchema.parse(action)).not.toHaveProperty("noQuestion");
    expect(
      liveActionSchema.parse({ ...action, noQuestion: true }).noQuestion,
    ).toBe(true);
    expect(
      liveActionSchema.safeParse({ ...action, noQuestion: false }).success,
    ).toBe(false);
  });
});

describe("response schemas tolerate additions and bound what they store", () => {
  it("accepts an extra field on screenshotsSent and sentByRevision entries", () => {
    const entry = { revision: 1, sent: "image", later: true };
    expect(
      liveTaskScreenshotsResponseSchema.safeParse({
        taskId: "task-1",
        screenshots: [
          {
            ordinal: 1,
            sourceId: "s",
            eventId: "e",
            sequence: 1,
            capturedAt: "2026-10-05T10:00:00.000Z",
            artifactId: null,
            ocrEngine: null,
            revisions: [1],
            sentByRevision: [entry],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("bounds a stored test name", () => {
    expect(
      liveCodeTestSchema.safeParse({ name: "n".repeat(200), status: "passed" })
        .success,
    ).toBe(true);
    expect(
      liveCodeTestSchema.safeParse({ name: "n".repeat(201), status: "passed" })
        .success,
    ).toBe(false);
  });

  it("keeps a dot out of a request id, so extra-image event ids cannot collide", () => {
    expect(
      liveOwnerCaptureRequestSchema.safeParse({
        requestId: "abc",
        operation: "analyze",
      }).success,
    ).toBe(true);
    expect(
      liveOwnerCaptureRequestSchema.safeParse({
        requestId: "abc.2",
        operation: "analyze",
      }).success,
    ).toBe(false);
  });
});
