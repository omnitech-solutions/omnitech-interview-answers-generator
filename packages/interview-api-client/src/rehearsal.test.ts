import { describe, expect, it, vi } from "vitest";
import { createRehearsalClient } from "./rehearsal.js";

const input = {
  format: "coding" as const,
  strict: true,
  followUps: false,
  concept: null,
  coding: { source: "question" as const, ref: "two-sum", title: "Two sum" },
  checks: [0, 1],
  reveals: ["hint1" as const],
  activeSeconds: 600,
  startedAt: "2026-10-01T10:00:00.000Z",
  endedAt: "2026-10-01T10:10:00.000Z",
};

describe("rehearsal client", () => {
  it("saves and lists through the rehearsals route", async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? Response.json({ ...input, id: "r1", score: 17 })
        : Response.json({ sessions: [{ ...input, id: "r1", score: 17 }] }),
    );
    const client = createRehearsalClient({ baseUrl: "http://host/", fetch });
    expect((await client.save(input)).score).toBe(17);
    expect(await client.list()).toHaveLength(1);
    expect(
      fetch.mock.calls.map(([url, init]) => `${init?.method} ${url}`),
    ).toEqual([
      "POST http://host/api/interview/rehearsals",
      "GET http://host/api/interview/rehearsals",
    ]);
  });

  it("raises the server's error code, or the status", async () => {
    const failing = (body: unknown) =>
      createRehearsalClient({
        baseUrl: "http://host",
        fetch: vi.fn(async () => Response.json(body, { status: 400 })),
      });
    await expect(
      failing({ error: { code: "invalid-request" } }).list(),
    ).rejects.toMatchObject({ status: 400, message: "invalid-request" });
    await expect(failing({}).list()).rejects.toThrow(
      "Rehearsal request failed with HTTP 400.",
    );
  });
});
