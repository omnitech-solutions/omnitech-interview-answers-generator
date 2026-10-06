import { createHash } from "node:crypto";
import { verifyIntegrationState } from "@omnitech/platform-integrations";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/src/platform/context", () => ({
  resolvePlatformContext: async () => ({
    tenant: { id: "00000000-0000-4000-8000-000000000002", slug: "acme" },
    user: { id: "00000000-0000-4000-8000-000000000001" },
  }),
}));

const { GET } = await import("./route");

beforeEach(() => {
  vi.stubEnv(
    "INTEGRATION_STATE_SECRET",
    "integration-state-secret-at-least-32",
  );
  vi.stubEnv(
    "CONNECTED_ACCOUNT_SECRET",
    "connected-account-secret-at-least-32",
  );
});
afterEach(() => vi.unstubAllEnvs());

const authorize = (provider: string) =>
  GET(
    new Request(
      `https://app.test/api/integrations/${provider}/authorize?tenant=acme`,
    ),
    { params: Promise.resolve({ provider }) },
  );

// ADR-0006 D3: a missing client id or secret is an operator configuration
// failure, reported as 503 before the browser is sent to the provider.
it("returns 503 without redirecting when the provider is not configured", async () => {
  vi.stubEnv("INTEGRATION_GOOGLE_ID", "");
  vi.stubEnv("INTEGRATION_GOOGLE_SECRET", "");
  const response = await authorize("google");
  expect(response.status).toBe(503);
  expect(response.headers.get("location")).toBeNull();
  expect(await response.json()).toEqual({
    error: "The google integration is not configured.",
  });
});

it("redirects to the provider when it is configured", async () => {
  vi.stubEnv("INTEGRATION_GOOGLE_ID", "client-id");
  vi.stubEnv("INTEGRATION_GOOGLE_SECRET", "client-secret");
  const response = await authorize("google");
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toMatch(
    /^https:\/\/accounts\.google\.com\//,
  );
});

// RFC 9700: the verifier stays in an httpOnly cookie scoped to the callback;
// only its S256 challenge travels in the URL, and the signed state carries
// that challenge so the callback can tie the cookie to this attempt.
it("starts a PKCE attempt: challenge in the URL, verifier only in an httpOnly cookie", async () => {
  vi.stubEnv("INTEGRATION_GOOGLE_ID", "client-id");
  vi.stubEnv("INTEGRATION_GOOGLE_SECRET", "client-secret");
  const response = await authorize("google");
  const location = new URL(response.headers.get("location")!);
  const cookie = response.headers.get("set-cookie") ?? "";
  const verifier = /integration_pkce_google=([^;]+)/.exec(cookie)?.[1];

  expect(location.searchParams.get("code_challenge_method")).toBe("S256");
  expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  expect(location.searchParams.get("code_challenge")).toBe(
    createHash("sha256").update(verifier!).digest("base64url"),
  );
  expect(location.toString()).not.toContain(verifier!);
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/Secure/i);
  expect(cookie).toMatch(/SameSite=lax/i);
  expect(cookie).toContain("Path=/api/integrations/google/callback");
  expect(cookie).toMatch(/Max-Age=600/i);
  const state = verifyIntegrationState(
    location.searchParams.get("state")!,
    "integration-state-secret-at-least-32",
  );
  expect(state.pkceChallenge).toBe(location.searchParams.get("code_challenge"));
});

it("uses a fresh verifier for every attempt", async () => {
  vi.stubEnv("INTEGRATION_GOOGLE_ID", "client-id");
  vi.stubEnv("INTEGRATION_GOOGLE_SECRET", "client-secret");
  const a = (await authorize("google")).headers.get("set-cookie");
  const b = (await authorize("google")).headers.get("set-cookie");
  expect(a).not.toBe(b);
});

it("sends no challenge and sets no cookie for a provider without PKCE", async () => {
  vi.stubEnv("INTEGRATION_LINKEDIN_ID", "client-id");
  vi.stubEnv("INTEGRATION_LINKEDIN_SECRET", "client-secret");
  const response = await authorize("linkedin");
  expect(
    new URL(response.headers.get("location")!).searchParams.has(
      "code_challenge",
    ),
  ).toBe(false);
  expect(response.headers.get("set-cookie")).toBeNull();
});

it("does not know providers other than Google and LinkedIn", async () => {
  const response = await authorize("github");
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Integration not found." });
});

// The callback cannot sign state or store tokens without these, so the
// browser is never sent to a provider it could not come back from.
it.each(["INTEGRATION_STATE_SECRET", "CONNECTED_ACCOUNT_SECRET"])(
  "returns 503 without redirecting when %s is not configured",
  async (name) => {
    vi.stubEnv("INTEGRATION_GOOGLE_ID", "client-id");
    vi.stubEnv("INTEGRATION_GOOGLE_SECRET", "client-secret");
    vi.stubEnv(name, "");
    const response = await authorize("google");
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual({
      error: "Integration secrets are not configured.",
    });
  },
);
