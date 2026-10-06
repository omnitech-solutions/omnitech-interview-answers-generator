import { createHash } from "node:crypto";
// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  value: null as null | { user: { email: string; name: string } },
}));
const cookieName = vi.hoisted(() =>
  vi.fn((_secure: boolean) => "omnitech.dev-session"),
);
vi.mock("@/auth", () => ({
  auth: async () => session.value,
  signIn: vi.fn(async () => new Response(null, { status: 302 })),
  authSecret: "test-secret-test-secret-test-secret-123",
  sessionCookieName: cookieName,
}));

const { signIn } = await import("@/auth");
const { nativeHandoffs } = await import("@/src/platform/native-handoff");
const complete = (await import("./complete/route")).GET;
const redeem = (await import("./redeem/route")).GET;
const providersRoute = (await import("./providers/route")).GET;
const providers = (host = "studio.test") =>
  providersRoute(
    new Request(`https://${host}/api/native-auth/providers`, {
      headers: { host },
    }),
  );
const start = (await import("./start/route")).GET;

const ORIGIN = "https://studio.test";

// The callback the finish page hands back: its button's address.
const callbackOf = (html: string): URL => {
  const button = /<a href="([^"]+)">Open Interview Studio<\/a>/.exec(html);
  const refresh = /http-equiv="refresh" content="0;url=([^"]+)"/.exec(html);
  expect(button?.[1]).toBeDefined();
  expect(refresh?.[1]).toBe(button?.[1]);
  return new URL(button?.[1] ?? "");
};
const STATE = "s".repeat(43);
const VERIFIER = "v".repeat(43);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

beforeEach(() => {
  session.value = { user: { email: "me@example.test", name: "Me" } };
});
afterEach(() => vi.unstubAllEnvs());

