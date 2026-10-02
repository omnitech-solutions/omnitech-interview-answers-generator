import { describe, expect, it, vi } from "vitest";
import { createBriefsClient } from "./briefs.js";

const brief = {
  id: "b1",
  kind: "concept",
  topic: "React",
  title: "React",
  updatedAt: "2026-10-01T00:00:00.000Z",
  brief: {
    version: 1,
    headline: "h",
    points: [
      { heading: "a", body: "b" },
      { heading: "c", body: "d" },
      { heading: "e", body: "f" },
    ],
    example: "x",
    pitfall: "y",
    followUps: [{ question: "q", answer: "a" }],
  },
};

describe("briefs client", () => {
  it("routes each call and validates what comes back", async () => {
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
      String(url).endsWith("/briefs") && (init?.method ?? "GET") === "GET"
        ? Response.json({ briefs: [{ ...brief, brief: undefined }] })
        : init?.method === "DELETE"
          ? Response.json({ ok: true })
          : Response.json(brief),
    );
    const client = createBriefsClient({ baseUrl: "http://host", fetch });
    expect(await client.list()).toHaveLength(1);
    expect((await client.get("b 1")).brief.points).toHaveLength(3);
    expect((await client.build({ kind: "concept", topic: "React" })).id).toBe(
      "b1",
    );
    await client.remove("b1");
    expect(
      fetch.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`),
    ).toEqual([
      "GET http://host/api/interview/briefs",
      "GET http://host/api/interview/briefs/b%201",
      "POST http://host/api/interview/briefs",
      "DELETE http://host/api/interview/briefs/b1",
    ]);
  });

  it("raises the server's error code", async () => {
    const client = createBriefsClient({
      baseUrl: "",
      fetch: async () =>
        Response.json(
          { error: { code: "generation-failed" } },
          { status: 502 },
        ),
    });
    await expect(client.build({ kind: "concept", topic: "x" })).rejects.toEqual(
      expect.objectContaining({ status: 502, message: "generation-failed" }),
    );
  });
});
