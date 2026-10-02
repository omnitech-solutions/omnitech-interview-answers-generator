import { describe, expect, it, vi } from "vitest";
import { InterviewApiError } from "./index.js";
import { createPlanClient } from "./plan.js";

const empty = { interview: null, items: [] };

describe("plan client", () => {
  it("sends each call to its route and returns the whole plan", async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(empty),
    );
    const client = createPlanClient({ baseUrl: "http://host/", fetch });
    await client.get();
    await client.saveInterview({
      company: "A",
      role: "B",
      scheduledAt: null,
      durationMinutes: null,
      format: "",
      topics: [],
    });
    await client.addItem({ kind: "task", ref: null, title: "Read" });
    await client.updateItem("a/b", { done: true });
    await expect(client.removeItem("x")).resolves.toEqual(empty);
    expect(
      fetch.mock.calls.map(([url, init]) => `${init?.method} ${url}`),
    ).toEqual([
      "GET http://host/api/interview/plan",
      "PUT http://host/api/interview/plan/interview",
      "POST http://host/api/interview/plan/items",
      "PATCH http://host/api/interview/plan/items/a%2Fb",
      "DELETE http://host/api/interview/plan/items/x",
    ]);
  });

  it("raises the server's error code", async () => {
    const client = createPlanClient({
      baseUrl: "",
      fetch: async () =>
        Response.json({ error: { code: "not-found" } }, { status: 404 }),
    });
    await expect(
      client.addItem({ kind: "task", ref: null, title: "x" }),
    ).rejects.toEqual(
      expect.objectContaining({ status: 404, message: "not-found" }),
    );
    await expect(
      createPlanClient({
        baseUrl: "",
        fetch: async () => new Response("oops", { status: 500 }),
      }).get(),
    ).rejects.toBeInstanceOf(InterviewApiError);
  });
});
