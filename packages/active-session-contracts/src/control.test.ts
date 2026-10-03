import { describe, expect, it } from "vitest";
import {
  acknowledgementSchema,
  controlMessageSchema,
  heartbeatSchema,
  REFUSAL_CODES,
} from "./control.js";

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
