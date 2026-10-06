// @vitest-environment node
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";
import { apiErrorHandler, originGuard } from "./api-safety";

function app() {
  const api = new Hono();
  api.use("/api/*", originGuard);
  api.onError(apiErrorHandler);
  api.get("/api/read", (c) => c.json({ ok: true }));
  for (const method of ["post", "put", "patch", "delete"] as const)
    api[method]("/api/write", (c) => c.json({ ok: true }));
  api.get("/api/boom", () => {
    throw new Error("prompt SECRET-PROMPT-TEXT leaked");
  });
  api.get("/api/teapot", () => {
    throw new HTTPException(418, { message: "short and stout" });
  });
  return api;
}

const send = (init: RequestInit & { headers?: Record<string, string> }) =>
  app().request("http://studio.test/api/write", init);

describe("the origin guard", () => {
  it("lets a non-browser caller through: a bearer token and no Origin", async () => {
    const response = await send({
      method: "POST",
      headers: { authorization: "Bearer token", host: "studio.test" },
    });
    expect(response.status).toBe(200);
  });

  it("lets a same-origin browser request through, whatever the scheme", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"])
      expect(
        (
          await send({
            method,
            headers: {
              origin: "http://studio.test",
              "sec-fetch-site": "same-origin",
            },
          })
        ).status,
      ).toBe(200);
    expect(
      (
        await send({
          method: "POST",
          headers: { origin: "https://studio.test", host: "studio.test" },
        })
      ).status,
    ).toBe(200);
  });

  it("refuses a forged cross-site browser request, for every mutating method", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await send({
        method,
        headers: {
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
          "content-type": "text/plain",
        },
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: {
          code: "origin_forbidden",
          message: "Cross-site requests are not allowed.",
        },
      });
    }
  });

  it("refuses a foreign Origin without Sec-Fetch-Site, and a null Origin", async () => {
    expect(
      (
        await send({
          method: "POST",
          headers: { origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await send({ method: "POST", headers: { origin: "null" } })).status,
    ).toBe(403);
  });

  it("refuses a sibling port on the same host: same-site is not same-origin", async () => {
    const response = await send({
      method: "POST",
      headers: {
        origin: "http://studio.test:4000",
        "sec-fetch-site": "same-site",
      },
    });
    expect(response.status).toBe(403);
  });

  it("never blocks a read", async () => {
    const response = await app().request("http://studio.test/api/read", {
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
    });
    expect(response.status).toBe(200);
  });
});

describe("the API error handler", () => {
  it("answers an unexpected error with a fixed body and no error text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await app().request("http://studio.test/api/boom");
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: "internal_error", message: "Something went wrong." },
    });
    expect(text).not.toContain("SECRET-PROMPT-TEXT");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "SECRET-PROMPT-TEXT",
    );
  });

  it("keeps an HTTPException's own status, without its message", async () => {
    const response = await app().request("http://studio.test/api/teapot");
    expect(response.status).toBe(418);
    expect(await response.text()).not.toContain("short and stout");
  });
});
