import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ATTEMPT_TTL_MS,
  configuredLoginProviders,
  HANDOFF_TTL_MS,
  isAttemptState,
  NativeHandoffStore,
} from "./native-handoff";

const ORIGIN = "https://studio.test";
const STATE = "a".repeat(43);
const OTHER_STATE = "b".repeat(43);
// The shell keeps the verifier secret and sends only its SHA-256 as the challenge.
const VERIFIER = "v".repeat(43);
const challengeOf = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");
const CHALLENGE = challengeOf(VERIFIER);
const identity = { email: "me@example.test", name: "Me", image: null };

function store() {
  const clock = { now: 1_000_000 };
  return { clock, store: new NativeHandoffStore(() => clock.now) };
}

describe("native sign-in handoff", () => {
  it("issues a code for a pending attempt and consumes it once", () => {
    const { store: handoffs } = store();
    expect(handoffs.beginAttempt(STATE, CHALLENGE)).toBe(true);
    const code = handoffs.issue(STATE, ORIGIN, identity);
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(handoffs.consume(code!, STATE, VERIFIER, ORIGIN)).toEqual(identity);
    // Replay of a spent code fails.
    expect(handoffs.consume(code!, STATE, VERIFIER, ORIGIN)).toBeNull();
  });

  it("refuses a completion with no pending attempt, and a second completion", () => {
    const { store: handoffs } = store();
    expect(handoffs.issue(STATE, ORIGIN, identity)).toBeNull();
    handoffs.beginAttempt(STATE, CHALLENGE);
    expect(handoffs.issue(STATE, ORIGIN, identity)).not.toBeNull();
    expect(handoffs.issue(STATE, ORIGIN, identity)).toBeNull();
  });

  it("needs the shell's secret verifier: the code and state alone redeem nothing", () => {
    const { store: handoffs } = store();
    handoffs.beginAttempt(STATE, CHALLENGE);
    const code = handoffs.issue(STATE, ORIGIN, identity)!;
    // An app that read the state from history and the code from the URL scheme.
    expect(handoffs.consume(code, STATE, "w".repeat(43), ORIGIN)).toBeNull();
    // A wrong try spends the code: the real shell cannot redeem it afterwards.
    expect(handoffs.consume(code, STATE, VERIFIER, ORIGIN)).toBeNull();
    // And the right verifier works on a fresh code.
    handoffs.beginAttempt(STATE, CHALLENGE);
    const fresh = handoffs.issue(STATE, ORIGIN, identity)!;
    expect(handoffs.consume(fresh, STATE, VERIFIER, ORIGIN)).toEqual(identity);
  });

  it("refuses an attempt that brings no valid challenge", () => {
    const { store: handoffs } = store();
    expect(handoffs.beginAttempt(STATE, "")).toBe(false);
    expect(handoffs.beginAttempt(STATE, "short")).toBe(false);
    expect(handoffs.beginAttempt(STATE, "!".repeat(43))).toBe(false);
    expect(handoffs.issue(STATE, ORIGIN, identity)).toBeNull();
  });

  it("expires a code after 60 seconds and an attempt after its window", () => {
    const { clock, store: handoffs } = store();
    handoffs.beginAttempt(STATE, CHALLENGE);
    const code = handoffs.issue(STATE, ORIGIN, identity)!;
    clock.now += HANDOFF_TTL_MS;
    expect(handoffs.consume(code, STATE, VERIFIER, ORIGIN)).toBeNull();

    handoffs.beginAttempt(OTHER_STATE, CHALLENGE);
    clock.now += ATTEMPT_TTL_MS;
    expect(handoffs.issue(OTHER_STATE, ORIGIN, identity)).toBeNull();
    expect(HANDOFF_TTL_MS).toBeLessThanOrEqual(60_000);
  });

  it("is bound to the attempt and the origin, and a wrong try spends the code", () => {
    const { store: handoffs } = store();
    handoffs.beginAttempt(STATE, CHALLENGE);
    const code = handoffs.issue(STATE, ORIGIN, identity)!;
    expect(handoffs.consume(code, OTHER_STATE, VERIFIER, ORIGIN)).toBeNull();
    expect(handoffs.consume(code, STATE, VERIFIER, ORIGIN)).toBeNull();

    handoffs.beginAttempt(STATE, CHALLENGE);
    const next = handoffs.issue(STATE, ORIGIN, identity)!;
    expect(
      handoffs.consume(next, STATE, VERIFIER, "https://evil.test"),
    ).toBeNull();
    expect(handoffs.consume(next, STATE, VERIFIER, ORIGIN)).toBeNull();
  });

  it("rejects malformed states, unknown and oversized codes", () => {
    const { store: handoffs } = store();
    expect(handoffs.beginAttempt("short", CHALLENGE)).toBe(false);
    expect(isAttemptState("x".repeat(65))).toBe(false);
    expect(isAttemptState("has space ".repeat(5))).toBe(false);
    expect(handoffs.consume("unknown", STATE, VERIFIER, ORIGIN)).toBeNull();
    expect(
      handoffs.consume("x".repeat(500), STATE, VERIFIER, ORIGIN),
    ).toBeNull();
  });

  it("holds codes only as hashes", () => {
    const { store: handoffs } = store();
    handoffs.beginAttempt(STATE, CHALLENGE);
    const code = handoffs.issue(STATE, ORIGIN, identity)!;
    expect(
      JSON.stringify([
        ...(
          handoffs as unknown as { handoffs: Map<string, unknown> }
        ).handoffs.keys(),
      ]),
    ).not.toContain(code);
  });
});

describe("configured login providers", () => {
  it("is empty by default, so the shell never prompts for the dev user", () => {
    expect(configuredLoginProviders({ FAKE_AUTH_ENABLED: "true" })).toEqual([]);
  });
  it("lists a provider only with both id and secret", () => {
    expect(
      configuredLoginProviders({
        AUTH_GOOGLE_ID: "id",
        AUTH_GOOGLE_SECRET: "secret",
        AUTH_LINKEDIN_ID: "id",
      }),
    ).toEqual(["google"]);
  });
});
