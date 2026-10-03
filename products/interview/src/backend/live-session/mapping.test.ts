// Pure tests for the database-to-core mapping and the credential helper; the
// database-backed behaviour is in repository.test.ts and the other suites.
import { hashCredential } from "@omnitech/active-session-contracts";
import { describe, expect, it } from "vitest";
import { SessionError } from "./errors.js";
import {
  decodeDraftKey,
  encodeDraftKey,
  policyFromDb,
  policyToDb,
  retentionFromDb,
  retentionRank,
  retentionToDb,
} from "./mapping.js";
import {
  credentialExpiry,
  mintSessionCredential,
  presentedCredentialHash,
} from "./session-credential.js";

describe("mapping between the database and the core", () => {
  it("round-trips policy and retention through the underscore forms", () => {
    expect(policyToDb("device-only")).toBe("device_only");
    expect(policyFromDb("permitted_remote")).toBe("permitted-remote");
    expect(retentionToDb("delete-at-end")).toBe("delete_at_end");
    expect(retentionFromDb("until_deleted")).toBe("until-deleted");
    expect(retentionRank("delete-at-end")).toBeLessThan(
      retentionRank("thirty-days"),
    );
    expect(retentionRank("thirty-days")).toBeLessThan(
      retentionRank("until-deleted"),
    );
  });

  it("refuses a value neither side defines", () => {
    expect(() => policyFromDb("anywhere")).toThrow(SessionError);
    expect(() => retentionFromDb("forever")).toThrow(SessionError);
  });

  it("encodes a text-keyed Workspace draft unambiguously", () => {
    const key = { workspaceId: "a/b", artifactId: 'c"d' };
    expect(decodeDraftKey(encodeDraftKey(key))).toEqual(key);
    expect(decodeDraftKey(null)).toBeNull();
  });
});

describe("the minted credential", () => {
  it("returns a plaintext and the hash of it, never the same string", async () => {
    const minted = await mintSessionCredential(0, 10 ** 9);
    expect(minted.hash).toBe(await hashCredential(minted.plaintext));
    expect(minted.hash).not.toBe(minted.plaintext);
    expect(minted.hash).not.toContain(minted.plaintext);
    const another = await mintSessionCredential(0, 10 ** 9);
    expect(another.plaintext).not.toBe(minted.plaintext);
  });

  it("expires no later than the session's duration cap", () => {
    expect(credentialExpiry(1_000, 2_000, 10_000).getTime()).toBe(2_000);
    expect(credentialExpiry(1_000, 99_000, 10_000).getTime()).toBe(11_000);
  });

  it("hashes a well-formed presented credential and nothing else", async () => {
    const minted = await mintSessionCredential(0, 10 ** 9);
    expect(await presentedCredentialHash(minted.plaintext)).toBe(minted.hash);
    expect(await presentedCredentialHash(`${minted.plaintext}x`)).toBeNull();
    expect(
      await presentedCredentialHash("Bearer " + minted.plaintext),
    ).toBeNull();
    expect(await presentedCredentialHash(undefined)).toBeNull();
  });
});
