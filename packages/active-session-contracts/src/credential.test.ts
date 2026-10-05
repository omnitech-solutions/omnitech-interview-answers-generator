import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_RANDOM_BYTES,
  CREDENTIAL_TRANSPORT,
  credentialClaimsSchema,
  credentialShapeSchema,
  generateCredential,
  hashCredential,
  hashesEqual,
} from "./credential";

describe("credential", () => {
  it("carries at least 128 random bits", () => {
    expect(CREDENTIAL_RANDOM_BYTES * 8).toBeGreaterThanOrEqual(128);
    const credential = generateCredential();
    expect(credentialShapeSchema.safeParse(credential).success).toBe(true);
    // 43 base64url characters decode to 32 bytes.
    expect(credential.slice("asc_".length)).toHaveLength(43);
  });

  it("is unique per generation", () => {
    const seen = new Set(Array.from({ length: 50 }, generateCredential));
    expect(seen.size).toBe(50);
  });

  it("is safe in an Authorization header and never allowed in a URL", () => {
    const credential = generateCredential();
    expect(credential).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(CREDENTIAL_TRANSPORT).toEqual({
      header: "Authorization",
      scheme: "Bearer",
      allowedInUrl: false,
    });
  });

  it("hashes stably to a hex digest that is not the credential", async () => {
    const credential = generateCredential();
    const first = await hashCredential(credential);
    const second = await hashCredential(credential);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(credential);
    expect(first).not.toContain(credential.slice(4));
    expect(await hashCredential(generateCredential())).not.toBe(first);
  });

  it("compares hashes for equality", async () => {
    const hash = await hashCredential("asc_x");
    expect(hashesEqual(hash, await hashCredential("asc_x"))).toBe(true);
    expect(hashesEqual(hash, await hashCredential("asc_y"))).toBe(false);
    expect(hashesEqual(hash, hash.slice(1))).toBe(false);
  });

  it("claims name tenant, owner, session, expiry and the ingest scope only", () => {
    const claims = {
      tenantId: "t-1",
      ownerId: "o-1",
      sessionId: "s-1",
      expiresAt: "2026-10-03T12:00:00.000Z",
      scope: "ingest",
    };
    expect(credentialClaimsSchema.safeParse(claims).success).toBe(true);
    expect(
      credentialClaimsSchema.safeParse({ ...claims, scope: "control" }).success,
    ).toBe(false);
    expect(
      credentialClaimsSchema.safeParse({ ...claims, roles: ["admin"] }).success,
    ).toBe(false);
  });
});
