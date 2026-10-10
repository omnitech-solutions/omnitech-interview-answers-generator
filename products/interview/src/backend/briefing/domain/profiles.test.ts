import { describe, expect, it } from "vitest";
import {
  currentProfileError,
  matrixHash,
  matrixTooLarge,
  nextProfileRevision,
  profileHashError,
  profileImportError,
  shouldSyncDefaultProfile,
} from "./profiles";

describe("immutable profile revisions", () => {
  it("hashes object keys canonically and preserves array order", () => {
    expect(matrixHash({ b: 2, a: { d: 4, c: 3 } })).toBe(
      matrixHash({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(matrixHash([1, 2])).not.toBe(matrixHash([2, 1]));
    expect(profileHashError({ a: 1 }, matrixHash({ a: 1 }))).toBeNull();
    expect(profileHashError({ a: 2 }, matrixHash({ a: 1 }))).toBe(
      "evidence-hash-conflict",
    );
  });
  it("counts UTF-8 bytes and accepts the exact byte limit", () => {
    expect(matrixTooLarge("a".repeat(1_048_574))).toBe(false);
    expect(matrixTooLarge("a".repeat(1_048_575))).toBe(true);
    expect(matrixTooLarge("é".repeat(524_288))).toBe(true);
  });
  it("allows only a matching existing revision, or a fresh profile", () => {
    const existing = { revision: 3, revoked: false };
    expect(profileImportError(existing, 3)).toBeNull();
    expect(profileImportError(existing, undefined)).toBe("revision-conflict");
    expect(profileImportError(existing, 2)).toBe("revision-conflict");
    expect(profileImportError({ ...existing, revoked: true }, 2)).toBe(
      "not-found",
    );
    expect(profileImportError(undefined, undefined)).toBeNull();
    expect(profileImportError(undefined, 0)).toBeNull();
    expect(profileImportError(undefined, 1)).toBe("revision-conflict");
    expect(nextProfileRevision(existing)).toBe(4);
    expect(nextProfileRevision(undefined)).toBe(1);
  });
  it("seeds only an empty workspace and never overwrites known content or a revocation", () => {
    expect(shouldSyncDefaultProfile(undefined, false, false)).toBe(true);
    expect(shouldSyncDefaultProfile(undefined, true, false)).toBe(false);
    expect(
      shouldSyncDefaultProfile({ revision: 2, revoked: false }, true, false),
    ).toBe(true);
    expect(
      shouldSyncDefaultProfile({ revision: 2, revoked: false }, false, true),
    ).toBe(false);
    expect(
      shouldSyncDefaultProfile({ revision: 2, revoked: true }, false, false),
    ).toBe(false);
  });
  it("requires the requested revision to remain current", () => {
    expect(currentProfileError(3, 3)).toBeNull();
    expect(currentProfileError(4, 3)).toBe("evidence-revision-conflict");
    expect(currentProfileError(undefined, 3)).toBe(
      "evidence-revision-conflict",
    );
  });
});
