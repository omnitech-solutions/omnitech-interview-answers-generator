import { createHash } from "node:crypto";
import {
  createPkcePair,
  signIntegrationState,
} from "@omnitech/platform-integrations";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const tenant = { id: "00000000-0000-4000-8000-000000000002", slug: "acme" };
const user = { id: "00000000-0000-4000-8000-000000000001" };
vi.mock("@/src/platform/context", () => ({
  resolvePlatformContext: async () => ({ tenant, user }),
}));

const { GET } = await import("./route");
const stateSecret = "integration-state-secret-at-least-32";

beforeEach(() => {
  vi.stubEnv("INTEGRATION_STATE_SECRET", stateSecret);
  vi.stubEnv(
    "CONNECTED_ACCOUNT_SECRET",
    "connected-account-secret-at-least-32",
  );
});
afterEach(() => vi.unstubAllEnvs());

// ADR-0006 D3: the callback shares the provider configuration, so a missing
// client id or secret is the same 503, before any code exchange or redirect.
it("returns 503 before exchanging the code when the provider is not configured", async () => {
  vi.stubEnv("INTEGRATION_GOOGLE_ID", "");
  vi.stubEnv("INTEGRATION_GOOGLE_SECRET", "");
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const state = signIntegrationState(
    {
      provider: "google",
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      userId: user.id,
      expiresAt: Date.now() + 60_000,
    },
    stateSecret,
  );
  const response = await GET(
    new Request(
      `https://app.test/api/integrations/google/callback?code=c&state=${state}`,
    ),
    { params: Promise.resolve({ provider: "google" }) },
  );
  expect(response.status).toBe(503);
  expect(response.headers.get("location")).toBeNull();
  expect(await response.json()).toEqual({
    error: "The google integration is not configured.",
  });
  expect(fetchSpy).not.toHaveBeenCalled();
});

function signedState(overrides: Record<string, unknown> = {}) {
  return signIntegrationState(
    {
      provider: "google",
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      userId: user.id,
      expiresAt: Date.now() + 60_000,
      ...overrides,
    },
    stateSecret,
  );
}

function callback(state: string) {
  return GET(
    new Request(
      `https://app.test/api/integrations/google/callback?code=c&state=${encodeURIComponent(state)}`,
    ),
    { params: Promise.resolve({ provider: "google" }) },
  );
}

// A state that is not exactly the one this member's authorize signed is a
// refusal, never an unhandled error.
it.each([
  ["tampered", () => `${signedState()}x`],
  [
    "signed with another secret",
    () =>
      signIntegrationState(
        {
          provider: "google",
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          userId: user.id,
          expiresAt: Date.now() + 60_000,
        },
        "another-secret-that-is-at-least-32-chars",
      ),
  ],
  ["malformed", () => "not-a-state"],
  ["expired", () => signedState({ expiresAt: Date.now() - 1 })],
  [
    "another workspace's",
    () => signedState({ tenantId: "00000000-0000-4000-8000-000000000009" }),
  ],
  [
    "another member's",
    () => signedState({ userId: "00000000-0000-4000-8000-000000000009" }),
  ],
])("returns 403 for a %s state", async (_case, state) => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const response = await callback(state());
  expect(response.status).toBe(403);
  expect(response.headers.get("location")).toBeNull();
  expect(fetchSpy).not.toHaveBeenCalled();
});

// ADR-0006 D3: a missing signing or vault secret is an operator gap.
it.each(["INTEGRATION_STATE_SECRET", "CONNECTED_ACCOUNT_SECRET"])(
  "returns 503 when %s is not configured",
  async (name) => {
    const state = signedState();
    vi.stubEnv(name, "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await callback(state);
    expect(response.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  },
);

// RFC 9700 PKCE: the callback needs the verifier cookie the same attempt's
// authorize set, and refuses before any token request when it is absent,
// wrong, or from another attempt.
function pkceCallback(
  verifier: string | undefined,
  challenge = createPkcePair().challenge,
) {
  return GET(
    new Request(
      `https://app.test/api/integrations/google/callback?code=c&state=${encodeURIComponent(signedState({ pkceChallenge: challenge }))}`,
      verifier === undefined
        ? {}
        : { headers: { cookie: `integration_pkce_google=${verifier}` } },
    ),
    { params: Promise.resolve({ provider: "google" }) },
  );
}

it.each([
  ["missing", () => pkceCallback(undefined)],
  ["wrong", () => pkceCallback("not-the-verifier-of-this-attempt-xxxxxxxxxx")],
  [
    "from an earlier attempt",
    () => pkceCallback(createPkcePair().verifier, createPkcePair().challenge),
  ],
])(
  "returns 403 before any token request when the PKCE verifier is %s",
  async (_case, run) => {
    vi.stubEnv("INTEGRATION_GOOGLE_ID", "client-id");
    vi.stubEnv("INTEGRATION_GOOGLE_SECRET", "client-secret");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await run();
    expect(response.status).toBe(403);
    expect(response.headers.get("location")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  },
);

it("returns 403 for a PKCE provider whose state carries no challenge (a replayed or foreign state)", async () => {
  vi.stubEnv("INTEGRATION_GOOGLE_ID", "client-id");
  vi.stubEnv("INTEGRATION_GOOGLE_SECRET", "client-secret");
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const response = await GET(
    new Request(
      `https://app.test/api/integrations/google/callback?code=c&state=${encodeURIComponent(signedState())}`,
      {
        headers: {
          cookie: `integration_pkce_google=${createPkcePair().verifier}`,
        },
      },
    ),
    { params: Promise.resolve({ provider: "google" }) },
  );
  expect(response.status).toBe(403);
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("with the matching verifier, sends it on the token exchange, then spends the attempt by clearing the cookie", async () => {
  vi.stubEnv("INTEGRATION_GOOGLE_ID", "client-id");
  vi.stubEnv("INTEGRATION_GOOGLE_SECRET", "client-secret");
  const { verifier, challenge } = createPkcePair();
  expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
    challenge,
  );
  const bodies: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    bodies.push(String(init?.body ?? ""));
    // Stop after the token request: the grant is refused.
    return new Response("{}", { status: 400 });
  });
  const response = await pkceCallback(verifier, challenge);
  expect(new URLSearchParams(bodies[0]).get("code_verifier")).toBe(verifier);
  // The attempt is spent whatever the outcome: the verifier cookie is cleared.
  expect(response.status).toBe(502);
  expect(response.headers.get("set-cookie")).toMatch(
    /integration_pkce_google=;.*Max-Age=0/i,
  );
});
