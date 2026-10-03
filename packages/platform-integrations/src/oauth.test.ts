import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getProviderConfiguration,
  signIntegrationState,
  verifyIntegrationState,
} from "./oauth.js";

describe("provider configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is undefined when the client id or secret is missing", () => {
    vi.stubEnv("INTEGRATION_GOOGLE_ID", "client-id");
    vi.stubEnv("INTEGRATION_GOOGLE_SECRET", "");
    expect(getProviderConfiguration("google")).toBeUndefined();
  });

  // ADR-0006 D4: the base integration requests OIDC profile data only;
  // product-specific scopes are a separate, later grant.
  it.each([
    ["google", ["openid", "email", "profile"]],
    ["linkedin", ["openid", "profile", "email"]],
  ] as const)(
    "requests only OIDC profile scopes from %s",
    (provider, scopes) => {
      vi.stubEnv(`INTEGRATION_${provider.toUpperCase()}_ID`, "client-id");
      vi.stubEnv(`INTEGRATION_${provider.toUpperCase()}_SECRET`, "secret");
      expect(getProviderConfiguration(provider)?.scopes).toEqual(scopes);
    },
  );
});

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
