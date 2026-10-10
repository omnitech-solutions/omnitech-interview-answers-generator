import { createHash } from "node:crypto";
import type { ExistingProfile } from "../contracts";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const matrixHash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");

export const matrixTooLarge = (matrix: unknown) =>
  Buffer.byteLength(JSON.stringify(matrix), "utf8") > 1_048_576;

export function profileImportError(
  existing: ExistingProfile | undefined,
  expectedRevision: number | undefined,
) {
  if (existing) {
    if (existing.revoked) return "not-found";
    if (expectedRevision !== existing.revision) return "revision-conflict";
  } else if (expectedRevision !== undefined && expectedRevision !== 0) {
    return "revision-conflict";
  }
  return null;
}

export const nextProfileRevision = (existing: ExistingProfile | undefined) =>
  existing ? existing.revision + 1 : 1;

// A local source seeds an empty workspace only; a previously imported file
// never overwrites a later edit made in the application.
export function shouldSyncDefaultProfile(
  existing: ExistingProfile | undefined,
  anyProfile: boolean,
  knownContent: boolean,
) {
  if (existing?.revoked) return false;
  if (!existing) return !anyProfile;
  return !knownContent;
}

export const currentProfileError = (
  latestRevision: number | undefined,
  revision: number,
) =>
  latestRevision === undefined || latestRevision !== revision
    ? "evidence-revision-conflict"
    : null;

export const profileHashError = (matrix: unknown, sha256: string) =>
  matrixHash(matrix) !== sha256 ? "evidence-hash-conflict" : null;
