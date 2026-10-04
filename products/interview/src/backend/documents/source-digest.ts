import { createHash } from "node:crypto";

// Only the mutable, approved source values enter this fingerprint. The
// immutable profile revision is identified separately by the document.
export function documentSourceDigest(
  candidacyValues: Record<string, string>,
  interviewValues: Record<string, string>,
): string {
  const sorted = (values: Record<string, string>) =>
    Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
  return createHash("sha256")
    .update(JSON.stringify([sorted(candidacyValues), sorted(interviewValues)]))
    .digest("hex");
}

export function revisionSourceDigest(provenance: unknown): string | null {
  if (!provenance || typeof provenance !== "object") return null;
  const value = (provenance as Record<string, unknown>)["sourceDigest"];
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
    ? value
    : null;
}

export function revisionModelOwnedKeys(provenance: unknown): string[] {
  if (!provenance || typeof provenance !== "object") return [];
  const value = (provenance as Record<string, unknown>)["modelOwnedKeys"];
  return Array.isArray(value) && value.every((key) => typeof key === "string")
    ? value
    : [];
}

export function revisionClaimState(
  provenance: unknown,
): "unverified" | "confirmed" {
  return provenance &&
    typeof provenance === "object" &&
    (provenance as Record<string, unknown>)["claimState"] === "confirmed"
    ? "confirmed"
    : "unverified";
}
