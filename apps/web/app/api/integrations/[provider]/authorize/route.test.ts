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

it("does not know providers other than Google and LinkedIn", async () => {
  const response = await authorize("github");
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Integration not found." });
});

it("returns 503 when state signing is not configured", async () => {
  vi.stubEnv("INTEGRATION_STATE_SECRET", "");
  const response = await authorize("linkedin");
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "Integration state signing is not configured.",
  });
});
