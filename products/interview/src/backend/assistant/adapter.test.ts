import { createHash } from "node:crypto";
import type { Proposal } from "@omnitech-assistant/contracts";
import { afterAll, beforeAll, expect, it } from "vitest";
import * as implementation from "./adapter.js";
import { InterviewWorkspaceRepository } from "./workspace.js";
import { disposablePostgres } from "./workspace-fixture.js";

const scope = { tenantId: "ground", actorId: "alice", productId: "interview" };
const origin = { workspaceId: "w", artifactId: "q", artifactRevision: 0 };
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const source = {
  id: "candidate",
  revision: 1,
  text: "I improved latency by 40%.",
  sha256: digest("I improved latency by 40%."),
  locator: "candidate://synthetic",
  sourceKind: "candidate" as const,
  classification: "confidential" as const,
  audience: ["alice"],
  metrics: [{ value: 40, unit: "%" }],
};
const answer = {
  title: "Example",
  language: "typescript",
  answerMarkdown: "I improved latency by 40%.",
  code: "",
  usageCode: "",
  testCode: "",
};
const claim = {
  kind: "candidate-metric",
  field: "answerMarkdown",
  text: answer.answerMarkdown,
  metric: { value: 40, unit: "%" },
  citations: [
    { id: source.id, revision: 1, sha256: source.sha256, quote: source.text },
  ],
};
let pg: Awaited<ReturnType<typeof disposablePostgres>>,
  workspace: InterviewWorkspaceRepository;
let allowed = true,
  technical = true;
const adapter = () =>
  implementation.createInterviewAdapter(pg.database, {
    authorizeEvidence: async () => allowed,
    verifyTechnicalReference: async () => technical,
  });
const generic = (item: typeof source) => {
  const { sourceKind, metrics, ...rest } = item;
  void sourceKind;
  void metrics;
  return rest;
};
const proposal = (
  patch: Record<string, unknown> = { answer, claims: [claim] },
  evidence: unknown[] = [source],
) =>
  ({
    id: "p",
    origin,
    patch,
    evidence: evidence.map((e) => generic(e as typeof source)),
  }) as unknown as Proposal;
