// @vitest-environment node
import { describe, expect, it } from "vitest";
import config from "./next.config";

describe("next.config security posture", () => {
  it("does not announce the framework", () => {
    expect(config.poweredByHeader).toBe(false);
  });

  // NX-SEC-01: a static baseline. A full Content-Security-Policy is deferred on
  // purpose (it needs a nonce, dynamic rendering and allowances for the OCR
  // worker, wasm and Mermaid), so the only CSP directive is frame-ancestors.
  it("sends exactly the baseline header set on every route", async () => {
    const [baseline] = (await config.headers?.()) ?? [];
    expect(
      Object.fromEntries(
        (baseline?.headers ?? []).map(({ key, value }) => [key, value]),
      ),
    ).toEqual({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy":
        "camera=(), geolocation=(), microphone=(self), display-capture=(self)",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Content-Security-Policy": "frame-ancestors 'self'",
    });
  });

  // A header here replaces the route's own, so a route that sets a stricter
  // policy must be left out of the baseline and given only what it lacks.
  it("leaves the routes that set their own policy alone, adding only nosniff", async () => {
    const [baseline, own] = (await config.headers?.()) ?? [];
    const pattern = (source: string | undefined) => new RegExp(`^${source}$`);
    const screenshot = "/api/interview/t/local/sessions/abc/screenshots/def";
    const complete = "/api/native-auth/complete";
    for (const path of [screenshot, complete]) {
      expect(path).not.toMatch(pattern(baseline?.source));
      expect(path).toMatch(pattern(own?.source));
    }
    for (const path of ["/", "/sign-in", "/api/platform/v1/context"]) {
      expect(path).toMatch(pattern(baseline?.source));
      expect(path).not.toMatch(pattern(own?.source));
    }
    expect(own?.headers).toEqual([
      { key: "X-Content-Type-Options", value: "nosniff" },
    ]);
  });
});
