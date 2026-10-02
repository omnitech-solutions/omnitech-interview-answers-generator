import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  DatabasePort,
  ModelInput,
  Proposal,
} from "@omnitech-assistant/contracts";
import {
  type CoreDependencies,
  createAssistantApp,
  createProposalService,
  createRunExecutor,
} from "@omnitech-assistant/server";
import {
  assistantGrants,
  assistantMigrations,
  PgBossRunQueue,
  RunRepository,
} from "@omnitech-assistant/storage-postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createInterviewAdapter, interviewPatchJsonSchema } from "./adapter.js";
import { interviewRunVersions } from "./prompt.js";
import { InterviewWorkspaceRepository } from "./workspace.js";
import { disposablePostgres } from "./workspace-fixture.js";

const scope = {
  tenantId: "combined",
  actorId: "alice",
  productId: "interview",
};
const origin = { workspaceId: "w", artifactId: "q", artifactRevision: 0 };
const text = "I improved latency by 40%.";
const source = {
  id: "synthetic",
  revision: 1,
  sha256: createHash("sha256").update(text).digest("hex"),
  locator: "candidate://synthetic",
  text,
  classification: "confidential" as const,
  audience: ["alice"],
};
const answer = {
  title: "Synthetic",
  language: "typescript" as const,
  answerMarkdown: text,
  code: "function solution() { return 1; }",
  usageCode: "solution();",
  testCode: "assert.equal(solution(),1);",
};
const patch = {
  answer,
  claims: [
    {
      kind: "candidate-metric",
      field: "answerMarkdown",
      text,
      metric: { value: 40, unit: "%" },
      citations: [
        { id: source.id, revision: 1, sha256: source.sha256, quote: text },
      ],
    },
  ],
};
// What the model sends; the adapter derives revision, hash and kind.
const draft = {
  answer,
  claims: [
    {
      field: "answerMarkdown",
      text,
      source: source.id,
      quote: text,
      metric: { value: 40, unit: "%" },
    },
  ],
};
let pg: Awaited<ReturnType<typeof disposablePostgres>>,
  queue: PgBossRunQueue,
  repo: RunRepository,
  workspace: InterviewWorkspaceRepository,
  deps: CoreDependencies;
let failReceipt = false,
  allowed = true,
  sourceAllowed = true,
  modelInputs: ModelInput[] = [];
