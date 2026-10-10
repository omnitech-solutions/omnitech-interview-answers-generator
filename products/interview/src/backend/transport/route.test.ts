import { type Context, Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { handle, input, param } from "./route";

const logged = vi.hoisted(() => vi.fn());
vi.mock("@omnitech/logging", () => ({
  createLogger: () => ({ error: logged }),
}));
afterEach(() => logged.mockClear());
class Conflict extends Error {}

describe("route failures", () => {
  it("answers known errors from the table without logging", async () => {
    const app = new Hono().get(
      "/",
      handle(
        { known: [[Conflict, 409, "conflict"]], log: "save" },
        async () => {
          throw new Conflict("private");
        },
      ),
    );
    const response = await app.request("/");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "conflict" } });
    expect(logged).not.toHaveBeenCalled();
  });

  it("logs only the class name and configured route before a fixed fallback", async () => {
    const app = new Hono().get(
      "/",
      handle({ log: "load", otherwise: [500, "failed"] }, async () => {
        throw new TypeError("private prompt");
      }),
    );
    const response = await app.request("/");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "failed" } });
    expect(logged).toHaveBeenCalledWith("route.failed", {
      route: "load",
      error: "TypeError",
    });
    expect(JSON.stringify(logged.mock.calls)).not.toContain("private prompt");
  });

  it("rethrows the original error when no fallback was declared", async () => {
    const error = new Error("private");
    const work = handle({}, async (_c: Context) => {
      throw error;
    });
    await expect(work({} as Context)).rejects.toBe(error);
  });

  it("answers only configured own-property codes, including non-Error refusals", async () => {
    const app = new Hono().get(
      "/:code",
      handle(
        { codes: { missing: 404 }, otherwise: [500, "failed"] },
        async (c) => {
          throw { code: c.req.param("code"), message: "private" };
        },
      ),
    );
    expect((await app.request("/missing")).status).toBe(404);
    expect(await (await app.request("/missing")).json()).toEqual({
      error: { code: "missing" },
    });
    for (const code of ["toString", "constructor", "unmapped"])
      expect((await app.request(`/${code}`)).status).toBe(500);
  });

  it("parses typed bounded input and UUID params", async () => {
    const app = new Hono().post(
      "/:id",
      handle({}, async (c) =>
        c.json({
          id: param(c, "id"),
          ...(await input(c, z.object({ count: z.number() }), 100)),
        }),
      ),
    );
    const id = "eeb1537e-8afe-4c02-b1be-90f658ff1d10";
    const response = await app.request(`/${id}`, {
      method: "POST",
      body: '{"count":3}',
    });
    expect(await response.json()).toEqual({ id, count: 3 });
    expect(
      (await app.request("/invalid", { method: "POST", body: "{}" })).status,
    ).toBe(400);
  });

  it("answers Zod, JSON and size refusals without echoing validation messages", async () => {
    const app = new Hono().post(
      "/",
      handle({ log: "input" }, async (c) =>
        c.json(
          await input(
            c,
            z.object({ count: z.number({ error: "private validation" }) }),
            24,
          ),
        ),
      ),
    );
    for (const body of ['{"count":"private"}', "bad json"]) {
      const response = await app.request("/", { method: "POST", body });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "invalid-request" },
      });
    }
    expect(
      (await app.request("/", { method: "POST", body: "x".repeat(25) })).status,
    ).toBe(413);
    expect(logged).not.toHaveBeenCalled();
  });
});
