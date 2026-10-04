import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { guidedProse } from "../../answer-fixture.js";
import { createInterviewAdapter } from "./adapter.js";
import { InterviewWorkspaceRepository } from "./workspace.js";
import { disposablePostgres } from "./workspace-fixture.js";

const scope = {
  tenantId: "code",
  actorId: "alice",
  productId: "omnitech.interview",
};
const origin = { workspaceId: "w", artifactId: "q", artifactRevision: 0 };
const answer = {
  title: "Synthetic",
  language: "typescript" as const,
  ...guidedProse("Technical explanation"),
  code: "return 1;",
  usageCode: "solution();",
  testCode: "assert.equal(1,1)",
};
let pg: Awaited<ReturnType<typeof disposablePostgres>>,
  workspace: InterviewWorkspaceRepository,
  calls = 0;
const result = {
  stdout: "one test passed",
  stderr: "",
  exitCode: 0,
  durationMs: 1,
  timedOut: false,
};
beforeAll(async () => {
  pg = await disposablePostgres();
  await pg.migrate();
  workspace = new InterviewWorkspaceRepository(pg.database);
  await workspace.create(scope, origin, { question: "Synthetic", answer });
});
afterAll(async () => {
  await pg?.close();
});
it("persists a scoped request and canonical code fingerprint before execution and replays the result once", async () => {
  const adapter = createInterviewAdapter(pg.database, {
    runner: {
      runAll: async (input) => {
        calls++;
        expect(input).toMatchObject({
          code: "return 1;",
          testCode: "assert.equal(1,1)",
        });
        const rows = (
          await pg.admin.query(
            "SELECT payload,state FROM interview.assistant_effect_receipts WHERE request_id='run-1'",
          )
        ).rows;
        expect(rows).toHaveLength(1);
        expect(rows[0]?.["state"]).toBe("started");
        return result;
      },
    },
  });
  const receipt = await adapter.runCode(
    scope,
    { origin, requestId: "run-1" },
    new AbortController().signal,
  );
  expect(receipt.passed).toBe(true);
  expect(
    await adapter.runCode(
      scope,
      { origin, requestId: "run-1" },
      new AbortController().signal,
    ),
  ).toEqual(receipt);
  expect(calls).toBe(1);
  const row = (
    await pg.admin.query(
      "SELECT fingerprint,payload,state,result FROM interview.assistant_effect_receipts WHERE request_id='run-1'",
    )
  ).rows[0]!;
  expect(row["state"]).toBe("completed");
  expect((row["result"] as { execution: unknown }).execution).toEqual(result);
  expect(
    (row["payload"] as { codeFingerprint: string }).codeFingerprint,
  ).toMatch(/^[a-f0-9]{64}$/);
  const codeFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        language: "typescript",
        code: "return 1;",
        usageCode: "solution();",
        testCode: "assert.equal(1,1)",
        stdin: "",
      }),
    )
    .digest("hex");
  expect((row["payload"] as { codeFingerprint: string }).codeFingerprint).toBe(
    codeFingerprint,
  );
  expect(row["fingerprint"]).toBe(
    createHash("sha256")
      .update(
        JSON.stringify({
          codeFingerprint,
          origin: { artifactId: "q", artifactRevision: 0, workspaceId: "w" },
        }),
      )
      .digest("hex"),
  );
  await expect(
    adapter.runCode(
      scope,
      { origin: { ...origin, artifactRevision: 1 }, requestId: "run-1" },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "idempotency-conflict" });
});
it("does not rerun a concurrently pending or cancelled ambiguous code operation and ignores late completion", async () => {
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const ready = new Promise<void>((r) => {
    entered = r;
  });
  const pending = new Promise<void>((r) => {
    release = r;
  });
  const controller = new AbortController();
  let count = 0;
  const adapter = createInterviewAdapter(pg.database, {
    runner: {
      runAll: async () => {
        count++;
        entered();
        await pending;
        return result;
      },
    },
  });
  const first = adapter.runCode(
    scope,
    { origin, requestId: "cancel" },
    controller.signal,
  );
  const rejected = expect(first).rejects.toThrow();
  await ready;
  await expect(
    adapter.runCode(
      scope,
      { origin, requestId: "cancel" },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "effect-interrupted" });
  controller.abort();
  release();
  await rejected;
  await expect(
    adapter.runCode(
      scope,
      { origin, requestId: "cancel" },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "effect-interrupted" });
  expect(count).toBe(1);
  expect(
    (
      await pg.admin.query(
        "SELECT state,result FROM interview.assistant_effect_receipts WHERE request_id='cancel'",
      )
    ).rows,
  ).toEqual([{ state: "interrupted", result: null }]);
});
it("denies cross-scope draft execution and refuses a missing runner explicitly", async () => {
  const adapter = createInterviewAdapter(pg.database, {
    runner: {
      runAll: async () => {
        throw Error("must never execute");
      },
    },
  });
  for (const other of [
    { ...scope, tenantId: "other" },
    { ...scope, actorId: "bob" },
    { ...scope, productId: "other" },
  ])
    await expect(
      adapter.runCode(
        other,
        { origin, requestId: "foreign" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "not-found" });
  await expect(
    createInterviewAdapter(pg.database).runCode(
      scope,
      { origin, requestId: "no-runner" },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "runner-unavailable" });
});
