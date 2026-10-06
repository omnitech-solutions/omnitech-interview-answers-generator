import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getProviderConfiguration,
  signIntegrationState,
  verifyIntegrationState,
} from "./oauth";

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

describe("PKCE capability", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is on for Google, whose S256 support is documented", () => {
    vi.stubEnv("INTEGRATION_GOOGLE_ID", "client-id");
    vi.stubEnv("INTEGRATION_GOOGLE_SECRET", "secret");
    expect(getProviderConfiguration("google")?.pkce).toBe(true);
  });

  // UNVERIFIED offline: LinkedIn's web-app PKCE support is not confirmed, so
  // it stays off unless the operator opts in.
  it("is off for LinkedIn unless INTEGRATION_LINKEDIN_PKCE=1", () => {
    vi.stubEnv("INTEGRATION_LINKEDIN_ID", "client-id");
    vi.stubEnv("INTEGRATION_LINKEDIN_SECRET", "secret");
    expect(getProviderConfiguration("linkedin")?.pkce).toBe(false);
    vi.stubEnv("INTEGRATION_LINKEDIN_PKCE", "1");
    expect(getProviderConfiguration("linkedin")?.pkce).toBe(true);
  });

  it("carries the challenge in the signed state and rejects a tampered one", () => {
    const state = {
      provider: "google" as const,
      tenantId: "00000000-0000-4000-8000-000000000002",
      tenantSlug: "acme",
      userId: "00000000-0000-4000-8000-000000000001",
      expiresAt: Date.now() + 60_000,
      pkceChallenge: "challenge-1",
    };
    const signed = signIntegrationState(
      state,
      "secret-that-is-long-enough-32-chars",
    );
    expect(
      verifyIntegrationState(signed, "secret-that-is-long-enough-32-chars")
        .pkceChallenge,
    ).toBe("challenge-1");
    const [, signature] = signed.split(".");
    const forged = `${Buffer.from(JSON.stringify({ ...state, pkceChallenge: "other" })).toString("base64url")}.${signature}`;
    expect(() =>
      verifyIntegrationState(forged, "secret-that-is-long-enough-32-chars"),
    ).toThrow("Invalid OAuth state.");
  });
});
