import { signIntegrationState } from "@omnitech/platform-integrations";
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
