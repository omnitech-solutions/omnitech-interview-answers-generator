import { createHash } from "node:crypto";
import type { Proposal } from "@omnitech-assistant/contracts";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createInterviewAdapter } from "./adapter.js";
import { InterviewWorkspaceRepository } from "./workspace.js";
import { disposablePostgres } from "./workspace-fixture.js";

// Every refusal the product can make, against a real PostgreSQL schema: what is
// refused, with which code, and (where the model can act on it) with which hint.
const scope = {
  tenantId: "refusals",
  actorId: "alice",
  productId: "interview",
};
const originFor = (artifactId: string, artifactRevision = 0) => ({
  workspaceId: "w",
  artifactId,
  artifactRevision,
});
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const reference = {
  id: "ref",
  revision: 1,
  text: "Optimistic concurrency compares an expected revision before writing.",
  sha256: digest(
    "Optimistic concurrency compares an expected revision before writing.",
  ),
  locator: "local://ref",
  sourceKind: "technical-reference" as const,
  classification: "public" as const,
  audience: ["alice"],
};
const candidate = {
  id: "cand",
  revision: 1,
  text: "I cut p95 latency by 40% last quarter.",
  sha256: digest("I cut p95 latency by 40% last quarter."),
  locator: "candidate://cand",
  sourceKind: "candidate" as const,
  classification: "confidential" as const,
  audience: ["alice"],
  metrics: [{ value: 40, unit: "%" }],
};
const generic = (item: typeof reference | typeof candidate) => {
  const { sourceKind: _kind, ...rest } = item;
  const { metrics: _metrics, ...plain } = rest as typeof rest & {
    metrics?: unknown;
  };
  return plain;
};
const answer = (answerMarkdown: string) => ({
  title: "Example",
  language: "typescript" as const,
  answerMarkdown,
  code: "",
  usageCode: "",
  testCode: "",
});
const technicalClaim = (
  text: string,
  quote = "compares an expected revision",
) => ({
  kind: "technical",
  field: "answerMarkdown",
  text,
  citations: [{ id: "ref", revision: 1, sha256: reference.sha256, quote }],
});

let pg: Awaited<ReturnType<typeof disposablePostgres>>;
let workspace: InterviewWorkspaceRepository;
const adapter = () =>
  createInterviewAdapter(pg.database, {
    authorizeEvidence: async () => true,
    verifyTechnicalReference: async () => true,
    runner: {
      runAll: async () => {
        throw new Error("the runner is never reached by a refused request");
      },
    },
  });
const proposal = (
  artifactId: string,
  patch: Record<string, unknown>,
  evidence: (typeof reference | typeof candidate)[] = [reference],
) =>
  ({
    id: `p-${artifactId}`,
    origin: originFor(artifactId),
    patch,
    evidence: evidence.map(generic),
  }) as unknown as Proposal;

beforeAll(async () => {
  pg = await disposablePostgres();
  for (const filename of [
    "0004_assistant_interview.sql",
    "0005_assistant_provenance.sql",
    "0007_assistant_reverts.sql",
  ])
    await pg.migrate(
      new URL(
        `../../../../../packages/platform-storage/migrations/${filename}`,
        import.meta.url,
      ),
    );
  workspace = new InterviewWorkspaceRepository(pg.database);
  await workspace.putEvidence(scope, reference);
  await workspace.putEvidence(scope, candidate);
  await workspace.create(scope, originFor("blank"), {
    question: "Same question",
    notes: "",
  });
  await workspace.create(scope, originFor("with-answer"), {
    question: "Same question",
    notes: "",
    answer: answer("Compare the expected revision."),
  });
});
afterAll(async () => {
  await pg?.close();
});

it("refuses a proposal that changes nothing and tells the model so", async () => {
  await expect(
    adapter().validateProposal(
      scope,
      proposal("blank", { question: "Same question" }),
    ),
  ).rejects.toMatchObject({
    code: "no-change",
    hint: expect.stringContaining("equals the current draft"),
  });
});

it("refuses an empty patch and claims without an answer", async () => {
  await expect(
    adapter().validateProposal(scope, proposal("blank", {})),
  ).rejects.toMatchObject({ code: "proposal-invalid" });
  await expect(
    adapter().validateProposal(
      scope,
      proposal("blank", {
        question: "A different question",
        claims: [technicalClaim("anything")],
      }),
    ),
  ).rejects.toMatchObject({ code: "claim-answer-required" });
});

it("refuses a cited source that no longer matches what is stored", async () => {
  await expect(
    adapter().validateProposal(
      scope,
      proposal(
        "blank",
        {
          answer: answer("Compare the expected revision."),
          claims: [technicalClaim("Compare the expected revision.")],
        },
        [{ ...reference, text: "Something else entirely." }],
      ),
    ),
  ).rejects.toMatchObject({ code: "evidence-lineage-conflict" });
});

it("refuses claims whose text, quote, kind or coverage do not hold", async () => {
  const check = (patch: Record<string, unknown>, code: string) =>
    expect(
      adapter().validateProposal(scope, proposal("blank", patch)),
    ).rejects.toMatchObject({ code });
  const text = "Compare the expected revision.";
  // The claim names words that are not in the answer field.
  await check(
    { answer: answer(text), claims: [technicalClaim("Not in the answer")] },
    "claim-text-conflict",
  );
  // The quote is not in the cited source.
  await check(
    {
      answer: answer(text),
      claims: [technicalClaim(text, "caches every write forever")],
    },
    "citation-quote-conflict",
  );
  // A metric on a claim that is not a metric claim.
  await check(
    {
      answer: answer(text),
      claims: [{ ...technicalClaim(text), metric: { value: 40, unit: "%" } }],
    },
    "claim-kind-conflict",
  );
  // A personal statement with only a technical claim behind it.
  await check(
    {
      answer: answer(`${text} I led the migration.`),
      claims: [technicalClaim(text)],
    },
    "missing-citation",
  );
});