beforeAll(async () => {
  pg = await disposablePostgres();
  for (const filename of [
    "0004_assistant_interview.sql",
    "0005_assistant_provenance.sql",
  ])
    await pg.migrate(
      new URL(
        `../../../../../packages/platform-storage/migrations/${filename}`,
        import.meta.url,
      ),
    );
  workspace = new InterviewWorkspaceRepository(pg.database);
  await workspace.create(scope, origin, {
    question: "Describe a synthetic improvement",
    notes: "Canonical notes",
  });
  await workspace.putEvidence(scope, source);
});
afterAll(async () => {
  await pg?.close();
});
it("refuses unsupported personal metrics rather than treating a citation as proof", async () => {
  await expect(
    adapter().validateProposal(
      scope,
      proposal({
        answer: { ...answer, answerMarkdown: "I improved latency by 80%." },
        claims: [
          {
            ...claim,
            text: "I improved latency by 80%.",
            metric: { value: 80, unit: "%" },
          },
        ],
      }),
    ),
  ).rejects.toMatchObject({ code: "unsupported-metric" });
});
it("requires citations for generated answers", async () => {
  await expect(
    adapter().validateProposal(scope, proposal({ answer, claims: [] })),
  ).rejects.toMatchObject({ code: "missing-citation" });
});
it("preserves supported candidate metrics inside ordinary Markdown talking points", async () => {
  await adapter().validateProposal(
    scope,
    proposal({
      answer: {
        ...answer,
        answerMarkdown:
          "**Talking points**\n- I improved latency by 40%.\n- Compare expected revisions.",
      },
      claims: [claim],
    }),
  );
});
it("requires typed metrics rather than relabeling them as ordinary candidate facts", async () => {
  const { metric: ignored, ...fact } = claim;
  void ignored;
  await expect(
    adapter().validateProposal(
      scope,
      proposal({ answer, claims: [{ ...fact, kind: "candidate-fact" }] }),
    ),
  ).rejects.toMatchObject({ code: "unsupported-metric" });
});
it("accepts canonical candidate metric and rejects unknown revision hash tenant actor audience or classification", async () => {
  await adapter().validateProposal(scope, proposal());
  for (const bad of [
    { id: "unknown" },
    { revision: 99 },
    { sha256: "0".repeat(64) },
  ])
    await expect(
      adapter().validateProposal(
        scope,
        proposal({
          answer,
          claims: [
            { ...claim, citations: [{ ...claim.citations[0], ...bad }] },
          ],
        }),
      ),
    ).rejects.toThrow();
  for (const other of [
    { ...scope, tenantId: "other" },
    { ...scope, actorId: "bob" },
  ])
    await expect(
      adapter().validateProposal(other, proposal()),
    ).rejects.toThrow();
  await workspace.putEvidence(scope, {
    ...source,
    id: "denied",
    audience: ["bob"],
  });
  await expect(
    adapter().validateProposal(
      scope,
      proposal(
        {
          answer,
          claims: [
            { ...claim, citations: [{ ...claim.citations[0], id: "denied" }] },
          ],
        },
        [{ ...source, id: "denied", audience: ["bob"] }],
      ),
    ),
  ).rejects.toThrow();
  allowed = false;
  try {
    await expect(
      adapter().validateProposal(scope, proposal()),
    ).rejects.toMatchObject({ code: "evidence-forbidden" });
    expect((await adapter().getContext(scope, origin)).evidence).toEqual([]);
  } finally {
    allowed = true;
  }
});
it("refuses candidate metrics supported only by technical source and refuses unverified references", async () => {
  const ref = {
    ...source,
    id: "reference",
    sourceKind: "technical-reference" as const,
    locator: "https://fixture.invalid/reference",
  };
  await workspace.putEvidence(scope, ref);
  const cited = {
    ...claim,
    citations: [{ ...claim.citations[0], id: "reference" }],
  };
  await expect(
    adapter().validateProposal(
      scope,
      proposal({ answer, claims: [cited] }, [ref]),
    ),
  ).rejects.toMatchObject({ code: "source-kind-conflict" });
  const { metric: ignored, ...withoutMetric } = cited;
  void ignored;
  const technicalClaim = { ...withoutMetric, kind: "technical" };
  technical = false;
  try {
    await expect(
      adapter().validateProposal(
        scope,
        proposal({ answer, claims: [technicalClaim] }, [ref]),
      ),
    ).rejects.toMatchObject({ code: "reference-unverified" });
  } finally {
    technical = true;
  }
});
it("rejects stale evidence even when its immutable old revision still exists", async () => {
  const next = {
    ...source,
    revision: 2,
    text: "I improved latency by 50%.",
    sha256: digest("I improved latency by 50%."),
    metrics: [{ value: 50, unit: "%" }],
  };
  await workspace.putEvidence(scope, next);
  await expect(
    adapter().validateProposal(scope, proposal()),
  ).rejects.toMatchObject({ code: "evidence-revision-conflict" });
});
it("returns current canonical origin for stale requests and never treats draft text as evidence", async () => {
  await workspace.edit(scope, origin, { notes: "My edit" });
  const context = await adapter().getContext(scope, origin);
  expect(context.origin.artifactRevision).toBe(1);
  expect(JSON.stringify(context.context)).toContain("My edit");
  expect(context.evidence.every((e) => e.text !== "My edit")).toBe(true);
});

it("does not allow relabeling a personal metric as a technical claim", async () => {
  const text = "I improved latency by 40%.";
  const ref = {
    ...source,
    id: "camouflage",
    sourceKind: "technical-reference" as const,
  };
  await workspace.putEvidence(scope, ref);
  const { metric: ignored, ...c } = claim;
  void ignored;
  await expect(
    adapter().validateProposal(scope, {
      ...proposal(
        {
          answer,
          claims: [
            {
              ...c,
              kind: "technical",
              citations: [{ ...claim.citations[0], id: "camouflage" }],
            },
          ],
        },
        [ref],
      ),
      origin: { ...origin, artifactRevision: 1 },
    } as never),
  ).rejects.toMatchObject({ code: "source-kind-conflict" });
});