it("reports no provider by default and refuses to start without one", async () => {
  vi.stubEnv("AUTH_GOOGLE_ID", "");
  vi.stubEnv("AUTH_LINKEDIN_ID", "");
  expect(await (await providers()).json()).toEqual({
    configured: false,
    providers: [],
  });
  const response = await start(
    new Request(
      `${ORIGIN}/api/native-auth/start?state=${STATE}&challenge=${CHALLENGE}`,
    ),
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
  expect(await (await providers()).json()).toEqual({
    configured: false,
    providers: [],
  });

  // A production build: the shell signs in as the local user.
  vi.stubEnv("NODE_ENV", "production");
  expect(await (await providers()).json()).toEqual({
    configured: true,
    providers: [],
  });
  vi.mocked(signIn).mockClear();
  const response = await start(
    new Request(
      `${ORIGIN}/api/native-auth/start?state=${STATE}&challenge=${CHALLENGE}`,
    ),
  );
  expect(response.status).toBe(302);
  expect(signIn).toHaveBeenCalledWith("local", {
    redirectTo: `/api/native-auth/complete?state=${STATE}`,
  });

  // Fake sign-in off: nothing to offer, whatever the build.
  vi.stubEnv("FAKE_AUTH_ENABLED", "false");
  expect(await (await providers()).json()).toEqual({
    configured: false,
    providers: [],
  });
});

// The panel draws "Continue on this Mac" only where it is true that Studio runs
// on this computer: the fake sign-in is on AND the request names a loopback host.
it("lists the local sign-in for the panel only for a loopback request with fake sign-in on", async () => {
  vi.stubEnv("AUTH_GOOGLE_ID", "gid");
  vi.stubEnv("AUTH_GOOGLE_SECRET", "gsecret");
  vi.stubEnv("AUTH_LINKEDIN_ID", "");
  vi.stubEnv("FAKE_AUTH_ENABLED", "true");
  vi.stubEnv("NODE_ENV", "production");
  expect((await (await providers("127.0.0.1:3100")).json()).providers).toEqual([
    "google",
    "local",
  ]);
  expect((await (await providers("localhost:3100")).json()).providers).toEqual([
    "google",
    "local",
  ]);
  // A public host: the real providers only, whatever the fake sign-in says.
  expect(
    (await (await providers("studio.example.com")).json()).providers,
  ).toEqual(["google"]);
  vi.stubEnv("FAKE_AUTH_ENABLED", "false");
  expect((await (await providers("127.0.0.1:3100")).json()).providers).toEqual([
    "google",
  ]);
});

it("round trips: callback carries only the code, redemption sets the cookie once", async () => {
  nativeHandoffs().beginAttempt(STATE, CHALLENGE);
  const done = await complete(
    new Request(`${ORIGIN}/api/native-auth/complete?state=${STATE}`),
  );
  // The browser shows "You're signed in", with the callback as its button and
  // as an automatic redirect; the response itself sets no cookie.
  expect(done.status).toBe(200);
  expect(done.headers.get("content-type")).toContain("text/html");
  expect(done.headers.get("set-cookie")).toBeNull();
  const location = callbackOf(await done.text());
  expect(location.protocol).toBe("omnitech-studio:");
  expect([...location.searchParams.keys()]).toEqual(["code"]);
  const code = location.searchParams.get("code")!;

  const url = `${ORIGIN}/api/native-auth/redeem?code=${code}&state=${STATE}&verifier=${VERIFIER}&tenant=local`;
  const first = await redeem(new Request(url));
  expect(first.status).toBe(302);
  // Relative, so the web view stays on the host it used: a route behind
  // `next start` derives its own origin as localhost, and the shell, which
  // keeps cookies and trust per host, would otherwise land on a host with no
  // session.
  // ...and on the compact panel the shell itself loads, never the bare card.
  expect(first.headers.get("location")).toBe(
    "/t/local/p/interview/live/overlay?host=native&panel=single&handsfree=1",
  );
  expect(first.headers.get("set-cookie")).toContain("omnitech.dev-session=");
  expect(first.headers.get("set-cookie")).toContain("HttpOnly");

  const replay = await redeem(new Request(url));
  expect(replay.status).toBe(403);
  expect(replay.headers.get("set-cookie")).toBeNull();
});

it("refuses completion without a session or a pending attempt", async () => {
  session.value = null;
  nativeHandoffs().beginAttempt(STATE, CHALLENGE);
  expect(
    (await complete(new Request(`${ORIGIN}/x?state=${STATE}`))).status,
  ).toBe(403);
  session.value = { user: { email: "me@example.test", name: "Me" } };
  expect(
    (await complete(new Request(`${ORIGIN}/x?state=${"t".repeat(43)}`))).status,
  ).toBe(403);
});

it("refuses redemption from another origin or with another state", async () => {
  nativeHandoffs().beginAttempt(STATE, CHALLENGE);
  const done = await complete(new Request(`${ORIGIN}/x?state=${STATE}`));
  const code = callbackOf(await done.text()).searchParams.get("code")!;
  const wrongOrigin = await redeem(
    new Request(
      `https://evil.test/api/native-auth/redeem?code=${code}&state=${STATE}&verifier=${VERIFIER}`,
    ),
  );
  expect(wrongOrigin.status).toBe(403);
});

it("refuses redemption by a holder of the code and state who lacks the shell's verifier", async () => {
  nativeHandoffs().beginAttempt(STATE, CHALLENGE);
  const done = await complete(new Request(`${ORIGIN}/x?state=${STATE}`));
  const code = callbackOf(await done.text()).searchParams.get("code")!;
  const without = await redeem(
    new Request(`${ORIGIN}/api/native-auth/redeem?code=${code}&state=${STATE}`),
  );
  expect(without.status).toBe(403);
  expect(without.headers.get("set-cookie")).toBeNull();
  // Presenting the code spent it, even for the real shell.
  const spent = await redeem(
    new Request(
      `${ORIGIN}/api/native-auth/redeem?code=${code}&state=${STATE}&verifier=${VERIFIER}`,
    ),
  );
  expect(spent.status).toBe(403);
});

it("refuses to start a sign-in with no challenge", async () => {
  const response = await start(
    new Request(`${ORIGIN}/api/native-auth/start?state=${STATE}`),
  );
  expect(response.status).toBe(400);
});

it("the finish page is the design's 'You're signed in', loads nothing, runs no script, and is not cached", async () => {
  nativeHandoffs().beginAttempt(STATE, CHALLENGE);
  const done = await complete(new Request(`${ORIGIN}/x?state=${STATE}`));
  const html = await done.text();
  expect(html).toContain("You’re signed in");
  expect(html).toContain(
    "Return to the Interview Studio app. You can close this tab.",
  );
  expect(html).toContain("Open Interview Studio");
  expect(html).not.toMatch(/<script|https?:\/\//);
  expect(done.headers.get("cache-control")).toBe("no-store");
  expect(done.headers.get("content-security-policy")).toContain(
    "default-src 'none'",
  );
  expect(done.headers.get("x-frame-options")).toBe("DENY");
  // Neither the session token nor a provider token is on the page.
  expect(html).not.toMatch(/session|token/i);
});

// AU-SEC-04 (verified by experiment): behind a TLS-terminating proxy the
// request URL is http. Auth.js decides "secure" from AUTH_URL, else the
// forwarded protocol; the handoff must too, or it sets a plain cookie that
// Auth.js (which reads only the __Secure- name over https) never finds, and the
// person is silently signed out.
it.each([
  {
    when: "a plain http request",
    env: undefined,
    header: undefined,
    secure: false,
  },
  {
    when: "a proxy that forwards https",
    env: undefined,
    header: "https",
    secure: true,
  },
  {
    when: "an https AUTH_URL and no forwarded header",
    env: "https://studio.example",
    header: undefined,
    secure: true,
  },
  {
    when: "an http AUTH_URL even when forwarded https",
    env: "http://localhost:3000",
    header: "https",
    secure: false,
  },
])(
  "sets the session cookie's Secure flag from $when",
  async ({ env, header, secure }) => {
    const base = "http://studio.test";
    const state =
      `${secure ? "S" : "p"}${header ? "h" : "n"}${env ? "e" : "x"}`.padEnd(
        43,
        "q",
      );
    vi.stubEnv("AUTH_URL", env);
    cookieName.mockClear();
    nativeHandoffs().beginAttempt(state, CHALLENGE);
    const done = await complete(
      new Request(`${base}/api/native-auth/complete?state=${state}`),
    );
    const code = callbackOf(await done.text()).searchParams.get("code")!;
    const response = await redeem(
      new Request(
        `${base}/api/native-auth/redeem?code=${code}&state=${state}&verifier=${VERIFIER}`,
        {
          headers: header ? { "x-forwarded-proto": header } : {},
        },
      ),
    );
    expect(response.status).toBe(302);
    expect(cookieName).toHaveBeenCalledWith(secure);
    expect(/;\s*secure/i.test(response.headers.get("set-cookie") ?? "")).toBe(
      secure,
    );
  },
);
