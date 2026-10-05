import { describe, expect, it } from "vitest";
import { ACTIVE_SESSION_LIMITS } from "./limits";
import { isWithinEnvelopeByteLimit, validateObservation } from "./observation";

const envelope = {
  version: 1,
  sourceId: "mic-1",
  eventId: "evt-1",
  occurredAt: "2026-10-03T10:00:00.000Z",
  sequence: 0,
};

const transcript = {
  ...envelope,
  kind: "transcript.final",
  content: {
    speaker: "speaker-1",
    text: "Tell me about yourself",
    startMs: 0,
    endMs: 2500,
  },
};
const snapshot = {
  ...envelope,
  kind: "screen.snapshot",
  content: {
    payloadRef: "shot-1",
    mediaType: "image/png",
    byteLength: 1024,
    windowLabel: "Editor",
  },
};
const disconnected = {
  ...envelope,
  kind: "source.disconnected",
  content: { source: "microphone", reason: "device-lost" },
};
const gap = {
  ...envelope,
  kind: "capture.gap",
  content: {
    source: "application-audio",
    durationMs: 4000,
    reason: "buffer-overflow",
  },
};

// The trailing "!" is outside the id and label alphabets, so the canary is
// invalid wherever it lands.
const CANARY = "CANARY-secret-content-9f3a!";

describe("validateObservation", () => {
  it.each([
    ["transcript.final", transcript],
    ["screen.snapshot", snapshot],
    ["source.disconnected", disconnected],
    ["capture.gap", gap],
  ])("accepts a valid %s", (_kind, sample) => {
    const result = validateObservation(sample);
    expect(result.ok).toBe(true);
  });

  it("accepts a transcript correction that supersedes an earlier event", () => {
    const result = validateObservation({
      ...transcript,
      eventId: "evt-2",
      content: { ...transcript.content, supersedes: "evt-1" },
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    [
      "transcript with end before start",
      {
        ...transcript,
        content: { ...transcript.content, startMs: 10, endMs: 5 },
      },
      ["content", "endMs"],
    ],
    [
      "transcript with empty text",
      { ...transcript, content: { ...transcript.content, text: "" } },
      ["content", "text"],
    ],
    [
      "snapshot with a svg media type",
      {
        ...snapshot,
        content: { ...snapshot.content, mediaType: "image/svg+xml" },
      },
      ["content", "mediaType"],
    ],
    [
      "snapshot with zero bytes",
      { ...snapshot, content: { ...snapshot.content, byteLength: 0 } },
      ["content", "byteLength"],
    ],
    [
      "disconnect with unknown source",
      { ...disconnected, content: { source: "camera", reason: "error" } },
      ["content", "source"],
    ],
    [
      "gap with negative duration",
      { ...gap, content: { ...gap.content, durationMs: -1 } },
      ["content", "durationMs"],
    ],
    ["missing eventId", { ...transcript, eventId: undefined }, ["eventId"]],
  ])("rejects %s with a path", (_name, sample, path) => {
    const result = validateObservation(sample);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.path)).toContainEqual(path);
    }
  });

  it("rejects an unknown version", () => {
    const result = validateObservation({ ...transcript, version: 2 });
    expect(result).toEqual({
      ok: false,
      issues: [{ path: ["version"], code: "unsupported_version" }],
    });
  });

  it("rejects an unknown kind", () => {
    const result = validateObservation({
      ...transcript,
      kind: "clipboard.copy",
    });
    expect(result).toEqual({
      ok: false,
      issues: [{ path: ["kind"], code: "unknown_kind" }],
    });
  });

  it("refuses owner.input: the owner's own requests never cross the capture wire", () => {
    const result = validateObservation({
      ...envelope,
      sourceId: "studio.owner-input",
      kind: "owner.input",
      content: { operation: "follow-up", text: "hello" },
    });
    expect(result).toEqual({
      ok: false,
      issues: [{ path: ["kind"], code: "unknown_kind" }],
    });
  });

  it("refuses an audio kind: no raw audio crosses the wire", () => {
    const result = validateObservation({
      ...envelope,
      kind: "audio",
      content: { samples: "AAAA" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe("unknown_kind");
  });

  it("reports both an unknown version and an unknown kind", () => {
    const result = validateObservation({
      ...transcript,
      version: 9,
      kind: "audio",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code).sort()).toEqual([
        "unknown_kind",
        "unsupported_version",
      ]);
    }
  });

  it.each([
    "tenantId",
    "userId",
    "actorId",
    "sessionId",
    "ownerId",
    "tenant_id",
    "Owner-Id",
  ])("rejects identity field %s smuggled inside content", (field) => {
    const result = validateObservation({
      ...transcript,
      content: { ...transcript.content, [field]: "t-1" },
    });
    expect(result).toEqual({
      ok: false,
      issues: [{ path: ["content", field], code: "identity_field_forbidden" }],
    });
  });

  it("rejects identity fields at the envelope level, even on an otherwise valid envelope", () => {
    const result = validateObservation({
      ...transcript,
      tenantId: "t-1",
      sessionId: "s-1",
    });
    expect(result).toEqual({
      ok: false,
      issues: [
        { path: ["tenantId"], code: "identity_field_forbidden" },
        { path: ["sessionId"], code: "identity_field_forbidden" },
      ],
    });
  });

  it("rejects other unknown fields rather than ignoring them", () => {
    const result = validateObservation({ ...transcript, extra: 1 });
    expect(result).toEqual({
      ok: false,
      issues: [{ path: [], code: "unknown_field" }],
    });
  });

  it("rejects text over the transcript limit", () => {
    const result = validateObservation({
      ...transcript,
      content: {
        ...transcript.content,
        text: "x".repeat(ACTIVE_SESSION_LIMITS.maxTranscriptTextChars + 1),
      },
    });
    expect(result).toEqual({
      ok: false,
      issues: [{ path: ["content", "text"], code: "too_large" }],
    });
  });

  it("rejects a screenshot over the byte limit", () => {
    const result = validateObservation({
      ...snapshot,
      content: {
        ...snapshot.content,
        byteLength: ACTIVE_SESSION_LIMITS.maxScreenshotBytes + 1,
      },
    });
    expect(result.ok).toBe(false);
  });

  it.each([null, "text", 7, [transcript]])(
    "rejects a non-object input %#",
    (input) => {
      expect(validateObservation(input)).toEqual({
        ok: false,
        issues: [{ path: [], code: "invalid_type" }],
      });
    },
  );

  it("never echoes content, ids or key names in issues", () => {
    const attempts = [
      {
        ...transcript,
        content: { ...transcript.content, text: CANARY.repeat(500) },
      },
      { ...transcript, content: { ...transcript.content, speaker: CANARY } },
      { ...transcript, sourceId: CANARY, eventId: CANARY },
      { ...transcript, [CANARY]: CANARY },
      { ...transcript, kind: CANARY },
      { ...transcript, version: CANARY },
      { ...transcript, content: { ...transcript.content, tenantId: CANARY } },
      {
        ...snapshot,
        content: {
          ...snapshot.content,
          mediaType: CANARY,
          windowLabel: CANARY.repeat(50),
        },
      },
      { ...disconnected, content: { source: CANARY, reason: CANARY } },
    ];
    for (const attempt of attempts) {
      const result = validateObservation(attempt);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(JSON.stringify(result.issues)).not.toContain("CANARY");
      }
    }
  });
});

