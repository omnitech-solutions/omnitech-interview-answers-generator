import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import * as workspace from "./workspace.js";
import { disposablePostgres } from "./workspace-fixture.js";

const scope = { tenantId: "a", actorId: "alice", productId: "interview" };
const origin = { workspaceId: "w", artifactId: "q", artifactRevision: 0 };
let pg: Awaited<ReturnType<typeof disposablePostgres>>;
let repo: workspace.InterviewWorkspaceRepository;
beforeAll(async () => {
  pg = await disposablePostgres();
  await pg.migrate(
    new URL(
      "../../../../../packages/platform-storage/migrations/0004_assistant_interview.sql",
      import.meta.url,
    ),
  );
  repo = new workspace.InterviewWorkspaceRepository(pg.database);
});
afterAll(async () => {
  await pg?.close();
});

it("exposes a scoped durable workspace repository rather than the process-global playground", () => {
  expect(workspace).toHaveProperty("InterviewWorkspaceRepository");
});
it("rejects oversized raw identifiers, padded questions and answer fields before persistence", async () => {
  await expect(
    repo.create(
      { ...scope, actorId: `${" ".repeat(257)}alice` },
      { ...origin, artifactId: "bounded" },
      { question: "Question" },
    ),
  ).rejects.toThrow();
  await expect(
    repo.create(
      scope,
      { ...origin, artifactId: "padded" },
      { question: `${" ".repeat(32_000)}Question` },
    ),
  ).rejects.toThrow();
  await expect(
    repo.create(
      scope,
      { ...origin, artifactId: "answer-bounds" },
      {
        question: "Question",
        answer: {
          title: "Bounded",
          language: "typescript",
          answerMarkdown: "Valid",
          code: "x".repeat(100_001),
          usageCode: "",
          testCode: "",
        },
      },
    ),
  ).rejects.toThrow();
});
it("keeps separate artifacts and private tenant actor product drafts across recreation", async () => {
  await repo.create(scope, origin, { question: "Explain concurrency" });
  await repo.create(
    scope,
    { ...origin, artifactId: "q2" },
    { question: "Second question" },
  );
  expect(
    (
      await new workspace.InterviewWorkspaceRepository(pg.database).read(
        scope,
        "w",
        "q",
      )
    ).value.question,
  ).toBe("Explain concurrency");
  expect((await repo.read(scope, "w", "q2")).value.question).toBe(
    "Second question",
  );
  for (const other of [
    { ...scope, tenantId: "b" },
    { ...scope, actorId: "bob" },
    { ...scope, productId: "notes" },
  ]) {
    await expect(repo.read(other, "w", "q")).rejects.toMatchObject({
      code: "not-found",
    });
  }
  expect(
    (await pg.member.query("SELECT * FROM interview.assistant_drafts")).rows,
  ).toEqual([]);
});
it("compare-and-swaps the real draft revision and preserves the user's edit on conflict", async () => {
  const edited = await repo.edit(scope, origin, { notes: "My edit" });
  expect(edited.origin.artifactRevision).toBe(1);
  await expect(
    repo.edit(scope, origin, { notes: "stale model edit" }),
  ).rejects.toMatchObject({ code: "revision-conflict" });
  expect((await repo.read(scope, "w", "q")).value.notes).toBe("My edit");
  await expect(
    repo.edit(scope, edited.origin, { answer: { title: "Bad" } } as never),
  ).rejects.toThrow();
});
it("saves immutable answer versions separately from draft edits", async () => {
  const current = await repo.read(scope, "w", "q");
  await expect(repo.save(scope, current.origin)).rejects.toMatchObject({
    code: "answer-required",
  });
  const draft = await repo.edit(scope, current.origin, {
    answer: {
      title: "Concurrency",
      language: "typescript",
      answerMarkdown: "Compare the expected revision",
      code: "",
      usageCode: "",
      testCode: "",
    },
  });
  const saved = await repo.save(scope, draft.origin);
  expect(saved.savedRevision).toBe(1);
  expect(saved.draftRevision).toBe(2);
  await repo.edit(scope, draft.origin, { notes: "After saving" });
  const loaded = await repo.readAnswerRevision(scope, "w", "q", 1);
  expect(loaded.value.notes).toBe("My edit");
  await expect(
    pg.admin.query(
      "UPDATE interview.assistant_answer_revisions SET value='{}'::jsonb WHERE saved_revision=1",
    ),
  ).rejects.toMatchObject({ code: "55000" });
});
it("rolls back host draft changes and receipt together in a caller transaction", async () => {
  await pg.admin.query("CREATE TABLE fixture_receipt (id text PRIMARY KEY)");
  await pg.admin.query("GRANT INSERT ON fixture_receipt TO fixture_member");
  const current = await repo.read(scope, "w", "q");
  await expect(
    pg.database.tenantTransaction(scope.tenantId, async (tx) => {
      await repo.editTransaction(tx, scope, current.origin, {
        notes: "must rollback",
      });
      await tx.query("INSERT INTO fixture_receipt VALUES ('p')");
      throw new Error("receipt rollback");
    }),
  ).rejects.toThrow("receipt rollback");
  expect((await repo.read(scope, "w", "q")).value.notes).toBe("After saving");
  expect((await pg.admin.query("SELECT * FROM fixture_receipt")).rows).toEqual(
    [],
  );
});
it("retains immutable evidence kind revision hash classification and actor audience", async () => {
  const text = "Built an optimistic concurrency service";
  const source = {
    id: "candidate",
    revision: 1,
    text,
    sha256: createHash("sha256").update(text).digest("hex"),
    locator: "candidate://project",
    classification: "confidential" as const,
    audience: ["alice"],
    sourceKind: "candidate" as const,
  };
  await repo.putEvidence(scope, source);
  expect(await repo.readEvidence(scope, "candidate", 1)).toEqual(source);
  expect(await repo.searchEvidence(scope, "concurrency", 10)).toEqual([source]);
  await expect(
    repo.putEvidence(scope, {
      ...source,
      id: "bad-hash",
      sha256: "0".repeat(64),
    }),
  ).rejects.toMatchObject({ code: "evidence-hash-conflict" });
  await expect(
    repo.putEvidence(scope, {
      ...source,
      id: "bad-class",
      classification: "private",
    } as never),
  ).rejects.toThrow();
  await expect(
    repo.readEvidence({ ...scope, actorId: "bob" }, "candidate", 1),
  ).rejects.toMatchObject({ code: "not-found" });
  await repo.putEvidence(scope, {
    ...source,
    id: "denied-audience",
    audience: ["bob"],
  });
  await expect(
    repo.readEvidence(scope, "denied-audience", 1),
  ).rejects.toMatchObject({ code: "evidence-forbidden" });
  await expect(
    pg.admin.query("UPDATE interview.assistant_evidence SET text='altered'"),
  ).rejects.toMatchObject({ code: "55000" });
});
