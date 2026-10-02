import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disposablePostgres } from "../assistant/workspace-fixture.js";
import { briefPrompt, createBriefsApi } from "./api.js";

let pg: Awaited<ReturnType<typeof disposablePostgres>>;
const brief = {
  version: 1,
  headline: "React re-renders when **state**, a parent, or a context changes.",
  points: [
    { heading: "Triggers", body: "State updates, a parent render, context." },
    { heading: "Reconciliation", body: "React diffs the new tree." },
    { heading: "Avoiding work", body: "Memoise or move state down." },
  ],
  example: "A search box re-rendering a 1,000-row table.",
  pitfall: "Saying it re-renders only when props change.",
  followUps: [
    { question: "What does memo compare?", answer: "Props, shallowly." },
  ],
};
let generated: unknown = brief;
const prompts: { system: string; prompt: string }[] = [];
const app = () =>
  createBriefsApi({
    database: pg.database,
    resolveScope: async (request) =>
      request.headers.get("x-anonymous")
        ? null
        : {
            tenantId: "t",
            actorId: request.headers.get("x-actor") ?? "alice",
            productId: "interview",
          },
    generate: async (input) => {
      prompts.push(input);
      if (generated instanceof Error) throw generated;
      return generated;
    },
  });
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await app().request(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  pg = await disposablePostgres();
  for (const file of [
    "0004_assistant_interview.sql",
    "0009_concept_briefs.sql",
  ])
    await pg.migrate(
      new URL(
        `../../../../../packages/platform-storage/migrations/${file}`,
        import.meta.url,
      ),
    );
  await pg.admin.query(
    "GRANT DELETE ON interview.concept_briefs TO fixture_member",
  );
});
afterAll(async () => {
  await pg?.close();
});

describe("briefs API", () => {
  it("builds, lists, reads and deletes a brief", async () => {
    const created = await request("/api/interview/briefs", "POST", {
      kind: "concept",
      topic: "How does React decide when to re-render?",
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      kind: "concept",
      title: "How does React decide when to re-render?",
      brief: { headline: brief.headline },
    });
    expect(prompts.at(-1)?.prompt).toBe(
      "Question: How does React decide when to re-render?",
    );
    expect(prompts.at(-1)).not.toHaveProperty("schema");
    expect(prompts.at(-1)?.system).toContain("matches this JSON Schema");
    expect(prompts.at(-1)?.system).toContain('"followUps"');

    const listed = await request("/api/interview/briefs");
    expect(listed.body.briefs).toHaveLength(1);
    expect(listed.body.briefs[0]).not.toHaveProperty("brief");
    const read = await request(`/api/interview/briefs/${created.body.id}`);
    expect(read.body.brief.points).toHaveLength(3);
    expect(
      (await request(`/api/interview/briefs/${created.body.id}`, "DELETE"))
        .body,
    ).toEqual({
      ok: true,
    });
    expect(
      (await request(`/api/interview/briefs/${created.body.id}`)).status,
    ).toBe(404);
    expect(
      (await request(`/api/interview/briefs/${created.body.id}`, "DELETE"))
        .status,
    ).toBe(404);
  });

  it("refuses an answer that does not fit the brief, and stores nothing", async () => {
    generated = { ...brief, points: brief.points.slice(0, 2) };
    expect(
      (
        await request("/api/interview/briefs", "POST", {
          kind: "concept",
          topic: "X",
        })
      ).status,
    ).toBe(502);
    generated = new Error("model down");
    expect(
      (
        await request("/api/interview/briefs", "POST", {
          kind: "concept",
          topic: "X",
        })
      ).status,
    ).toBe(502);
    generated = brief;
    expect((await request("/api/interview/briefs")).body.briefs).toEqual([]);
  });

  it("validates requests, keeps briefs private and refuses other sites", async () => {
    expect(
      (
        await request("/api/interview/briefs", "POST", {
          kind: "story",
          topic: "X",
        })
      ).status,
    ).toBe(400);
    await request("/api/interview/briefs", "POST", {
      kind: "system-design",
      topic: "Cache",
    });
    expect(
      (
        await request("/api/interview/briefs", "GET", undefined, {
          "x-actor": "bob",
        })
      ).body,
    ).toEqual({ briefs: [] });
    expect(
      (
        await request("/api/interview/briefs", "GET", undefined, {
          "x-anonymous": "1",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(
          "/api/interview/briefs",
          "POST",
          { kind: "concept", topic: "X" },
          {
            origin: "https://evil.example",
          },
        )
      ).status,
    ).toBe(403);
  });
});

describe("briefPrompt", () => {
  it("shapes concept and system-design briefs differently", () => {
    expect(briefPrompt("concept", "Q").system).toContain("concept question");
    expect(briefPrompt("system-design", "Q").system).toContain(
      "system-design question",
    );
    expect(briefPrompt("concept", "Q").system).toContain("untrusted input");
  });
});