it("supports exact candidate facts and explicitly verified technical fixture references, while defaults deny private or unverified evidence", async () => {
  const factText = "Built a synthetic cache";
  const fact = {
    ...source,
    id: "fact",
    text: factText,
    sha256: digest(factText),
    metrics: [],
  };
  await workspace.putEvidence(scope, fact);
  const factClaim = {
    kind: "candidate-fact",
    field: "answerMarkdown",
    text: factText,
    citations: [
      { id: "fact", revision: 1, sha256: fact.sha256, quote: factText },
    ],
  };
  const draft = { ...answer, answerMarkdown: factText };
  const proposed = {
    ...proposal({ answer: draft, claims: [factClaim] }, [fact]),
    origin: { ...origin, artifactRevision: 1 },
  };
  await adapter().validateProposal(scope, proposed);
  await expect(
    adapter().validateProposal(scope, {
      ...proposed,
      patch: {
        answer: { ...draft, answerMarkdown: "Led an invented global team" },
        claims: [{ ...factClaim, text: "Led an invented global team" }],
      },
    } as never),
  ).rejects.toMatchObject({ code: "candidate-fact-conflict" });
  await expect(
    implementation
      .createInterviewAdapter(pg.database)
      .validateProposal(scope, proposed),
  ).rejects.toMatchObject({ code: "evidence-forbidden" });
  const referenceText = "Optimistic concurrency compares the expected revision";
  const ref = {
    ...source,
    id: "approved-reference",
    text: referenceText,
    sha256: digest(referenceText),
    metrics: [],
    sourceKind: "technical-reference" as const,
    classification: "public" as const,
    locator: "https://fixture.invalid/known-reference",
  };
  await workspace.putEvidence(scope, ref);
  const technicalClaim = {
    kind: "technical",
    field: "answerMarkdown",
    text: referenceText,
    citations: [
      { id: ref.id, revision: 1, sha256: ref.sha256, quote: referenceText },
    ],
  };
  const technicalProposal = {
    ...proposal(
      {
        answer: { ...answer, answerMarkdown: referenceText },
        claims: [technicalClaim],
      },
      [ref],
    ),
    origin: { ...origin, artifactRevision: 1 },
  };
  await implementation
    .createInterviewAdapter(pg.database, {
      verifyTechnicalReference: async (_scope, source) =>
        source.id === "approved-reference",
    })
    .validateProposal(scope, technicalProposal);
  await expect(
    implementation
      .createInterviewAdapter(pg.database)
      .validateProposal(scope, technicalProposal),
  ).rejects.toMatchObject({ code: "reference-unverified" });
});

// The model supplies content and says which source supports it; the product
// derives revisions, hashes, claim kinds and exact quotes.
const technicalNote = {
  id: "technical-note",
  revision: 1,
  text: "Optimistic concurrency compares an expected revision before writing.\nUse a pure function and test stale revisions.",
  sha256: digest(
    "Optimistic concurrency compares an expected revision before writing.\nUse a pure function and test stale revisions.",
  ),
  locator: "local://reference",
  sourceKind: "technical-reference" as const,
  classification: "public" as const,
  audience: ["alice"],
};
const technicalAnswer = {
  ...answer,
  answerMarkdown: "Compare the expected revision before writing.",
};
const draftClaim = {
  field: "answerMarkdown",
  text: "Compare the expected revision before writing.",
  source: "technical-note",
  quote: "compares an expected revision before writing",
};
// Earlier tests in this file bump the shared draft and rewrite shared sources,
// so these use their own artifact and their own candidate source.
const builtOrigin = { ...origin, artifactId: "built" };
const candidateNote = {
  ...source,
  id: "built-candidate",
  text: "I cut p95 latency by 40% last quarter.",
  sha256: digest("I cut p95 latency by 40% last quarter."),
  locator: "candidate://built",
};
const builtProposal = (patch: Record<string, unknown>, evidence: unknown[]) =>
  ({ ...proposal(patch, evidence), origin: builtOrigin }) as Proposal;