it("refuses a number in the answer that no claim covers", async () => {
  await expect(
    adapter().validateProposal(
      scope,
      proposal(
        "blank",
        {
          answer: answer("Compare the expected revision. Latency fell 40%."),
          claims: [technicalClaim("Compare the expected revision.")],
        },
        [reference, candidate],
      ),
    ),
  ).rejects.toMatchObject({ code: "missing-citation" });
});

it("finds evidence by query, and refuses an empty query", async () => {
  const found = await adapter().searchEvidence(scope, "latency");
  expect(found.map((item) => item.id)).toEqual(["cand"]);
  await expect(adapter().searchEvidence(scope, "  ")).rejects.toThrow();
});

it("explains an unusable quote or draft to the model", async () => {
  await expect(
    adapter().buildProposal!(scope, originFor("blank"), {
      answer: answer("Compare the expected revision."),
      claims: [
        {
          field: "answerMarkdown",
          text: "Compare the expected revision.",
          source: "ref",
          quote: "   ",
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "citation-quote-conflict" });
  await expect(
    adapter().buildProposal!(scope, originFor("blank"), {
      unexpected: true,
    } as never),
  ).rejects.toMatchObject({ code: "proposal-invalid" });
});

it("refuses to run code that is missing or from a stale revision", async () => {
  await expect(
    adapter().runCode(
      scope,
      { origin: originFor("blank"), requestId: "run-1" },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "answer-required" });
  await expect(
    adapter().runCode(
      scope,
      { origin: originFor("blank", 7), requestId: "run-2" },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "revision-conflict" });
});

it("refuses to read a missing artifact or edit from a stale revision", async () => {
  await expect(
    workspace.read(scope, "w", "does-not-exist"),
  ).rejects.toMatchObject({ code: "not-found" });
  await expect(
    workspace.edit(scope, originFor("with-answer", 9), { notes: "late" }),
  ).rejects.toMatchObject({ code: "revision-conflict" });
});

it("lists the saved versions of an artifact, newest first", async () => {
  const origin = (await workspace.read(scope, "w", "with-answer")).origin;
  await workspace.save(scope, origin, "save-1");
  const saved = await workspace.listAnswerRevisions(scope, "w", "with-answer");
  expect(saved).toHaveLength(1);
  expect(saved[0]?.value.answer?.answerMarkdown).toBe(
    "Compare the expected revision.",
  );
});

it("merges a partial answer into the current one and keeps every field it did not name", async () => {
  const origin = (await workspace.read(scope, "w", "with-answer")).origin;
  const built = await adapter().buildProposal!(scope, origin, {
    answer: { testCode: "it('adds a test', () => {});" },
  });
  expect(built.patch["answer"]).toEqual({
    ...answer("Compare the expected revision."),
    testCode: "it('adds a test', () => {});",
  });
  expect(built.patch["claims"]).toBeUndefined();
});

it("asks for every field when there is no answer yet to merge into", async () => {
  await expect(
    adapter().buildProposal!(scope, originFor("blank"), {
      answer: { testCode: "it('adds a test', () => {});" },
    }),
  ).rejects.toMatchObject({
    code: "proposal-invalid",
    hint: expect.stringContaining("title, language, guide (or answerMarkdown)"),
  });
});

it("accepts a change to code or tests without citations, but not a change to the prose", async () => {
  const current = await workspace.read(scope, "w", "with-answer");
  const base = current.value.answer!;
  const at = current.origin;
  const make = (patch: Record<string, unknown>) =>
    ({ id: "p-edit", origin: at, patch, evidence: [] }) as unknown as Proposal;
  // Tests only: nothing in the prose changes, so there is nothing to cite.
  await adapter().validateProposal(
    scope,
    make({ answer: { ...base, testCode: "it('x', () => {});" } }),
  );
  // Prose changes still need a source behind them.
  await expect(
    adapter().validateProposal(
      scope,
      make({ answer: { ...base, answerMarkdown: "Something new." } }),
    ),
  ).rejects.toMatchObject({ code: "missing-citation" });
});

it("gives the model an outline of the tests and definitions, so lists of them are exact", async () => {
  const outlined = originFor("outlined");
  await workspace.create(scope, outlined, {
    question: "Outline me",
    notes: "",
    answer: {
      ...answer("Notes."),
      code: "export class Cache {}\nfunction helper() {}\nconst unused = 1;",
      testCode: [
        "describe('Cache', () => {",
        "  it('stores a value', () => {});",
        '  it("evicts the oldest", () => {});',
        "  test(`handles capacity 0`, () => {});",
        "});",
      ].join("\n"),
    },
  });
  const context = (await adapter().getContext(scope, outlined)).context as {
    outline: { suites: string[]; tests: string[]; definitions: string[] };
  };
  expect(context.outline).toEqual({
    suites: ["Cache"],
    tests: ["stores a value", "evicts the oldest", "handles capacity 0"],
    definitions: ["Cache", "helper"],
  });
  // With no answer yet there is nothing to outline.
  const blank = (await adapter().getContext(scope, originFor("blank")))
    .context as {
    outline: unknown;
  };
  expect(blank.outline).toEqual({ suites: [], tests: [], definitions: [] });
});
