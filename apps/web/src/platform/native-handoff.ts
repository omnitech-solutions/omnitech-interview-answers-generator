import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// [DOMAIN] The native shell's sign-in handoff (ADR-0019 amendment, ADR-0006).
// The shell runs Studio's ordinary Auth.js sign-in in a system web-auth
// session, then needs the same person signed in inside its embedded web view.
// A handoff code carries that one fact across: "this attempt signed in as this
// person". It is a login artifact only: it is not a provider token, it is never
// derived from or exchanged for one, and it never touches connected accounts.
// [SAFETY] Short-lived, single-use, bound to the shell's pending attempt and to
// Studio's origin, and held only as a SHA-256 hash. Held in process memory: a
// restart drops pending handoffs (the person signs in again); a multi-instance
// deployment must back this with a shared store.

export const HANDOFF_TTL_MS = 60_000;
export const ATTEMPT_TTL_MS = 5 * 60_000;
const MAX_PENDING = 200;

// The app bundle's own callback scheme (registered by bundle-app.sh).
export const NATIVE_CALLBACK_URL = "omnitech-studio://signin";

export interface HandoffIdentity {
  email: string;
  name: string | null;
  image: string | null;
}

interface Handoff {
  stateHash: Buffer;
  // base64url SHA-256 of the shell's secret verifier (RFC 7636 S256).
  challenge: string;
  origin: string;
  identity: HandoffIdentity;
  expiresAt: number;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest();
const hex = (digest: Buffer) => digest.toString("hex");

// The shell's attempt nonce: 32 to 64 URL-safe characters it generated.
export const isAttemptState = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{32,64}$/.test(value);

// The shell's PKCE challenge: the unpadded base64url SHA-256 of its secret
// verifier, always 43 characters. The verifier itself (43 to 128 URL-safe
// characters) stays inside the shell until it redeems the code.
export const isChallenge = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
export const isVerifier = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(value);

export class NativeHandoffStore {
  private readonly attempts = new Map<
    string,
    { expiresAt: number; challenge: string }
  >();
  private readonly handoffs = new Map<string, Handoff>();

  constructor(private readonly now: () => number = Date.now) {}

  // The shell started a sign-in: remember the attempt, with the challenge of its
  // secret verifier, so only it can be completed and only the shell can redeem
  // it. Returns false for a malformed state or challenge.
  beginAttempt(state: string, challenge: string): boolean {
    if (!isAttemptState(state) || !isChallenge(challenge)) return false;
    this.purge();
    this.attempts.set(hex(sha256(state)), {
      expiresAt: this.now() + ATTEMPT_TTL_MS,
      challenge,
    });
    return true;
  }

  // Sign-in finished with a session: turn the pending attempt into a one-time
  // code, or null when the attempt is unknown, expired or already completed.
  issue(
    state: string,
    origin: string,
    identity: HandoffIdentity,
  ): string | null {
    if (!isAttemptState(state)) return null;
    this.purge();
    const key = hex(sha256(state));
    const attempt = this.attempts.get(key);
    this.attempts.delete(key);
    if (attempt === undefined || attempt.expiresAt <= this.now()) return null;
    const code = randomBytes(32).toString("base64url");
    this.handoffs.set(hex(sha256(code)), {
      stateHash: sha256(state),
      challenge: attempt.challenge,
      origin,
      identity,
      expiresAt: this.now() + HANDOFF_TTL_MS,
    });
    return code;
  }

  // Verify and consume. The code is spent by any presentation, right or wrong,
  // so a guess cannot be retried and a replay always fails. The verifier must
  // hash to the challenge the attempt began with: the state travels in browser
  // history and the code through a URL scheme any app can register, so neither
  // alone redeems anything.
  consume(
    code: string,
    state: string,
    verifier: string,
    origin: string,
  ): HandoffIdentity | null {
    if (typeof code !== "string" || code.length > 128) return null;
    const key = hex(sha256(code));
    const handoff = this.handoffs.get(key);
    this.handoffs.delete(key);
    if (!handoff || handoff.expiresAt <= this.now()) return null;
    if (!isAttemptState(state)) return null;
    if (!timingSafeEqual(handoff.stateHash, sha256(state))) return null;
    if (!isVerifier(verifier)) return null;
    const presented = Buffer.from(
      createHash("sha256").update(verifier).digest("base64url"),
    );
    const expected = Buffer.from(handoff.challenge);
    if (
      presented.length !== expected.length ||
      !timingSafeEqual(presented, expected)
    )
      return null;
    if (handoff.origin !== origin) return null;
    return handoff.identity;
  }

  private purge() {
    const now = this.now();
    for (const [key, attempt] of this.attempts)
      if (attempt.expiresAt <= now) this.attempts.delete(key);
    for (const [key, handoff] of this.handoffs)
      if (handoff.expiresAt <= now) this.handoffs.delete(key);
    // A flood cannot grow the maps without bound: oldest entries go first.
    for (const map of [this.attempts, this.handoffs])
      while (map.size >= MAX_PENDING) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
  }
}

const holder = globalThis as { __nativeHandoffs?: NativeHandoffStore };
export const nativeHandoffs = (): NativeHandoffStore =>
  (holder.__nativeHandoffs ??= new NativeHandoffStore());

// Real login providers this Studio has configured (the fake local provider is
// not one: the shell needs no sign-in for it). Same environment as auth.ts.
export function configuredLoginProviders(
  env: Record<string, string | undefined> = process.env,
): ("google" | "linkedin")[] {
  const providers: ("google" | "linkedin")[] = [];
  if (env["AUTH_GOOGLE_ID"] && env["AUTH_GOOGLE_SECRET"])
    providers.push("google");
  if (env["AUTH_LINKEDIN_ID"] && env["AUTH_LINKEDIN_SECRET"])
    providers.push("linkedin");
  return providers;
}

export const isTenantSlug = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
