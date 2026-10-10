// The ingest decisions, tested directly: no database, no clock, no log.
import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../session-record";
import {
  failedByCompanion,
  failedBySelectionChange,
  isPendingRequest,
  pendingCaptureOf,
} from "./capture-request";
import {
  checkScreenshot,
  heardLineOf,
  ledgerFor,
  readEnvelope,
  reservedSourceRefusal,
  sameObservation,
  storedContentOf,
  unpermittedSourceRefusal,
  validationRefusal,
  volumeRefusal,
} from "./observation";
import {
  controlOf,
  controlState,
  credentialIsLive,
  heartbeatTooSoon,
  mayIngest,
  messageKindOf,
  spacingRetryAfterSeconds,
  voiceActivityAllowed,
  withoutCapture,
} from "./session-policy";
import { decideReconcile } from "./session-transition";

const NOW = Date.parse("2026-10-03T10:00:00.000Z");
const row = (over: Partial<SessionRecord> = {}): SessionRecord =>
  ({
    id: "s-1",
    status: "active",
    policy: "permitted-remote",
    credentialHash: "hash",
    credentialExpiresAt: new Date(NOW + 60_000),
    credentialRevokedAt: null,
    sources: { captureSources: ["microphone", "screen"], liveAssistance: true },
    expiresAt: new Date(NOW + 3_600_000),
    lastHeartbeatAt: null,
    purgedAt: null,
    captureRequest: null,
    nowMs: NOW,
    ...over,
  }) as SessionRecord;

const line = (over: Record<string, unknown> = {}) =>
  ({
    version: 1,
    kind: "transcript.final",
    sourceId: "mic",
    eventId: "e-1",
    occurredAt: "2026-10-03T10:00:00.000Z",
    sequence: 3,
    content: { speaker: "s", text: "words", startMs: 0, endMs: 1 },
    ...over,
  }) as never;

const shot = (content: Record<string, unknown> = {}) =>
  ({
    version: 1,
    kind: "screen.snapshot",
    sourceId: "screen",
    eventId: "e-2",
    occurredAt: "2026-10-03T10:00:00.000Z",
    sequence: 1,
    content: {
      payloadRef: "p",
      mediaType: "image/png",
      byteLength: 16,
      ...content,
    },
  }) as never;

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4,
]);
const pending = (over: Record<string, unknown> = {}) => ({
  request: { requestId: "r-1", mode: "window" },
  status: "pending",
  createdAt: new Date(NOW).toISOString(),
  expiresAt: new Date(NOW + 5_000).toISOString(),
  ...over,
});

describe("session policy", () => {
  it("lets only the roles that may start a session ingest", () => {
    expect(
      ["admin", "owner", "member", "viewer", undefined].map(mayIngest),
    ).toEqual([true, true, false, false, false]);
  });

  it("holds a credential live only when it is the session's, unrevoked and unexpired by the row's clock", () => {
    expect(credentialIsLive(row(), "hash")).toBe(true);
    expect(credentialIsLive(row(), "other")).toBe(false);
    expect(
      credentialIsLive(row({ credentialRevokedAt: new Date(NOW) }), "hash"),
    ).toBe(false);
    expect(credentialIsLive(row({ credentialExpiresAt: null }), "hash")).toBe(
      false,
    );
    expect(
      credentialIsLive(row({ credentialExpiresAt: new Date(NOW) }), "hash"),
    ).toBe(false);
  });

  it("reads a session that has not started as paused, and carries the capture request only to a companion that declared it", () => {
    expect(
      ["created", "active", "paused", "ended", "purging"].map((s) =>
        controlState(s as never),
      ),
    ).toEqual(["paused", "active", "paused", "ended", "purging"]);
    const withRequest = row({ captureRequest: pending() });
    expect(
      controlOf(withRequest, "active", { captureRequests: false }),
    ).toEqual({
      state: "active",
      credentialExpiresAt: new Date(NOW + 60_000).toISOString(),
    });
    const handed = controlOf(withRequest, "active", { captureRequests: true });
    expect(handed.capture).toMatchObject({ requestId: "r-1", mode: "window" });
    expect(withoutCapture(handed)).toEqual({
      state: "active",
      credentialExpiresAt: new Date(NOW + 60_000).toISOString(),
    });
    expect(
      controlOf(row({ credentialExpiresAt: null }), "paused", {
        captureRequests: true,
      }).credentialExpiresAt,
    ).toBe(new Date(NOW + 3_600_000).toISOString());
  });

  it("names the kind of an envelope, whatever it is", () => {
    expect(
      [{ kind: "heartbeat" }, { kind: 4 }, {}, null, "x", []].map(
        messageKindOf,
      ),
    ).toEqual(["heartbeat", 4, undefined, undefined, undefined, undefined]);
  });

  it("spaces only an active session's capturing heartbeat, and asks for the spacing in whole seconds, never under one", () => {
    const limits = { minHeartbeatIntervalMs: 1_000 };
    const recent = row({ lastHeartbeatAt: new Date(NOW - 999) });
    expect(heartbeatTooSoon(recent, "active", true, limits)).toBe(true);
    expect(heartbeatTooSoon(recent, "active", false, limits)).toBe(false);
    expect(heartbeatTooSoon(recent, "paused", true, limits)).toBe(false);
    expect(
      heartbeatTooSoon(
        row({ lastHeartbeatAt: new Date(NOW - 1_000) }),
        "active",
        true,
        limits,
      ),
    ).toBe(false);
    expect(heartbeatTooSoon(row(), "active", true, limits)).toBe(false);
    expect(
      [0, 400, 1_000, 2_500].map((ms) =>
        spacingRetryAfterSeconds({ minHeartbeatIntervalMs: ms }),
      ),
    ).toEqual([1, 1, 1, 3]);
  });

  it("allows voice activity only with the switch on and a session that may be processed off the device", () => {
    expect(voiceActivityAllowed(row(), true)).toBe(true);
    expect(voiceActivityAllowed(row(), false)).toBe(false);
    expect(voiceActivityAllowed(row({ policy: "device-only" }), true)).toBe(
      false,
    );
  });
});

