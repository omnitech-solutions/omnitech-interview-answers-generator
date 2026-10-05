import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  acknowledgementSchema,
  CAPABILITY_ACK_EVENT_ID,
  CAPTURE_FAILURE_CODES,
  capabilityReportSchema,
  captureRequestSchema,
  controlMessageSchema,
  controlStatusSchema,
  heartbeatSchema,
  ingestMessageSchema,
  REFUSAL_CODES,
  sessionControlStateSchema,
  validateIngestMessage,
} from "./control";
import { isoTimestampSchema } from "./ids";
import {
  COMPANION_FEATURE_CAPTURE_REQUEST,
  COMPANION_FEATURES_HEADER,
  COMPANION_SCREEN_HEADER,
  formatCompanionFeatures,
  parseCompanionDeclaration,
} from "./negotiation";

const control = {
  state: "active",
  credentialExpiresAt: "2026-10-03T12:00:00.000Z",
};
const accepted = {
  version: 1,
  status: "accepted",
  sourceId: "mic-1",
  eventId: "evt-1",
  control,
};

describe("acknowledgement", () => {
  it("accepts an accepted ack carrying the control state and credential expiry", () => {
    expect(acknowledgementSchema.safeParse(accepted).success).toBe(true);
  });

  it.each(["active", "paused", "ended", "purging"])(
    "carries control state %s",
    (state) => {
      expect(
        acknowledgementSchema.safeParse({
          ...accepted,
          control: { ...control, state },
        }).success,
      ).toBe(true);
    },
  );

  it("returns the original ack inside a duplicate", () => {
    const parsed = acknowledgementSchema.safeParse({
      version: 1,
      status: "duplicate",
      original: accepted,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a refusal with a stable code and optional control", () => {
    for (const code of REFUSAL_CODES) {
      expect(
        acknowledgementSchema.safeParse({ version: 1, status: "refused", code })
          .success,
      ).toBe(true);
    }
    expect(
      acknowledgementSchema.safeParse({
        version: 1,
        status: "refused",
        code: "session_paused",
        control: { ...control, state: "paused" },
      }).success,
    ).toBe(true);
  });

  it("rejects an invented refusal code, message field or unknown state", () => {
    expect(
      acknowledgementSchema.safeParse({
        version: 1,
        status: "refused",
        code: "oops",
      }).success,
    ).toBe(false);
    expect(
      acknowledgementSchema.safeParse({
        version: 1,
        status: "refused",
        code: "rate_limited",
        message: "free text",
      }).success,
    ).toBe(false);
    expect(
      acknowledgementSchema.safeParse({
        ...accepted,
        control: { ...control, state: "broaden" },
      }).success,
    ).toBe(false);
  });
});

const capability = {
  version: 1,
  kind: "capability.report",
  sourceId: "companion-1",
  sentAt: "2026-10-03T10:00:00Z",
  speech: {
    locale: "en-GB",
    onDeviceAvailable: true,
    recognizerAvailable: true,
    authorizationStatus: "authorized",
  },
  permissions: { microphone: "granted", screen: "not-determined" },
};

describe("capability.report", () => {
  it("is a strict content-free report accepted by the ingest union", () => {
    expect(capabilityReportSchema.safeParse(capability).success).toBe(true);
    expect(ingestMessageSchema.safeParse(capability).success).toBe(true);
  });

  it("rejects extra fields, a bad locale and unknown states", () => {
    const bad = [
      { ...capability, text: "hi" },
      { ...capability, speech: { ...capability.speech, extra: 1 } },
      { ...capability, speech: { ...capability.speech, locale: "en GB" } },
      {
        ...capability,
        speech: { ...capability.speech, locale: "x".repeat(36) },
      },
      {
        ...capability,
        speech: { ...capability.speech, authorizationStatus: "maybe" },
      },
      { ...capability, permissions: { ...capability.permissions, screen: "" } },
    ];
    for (const message of bad) {
      expect(capabilityReportSchema.safeParse(message).success).toBe(false);
    }
  });

  it("is acknowledged with the fixed capability event id", () => {
    expect(CAPABILITY_ACK_EVENT_ID).toBe("capability");
    expect(
      acknowledgementSchema.safeParse({
        ...accepted,
        eventId: CAPABILITY_ACK_EVENT_ID,
      }).success,
    ).toBe(true);
  });
});

describe("event_conflict refusal", () => {
  it("is a stable refusal code", () => {
    expect(REFUSAL_CODES).toContain("event_conflict");
    expect(
      acknowledgementSchema.safeParse({
        version: 1,
        status: "refused",
        code: "event_conflict",
        control,
      }).success,
    ).toBe(true);
  });
});

describe("validateIngestMessage", () => {
  it("validates heartbeat and capability.report", () => {
    expect(validateIngestMessage(capability).ok).toBe(true);
    expect(
      validateIngestMessage({
        version: 1,
        kind: "heartbeat",
        sourceId: "mic-1",
        sentAt: "2026-10-03T10:00:00Z",
        capturing: true,
      }).ok,
    ).toBe(true);
  });

  it("refuses identity fields anywhere in the new message", () => {
    expect(
      validateIngestMessage({
        ...capability,
        permissions: { ...capability.permissions, userId: "u" },
      }),
    ).toEqual({
      ok: false,
      issues: [
        { path: ["permissions", "userId"], code: "identity_field_forbidden" },
      ],
    });
  });

  it("reports unknown fields and versions by stable code", () => {
    expect(validateIngestMessage({ ...capability, extra: 1 })).toEqual({
      ok: false,
      issues: [{ path: [], code: "unknown_field" }],
    });
    expect(validateIngestMessage({ ...capability, version: 2 })).toEqual({
      ok: false,
      issues: [{ path: ["version"], code: "unsupported_version" }],
    });
  });
});

describe("heartbeat and control message", () => {
  it("heartbeat is content-free", () => {
    const heartbeat = {
      version: 1,
      kind: "heartbeat",
      sourceId: "mic-1",
      sentAt: "2026-10-03T10:00:00Z",
      capturing: false,
    };
    expect(heartbeatSchema.safeParse(heartbeat).success).toBe(true);
    expect(
      heartbeatSchema.safeParse({ ...heartbeat, text: "hi" }).success,
    ).toBe(false);
  });

  it("control message carries an action and no identity", () => {
    const message = { version: 1, kind: "session.control", action: "pause" };
    expect(controlMessageSchema.safeParse(message).success).toBe(true);
    expect(
      controlMessageSchema.safeParse({ ...message, sessionId: "s" }).success,
    ).toBe(false);
    expect(
      controlMessageSchema.safeParse({ ...message, action: "broaden-sources" })
        .success,
    ).toBe(false);
  });
});

describe("capture request control", () => {
  const region = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };
  const expiresAt = "2026-10-03T12:00:20.000Z";
  const request = (over: Record<string, unknown> = {}) => ({
    requestId: "c",
    mode: "display",
    expiresAt,
    ...over,
  });
  const withCapture = (capture: unknown) => ({
    ...accepted,
    control: { ...control, capture },
  });

  it("carries a pending request, with its deadline, on any control", () => {
    for (const capture of [
      request({ mode: "focused-window" }),
      request(),
      request({ mode: "region", region, selection: "disp-1.3" }),
    ]) {
      expect(
        acknowledgementSchema.safeParse(withCapture(capture)).success,
      ).toBe(true);
    }
    expect(
      acknowledgementSchema.safeParse({
        version: 1,
        status: "refused",
        code: "rate_limited",
        control: { ...control, capture: request() },
      }).success,
    ).toBe(true);
  });

  it("requires the deadline", () => {
    const { expiresAt: _omitted, ...bare } = request();
    expect(captureRequestSchema.safeParse(bare).success).toBe(false);
    expect(
      captureRequestSchema.safeParse(request({ expiresAt: "soon" })).success,
    ).toBe(false);
  });

  it("requires a region and its selection exactly when the mode is region", () => {
    expect(
      captureRequestSchema.safeParse(request({ mode: "region" })).success,
    ).toBe(false);
    expect(
      captureRequestSchema.safeParse(request({ mode: "region", region }))
        .success,
    ).toBe(false);
    expect(
      captureRequestSchema.safeParse(
        request({ mode: "region", selection: "d.1" }),
      ).success,
    ).toBe(false);
    expect(captureRequestSchema.safeParse(request({ region })).success).toBe(
      false,
    );
    expect(
      captureRequestSchema.safeParse(request({ selection: "d.1" })).success,
    ).toBe(false);
  });

  it.each([
    { x: -0.1, y: 0, width: 0.5, height: 0.5 },
    { x: 0, y: 0, width: 0, height: 0.5 },
    { x: 0.6, y: 0, width: 0.5, height: 0.5 },
    { x: 0, y: 0.7, width: 0.5, height: 0.4 },
    { x: 0, y: 0, width: 1.2, height: 0.5 },
    { x: "0", y: 0, width: 0.5, height: 0.5 },
  ])("refuses a region outside the unit display: %j", (bad) => {
    expect(
      captureRequestSchema.safeParse(
        request({ mode: "region", region: bad, selection: "d.1" }),
      ).success,
    ).toBe(false);
  });

  it("refuses unknown capture fields and modes", () => {
    expect(
      captureRequestSchema.safeParse(request({ window: "x" })).success,
    ).toBe(false);
    expect(
      captureRequestSchema.safeParse(request({ mode: "window" })).success,
    ).toBe(false);
  });
});

describe("capture failure message", () => {
  const failure = {
    version: 1,
    kind: "capture.failure",
    sourceId: "companion",
    sentAt: "2026-10-03T12:00:05.000Z",
    requestId: "cap-1",
    code: "no-focused-window",
  };

  it("accepts each closed code and refuses anything else", () => {
    for (const code of CAPTURE_FAILURE_CODES) {
      expect(validateIngestMessage({ ...failure, code }).ok).toBe(true);
    }
    expect(validateIngestMessage({ ...failure, code: "boom" }).ok).toBe(false);
    expect(validateIngestMessage({ ...failure, message: "x" }).ok).toBe(false);
    const { requestId: _omitted, ...bare } = failure;
    expect(validateIngestMessage(bare).ok).toBe(false);
  });
});

// Conformance for the strict-reader hazard (ADR-0020). LEGACY_CONTROL is the
// control object exactly as the companion read it before capture requests: a
// strict reader. The new field is not readable by it, which is why Studio
// emits it only to a companion that declared the feature.
describe("capture request negotiation", () => {
  const LEGACY_CONTROL = z.strictObject({
    state: sessionControlStateSchema,
    credentialExpiresAt: isoTimestampSchema,
  });
  const capture = {
    requestId: "c",
    mode: "display",
    expiresAt: "2026-10-03T12:00:20.000Z",
  };

  it("a strict legacy reader rejects control.capture, so it is never additive", () => {
    expect(LEGACY_CONTROL.safeParse({ ...control, capture }).success).toBe(
      false,
    );
    expect(LEGACY_CONTROL.safeParse(control).success).toBe(true);
  });

  it("the current reader accepts a control with and without capture", () => {
    expect(controlStatusSchema.safeParse(control).success).toBe(true);
    expect(controlStatusSchema.safeParse({ ...control, capture }).success).toBe(
      true,
    );
  });

  it("reads the declaration tolerantly and never throws", () => {
    const headers = (values: Record<string, string>) => (name: string) =>
      values[name] ?? null;
    expect(
      parseCompanionDeclaration(
        headers({
          [COMPANION_FEATURES_HEADER]: `future.v9, ${COMPANION_FEATURE_CAPTURE_REQUEST}`,
          [COMPANION_SCREEN_HEADER]: "disp-1.3",
        }),
      ),
    ).toEqual({ captureRequests: true, screenSelection: "disp-1.3" });
    expect(parseCompanionDeclaration(headers({}))).toEqual({
      captureRequests: false,
    });
    expect(
      parseCompanionDeclaration(headers({ [COMPANION_SCREEN_HEADER]: "a b" })),
    ).toEqual({ captureRequests: false });
    expect(formatCompanionFeatures()).toBe(COMPANION_FEATURE_CAPTURE_REQUEST);
  });
});
