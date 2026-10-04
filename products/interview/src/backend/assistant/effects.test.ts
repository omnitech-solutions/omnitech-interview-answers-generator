import { afterAll, beforeAll, expect, it } from "vitest";
import { guidedProse } from "../../answer-fixture.js";
import { InterviewWorkspaceRepository } from "./workspace.js";
import { disposablePostgres } from "./workspace-fixture.js";

const scope = {
  tenantId: "effects",
  actorId: "alice",
  productId: "omnitech.interview",
};
const origin = { workspaceId: "w", artifactId: "q", artifactRevision: 0 };
let pg: Awaited<ReturnType<typeof disposablePostgres>>,
  workspace: InterviewWorkspaceRepository;
beforeAll(async () => {
  pg = await disposablePostgres();
  await pg.migrate();
  workspace = new InterviewWorkspaceRepository(pg.database);
  await workspace.create(scope, origin, {
    question: "Synthetic",
    answer: {
      title: "Synthetic",
      language: "typescript",
      ...guidedProse("Explanation"),
      code: "return 1;",
      usageCode: "",
      testCode: "",
    },
  });
});
afterAll(async () => {
  await pg?.close();
});
it("replays explicit Save without producing duplicate immutable revisions", async () => {
  const a = await workspace.save(scope, origin, "save-request");
  const b = await workspace.save(scope, origin, "save-request");
  expect(b).toEqual(a);
  expect(
    (
      await pg.admin.query(
        "SELECT count(*)::int n FROM interview.assistant_answer_revisions",
      )
    ).rows,
  ).toEqual([{ n: 1 }]);
  await expect(
    workspace.save(scope, { ...origin, artifactRevision: 1 }, "save-request"),
  ).rejects.toMatchObject({ code: "idempotency-conflict" });
});
it("composes Save and caller receipt in one actual transaction", async () => {
  await expect(
    pg.database.tenantTransaction(scope.tenantId, async (tx) => {
      await workspace.saveTransaction(tx, scope, origin, "rollback-save");
      throw Error("caller-failure");
    }),
  ).rejects.toThrow("caller-failure");
  expect(
    (
      await pg.admin.query(
        "SELECT count(*)::int n FROM interview.assistant_answer_revisions",
      )
    ).rows,
  ).toEqual([{ n: 1 }]);
});

it("keeps completed Save receipts immutable in PostgreSQL", async () => {
  await expect(
    pg.admin.query(
      "UPDATE interview.assistant_effect_receipts SET result='{}'::jsonb WHERE operation='save' AND request_id='save-request'",
    ),
  ).rejects.toMatchObject({ code: "55000" });
});