const transactions: { table: string; id: string }[] = [];
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
  for (const migration of assistantMigrations)
    await pg.admin.query(await readFile(migration, "utf8"));
  await pg.admin.query(assistantGrants("fixture_member"));
  queue = new PgBossRunQueue({
    ...pg.config,
    supervise: false,
    schedule: false,
  });
  await queue.start();
  await pg.admin.query(
    "GRANT USAGE ON SCHEMA pgboss TO fixture_member; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA pgboss TO fixture_member",
  );
  const database: DatabasePort = {
    tenantTransaction: (tenant, fn) =>
      pg.database.tenantTransaction(tenant, (tx) =>
        fn({
          query: async (sql, values) => {
            if (sql.startsWith("INSERT INTO assistant.receipts") && failReceipt)
              throw Error("injected-receipt-failure");
            if (
              sql.startsWith("UPDATE interview.assistant_drafts SET value") ||
              sql.startsWith("INSERT INTO assistant.receipts")
            ) {
              const [row] = await tx.query("SELECT txid_current()::text id");
              transactions.push({
                table: sql.startsWith("UPDATE") ? "draft" : "receipt",
                id: String(row!["id"]),
              });
            }
            return tx.query(sql, values);
          },
        }),
      ),
  };
  repo = new RunRepository(
    database,
    pg.worker,
    queue,
    interviewRunVersions("deterministic"),
  );
  workspace = new InterviewWorkspaceRepository(database);
  await workspace.putEvidence(scope, {
    ...source,
    sourceKind: "candidate",
    metrics: [{ value: 40, unit: "%" }],
  });
  const adapter = createInterviewAdapter(database, {
    authorizeEvidence: async (_scope, source) =>
      allowed && sourceAllowed && source.classification !== "restricted",
  });
  deps = {
    database,
    repository: repo,
    products: new Map([["interview", adapter]]),
    authority: {
      isMember: async () => allowed,
      hasPermissions: async () => allowed,
      authorizeProfile: async () => allowed,
    },
    patchSchemas: new Map([["interview", interviewPatchJsonSchema]]),
    model: {
      stream: async function* (_s, input) {
        modelInputs.push(input);
        if (input.messages.at(-1)?.role === "tool")
          yield {
            type: "text",
            text: "Review this supported synthetic example.",
          };
        else
          yield {
            type: "tool-call",
            id: `call-${modelInputs.length}`,
            name: "proposePatch",
            input: draft,
          };
      },
    },
  };
});
afterAll(async () => {
  await queue?.stop();
  await pg?.close();
});
async function proposal(id: string) {
  const bound = { ...origin, artifactId: id };
  await workspace.create(scope, bound, {
    question: "Synthetic question",
    notes: "Canonical notes",
  });
  const thread = await repo.createThread(scope, { title: id, origin: bound });
  const run = await repo.createRun(
    scope,
    {
      threadId: thread.id,
      origin: bound,
      prompt: "Synthetic prompt",
      profileId: "deterministic",
      attachmentIds: [],
    },
    id,
  );
  const proposal: Proposal = {
    id,
    origin: bound,
    patch: patch as never,
    evidence: [source],
  };
  await repo.storeProposal(scope, run.id, proposal);
  await repo.settleRun(scope, run.id, "cancelled");
  return { proposal, run };
}
it("commits real product draft and assistant receipt/state/event in the same PostgreSQL transaction with concurrent replay", async () => {
  const { proposal: p, run } = await proposal("accept");
  transactions.length = 0;
  const service = createProposalService(deps);
  const receipts = await Promise.all([
    service.apply(scope, p.id),
    service.apply(scope, p.id),
  ]);
  expect(receipts).toEqual([
    { proposalId: "accept", artifactRevision: 1 },
    { proposalId: "accept", artifactRevision: 1 },
  ]);
  expect(transactions.map((t) => t.table)).toEqual(["draft", "receipt"]);
  expect(new Set(transactions.map((t) => t.id)).size).toBe(1);
  expect((await workspace.read(scope, "w", "accept")).value.answer).toEqual(
    answer,
  );
  expect((await repo.getProposal(scope, p.id)).status).toBe("applied");
  expect(
    (await repo.readEvents(scope, run.id, 0)).filter(
      (e) => e.type === "proposal.applied",
    ),
  ).toHaveLength(1);
  expect(
    (
      await pg.admin.query(
        "SELECT count(*)::int n FROM interview.assistant_answer_revisions",
      )
    ).rows,
  ).toEqual([{ n: 0 }]);
});
it("rolls back the real draft and provenance when the assistant receipt insert fails", async () => {
  const { proposal: p } = await proposal("rollback");
  failReceipt = true;
  try {
    await expect(
      createProposalService(deps).apply(scope, p.id),
    ).rejects.toThrow("injected-receipt-failure");
  } finally {
    failReceipt = false;
  }
  const current = await workspace.read(scope, "w", "rollback");
  expect(current.origin.artifactRevision).toBe(0);
  expect(current.value.answer).toBeNull();
  expect(current.provenance).toBeNull();
  expect((await repo.getProposal(scope, p.id)).status).toBe("pending");
  expect((await repo.getProposal(scope, p.id)).receipt).toBeUndefined();
  expect(await createProposalService(deps).apply(scope, p.id)).toEqual({
    proposalId: "rollback",
    artifactRevision: 1,
  });
});
it("preserves manual notes and question edits and commits explicit proposal conflicts", async () => {
  for (const [id, edit] of [
    ["stale", { notes: "My edit" }],
    ["question", { question: "New question" }],
  ] as const) {
    const { proposal: p, run } = await proposal(id);
    await workspace.edit(scope, p.origin, edit);
    await expect(
      createProposalService(deps).apply(scope, p.id),
    ).rejects.toMatchObject({ code: "revision-conflict" });
    const current = await workspace.read(scope, "w", id);
    expect(current.value).toMatchObject(edit);
    expect(current.value.answer).toBeNull();
    expect((await repo.getProposal(scope, p.id)).status).toBe("conflicted");
    expect(
      (await repo.readEvents(scope, run.id, 0)).filter(
        (e) => e.type === "proposal.conflicted",
      ),
    ).toHaveLength(1);
  }
});
it("keeps a switched question artifact intact and refuses wrong run origin lineage", async () => {
  const { proposal: p, run } = await proposal("old-question");
  const second = { ...origin, artifactId: "new-question" };
  await workspace.create(scope, second, {
    question: "Switched question",
    notes: "New draft",
  });
  const t = await repo.createThread(scope, {
    title: "Forged",
    origin: p.origin,
  });
  const r = await repo.createRun(
    scope,
    {
      threadId: t.id,
      origin: p.origin,
      prompt: "Forged",
      profileId: "deterministic",
      attachmentIds: [],
    },
    "forged",
  );
  await expect(
    repo.storeProposal(scope, r.id, { ...p, id: "forged", origin: second }),
  ).rejects.toMatchObject({ code: "origin-conflict" });
  await repo.settleRun(scope, r.id, "cancelled");
  void run;
  await createProposalService(deps).apply(scope, p.id);
  expect((await workspace.read(scope, "w", "new-question")).value).toEqual({
    question: "Switched question",
    notes: "New draft",
    answer: null,
  });
});
it("revalidates source authorization on acceptance and rejects/replays private resources correctly", async () => {
  const { proposal: p } = await proposal("revoked");
  allowed = false;
  try {
    await expect(
      createProposalService(deps).apply(scope, p.id),
    ).rejects.toMatchObject({ code: "forbidden" });
  } finally {
    allowed = true;
  }
  for (const other of [
    { ...scope, tenantId: "other" },
    { ...scope, actorId: "bob" },
    { ...scope, productId: "other" },
  ])
    await expect(
      createProposalService(deps).apply(other, p.id),
    ).rejects.toMatchObject({ code: "not-found" });
  await createProposalService(deps).reject(scope, p.id);
  await createProposalService(deps).reject(scope, p.id);
  expect((await repo.getProposal(scope, p.id)).status).toBe("rejected");
  await expect(
    createProposalService(deps).apply(scope, p.id),
  ).rejects.toMatchObject({ code: "proposal-conflict" });
});
it("serializes versioned interview instructions/current draft/evidence into actual model input and persists the matching prompt version without applying", async () => {
  const o = { ...origin, artifactId: "model" };
  await workspace.create(scope, o, {
    question: "Serialized question",
    notes: "Serialized notes",
    answer: { ...answer, answerMarkdown: "Existing editor answer" },
  });
  const thread = await repo.createThread(scope, { title: "Model", origin: o });
  const run = await repo.createRun(
    scope,
    {
      threadId: thread.id,
      origin: o,
      prompt: "Write a grounded answer",
      profileId: "deterministic",
      attachmentIds: [],
    },
    "model",
  );
  const claimStart = performance.now();
  let claim,
    dequeues = 0;
  // Drain at most 16 cancelled fixture entries; no delay, effect retry, or
  // production polling policy. Fail visibly if the live fixture cannot claim.
  while (!claim && dequeues < 16) {
    dequeues++;
    claim = await repo.claimRun("worker", 10000);
    if (claim) break;
  }
  process.stdout.write(
    JSON.stringify({
      fixtureQueueDrain: "after-bounded16",
      dequeues,
      durationMs: Number((performance.now() - claimStart).toFixed(3)),
    }) + "\n",
  );
  expect(claim).toBeDefined();
  expect(claim!.run.id).toBe(run.id);
  await createRunExecutor(deps, "worker")(
    scope,
    claim!.run,
    new AbortController().signal,
  );
  expect((await repo.getRun(scope, run.id)).status).toBe("completed");
  const serialized = JSON.stringify(modelInputs[0]);
  expect(serialized).toContain("interview-grounding-3");
  expect(serialized).toContain("software-interview-preparation");
  expect(serialized).toContain("PROBLEM, STRATEGY, COMPLEXITY");
  expect(serialized).toContain("Serialized question");
  expect(serialized).toContain("Existing editor answer");
  expect(serialized).toContain(source.sha256);
  expect(serialized).toContain("candidate-metric");
  const saved = (
    await pg.admin.query("SELECT versions FROM assistant.runs WHERE id=$1", [
      run.id,
    ])
  ).rows[0]!;
  expect((saved["versions"] as { prompt: string }).prompt).toBe(
    "interview-grounding-3",
  );
  expect(
    (await repo.readThread(scope, thread.id)).messages.filter(
      (m) => m.role === "system",
    ),
  ).toHaveLength(1);
  expect(
    (await workspace.read(scope, "w", "model")).origin.artifactRevision,
  ).toBe(0);
});
it("saves accepted source lineage separately, replays Save, and clears proof after manual answer edits", async () => {
  const current = await workspace.read(scope, "w", "accept");
  expect(current.provenance?.proposalId).toBe("accept");
  expect(current.provenance?.acceptedDraftRevision).toBe(1);
  const noted = await workspace.edit(scope, current.origin, {
    notes: "Notes after acceptance",
  });
  expect(noted.provenance?.acceptedDraftRevision).toBe(1);
  expect(noted.provenance?.draftRevision).toBe(2);
  const first = await workspace.save(scope, noted.origin, "save-accept");
  expect(await workspace.save(scope, noted.origin, "save-accept")).toEqual(
    first,
  );
  expect(first.provenance?.sources).toEqual(
    [
      {
        ...source,
        sourceKind: "candidate",
        classification: "confidential",
        audience: ["alice"],
        locator: source.locator,
        text: undefined,
      },
    ].map(({ text, ...rest }) => rest),
  );
  await workspace.edit(scope, noted.origin, {
    answer: { ...answer, answerMarkdown: "Manual unsupported replacement" },
  });
  expect((await workspace.read(scope, "w", "accept")).provenance).toBeNull();
  expect(
    (await workspace.readAnswerRevision(scope, "w", "accept", 1)).provenance
      ?.proposalId,
  ).toBe("accept");
});

