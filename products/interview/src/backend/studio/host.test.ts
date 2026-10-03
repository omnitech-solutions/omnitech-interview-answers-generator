import type { Scope } from "@omnitech-assistant/contracts";
import {
  assistantGrants,
  PgBossRunQueue,
} from "@omnitech-assistant/storage-postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile.js";
import { disposablePostgres } from "../assistant/workspace-fixture.js";
import { createInterviewStudio } from "./host.js";

let pg: Awaited<ReturnType<typeof disposablePostgres>>;
let queue: PgBossRunQueue;
let studio: ReturnType<typeof createInterviewStudio>;
const alice: Scope = {
  tenantId: "tenant-a",
  actorId: "alice",
  productId: INTERVIEW_PRODUCT_ID,
};
const generate = vi.fn(async () => ({}));
const runner = { runAll: vi.fn() };

beforeAll(async () => {
  pg = await disposablePostgres();
  await pg.migrate();
  await pg.admin.query(assistantGrants("fixture_member"));
  queue = new PgBossRunQueue({
    ...pg.config,
    supervise: false,
    schedule: false,
  });
  await queue.start();
  studio = createInterviewStudio({
    database: pg.database,
    workerDatabase: pg.worker,
    queue,
    // The test names the member in a header the way the host's session does.
    resolveScope: async (request) =>
      request.headers.get("x-member") === "alice" ? alice : null,
    isMember: async (scope) => scope.actorId === "alice",
    model: { async *stream() {} },
    modelVersion: "test",
    generate,
    runner,
    contextCharacters: 10_000,
    loadDefaultProfile: async () => null,
  });
});
afterAll(async () => {
  await queue?.stop();
  await pg?.close();
});

const call = (
  path: string,
  init: { method?: string; body?: unknown; member?: string | null } = {},
) =>
  studio.app.request(`http://studio.test${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      origin: "http://studio.test",
      ...(init.member === null ? {} : { "x-member": init.member ?? "alice" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
const drafts = "/api/interview/workspaces/interview/artifacts";

describe("Interview Studio host", () => {
  it("refuses a request it cannot resolve to a member", async () => {
    expect((await call(drafts, { member: null })).status).toBe(401);
    expect((await call("/api/interview/plan", { member: null })).status).toBe(
      401,
    );
    expect(
      (await call("/api/assistant/v1/capabilities", { member: null })).status,
    ).toBe(401);
  });

  it("starts, edits, saves and lists a member's Workspace question", async () => {
    // Reading a question that does not exist yet starts it.
    const started = await (await call(`${drafts}/q1`)).json();
    expect(started.value.question).toBe("New interview question");

    const edited = await call(`${drafts}/q1`, {
      method: "PATCH",
      body: { origin: started.origin, patch: { question: "Two sum?" } },
    });
    expect(edited.status).toBe(200);
    const record = await edited.json();
    expect(record.value.question).toBe("Two sum?");

    // [GUARD] A patch for another question is refused.
    expect(
      (
        await call(`${drafts}/q2`, {
          method: "PATCH",
          body: { origin: record.origin, patch: { notes: "x" } },
        })
      ).status,
    ).toBe(409);
    expect(
      (await call(`${drafts}/q1`, { method: "PATCH", body: { bad: 1 } }))
        .status,
    ).toBe(400);

    // Only a question with an answer can be saved as a version.
    const answered = await (
      await call(`${drafts}/q1`, {
        method: "PATCH",
        body: {
          origin: record.origin,
          patch: {
            answer: {
              title: "Two sum",
              language: "typescript",
              answerMarkdown: "Use a map.",
              code: "export const twoSum = () => null;",
              usageCode: "",
              testCode: "",
            },
          },
        },
      })
    ).json();
    const saved = await call(`${drafts}/q1/save`, {
      method: "POST",
      body: { origin: answered.origin, requestId: "save-1" },
    });
    expect(saved.status).toBe(200);
    const versions = await (await call(`${drafts}/q1/versions`)).json();
    expect(versions).toEqual([
      expect.objectContaining({ id: "q1:1", question: "Two sum?" }),
    ]);
    const listed = await (await call(drafts)).json();
    expect(
      listed.map((item: { artifactId: string }) => item.artifactId),
    ).toEqual(["q1"]);
    expect(
      (
        await call(`${drafts}/q1/save`, {
          method: "POST",
          body: {
            origin: { ...answered.origin, artifactId: "q9" },
            requestId: "save-2",
          },
        })
      ).status,
    ).toBe(409);
  });

  it("says plainly when Docker is not running", async () => {
    runner.runAll.mockRejectedValueOnce(
      new Error("Docker daemon is unavailable."),
    );
    const record = await (await call(`${drafts}/q1`)).json();
    const response = await call(`${drafts}/q1/run-code`, {
      method: "POST",
      body: { origin: record.origin, requestId: "run-docker-down" },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "runner-unavailable" });
  });

  it("serves the plan, briefs, rehearsals and briefing packs for the member", async () => {
    for (const path of [
      "/api/interview/plan",
      "/api/interview/briefs",
      "/api/interview/rehearsals",
      "/api/interview/briefing/artifacts",
    ])
      expect((await call(path)).status).toBe(200);
  });

  it("forwards the assistant's routes with the member's scope", async () => {
    const response = await call("/api/assistant/v1/capabilities");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      features: expect.any(Array),
    });
    const threads = await call(
      "/api/assistant/v1/threads?workspaceId=interview&artifactId=q1",
    );
    expect(threads.status).toBe(200);
    expect(await threads.json()).toEqual([]);
    expect(typeof studio.worker.tick).toBe("function");
  });

  it("denies everything once a source the member relies on is restricted", async () => {
    await pg.admin.query(
      "INSERT INTO interview.assistant_evidence(tenant_id,actor_id,product_id,id,revision,sha256,locator,text,source_kind,classification,audience) VALUES($1,$2,$3,'secret',1,$4,'local://secret','x','candidate','restricted',$5)",
      [
        alice.tenantId,
        alice.actorId,
        alice.productId,
        "a".repeat(64),
        [alice.actorId],
      ],
    );
    expect((await call(drafts)).status).toBe(401);
  });
});
