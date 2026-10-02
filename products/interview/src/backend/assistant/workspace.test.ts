import { createHash } from "node:crypto";
import type { BriefingDraft } from "@omnitech/interview-contracts";
import { afterAll, beforeAll, expect, it } from "vitest";
import * as workspace from "./workspace.js";
import { disposablePostgres } from "./workspace-fixture.js";

const scope = {
  tenantId: "a",
  actorId: "alice",
  productId: "omnitech.interview",
};
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
  await pg.migrate(
    new URL(
      "../../../../../packages/platform-storage/migrations/0005_assistant_provenance.sql",
      import.meta.url,
    ),
  );
  repo = new workspace.InterviewWorkspaceRepository(pg.database);
});
afterAll(async () => {
  await pg?.close();
});

it("saves a complete briefing without a coding answer and rejects mixed draft kinds", async () => {
  const briefing: BriefingDraft = {
    kind: "non-technical-briefing",
    title: "Recruiter",
    context: {
      company: "Acme",
      role: "Engineer",
      stage: "recruiter",
      profile: { id: "p", revision: 1 },
    },
    questions: [
      {
        id: "q",
        question: "Tell me about yourself",
        category: "background",
        answerMarkdown: "I build systems.",
        talkingPoints: ["systems", "teams", "delivery"],
        evidenceRefs: [],
        gaps: [],
      },
    ],
  };
  const artifactId = "briefing-workspace-test";
  const created = await repo.create(
    scope,
    { workspaceId: "briefings", artifactId, artifactRevision: 0 },
    { question: "Recruiter", briefing },
  );
  expect(created.value.briefing).toEqual(briefing);
  const saved = await repo.save(scope, created.origin, "briefing-save-test");
  expect(saved.value.briefing).toEqual(briefing);
  await expect(
    repo.edit(scope, created.origin, {
      answer: {
        title: "Mixed",
        language: "typescript",
        answerMarkdown: "x",
        code: "x",
        usageCode: "",
        testCode: "",
      },
    }),
  ).rejects.toThrow();
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
it("round-trips padded scope origin and evidence identifiers without rewriting source text", async () => {
  const padded = {
    tenantId: " canonical-tenant ",
    actorId: " canonical-actor ",
    productId: " omnitech.interview ",
  };
  const canonical = {
    tenantId: "canonical-tenant",
    actorId: "canonical-actor",
    productId: "omnitech.interview",
  };
  const created = await repo.create(
    padded,
    {
      workspaceId: " canonical-workspace ",
      artifactId: " canonical-artifact ",
      artifactRevision: 0,
    },
    { question: "Canonical question", notes: " Exact notes " },
  );
  expect(created.origin).toEqual({
    workspaceId: "canonical-workspace",
    artifactId: "canonical-artifact",
    artifactRevision: 0,
  });
  expect(
    (
      await repo.read(
        canonical,
        created.origin.workspaceId,
        created.origin.artifactId,
      )
    ).value.notes,
  ).toBe(" Exact notes ");
  const edited = await repo.edit(padded, created.origin, {
    answer: {
      title: "Canonical",
      language: "typescript",
      answerMarkdown: "Canonical answer",
      code: " Exact code ",
      usageCode: "",
      testCode: "",
    },
  });
  const saved = await repo.save(canonical, {
    ...edited.origin,
    workspaceId: " canonical-workspace ",
    artifactId: " canonical-artifact ",
  });
  expect(
    (
      await repo.readAnswerRevision(
        padded,
        " canonical-workspace ",
        " canonical-artifact ",
        saved.savedRevision,
      )
    ).value.answer?.code,
  ).toBe(" Exact code ");
  const text = " Exact evidence text ";
  const evidence = {
    id: " canonical-evidence ",
    revision: 1,
    sha256: createHash("sha256").update(text).digest("hex"),
    locator: "candidate://canonical",
    text,
    sourceKind: "candidate" as const,
    classification: "internal" as const,
    audience: [" canonical-actor "],
  };
  await repo.putEvidence(padded, evidence);
  expect(await repo.readEvidence(canonical, " canonical-evidence ", 1)).toEqual(
    { ...evidence, id: "canonical-evidence", audience: ["canonical-actor"] },
  );
  expect((await repo.searchEvidence(padded, "evidence", 10))[0]?.text).toBe(
    text,
  );
});

it("lists only this actor's drafts in a workspace, newest first, titled by the question", async () => {
  const listScope = {
    tenantId: "list",
    actorId: "ana",
    productId: "omnitech.interview",
  };
  const at = (artifactId: string) => ({
    workspaceId: "lw",
    artifactId,
    artifactRevision: 0,
  });
  await repo.create(listScope, at("older"), { question: "Older question" });
  await repo.create(listScope, at("newer"), {
    question: "\n  Max events in a time window\nGiven sorted timestamps…",
  });
  await repo.create(
    listScope,
    { ...at("elsewhere"), workspaceId: "other" },
    {
      question: "Another workspace",
    },
  );
  await repo.create({ ...listScope, actorId: "bob" }, at("bobs"), {
    question: "Bob's question",
  });
  await repo.create({ ...listScope, tenantId: "t2" }, at("t2"), {
    question: "Other tenant",
  });
  const listed = await repo.listDrafts(listScope, "lw");
  expect(listed.map((item) => item.artifactId)).toEqual(["newer", "older"]);
  expect(listed[0]).toMatchObject({
    title: "Max events in a time window",
    language: null,
    kind: "coding",
    revision: 0,
  });
  expect(typeof listed[0]?.updatedAt).toBe("string");
  const long = "x".repeat(120);
  await repo.create(listScope, at("long"), { question: long });
  expect((await repo.listDrafts(listScope, "lw"))[0]?.title).toBe(
    `${"x".repeat(79)}…`,
  );
});

it("keeps stage progress on the draft and renders the answer's Markdown from its guide", async () => {
  const progressScope = {
    tenantId: "guide",
    actorId: "ana",
    productId: "omnitech.interview",
  };
  const at = { workspaceId: "gw", artifactId: "g1", artifactRevision: 0 };
  const guide = {
    version: 1 as const,
    understand: {
      prompt: "Count.",
      examples: [],
      constraints: [],
      clarify: ["Zero?"],
    },
    plan: { steps: ["Add one."], complexity: { time: "O(1)", space: "O(1)" } },
    edgeCases: [],
    explain: [{ heading: "Idea", body: "Add one." }],
    talkingPoints: ["a", "b", "c"],
  };
  const answer = {
    title: "Counter",
    language: "typescript" as const,
    answerMarkdown: "written by a client",
    code: "x",
    usageCode: "",
    testCode: "",
    guide,
  };
  const created = await repo.create(progressScope, at, {
    question: "Count",
    answer,
  });
  expect(created.value.answer?.answerMarkdown).toContain("## Question");
  expect(created.value.answer?.answerMarkdown).not.toContain(
    "written by a client",
  );

  const progressed = await repo.edit(progressScope, created.origin, {
    progress: { stage: "plan", clarified: [0] },
  });
  expect(progressed.value.progress).toEqual({ stage: "plan", clarified: [0] });
  // Progress is not an answer change: it keeps the answer as it was.
  expect(progressed.value.answer).toEqual(created.value.answer);

  // Editing only the Markdown (a client that does not know guides) drops it.
  const edited = await repo.edit(progressScope, progressed.origin, {
    answer: {
      ...progressed.value.answer!,
      answerMarkdown: "## Question\nMine",
    },
  });
  expect(edited.value.answer?.guide).toBeUndefined();
  expect(edited.value.answer?.answerMarkdown).toBe("## Question\nMine");
  expect(edited.value.progress).toEqual({ stage: "plan", clarified: [0] });
  await expect(
    repo.edit(progressScope, edited.origin, {
      progress: { stage: "later" } as never,
    }),
  ).rejects.toThrow();
});

it("summarises each question's latest completed test run", async () => {
  const runScope = {
    tenantId: "runs",
    actorId: "ana",
    productId: "omnitech.interview",
  };
  const at = (artifactId: string) => ({
    workspaceId: "rw",
    artifactId,
    artifactRevision: 0,
  });
  await repo.create(runScope, at("ran"), { question: "Ran" });
  await repo.create(runScope, at("never"), { question: "Never ran" });
  const run = async (requestId: string, execution: unknown) =>
    repo.transaction(runScope, async (tx, scope) => {
      await repo.beginEffectTransaction(tx, scope, "run-code", requestId, {
        origin: at("ran"),
        codeFingerprint: requestId,
      });
      await repo.completeEffectTransaction(tx, scope, "run-code", requestId, {
        receipt: {},
        execution,
      });
    });
  await run("first", { exitCode: 0, timedOut: false, stdout: "" });
  await run("second", {
    exitCode: 1,
    timedOut: false,
    tests: [{ status: "passed" }, { status: "failed" }, { status: "passed" }],
  });
  const listed = await repo.listDrafts(runScope, "rw");
  expect(
    listed.find((item) => item.artifactId === "ran")?.lastRun,
  ).toMatchObject({
    ok: false,
    passed: 2,
    total: 3,
  });
  expect(
    listed.find((item) => item.artifactId === "never")?.lastRun,
  ).toBeNull();
});