it("keeps product source permission failures visible across fresh installed package exports, including receipt replay", async () => {
  const { proposal: p } = await proposal("source-permission");
  const app = createAssistantApp({ ...deps, resolveScope: async () => scope });
  sourceAllowed = false;
  try {
    const response = await app.request(
      "/v1/proposals/source-permission/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: "evidence-forbidden",
      message: "evidence-forbidden",
    });
  } finally {
    sourceAllowed = true;
  }
  await createProposalService(deps).apply(scope, p.id);
  sourceAllowed = false;
  try {
    await expect(
      createProposalService(deps).apply(scope, p.id),
    ).rejects.toMatchObject({ code: "evidence-forbidden" });
    const preview = await app.request("/v1/proposals/source-permission");
    expect(preview.status).toBe(403);
    expect(await preview.json()).toEqual({
      code: "evidence-forbidden",
      message: "evidence-forbidden",
    });
    const replay = await app.request("/v1/proposals/source-permission/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(replay.status).toBe(403);
    expect(await replay.json()).toEqual({
      code: "evidence-forbidden",
      message: "evidence-forbidden",
    });
  } finally {
    sourceAllowed = true;
  }
});

it("uses current source classification/audience for replay while later allowed revisions preserve the original receipt", async () => {
  const { proposal: p } = await proposal("source-head-acl");
  const service = createProposalService(deps);
  const first = await service.apply(scope, p.id);
  await workspace.putEvidence(scope, {
    ...source,
    revision: 2,
    sourceKind: "candidate",
    classification: "restricted",
    audience: ["alice"],
    metrics: [{ value: 40, unit: "%" }],
  });
  await expect(service.apply(scope, p.id)).rejects.toMatchObject({
    code: "evidence-forbidden",
  });
  await workspace.putEvidence(scope, {
    ...source,
    revision: 3,
    sourceKind: "candidate",
    metrics: [{ value: 40, unit: "%" }],
  });
  expect(await service.apply(scope, p.id)).toEqual(first);
  await workspace.putEvidence(scope, {
    ...source,
    revision: 4,
    sourceKind: "candidate",
    audience: ["bob"],
    metrics: [{ value: 40, unit: "%" }],
  });
  await expect(service.read(scope, p.id)).rejects.toMatchObject({
    code: "evidence-forbidden",
  });
  await workspace.putEvidence(scope, {
    ...source,
    revision: 5,
    sourceKind: "candidate",
    metrics: [{ value: 40, unit: "%" }],
  });
  expect(await service.apply(scope, p.id)).toEqual(first);
  expect(
    (await workspace.read(scope, "w", "source-head-acl")).origin
      .artifactRevision,
  ).toBe(1);
});

