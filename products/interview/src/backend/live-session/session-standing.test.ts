// The standing verdict the agent port acts on after a capacity wait, without a
// database: a paused or ended session and a failed read are RETRYABLE answers,
// a session that is not remote-permitted is a final denial (ADR-0016).
import { describe, expect, it } from "vitest";
import {
  createSessionStillPermitted,
  standingVerdictOf,
} from "./session-standing.js";

describe("standingVerdictOf", () => {
  it("permits an active remote-permitted session", () => {
    expect(
      standingVerdictOf({
        status: "active",
        processing_policy: "permitted_remote",
      }),
    ).toBe(true);
  });

  it("says not-active, retryably, for a paused, ended or missing session", () => {
    for (const status of ["paused", "ended", "purging"])
      expect(
        standingVerdictOf({ status, processing_policy: "permitted_remote" }),
      ).toBe("not-active");
    expect(standingVerdictOf(undefined)).toBe("not-active");
  });

  it("denies, finally, a device-only or unreadable policy", () => {
    expect(
      standingVerdictOf({ status: "active", processing_policy: "device_only" }),
    ).toBe(false);
    expect(
      standingVerdictOf({ status: "active", processing_policy: "???" }),
    ).toBe(false);
  });
});

describe("createSessionStillPermitted", () => {
  const request = (key: string | undefined) => ({
    context: { tenantId: "t", userId: "u", productId: "p", permissions: [] },
    ...(key === undefined ? {} : { idempotencyKey: key }),
  });

  it("denies a request that names no session without reading anything", async () => {
    const check = createSessionStillPermitted({} as never);
    expect(await check(request("not-a-uuid:x"))).toBe(false);
    expect(await check(request(undefined))).toBe(false);
  });

  it("answers read-failed, retryably, when the read throws", async () => {
    const database = {
      transaction: async () => {
        throw new Error("connection reset");
      },
    } as never;
    const check = createSessionStillPermitted(database);
    expect(
      await check(request("00000000-0000-4000-8000-000000000001:t:1")),
    ).toBe("read-failed");
  });
});
