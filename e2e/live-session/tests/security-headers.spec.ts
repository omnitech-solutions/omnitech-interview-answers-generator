import { request } from "@playwright/test";
import { expect, test } from "../src/fixtures/test";

// NX-SEC-01/02: the baseline header set is on pages and API answers alike, and
// the server does not announce the framework. The set itself is pinned in
// apps/web/next.config.test.ts; this proves the running server sends it.
const BASELINE = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy":
    "camera=(), geolocation=(), microphone=(self), display-capture=(self)",
  "cross-origin-opener-policy": "same-origin",
  "content-security-policy": "frame-ancestors 'self'",
};

test("security headers: a page and an API answer carry the baseline, and neither says x-powered-by", async ({
  page,
}) => {
  for (const path of ["/sign-in", "/api/platform/v1/context?tenant=local"]) {
    const response = await page.request.get(path);
    const headers = response.headers();
    for (const [name, value] of Object.entries(BASELINE))
      expect(headers[name], `${path} ${name}`).toBe(value);
    expect(headers["x-powered-by"], path).toBeUndefined();
  }
});

test("security headers: a forged cross-site write is refused while the page's own write works", async ({
  page,
}) => {
  const url = "/api/platform/v1/preferences?tenant=local";
  const body = { theme: "system", locale: "en" };
  const forged = await page.request.put(url, {
    data: body,
    headers: {
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    },
  });
  expect(forged.status()).toBe(403);
  const own = await page.request.put(url, { data: body });
  expect(own.status()).toBe(200);
});

// A header from next.config replaces the same header a route sets itself, so
// the two routes with their own stricter policy are kept out of the baseline.
test("security headers: the native completion route keeps its own policy and still gets nosniff", async ({
  stack,
}) => {
  // Signed out, so the route refuses before it mints anything.
  const anonymous = await request.newContext({ baseURL: stack.webUrl });
  const response = await anonymous.get("/api/native-auth/complete");
  const headers = response.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["content-security-policy"]).not.toBe("frame-ancestors 'self'");
  expect(headers["referrer-policy"]).not.toBe(
    "strict-origin-when-cross-origin",
  );
});