async function ensureReference() {
  allowed = true;
  technical = true;
  await workspace
    .read(scope, builtOrigin.workspaceId, builtOrigin.artifactId)
    .catch(() =>
      workspace.create(scope, builtOrigin, {
        question: "Describe a synthetic improvement",
        notes: "",
      }),
    );
  await workspace
    .readEvidence(scope, candidateNote.id, 1)
    .catch(() => workspace.putEvidence(scope, candidateNote));
  await workspace
    .readEvidence(scope, technicalNote.id, 1)
    .catch(() => workspace.putEvidence(scope, technicalNote));
}
it("derives revision, hash, kind and citation from a source id and quote, and the result passes validation", async () => {
  await ensureReference();
  const built = await adapter().buildProposal!(scope, origin, {
    answer: technicalAnswer,
    claims: [draftClaim],
  });
  expect(built.evidenceRefs).toEqual([{ id: "technical-note", revision: 1 }]);
  expect(built.patch["claims"]).toEqual([
    {
      kind: "technical",
      field: "answerMarkdown",
      text: draftClaim.text,
      citations: [
        {
          id: "technical-note",
          revision: 1,
          sha256: technicalNote.sha256,
          quote: draftClaim.quote,
        },
      ],
    },
  ]);
  // The derived patch is accepted by the same validator that checks any proposal.
  await adapter().validateProposal(
    scope,
    builtProposal(built.patch as Record<string, unknown>, [technicalNote]),
  );
});
it("locates the real passage when the model's quote differs in case or whitespace", async () => {
  await ensureReference();
  const built = await adapter().buildProposal!(scope, origin, {
    answer: technicalAnswer,
    claims: [
      {
        ...draftClaim,
        quote: "Use A PURE   function and test stale revisions",
      },
    ],
  });
  const claims = built.patch["claims"] as { citations: { quote: string }[] }[];
  expect(claims[0]?.citations[0]?.quote).toBe(
    "Use a pure function and test stale revisions",
  );
});
it("derives candidate-metric claims from the model's metric", async () => {
  await ensureReference();
  const candidateAnswer = { ...answer, answerMarkdown: candidateNote.text };
  const built = await adapter().buildProposal!(scope, origin, {
    answer: candidateAnswer,
    claims: [
      {
        field: "answerMarkdown",
        text: candidateNote.text,
        source: candidateNote.id,
        quote: candidateNote.text,
        metric: { value: 40, unit: "%" },
      },
    ],
  });
  expect((built.patch["claims"] as { kind: string }[])[0]?.kind).toBe(
    "candidate-metric",
  );
  await adapter().validateProposal(
    scope,
    builtProposal(built.patch as Record<string, unknown>, [candidateNote]),
  );
});
it("refuses a quote that is not in the source and shows the model the real text", async () => {
  await ensureReference();
  await expect(
    adapter().buildProposal!(scope, origin, {
      answer: technicalAnswer,
      claims: [{ ...draftClaim, quote: "caches every write forever" }],
    }),
  ).rejects.toMatchObject({
    code: "citation-quote-conflict",
    hint: expect.stringContaining("Optimistic concurrency compares"),
  });
});
it("refuses an unknown source and lists the sources it may cite", async () => {
  await ensureReference();
  await expect(
    adapter().buildProposal!(scope, origin, {
      answer: technicalAnswer,
      claims: [{ ...draftClaim, source: "made-up" }],
    }),
  ).rejects.toMatchObject({
    code: "evidence-unavailable",
    hint: expect.stringContaining("technical-note"),
  });
});
it("passes a draft without claims through so validation can ask for them", async () => {
  await ensureReference();
  const built = await adapter().buildProposal!(scope, origin, {
    answer: technicalAnswer,
  });
  expect(built.evidenceRefs).toEqual([]);
  expect(built.patch["claims"]).toBeUndefined();
  await expect(
    adapter().validateProposal(
      scope,
      builtProposal(built.patch as Record<string, unknown>, []),
    ),
  ).rejects.toMatchObject({ code: "missing-citation" });
});
it("accepts claims placed inside the answer as well as beside it", async () => {
  await ensureReference();
  const nested = await adapter().buildProposal!(scope, origin, {
    answer: { ...technicalAnswer, claims: [draftClaim] },
  });
  const beside = await adapter().buildProposal!(scope, origin, {
    answer: technicalAnswer,
    claims: [draftClaim],
  });
  expect(nested).toEqual(beside);
  expect(nested.patch["answer"]).toEqual(technicalAnswer);
  // The same claim in both places is stated once.
  const both = await adapter().buildProposal!(scope, origin, {
    answer: { ...technicalAnswer, claims: [draftClaim] },
    claims: [draftClaim],
  });
  expect((both.patch["claims"] as unknown[]).length).toBe(1);
});