// Pause after validation's first actual product lock. Acceptance must reach that
// same lock before releasing validation: this forces the production inversion
// when present, without sleeps, stress loops, simulated locks or effect retries.
for (const [caseName, sourceIds] of [
  ["draft-source", ["lock-source"]],
  ["unicode-reversed", ["é", "e\u0301"]],
] as const) {
  it(`avoids real validation/acceptance deadlock with ${caseName} lock ordering`, async () => {
    const id = `interleave-${caseName}`;
    const bound = { ...origin, artifactId: id };
    const refs = sourceIds.map((id) => ({ ...source, id }));
    for (const ref of refs)
      await workspace.putEvidence(scope, {
        ...ref,
        sourceKind: "candidate",
        metrics: [{ value: 40, unit: "%" }],
      });
    await workspace.create(scope, bound, {
      question: "Synthetic lock ordering",
    });
    const thread = await repo.createThread(scope, { title: id, origin: bound });
    const run = await repo.createRun(
      scope,
      {
        threadId: thread.id,
        origin: bound,
        prompt: "Fixture",
        profileId: "deterministic",
        attachmentIds: [],
      },
      id,
    );
    const p: Proposal = {
      id,
      origin: bound,
      patch: {
        ...patch,
        claims: [
          {
            ...patch.claims[0]!,
            citations: [{ ...patch.claims[0]!.citations[0]!, id: refs[0]!.id }],
          },
        ],
      } as never,
      evidence: refs,
    };
    await repo.storeProposal(scope, run.id, p);
    await repo.settleRun(scope, run.id, "cancelled");
    let heldIdentity: string | undefined;
    let heldReady: () => void = () => {},
      resume: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      heldReady = resolve;
    });
    const release = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const lockOrder: Record<string, string[]> = {
      validation: [],
      acceptance: [],
    };
    const database = (role: "validation" | "acceptance"): DatabasePort => ({
      tenantTransaction: (tenant, fn) =>
        pg.database.tenantTransaction(tenant, (tx) =>
          fn({
            query: async (sql, values) => {
              const sourceLock = sql.startsWith("SELECT pg_advisory_xact_lock");
              const draftLock =
                sql.startsWith("SELECT * FROM interview.assistant_drafts") &&
                sql.endsWith("FOR UPDATE");
              const identity = sourceLock
                ? `source:${String(values?.[0])}`
                : draftLock
                  ? `draft:${JSON.stringify(values)}`
                  : undefined;
              const pending = tx.query(sql, values);
              if (role === "acceptance" && identity === heldIdentity) resume();
              const rows = await pending;
              if (sourceLock) {
                const key = JSON.parse(String(values?.[0])) as string[];
                lockOrder[role]!.push(key[key.length - 1]!);
              }
              if (
                role === "validation" &&
                identity &&
                heldIdentity === undefined
              ) {
                heldIdentity = identity;
                heldReady();
                await release;
              }
              return rows;
            },
          }),
        ),
    });
    const trusted = { authorizeEvidence: async () => true };
    const validationAdapter = createInterviewAdapter(
      database("validation"),
      trusted,
    );
    const acceptanceDatabase = database("acceptance");
    const acceptanceRepo = new RunRepository(
      acceptanceDatabase,
      pg.worker,
      queue,
      interviewRunVersions("deterministic"),
    );
    const service = createProposalService({
      ...deps,
      database: acceptanceDatabase,
      repository: acceptanceRepo,
      products: new Map([
        ["interview", createInterviewAdapter(acceptanceDatabase, trusted)],
      ]),
    });
    const start = performance.now();
    const validation = validationAdapter.validateProposal(scope, {
      ...p,
      evidence: [...refs].reverse(),
    });
    await ready;
    const acceptance = service.apply(scope, id);
    const outcomes = await Promise.allSettled([validation, acceptance]);
    process.stdout.write(
      JSON.stringify({
        interleaving: caseName,
        durationMs: Number((performance.now() - start).toFixed(3)),
        outcomes: outcomes.map((r) =>
          r.status === "fulfilled"
            ? { status: r.status }
            : { status: r.status, code: (r.reason as { code?: string }).code },
        ),
        firstHeld: heldIdentity,
        lockOrder,
      }) + "\n",
    );
    expect(outcomes.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const expected = [...sourceIds].sort(); // Exact UTF-16 strings, no locale equivalence.
    for (const role of ["validation", "acceptance"] as const)
      expect([...new Set(lockOrder[role])]).toEqual(expected);
    expect((await workspace.read(scope, "w", id)).origin.artifactRevision).toBe(
      1,
    );
    expect((await repo.getProposal(scope, id)).receipt).toEqual({
      proposalId: id,
      artifactRevision: 1,
    });
  });
}
