import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InterviewWorkspaceRepository } from "../assistant/workspace.js";
import { disposablePostgres } from "../assistant/workspace-fixture.js";
import { createPlanApi, questionStatus } from "./api.js";

let pg: Awaited<ReturnType<typeof disposablePostgres>>;
const scope = {
  tenantId: "tenant-a",
  actorId: "alice",
  productId: "omnitech.interview",
};
const app = () =>
  createPlanApi({
    database: pg.database,
    questionsWorkspace: "interview",
    resolveScope: async (request) =>
      request.headers.get("x-anonymous")
        ? null
        : { ...scope, actorId: request.headers.get("x-actor") ?? "alice" },
    rehearsalStatus: async (_scope, ref) =>
      ref ? { label: `Session ${ref}`, tone: "neutral" } : null,
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
const northwind = {
  company: "Northwind",
  role: "Senior Backend Engineer",
  scheduledAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  durationMinutes: 60,
  format: "live coding + concepts",
  topics: ["TypeScript", "PostgreSQL"],
};

beforeAll(async () => {
  pg = await disposablePostgres();
  await pg.migrate();
  await pg.admin.query(
    "GRANT DELETE ON interview.interview_plan_items TO fixture_member",
  );
});
afterAll(async () => {
  await pg?.close();
});

describe("plan API", () => {
  it("starts empty, then holds the interview being prepared for", async () => {
    expect((await request("/api/interview/plan")).body).toEqual({
      interview: null,
      items: [],
    });
    expect(
      (
        await request("/api/interview/plan/items", "POST", {
          kind: "task",
          ref: null,
          title: "Read the job post",
        })
      ).status,
    ).toBe(404);
    const created = await request(
      "/api/interview/plan/interview",
      "PUT",
      northwind,
    );
    expect(created.status).toBe(200);
    expect(created.body.interview).toMatchObject({
      company: "Northwind",
      durationMinutes: 60,
      topics: ["TypeScript", "PostgreSQL"],
    });
    const updated = await request("/api/interview/plan/interview", "PUT", {
      ...northwind,
      id: created.body.interview.id,
      format: "system design",
    });
    expect(updated.body.interview).toMatchObject({
      id: created.body.interview.id,
      format: "system design",
    });
    expect(
      (
        await request("/api/interview/plan/interview", "PUT", {
          ...northwind,
          company: "",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/interview/plan/interview", "PUT", {
          ...northwind,
          id: "nope",
        })
      ).status,
    ).toBe(404);
  });

  it("lists plan items with the live status of the work they link to", async () => {
    const drafts = new InterviewWorkspaceRepository(pg.database);
    await drafts.create(
      scope,
      { workspaceId: "interview", artifactId: "two-sum", artifactRevision: 0 },
      { question: "Two sum" },
    );
    await drafts.transaction(scope, async (tx, current) => {
      await drafts.beginEffectTransaction(tx, current, "run-code", "r1", {
        origin: {
          workspaceId: "interview",
          artifactId: "two-sum",
          artifactRevision: 0,
        },
        codeFingerprint: "f",
      });
      await drafts.completeEffectTransaction(tx, current, "run-code", "r1", {
        receipt: {},
        execution: {
          exitCode: 1,
          timedOut: false,
          tests: [{ status: "passed" }, { status: "failed" }],
        },
      });
    });
    for (const item of [
      { kind: "question", ref: "two-sum", title: "Solve: two sum" },
      { kind: "question", ref: "gone", title: "Solve: deleted" },
      { kind: "briefing", ref: "missing", title: "Brief: recruiter" },
      { kind: "rehearsal", ref: "1", title: "Rehearse once" },
      { kind: "task", ref: null, title: "Read the job post" },
    ])
      expect(
        (await request("/api/interview/plan/items", "POST", item)).status,
      ).toBe(200);
    const { body } = await request("/api/interview/plan");
    expect(
      body.items.map((item: { title: string; status: unknown }) => [
        item.title,
        item.status,
      ]),
    ).toEqual([
      ["Solve: two sum", { label: "1 of 2 tests passing", tone: "warn" }],
      ["Solve: deleted", { label: "Question not found", tone: "warn" }],
      ["Brief: recruiter", { label: "Briefing not found", tone: "warn" }],
      ["Rehearse once", { label: "Session 1", tone: "neutral" }],
      ["Read the job post", null],
    ]);
    expect(
      body.items.map((item: { position: number }) => item.position),
    ).toEqual([0, 1, 2, 3, 4]);

    const [first, second] = body.items;
    const ticked = await request(
      `/api/interview/plan/items/${first.id}`,
      "PATCH",
      {
        done: true,
      },
    );
    expect(ticked.body.items[0]).toMatchObject({
      done: true,
      title: "Solve: two sum",
    });
    const removed = await request(
      `/api/interview/plan/items/${second.id}`,
      "DELETE",
    );
    expect(removed.body.items).toHaveLength(4);
    expect(
      (await request(`/api/interview/plan/items/${second.id}`, "DELETE"))
        .status,
    ).toBe(404);
    expect(
      (
        await request(`/api/interview/plan/items/${first.id}`, "PATCH", {
          done: "yes",
        })
      ).status,
    ).toBe(400);
  });

  it("keeps each person's plan private", async () => {
    expect(
      (
        await request("/api/interview/plan", "GET", undefined, {
          "x-actor": "bob",
        })
      ).body,
    ).toEqual({ interview: null, items: [] });
    expect(
      (
        await request("/api/interview/plan", "GET", undefined, {
          "x-anonymous": "1",
        })
      ).status,
    ).toBe(401);
  });

  it("refuses writes from another site", async () => {
    expect(
      (
        await request("/api/interview/plan/interview", "PUT", northwind, {
          origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/api/interview/plan/interview", "PUT", northwind, {
          "sec-fetch-site": "cross-site",
        })
      ).status,
    ).toBe(403);
  });

  it("prepares for the next interview still ahead", async () => {
    const past = await request("/api/interview/plan/interview", "PUT", {
      ...northwind,
      company: "Old Co",
      scheduledAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    });
    expect(past.body.interview.company).toBe("Northwind");
  });
});

describe("questionStatus", () => {
  it("reads a run without per-test results by its outcome", () => {
    const draft = {
      artifactId: "a",
      title: "t",
      kind: "coding" as const,
      language: null,
      revision: 0,
      updatedAt: "",
    };
    expect(
      questionStatus({
        ...draft,
        lastRun: { ok: true, passed: null, total: null, at: "" },
      }),
    ).toEqual({ label: "Tests passing", tone: "good" });
    expect(
      questionStatus({
        ...draft,
        lastRun: { ok: false, passed: null, total: null, at: "" },
      }),
    ).toEqual({ label: "Tests failing", tone: "warn" });
    expect(
      questionStatus({
        ...draft,
        lastRun: { ok: true, passed: 3, total: 3, at: "" },
      }),
    ).toEqual({ label: "3 of 3 tests passing", tone: "good" });
    expect(questionStatus({ ...draft, lastRun: null })).toEqual({
      label: "Tests not run yet",
      tone: "neutral",
    });
  });
});
