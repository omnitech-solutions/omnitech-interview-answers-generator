import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disposablePostgres } from "../assistant/workspace-fixture.js";
import { createRehearsalApi, rehearsalStatus } from "./api.js";

let pg: Awaited<ReturnType<typeof disposablePostgres>>;
const scope = {
  tenantId: "t",
  actorId: "alice",
  productId: "omnitech.interview",
};
const app = () =>
  createRehearsalApi({
    database: pg.database,
    resolveScope: async (request) =>
      request.headers.get("x-anonymous")
        ? null
        : { ...scope, actorId: request.headers.get("x-actor") ?? "alice" },
  });
async function request(
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await app().request(
    "http://localhost/api/interview/rehearsals",
    {
      method,
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  return { status: response.status, body: await response.json() };
}
const finished = (endedAt: string, checks: number[], reveals: string[]) => ({
  format: "full",
  strict: false,
  followUps: true,
  concept: { source: "prompt", ref: "react-render", title: "React re-renders" },
  coding: { source: "question", ref: "two-sum", title: "Two sum" },
  checks,
  reveals,
  activeSeconds: 1800,
  startedAt: "2026-10-01T10:00:00.000Z",
  endedAt,
});

beforeAll(async () => {
  pg = await disposablePostgres();
  for (const file of [
    "0004_assistant_interview.sql",
    "0010_rehearsal_sessions.sql",
  ])
    await pg.migrate(
      new URL(
        `../../../../../packages/platform-storage/migrations/${file}`,
        import.meta.url,
      ),
    );
});
afterAll(async () => {
  await pg?.close();
});

describe("rehearsal API", () => {
  it("scores a finished rehearsal itself and lists the newest first", async () => {
    const status = rehearsalStatus(pg.database);
    expect(await status(scope)).toEqual({
      label: "Not rehearsed yet",
      tone: "neutral",
    });
    // Duplicates are counted once: 8 checks − 2 hints = 74.
    const saved = await request(
      "POST",
      finished(
        "2026-10-01T11:00:00.000Z",
        [0, 1, 2, 3, 4, 5, 6, 7, 7],
        ["clarify", "hint1", "hint1"],
      ),
    );
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      score: 74,
      checks: [0, 1, 2, 3, 4, 5, 6, 7],
    });
    expect(await status(scope)).toEqual({
      label: "Last score 74",
      tone: "warn",
    });
    await request(
      "POST",
      finished("2026-10-01T12:00:00.000Z", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], []),
    );
    expect(await status(scope)).toEqual({
      label: "Last score 100",
      tone: "good",
    });
    const listed = await request("GET");
    expect(
      listed.body.sessions.map((item: { score: number }) => item.score),
    ).toEqual([100, 74]);
  });

  it("validates, keeps sessions private and refuses other sites", async () => {
    expect((await request("POST", { format: "marathon" })).status).toBe(400);
    expect(
      (await request("GET", undefined, { "x-actor": "bob" })).body,
    ).toEqual({
      sessions: [],
    });
    expect(
      (await request("GET", undefined, { "x-anonymous": "1" })).status,
    ).toBe(401);
    expect(
      (
        await request("POST", finished("2026-10-01T13:00:00.000Z", [], []), {
          origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
  });
});
