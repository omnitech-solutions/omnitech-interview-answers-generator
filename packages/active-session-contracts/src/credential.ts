import { z } from "zod";
import { isoTimestampSchema, opaqueIdSchema } from "./ids";

// The credential travels only as `Authorization: Bearer <credential>` and is
// never placed in a URL or logged (rule:credential-storage).
export const CREDENTIAL_TRANSPORT = Object.freeze({
  header: "Authorization",
  scheme: "Bearer",
  allowedInUrl: false,
});

export const CREDENTIAL_RANDOM_BYTES = 32; // 256 bits, above the 128-bit floor
export const CREDENTIAL_PREFIX = "asc_";

// Claims bound to the credential: ingest for one session only. Identity for
// ingest comes from these claims and nowhere else.
export const credentialClaimsSchema = z.strictObject({
  tenantId: opaqueIdSchema,
  ownerId: opaqueIdSchema,
  sessionId: opaqueIdSchema,
  expiresAt: isoTimestampSchema,
  scope: z.literal("ingest"),
});
export type CredentialClaims = z.infer<typeof credentialClaimsSchema>;

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

// Header-safe: prefix plus base64url, no characters that need escaping.
export function generateCredential(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CREDENTIAL_RANDOM_BYTES));
  return `${CREDENTIAL_PREFIX}${base64Url(bytes)}`;
}

export const credentialShapeSchema = z
  .string()
  .max(128)
  .regex(/^asc_[A-Za-z0-9_-]{43}$/);

// SHA-256 hex is enough for storage because the secret is high-entropy random.
export async function hashCredential(credential: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(credential),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Compares two hashes without an early exit on the first differing character.
export function hashesEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