describe("an observation", () => {
  it("reads an envelope by size and shape before anything else", () => {
    expect(readEnvelope({ a: 1 })).toEqual({ ok: true, value: { a: 1 } });
    expect(readEnvelope('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(readEnvelope("{nope")).toEqual({
      ok: false,
      code: "invalid_observation",
    });
    expect(readEnvelope({ big: 1n })).toEqual({
      ok: false,
      code: "invalid_observation",
    });
    expect(readEnvelope("x".repeat(2_000_000))).toEqual({
      ok: false,
      code: "envelope_too_large",
    });
    expect(readEnvelope(undefined)).toEqual({ ok: true, value: undefined });
  });

  it("answers a failed validation as a version refusal when any issue says so", () => {
    expect(
      validationRefusal([{ path: ["a"], code: "invalid_value" }]).code,
    ).toBe("invalid_observation");
    expect(
      validationRefusal([
        { path: ["a"], code: "invalid_value" },
        { path: ["version"], code: "unsupported_version" },
      ]).code,
    ).toBe("unsupported_version");
  });

  it("refuses the reserved owner sources and a source the session never registered", () => {
    for (const sourceId of [
      "studio.owner-input",
      "studio.owner-capture",
      "studio.owner-microphone",
    ])
      expect(reservedSourceRefusal(line({ sourceId }))).toEqual({
        code: "invalid_observation",
        issues: [{ path: ["sourceId"], code: "invalid_value" }],
      });
    expect(reservedSourceRefusal(line())).toBeNull();
    expect(unpermittedSourceRefusal(line(), ["microphone"])).toBeNull();
    expect(unpermittedSourceRefusal(line(), ["application-audio"])).toBeNull();
    expect(unpermittedSourceRefusal(line(), ["screen"])?.issues).toEqual([
      { path: ["kind"], code: "invalid_value" },
    ]);
    const labelled = line({
      content: {
        speaker: "s",
        text: "w",
        startMs: 0,
        endMs: 1,
        source: "application-audio",
      },
    });
    expect(unpermittedSourceRefusal(labelled, ["microphone"])?.issues).toEqual([
      { path: ["content", "source"], code: "invalid_value" },
    ]);
    expect(unpermittedSourceRefusal(shot(), ["microphone"])?.issues).toEqual([
      { path: ["kind"], code: "invalid_value" },
    ]);
    expect(
      unpermittedSourceRefusal({ kind: "capture.gap" } as never, []),
    ).toBeNull();
  });

  it("holds a resend the same by kind, body and source sequence, a screenshot by body and bytes", () => {
    const stored = {
      kind: "transcript.final",
      content: storedContentOf(line()),
      payloadSha256: null,
    };
    expect(sameObservation(stored, line(), undefined)).toBe(true);
    expect(
      sameObservation(
        stored,
        line({ occurredAt: "2026-10-04T00:00:00.000Z" }),
        undefined,
      ),
    ).toBe(true);
    expect(sameObservation(stored, line({ sequence: 4 }), undefined)).toBe(
      false,
    );
    expect(
      sameObservation(
        stored,
        line({
          content: { speaker: "s", text: "other", startMs: 0, endMs: 1 },
        }),
        undefined,
      ),
    ).toBe(false);
    expect(
      sameObservation({ ...stored, kind: "capture.gap" }, line(), undefined),
    ).toBe(false);
    const image = {
      kind: "screen.snapshot",
      content: storedContentOf(shot()),
      payloadSha256: "0".repeat(64),
    };
    expect(sameObservation(image, shot(), undefined)).toBe(true);
    expect(
      sameObservation(
        image,
        { ...(shot() as object), sequence: 9 } as never,
        undefined,
      ),
    ).toBe(true);
    expect(sameObservation(image, shot(), PNG)).toBe(false);
  });

  it("hands the core a ledger of the next sequence and this message's stored acknowledgement only", () => {
    expect(ledgerFor(line(), undefined, 7)).toMatchObject({
      nextSeq: 8,
      acks: {},
    });
    const ledger = ledgerFor(
      line(),
      { sequence: 2, ack: { status: "accepted" } },
      7,
    );
    expect(Object.values(ledger.acks)).toEqual([
      { seq: 2, ack: { status: "accepted" } },
    ]);
  });

  it("puts the session's cap before its rate", () => {
    const limits = { maxObservationsPerSession: 2, maxIngestPerMinute: 1 };
    expect(volumeRefusal({ total: 2, recent: 1 }, limits)).toEqual({
      code: "limit_reached",
    });
    expect(volumeRefusal({ total: 1, recent: 1 }, limits)).toEqual({
      code: "rate_limited",
    });
    expect(volumeRefusal({ total: 1, recent: 0 }, limits)).toBeNull();
  });

  it("checks a screenshot in order: count, payload, size, leading bytes, declared length", () => {
    const limits = { maxScreenshotsPerSession: 1, maxScreenshotBytes: 100 };
    const code = (r: ReturnType<typeof checkScreenshot>) =>
      r.ok ? "ok" : r.refusal;
    expect(code(checkScreenshot(shot(), undefined, 1, limits))).toEqual({
      code: "limit_reached",
    });
    expect(code(checkScreenshot(shot(), undefined, 0, limits))).toEqual({
      code: "invalid_observation",
      issues: [{ path: ["payload"], code: "too_small" }],
    });
    expect(
      code(
        checkScreenshot(shot(), PNG, 0, { ...limits, maxScreenshotBytes: 4 }),
      ),
    ).toEqual({ code: "payload_too_large" });
    expect(
      code(checkScreenshot(shot({ byteLength: 101 }), PNG, 0, limits)),
    ).toEqual({ code: "payload_too_large" });
    expect(
      code(checkScreenshot(shot({ mediaType: "image/jpeg" }), PNG, 0, limits)),
    ).toMatchObject({
      issues: [{ path: ["payload"], code: "invalid_value" }],
    });
    expect(
      code(checkScreenshot(shot({ byteLength: 17 }), PNG, 0, limits)),
    ).toMatchObject({
      issues: [{ path: ["content", "byteLength"], code: "invalid_value" }],
    });
    expect(checkScreenshot(shot(), PNG, 0, limits)).toEqual({
      ok: true,
      screenshot: { bytes: PNG, mediaType: "image/png" },
    });
  });

  it("tells a heard line with its session and whether it may leave the device", () => {
    const session = {
      scope: { tenantId: "t", actorId: "a" },
      sessionId: "s",
      remote: false,
    };
    expect(heardLineOf(line(), session)).toEqual({
      remote: false,
      text: "words",
      occurredAt: "2026-10-03T10:00:00.000Z",
      session: { tenantId: "t", actorId: "a", sessionId: "s" },
    });
    const labelled = line({
      content: {
        speaker: "s",
        text: "w",
        startMs: 0,
        endMs: 1,
        source: "microphone",
      },
    });
    expect(heardLineOf(labelled, { ...session, remote: true })).toMatchObject({
      source: "microphone",
      remote: true,
    });
  });
});

