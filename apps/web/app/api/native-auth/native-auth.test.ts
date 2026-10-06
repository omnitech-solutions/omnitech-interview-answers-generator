// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  value: null as null | { user: { email: string; name: string } },
}));
vi.mock("@/auth", () => ({
  auth: async () => session.value,
  signIn: vi.fn(async () => new Response(null, { status: 302 })),
  authSecret: "test-secret-test-secret-test-secret-123",
  sessionCookieName: () => "omnitech.dev-session",
}));

const { signIn } = await import("@/auth");
const { nativeHandoffs } = await import("@/src/platform/native-handoff");
const complete = (await import("./complete/route")).GET;
const redeem = (await import("./redeem/route")).GET;
const providers = (await import("./providers/route")).GET;
const start = (await import("./start/route")).GET;

const ORIGIN = "https://studio.test";
const STATE = "s".repeat(43);

beforeEach(() => {
  session.value = { user: { email: "me@example.test", name: "Me" } };
});
afterEach(() => vi.unstubAllEnvs());

it("reports no provider by default and refuses to start without one", async () => {
  vi.stubEnv("AUTH_GOOGLE_ID", "");
  vi.stubEnv("AUTH_LINKEDIN_ID", "");
  expect(await (await providers()).json()).toEqual({ configured: false });
  const response = await start(
    new Request(`${ORIGIN}/api/native-auth/start?state=${STATE}`),
  );
  expect(response.status).toBe(503);
});

// A production build with FAKE_AUTH_ENABLED has no no-session bypass (it is a
// development-only shortcut), so the shell starts signed out. Without this the
// shell was told "no provider, no sign-in needed" and its panel ended on a 404.
it("offers the local sign-in to the shell only where the bypass is off", async () => {
  vi.stubEnv("AUTH_GOOGLE_ID", "");
  vi.stubEnv("AUTH_LINKEDIN_ID", "");
  vi.stubEnv("FAKE_AUTH_ENABLED", "true");

  // Development: the bypass signs the shell in; nothing to offer.
  vi.stubEnv("NODE_ENV", "development");
  expect(await (await providers()).json()).toEqual({ configured: false });

  // A production build: the shell signs in as the local user.
  vi.stubEnv("NODE_ENV", "production");
  expect(await (await providers()).json()).toEqual({ configured: true });
  vi.mocked(signIn).mockClear();
  const response = await start(
    new Request(`${ORIGIN}/api/native-auth/start?state=${STATE}`),
  );
  expect(response.status).toBe(302);
  expect(signIn).toHaveBeenCalledWith("local", {
    redirectTo: `/api/native-auth/complete?state=${STATE}`,
  });

  // Fake sign-in off: nothing to offer, whatever the build.
  vi.stubEnv("FAKE_AUTH_ENABLED", "false");
  expect(await (await providers()).json()).toEqual({ configured: false });
});

it("round trips: callback carries only the code, redemption sets the cookie once", async () => {
  nativeHandoffs().beginAttempt(STATE);
  const done = await complete(
    new Request(`${ORIGIN}/api/native-auth/complete?state=${STATE}`),
  );
  expect(done.status).toBe(302);
  const location = new URL(done.headers.get("location")!);
  expect(location.protocol).toBe("omnitech-studio:");
  expect([...location.searchParams.keys()]).toEqual(["code"]);
  expect(done.headers.get("set-cookie")).toBeNull();
  const code = location.searchParams.get("code")!;

  const url = `${ORIGIN}/api/native-auth/redeem?code=${code}&state=${STATE}&tenant=local`;
  const first = await redeem(new Request(url));
  expect(first.status).toBe(302);
  // Relative, so the web view stays on the host it used: a route behind
  // `next start` derives its own origin as localhost, and the shell, which
  // keeps cookies and trust per host, would otherwise land on a host with no
  // session.
  expect(first.headers.get("location")).toBe(
    "/t/local/p/interview/live/overlay?host=native",
  );
  expect(first.headers.get("set-cookie")).toContain("omnitech.dev-session=");
  expect(first.headers.get("set-cookie")).toContain("HttpOnly");

  const replay = await redeem(new Request(url));
  expect(replay.status).toBe(403);
  expect(replay.headers.get("set-cookie")).toBeNull();
});

it("refuses completion without a session or a pending attempt", async () => {
  session.value = null;
  nativeHandoffs().beginAttempt(STATE);
  expect(
    (await complete(new Request(`${ORIGIN}/x?state=${STATE}`))).status,
  ).toBe(403);
  session.value = { user: { email: "me@example.test", name: "Me" } };
  expect(
    (await complete(new Request(`${ORIGIN}/x?state=${"t".repeat(43)}`))).status,
  ).toBe(403);
});

it("refuses redemption from another origin or with another state", async () => {
  nativeHandoffs().beginAttempt(STATE);
  const done = await complete(new Request(`${ORIGIN}/x?state=${STATE}`));
  const code = new URL(done.headers.get("location")!).searchParams.get("code")!;
  const wrongOrigin = await redeem(
    new Request(
      `https://evil.test/api/native-auth/redeem?code=${code}&state=${STATE}`,
    ),
  );
  expect(wrongOrigin.status).toBe(403);
});
