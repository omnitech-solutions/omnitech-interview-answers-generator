import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { InterviewWorkspaceRepository } from "./workspace.js";
import { disposablePostgres } from "./workspace-fixture.js";

const scope = {
  tenantId: "sources",
  actorId: "alice",
  productId: "omnitech.interview",
};
let pg: Awaited<ReturnType<typeof disposablePostgres>>,
  workspace: InterviewWorkspaceRepository;
const text = "Synthetic evidence";
const evidence = {
  id: "e",
  revision: 1,
  sha256: createHash("sha256").update(text).digest("hex"),
  text,
  locator: "candidate://synthetic",
  classification: "public" as const,
  sourceKind: "candidate" as const,
  audience: ["alice"],
};
beforeAll(async () => {
  pg = await disposablePostgres();
  for (const file of [
    "0004_assistant_interview.sql",
    "0005_assistant_provenance.sql",
    "0007_assistant_reverts.sql",
  ])
    await pg.migrate(
      new URL(
        `../../../../../packages/platform-storage/migrations/${file}`,
        import.meta.url,
      ),
    );
  workspace = new InterviewWorkspaceRepository(pg.database);
  await workspace.putEvidence(scope, evidence);
});
afterAll(async () => {
  await pg?.close();
});
it("serializes canonical source revision validation against trusted ingestion for the whole host transaction", async () => {
  await pg.database.tenantTransaction(scope.tenantId, async (tx) => {
    await workspace.readEvidenceTransaction(tx, scope, "e", 1);
    // Disposable test transaction only: a finite lock budget makes an actual
    // blocked ingestion observable without a polling/retry driver.
    const ingestion = new InterviewWorkspaceRepository({
      tenantTransaction: (tenant, fn) =>
        pg.database.tenantTransaction(tenant, async (writeTx) => {
          await writeTx.query("SET LOCAL lock_timeout='1ms'");
          return fn(writeTx);
        }),
    });
    await expect(
      ingestion.putEvidence(scope, { ...evidence, revision: 2 }),
    ).rejects.toMatchObject({ code: "55P03" });
  });
});
it("measures the same source read/ingestion workload locally", async () => {
  const before = performance.now();
  for (let i = 0; i < 20; i++) await workspace.readEvidence(scope, "e", 1);
  const reads = performance.now() - before;
  const start = performance.now();
  for (let i = 0; i < 20; i++)
    await workspace.putEvidence(scope, { ...evidence, id: `new-${i}` });
  const inserts = performance.now() - start;
  console.log(
    JSON.stringify({
      workload: "20 canonical source reads +20 inserts",
      readsMs: Number(reads.toFixed(3)),
      insertsMs: Number(inserts.toFixed(3)),
    }),
  );
  expect(await workspace.readEvidence(scope, "new-19", 1)).toEqual({
    ...evidence,
    id: "new-19",
  });
});