describe("the capture request", () => {
  it("is handed out only pending, unexpired, while capturing, and a region only to its bound selection", () => {
    const declared = { captureRequests: true, screenSelection: "display:1" };
    expect(
      pendingCaptureOf(row({ captureRequest: pending() }), "paused", declared),
    ).toBeUndefined();
    expect(
      pendingCaptureOf(
        row({ captureRequest: pending({ status: "captured" }) }),
        "active",
        declared,
      ),
    ).toBeUndefined();
    expect(
      pendingCaptureOf(
        row({
          captureRequest: pending({ expiresAt: new Date(NOW).toISOString() }),
        }),
        "active",
        declared,
      ),
    ).toBeUndefined();
    const region = pending({
      request: {
        requestId: "r-1",
        mode: "region",
        region: { x: 0, y: 0, width: 1, height: 1 },
      },
      selection: "display:2",
    });
    expect(
      pendingCaptureOf(row({ captureRequest: region }), "active", declared),
    ).toBeUndefined();
    expect(
      pendingCaptureOf(
        row({ captureRequest: { ...region, selection: "display:1" } }),
        "active",
        declared,
      ),
    ).toMatchObject({ mode: "region", selection: "display:1" });
  });

  it("fails a pending region when the companion's selection changed, and only the named pending request when the companion reports", () => {
    const region = pending({
      request: { requestId: "r-1", mode: "region" },
      selection: "display:2",
    });
    const declared = { captureRequests: true, screenSelection: "display:1" };
    expect(
      failedBySelectionChange(row({ captureRequest: region }), declared),
    ).toMatchObject({
      status: "failed",
      reason: "source-changed",
    });
    expect(
      failedBySelectionChange(row({ captureRequest: pending() }), declared),
    ).toBeNull();
    expect(
      failedBySelectionChange(row({ captureRequest: region }), {
        captureRequests: true,
      }),
    ).toBeNull();
    const held = row({ captureRequest: pending() });
    expect(
      failedByCompanion(held, "r-1", "permission_denied" as never),
    ).toMatchObject({
      status: "failed",
      reason: "permission_denied",
    });
    expect(
      failedByCompanion(held, "r-2", "permission_denied" as never),
    ).toBeNull();
    expect(isPendingRequest(held, "r-1")).toBe(true);
    expect(isPendingRequest(held, "r-2")).toBe(false);
    expect(
      isPendingRequest(
        row({ nowMs: NOW + 5_000, captureRequest: pending() }),
        "r-1",
      ),
    ).toBe(false);
  });
});

