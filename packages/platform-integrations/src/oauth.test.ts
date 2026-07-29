import { describe, expect, it } from "vitest";
import { signIntegrationState, verifyIntegrationState } from "./oauth.js";

const secret = "integration-state-secret-at-least-32";
const state = {
  provider: "linkedin" as const,
  tenantId: "00000000-0000-4000-8000-000000000002",
  tenantSlug: "acme",
  userId: "00000000-0000-4000-8000-000000000001",
  expiresAt: 2_000,
};

describe("integration state", () => {
  it("signs and verifies tenant-bound state", () => {
    expect(
      verifyIntegrationState(
        signIntegrationState(state, secret),
        secret,
        1_000,
      ),
    ).toEqual(state);
  });

  it("rejects tampering and expiration", () => {
    const signed = signIntegrationState(state, secret);
    expect(() => verifyIntegrationState(`${signed}x`, secret, 1_000)).toThrow();
    expect(() => verifyIntegrationState(signed, secret, 3_000)).toThrow(
      /expired/,
    );
  });
});
