import type { AiExecutionRequest } from "@omnitech/ai-contracts";
import {
  INTERVIEW_ANSWER_PROFILE,
  INTERVIEW_SESSION_DEVICE_PROFILE,
  INTERVIEW_SESSION_FAST_PROFILE,
} from "@omnitech/product-interview/session-worker";
import { describe, expect, it } from "vitest";
import { createSessionGateway } from "./session-gateway.js";

const REMOTE = {
  AI_BASE_URL: "https://models.example.test/v1",
  AI_MODEL: "m",
  AI_API_KEY: "test-key",
};

describe("session gateway composition", () => {
  it("is null when no language model is configured", () => {
    expect(createSessionGateway({})).toBeNull();
  });

  it("throws for an unusable model, which the worker turns into a disabled loop", () => {
    expect(() =>
      createSessionGateway({ ...REMOTE, AI_API_KEY: undefined }),
    ).toThrow();
  });

  it("serves the fast and code-solution profiles for a remote declaration", () => {
    expect(createSessionGateway(REMOTE)?.profileIds).toEqual([
      INTERVIEW_SESSION_FAST_PROFILE,
      INTERVIEW_ANSWER_PROFILE,
    ]);
  });

  it("adds the device profile only for a device-declared loopback model", () => {
    const loopback = {
      AI_BASE_URL: "http://127.0.0.1:1234/v1",
      AI_MODEL: "m",
    };
    expect(
      createSessionGateway({ ...loopback, AI_LOCALITY: "device" })?.profileIds,
    ).toEqual([
      INTERVIEW_SESSION_FAST_PROFILE,
      INTERVIEW_ANSWER_PROFILE,
      INTERVIEW_SESSION_DEVICE_PROFILE,
    ]);
    // Loopback without a declaration is not inferred to be device.
    expect(createSessionGateway(loopback)?.profileIds).toEqual([
      INTERVIEW_SESSION_FAST_PROFILE,
      INTERVIEW_ANSWER_PROFILE,
    ]);
    // A device declaration on a non-loopback URL is downgraded to remote.
    expect(
      createSessionGateway({ ...REMOTE, AI_LOCALITY: "device" })?.profileIds,
    ).toEqual([INTERVIEW_SESSION_FAST_PROFILE, INTERVIEW_ANSWER_PROFILE]);
  });

  const request = (
    permissions: string[],
    processingPolicy: "device-only" | "permitted-remote",
  ): AiExecutionRequest => ({
    context: { tenantId: "t", userId: "u", productId: "p", permissions },
    profileId: INTERVIEW_SESSION_FAST_PROFILE,
    task: {
      type: "structured-generation",
      system: "s",
      prompt: "p",
      schema: { type: "object" },
    },
    processingPolicy,
  });

  it("refuses a caller without interview.read", async () => {
    await expect(
      createSessionGateway(REMOTE)?.gateway.execute(
        request([], "permitted-remote"),
      ),
    ).rejects.toThrow();
  });

  it("refuses the code-solution profile for a device-only request even when the model is declared to run on the device", async () => {
    const device = {
      AI_BASE_URL: "http://127.0.0.1:1234/v1",
      AI_MODEL: "m",
      AI_LOCALITY: "device",
    };
    await expect(
      createSessionGateway(device)?.gateway.execute({
        ...request(["interview.read"], "device-only"),
        profileId: INTERVIEW_ANSWER_PROFILE,
      }),
    ).rejects.toMatchObject({ code: "policy-refused" });
  });

  it("refuses a device-only request on a non-device fast profile", async () => {
    await expect(
      createSessionGateway(REMOTE)?.gateway.execute(
        request(["interview.read"], "device-only"),
      ),
    ).rejects.toThrow();
  });
});