describe("what time does to a session", () => {
  it("ends at the duration cap, pauses for a dead credential or a silent companion, and never touches a session no companion contacted", () => {
    const contact = { contact: true };
    expect(decideReconcile(row(), contact)).toBeNull();
    expect(decideReconcile(row({ expiresAt: new Date(NOW) }), contact)).toEqual(
      { command: "end", actor: "duration-cap" },
    );
    expect(
      decideReconcile(
        row({ status: "paused", expiresAt: new Date(NOW) }),
        contact,
      )?.command,
    ).toBe("end");
    expect(
      decideReconcile(
        row({ status: "ended", expiresAt: new Date(NOW) }),
        contact,
      ),
    ).toBeNull();
    expect(
      decideReconcile(
        row({ purgedAt: new Date(NOW), expiresAt: new Date(NOW) }),
        contact,
      ),
    ).toBeNull();
    const contacted = { lastHeartbeatAt: new Date(NOW - 121_000) };
    expect(
      decideReconcile(row({ credentialRevokedAt: new Date(NOW) }), contact),
    ).toBeNull();
    expect(
      decideReconcile(
        row({ ...contacted, credentialRevokedAt: new Date(NOW) }),
        contact,
      ),
    ).toEqual({
      command: "pause",
      actor: "credential-expiry",
    });
    expect(decideReconcile(row(contacted), contact)).toBeNull();
    expect(decideReconcile(row(contacted), { contact: false })).toEqual({
      command: "pause",
      actor: "companion-stop",
    });
    expect(
      decideReconcile(row(contacted), {
        contact: false,
        heartbeatStaleMs: 200_000,
      }),
    ).toBeNull();
    expect(
      decideReconcile(row({ ...contacted, status: "paused" }), {
        contact: false,
      }),
    ).toBeNull();
  });
});
