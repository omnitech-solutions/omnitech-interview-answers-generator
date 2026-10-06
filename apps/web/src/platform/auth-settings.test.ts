// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEVELOPMENT_AUTH_SECRET,
  resolveAuthSecret,
  resolveTrustHost,
} from "./auth-settings";

describe("resolveAuthSecret", () => {
  it("uses the configured secret everywhere", () => {
    for (const NODE_ENV of ["production", "development"])
      expect(
        resolveAuthSecret({ NODE_ENV, AUTH_SECRET: "configured-secret-value" }),
      ).toBe("configured-secret-value");
  });

  // AU-SEC-01: the committed string signs sessions only where the passwordless
  // local sign-in is deliberately on.
  it("falls back to the committed development secret only with FAKE_AUTH_ENABLED outside production", () => {
    expect(
      resolveAuthSecret({ NODE_ENV: "development", FAKE_AUTH_ENABLED: "true" }),
    ).toBe(DEVELOPMENT_AUTH_SECRET);
  });

  it("refuses the committed secret on a non-production host without FAKE_AUTH_ENABLED (staging)", () => {
    expect(resolveAuthSecret({ NODE_ENV: "development" })).toBeUndefined();
    expect(resolveAuthSecret({ NODE_ENV: "test" })).toBeUndefined();
    expect(
      resolveAuthSecret({
        NODE_ENV: "development",
        FAKE_AUTH_ENABLED: "false",
      }),
    ).toBeUndefined();
  });

  it("never falls back in production, fake sign-in or not", () => {
    expect(
      resolveAuthSecret({ NODE_ENV: "production", FAKE_AUTH_ENABLED: "true" }),
    ).toBeUndefined();
  });

  it("does not throw with an empty environment, so `next build` works", () => {
    expect(() => resolveAuthSecret({})).not.toThrow();
  });
});

describe("resolveTrustHost", () => {
  it("is on for the local fake-auth setup and for next dev", () => {
    expect(
      resolveTrustHost({ NODE_ENV: "production", FAKE_AUTH_ENABLED: "true" }),
    ).toBe(true);
    expect(resolveTrustHost({ NODE_ENV: "development" })).toBe(true);
  });

  it("is off for a production host unless AUTH_TRUST_HOST=true", () => {
    expect(resolveTrustHost({ NODE_ENV: "production" })).toBe(false);
    expect(
      resolveTrustHost({ NODE_ENV: "production", AUTH_TRUST_HOST: "true" }),
    ).toBe(true);
    expect(
      resolveTrustHost({ NODE_ENV: "production", AUTH_TRUST_HOST: "yes" }),
    ).toBe(false);
  });

  it("lets AUTH_TRUST_HOST=false switch it off anywhere", () => {
    expect(
      resolveTrustHost({
        NODE_ENV: "development",
        FAKE_AUTH_ENABLED: "true",
        AUTH_TRUST_HOST: "false",
      }),
    ).toBe(false);
  });
});
