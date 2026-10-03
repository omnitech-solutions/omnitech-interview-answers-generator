// The ingest credential helper (rule:credential-storage, rule:credential-
// strength, rule:credential-lifetime-and-renewal). The plaintext exists only in
// the value returned to the owner at start or renewal; the database stores its
// SHA-256 hash and expiry. Nothing here logs, and no error carries a
// credential, so a canary credential never surfaces in a message.
import {
  ACTIVE_SESSION_LIMITS,
  credentialShapeSchema,
  generateCredential,
  hashCredential,
} from "@omnitech/active-session-contracts";

export type MintedCredential = {
  // Returned to the owner once; never stored, logged or put in a URL.
  plaintext: string;
  // What the session row stores.
  hash: string;
  expiresAt: Date;
};

// Never past the session's duration cap: the shorter of one credential
// lifetime and the time left on the session.
export function credentialExpiry(
  nowMs: number,
  sessionExpiresAtMs: number,
  lifetimeMs: number = ACTIVE_SESSION_LIMITS.credentialLifetimeMs,
): Date {
  return new Date(Math.min(nowMs + lifetimeMs, sessionExpiresAtMs));
}

export async function mintSessionCredential(
  nowMs: number,
  sessionExpiresAtMs: number,
): Promise<MintedCredential> {
  const plaintext = generateCredential();
  return {
    plaintext,
    hash: await hashCredential(plaintext),
    expiresAt: credentialExpiry(nowMs, sessionExpiresAtMs),
  };
}

// Hashes a presented credential, or returns null when it does not even have the
// credential's shape (so a malformed value never reaches the database).
export async function presentedCredentialHash(
  presented: unknown,
): Promise<string | null> {
  const shape = credentialShapeSchema.safeParse(presented);
  return shape.success ? hashCredential(shape.data) : null;
}