describe("isWithinEnvelopeByteLimit", () => {
  it("counts UTF-8 bytes, not characters", () => {
    const characters = ACTIVE_SESSION_LIMITS.maxEnvelopeBytes / 2;
    expect(isWithinEnvelopeByteLimit("a".repeat(characters))).toBe(true);
    expect(isWithinEnvelopeByteLimit("é".repeat(characters + 1))).toBe(false);
    expect(
      isWithinEnvelopeByteLimit(
        new Uint8Array(ACTIVE_SESSION_LIMITS.maxEnvelopeBytes + 1),
      ),
    ).toBe(false);
  });
});

describe("transcript.final source label", () => {
  it.each(["microphone", "application-audio"])(
    "accepts source %s",
    (source) => {
      expect(
        validateObservation({
          ...transcript,
          content: { ...transcript.content, source },
        }).ok,
      ).toBe(true);
    },
  );

  it("stays optional and rejects anything but an audio source label", () => {
    expect(validateObservation(transcript).ok).toBe(true);
    for (const source of ["screen", "speaker-1", ""]) {
      expect(
        validateObservation({
          ...transcript,
          content: { ...transcript.content, source },
        }).ok,
      ).toBe(false);
    }
  });
});

describe("limits", () => {
  it("keeps the credential strictly shorter than the session cap", () => {
    expect(ACTIVE_SESSION_LIMITS.credentialLifetimeMs).toBeLessThan(
      ACTIVE_SESSION_LIMITS.sessionDurationCapMs,
    );
  });

  it("spaces heartbeats at least one second apart", () => {
    expect(ACTIVE_SESSION_LIMITS.minHeartbeatIntervalMs).toBe(1_000);
  });

  it("is frozen and allows one active session per owner", () => {
    expect(Object.isFrozen(ACTIVE_SESSION_LIMITS)).toBe(true);
    expect(ACTIVE_SESSION_LIMITS.maxActiveSessionsPerOwner).toBe(1);
  });
});

describe("screen snapshot requestId", () => {
  const withRequest = (requestId: unknown) => ({
    ...snapshot,
    content: { ...snapshot.content, requestId },
  });

  it("accepts an optional capture-request correlation id", () => {
    expect(validateObservation(withRequest("cap-1")).ok).toBe(true);
    expect(validateObservation(snapshot).ok).toBe(true);
  });

  it.each(["", "a b", "x".repeat(129), 7])("refuses %j", (bad) => {
    expect(validateObservation(withRequest(bad)).ok).toBe(false);
  });
});
