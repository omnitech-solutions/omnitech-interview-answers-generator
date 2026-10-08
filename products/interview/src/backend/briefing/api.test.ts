import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type {
  WorkspaceDatabasePort,
  WorkspaceScope,
} from "../assistant/workspace";
import { disposablePostgres } from "../assistant/workspace-fixture";
import { createBriefingApi } from "./api";

// Every log line the product writes, as the JSON a deployment would emit
// (through the real logger and its redaction), so a test can read an event.
const logged = vi.hoisted(() => [] as string[]);
vi.mock("@omnitech/logging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@omnitech/logging")>();
  return {
    ...actual,
    createLogger: (options: Parameters<typeof actual.createLogger>[0]) =>
      actual.createLogger({
        ...options,
        level: "info",
        format: "json",
        write: (line) => logged.push(line),
      }),
  };
});

let pg: Awaited<ReturnType<typeof disposablePostgres>>;
const scope = {
  tenantId: "tenant-a",
  actorId: "alice",
  productId: "omnitech.interview",
};
const matrix = {
  candidate: { name: "Synthetic Candidate" },
  roles: [
    {
      company: "Acme",
      title: "Engineer",
      technologies: ["TypeScript"],
      proof_points: ["Mentored engineers"],
    },
  ],
};
const context = {
  company: "Acme",
  role: "Engineer",
  stage: "recruiter",
  profile: { id: "profile", revision: 1 },
};
const briefing = {
  kind: "non-technical-briefing",
  title: "Recruiter",
  context,
  questions: [],
};
let generated: unknown = {
  questions: [
    {
      id: "q",
      answerMarkdown: "I mentored engineers.",
      talkingPoints: [
        "I mentored engineers",
        "I build products",
        "I collaborate",
      ],
      citations: [
        {
          field: "answerMarkdown",
          text: "mentored engineers",
          sourceKind: "candidate",
          pointer: "/roles/0/proof_points/0",
          quote: "Mentored engineers",
        },
      ],
      gaps: [],
    },
  ],
};
const prompts: { system: string; prompt: string }[] = [];
const app = (
  database: WorkspaceDatabasePort = pg.database,
  loadDefaultProfile?: (
    scope: WorkspaceScope,
  ) => Promise<{ name: string; matrix: unknown } | null>,
) =>
  createBriefingApi({
    database,
    resolveScope: async (request) => ({
      ...scope,
      actorId: request.headers.get("x-actor") ?? scope.actorId,
    }),
    generate: async (input) => {
      prompts.push(input);
      if (generated instanceof Error) throw generated;
      return generated;
    },
    ...(loadDefaultProfile ? { loadDefaultProfile } : {}),
  });
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  actor = "alice",
) {
  return app().request(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "x-actor": actor,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeAll(async () => {
  pg = await disposablePostgres();
  await pg.migrate();
});
afterAll(async () => {
  await pg?.close();
});

it("imports immutable versions and enforces actor RLS", async () => {
  const imported = await request("/api/interview/briefing/profiles", "POST", {
    name: "Synthetic",
    profileId: "profile",
    matrix,
  });
  expect(imported.status).toBe(201);
  expect((await imported.json()).revision).toBe(1);
  const version = await request(
    "/api/interview/briefing/profiles/profile/revisions/1",
  );
  expect((await version.json()).matrix).toEqual(matrix);
  expect(
    (
      await request(
        "/api/interview/briefing/profiles/profile/revisions/1",
        "GET",
        undefined,
        "bob",
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await pg.member.query(
        "SELECT * FROM interview.candidate_profile_revisions",
      )
    ).rows,
  ).toEqual([]);
  const second = await request("/api/interview/briefing/profiles", "POST", {
    name: "Synthetic",
    profileId: "profile",
    expectedRevision: 1,
    matrix: { ...matrix, candidate: { name: "Synthetic Candidate 2" } },
  });
  expect((await second.json()).revision).toBe(2);
  expect(
    (
      await (
        await request("/api/interview/briefing/profiles/profile/revisions/1")
      ).json()
    ).matrix,
  ).toEqual(matrix);
});

it("keeps generation separate from apply and saves the entire pack", async () => {
  const created = await request(
    "/api/interview/briefing/artifacts/pack",
    "PUT",
    { expectedRevision: 0, briefing },
  );
  expect(created.status).toBe(200);
  const proposal = await request(
    "/api/interview/briefing/artifacts/pack/proposals",
    "POST",
    {
      expectedRevision: 0,
      context,
      questions: [
        {
          id: "q",
          question: "Tell me about mentoring",
          category: "leadership",
        },
      ],
    },
  );
  expect(proposal.status).toBe(201);
  const proposed = await proposal.json();
  expect(proposed.briefing.questions[0].evidenceRefs[0]).toMatchObject({
    pointer: "/roles/0/proof_points/0",
    quote: "Mentored engineers",
    sourceKind: "candidate",
    sha256: createHash("sha256").update("Mentored engineers").digest("hex"),
  });
  expect(
    (await (await request("/api/interview/briefing/artifacts/pack")).json())
      .value.briefing.questions,
  ).toEqual([]);
  const applied = await request(
    "/api/interview/briefing/artifacts/pack/apply",
    "POST",
    { proposalId: proposed.id, expectedRevision: 0 },
  );
  const appliedRecord = await applied.json();
  expect(appliedRecord.value.briefing.questions).toHaveLength(1);
  expect(
    (
      await request("/api/interview/briefing/artifacts/pack/apply", "POST", {
        proposalId: proposed.id,
        expectedRevision: 0,
      })
    ).status,
  ).toBe(409);
  const saved = await request(
    "/api/interview/briefing/artifacts/pack/save",
    "POST",
    { expectedRevision: 1, requestId: "save-pack" },
  );
  expect((await saved.json()).value.briefing.questions[0].answerMarkdown).toBe(
    "I mentored engineers.",
  );
  const changed = {
    ...appliedRecord.value.briefing,
    questions: [
      {
        ...appliedRecord.value.briefing.questions[0],
        answerMarkdown: "I edited this answer.",
      },
    ],
  };
  const edited = await request(
    "/api/interview/briefing/artifacts/pack",
    "PUT",
    { expectedRevision: 1, briefing: changed },
  );
  const editedQuestion = (await edited.json()).value.briefing.questions[0];
  expect(editedQuestion.evidenceRefs).toEqual([]);
  expect(editedQuestion.gaps).toContain(
    "Review the edited answer against its sources.",
  );
});

it("turns an invented quotation into a gap and leaves the draft intact", async () => {
  generated = {
    questions: [
      {
        id: "bad",
        answerMarkdown: "Invented",
        talkingPoints: ["a", "b", "c"],
        citations: [
          {
            field: "answerMarkdown",
            text: "Invented",
            sourceKind: "candidate",
            pointer: "/roles/0/proof_points/0",
            quote: "not in source",
          },
        ],
        gaps: [],
      },
    ],
  };
  const created = await request(
    "/api/interview/briefing/artifacts/invalid",
    "PUT",
    { expectedRevision: 0, briefing },
  );
  expect(created.status).toBe(200);
  const proposal = await request(
    "/api/interview/briefing/artifacts/invalid/proposals",
    "POST",
    {
      expectedRevision: 0,
      context,
      questions: [
        {
          id: "bad",
          question: "Tell me about mentoring",
          category: "leadership",
        },
      ],
    },
  );
  expect(proposal.status).toBe(201);
  const [invented] = (await proposal.json()).briefing.questions;
  expect(invented.evidenceRefs).toEqual([]);
  expect(invented.gaps).toEqual([
    "Could not verify “Invented” against your sources.",
  ]);
  expect(
    (await (await request("/api/interview/briefing/artifacts/invalid")).json())
      .value.briefing.questions,
  ).toEqual([]);
});

it("reads a profile with nested keys reordered by PostgreSQL jsonb", async () => {
  const imported = await request("/api/interview/briefing/profiles", "POST", {
    name: "Reordered",
    profileId: "reordered",
    matrix: {
      roles: [
        {
          title: "Engineer",
          company: "Acme",
          z_private_extension: { z: "last", a: "first" },
          proof_points: ["A result"],
        },
      ],
      candidate: { z: "last", a: "first" },
      experience_matrix_extensions: { z: { z: true, a: false }, a: "first" },
    },
  });
  expect(imported.status).toBe(201);
  const read = await request(
    "/api/interview/briefing/profiles/reordered/revisions/1",
  );
  expect(read.status).toBe(200);
});

it("refuses a historical profile revision whose stored hash does not match its matrix", async () => {
  const imported = await request("/api/interview/briefing/profiles", "POST", {
    name: "Hash guard",
    profileId: "hash-guard",
    matrix,
  });
  expect(imported.status).toBe(201);
  await pg.worker.transaction(async (tx) => {
    await tx.query(
      "SELECT set_config('app.tenant_id','tenant-a',true), set_config('app.actor_id','alice',true), set_config('app.product_id','omnitech.interview',true)",
    );
    await tx.query(
      "INSERT INTO interview.candidate_profile_revisions(tenant_id,actor_id,product_id,id,revision,name,sha256,matrix) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
      [
        "tenant-a",
        "alice",
        "omnitech.interview",
        "hash-guard",
        99,
        "Hash guard",
        "0".repeat(64),
        JSON.stringify(matrix),
      ],
    );
  });
  const response = await request(
    "/api/interview/briefing/profiles/hash-guard/revisions/99",
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("evidence-hash-conflict");
  expect(
    (await request("/api/interview/briefing/profiles/hash-guard/revisions/1"))
      .status,
  ).toBe(200);
});

it("does not overwrite a revoked profile or accept a stale profile revision", async () => {
  const path = "/api/interview/briefing/profiles";
  const imported = await request(path, "POST", {
    name: "Revocation guard",
    profileId: "revocation-guard",
    matrix,
  });
  expect(imported.status).toBe(201);
  const stale = await request(path, "POST", {
    name: "Stale update",
    profileId: "revocation-guard",
    expectedRevision: 0,
    matrix,
  });
  expect(stale.status).toBe(409);
  expect((await stale.json()).error.code).toBe("revision-conflict");
  await pg.worker.transaction(async (tx) => {
    await tx.query(
      "SELECT set_config('app.tenant_id','tenant-a',true), set_config('app.actor_id','alice',true), set_config('app.product_id','omnitech.interview',true)",
    );
    await tx.query(
      "UPDATE interview.candidate_profiles SET revoked_at=now() WHERE id='revocation-guard'",
    );
  });
  const revoked = await request(path, "POST", {
    name: "Revoked update",
    profileId: "revocation-guard",
    expectedRevision: 1,
    matrix,
  });
  expect(revoked.status).toBe(404);
  expect((await revoked.json()).error.code).toBe("not-found");
});

it("rejects cross-site mutations and preserves unrelated cards on a one-card refinement", async () => {
  const forbidden = await app().request(
    "http://localhost/api/interview/briefing/profiles",
    {
      method: "POST",
      headers: {
        origin: "https://evil.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "X", matrix }),
    },
  );
  expect(forbidden.status).toBe(403);
  generated = {
    questions: [
      {
        id: "first",
        answerMarkdown: "I mentored engineers.",
        talkingPoints: ["a", "b", "c"],
        citations: [
          {
            field: "answerMarkdown",
            text: "mentored engineers",
            sourceKind: "candidate",
            pointer: "/roles/0/proof_points/0",
            quote: "Mentored engineers",
          },
        ],
        gaps: [],
      },
    ],
  };
  await request("/api/interview/briefing/artifacts/refine", "PUT", {
    expectedRevision: 0,
    briefing: {
      ...briefing,
      questions: [
        {
          id: "first",
          question: "Leadership",
          category: "leadership",
          answerMarkdown: "Before",
          talkingPoints: ["a", "b", "c"],
          evidenceRefs: [],
          gaps: [],
        },
        {
          id: "second",
          question: "Delivery",
          category: "delivery",
          answerMarkdown: "Keep this",
          talkingPoints: ["x", "y", "z"],
          evidenceRefs: [],
          gaps: [],
        },
      ],
    },
  });
  const result = await request(
    "/api/interview/briefing/artifacts/refine/proposals",
    "POST",
    {
      expectedRevision: 0,
      context,
      questionId: "first",
      questions: [
        { id: "first", question: "Leadership", category: "leadership" },
      ],
    },
  );
  expect(result.status).toBe(201);
  expect(
    (await result.json()).briefing.questions.map(
      (item: { answerMarkdown: string }) => item.answerMarkdown,
    ),
  ).toEqual(["I mentored engineers.", "Keep this"]);
});

it("does not count a claim whose text is absent from its named answer field", async () => {
  generated = {
    questions: [
      {
        id: "unlinked",
        answerMarkdown: "I build systems.",
        talkingPoints: ["a", "b", "c"],
        citations: [
          {
            field: "answerMarkdown",
            text: "I led teams",
            sourceKind: "candidate",
            pointer: "/roles/0/proof_points/0",
            quote: "Mentored engineers",
          },
        ],
        gaps: [],
      },
    ],
  };
  await request("/api/interview/briefing/artifacts/unlinked", "PUT", {
    expectedRevision: 0,
    briefing,
  });
  const response = await request(
    "/api/interview/briefing/artifacts/unlinked/proposals",
    "POST",
    {
      expectedRevision: 0,
      context,
      questions: [
        {
          id: "unlinked",
          question: "How do you lead?",
          category: "leadership",
        },
      ],
    },
  );
  expect(response.status).toBe(201);
  const [unlinked] = (await response.json()).briefing.questions;
  expect(unlinked.evidenceRefs).toEqual([]);
  expect(unlinked.gaps).toContain(
    "Could not verify “I led teams” against your sources.",
  );
});

it("does not accept employer material as candidate evidence", async () => {
  const employerContext = {
    ...context,
    employerNotes: "The employer values mentoring",
  };
  generated = {
    questions: [
      {
        id: "typed",
        answerMarkdown: "The employer values mentoring.",
        talkingPoints: ["a", "b", "c"],
        citations: [
          {
            field: "answerMarkdown",
            text: "employer values mentoring",
            sourceKind: "candidate",
            pointer: "/context/employerNotes",
            quote: "The employer values mentoring",
          },
        ],
        gaps: [],
      },
    ],
  };
  await request("/api/interview/briefing/artifacts/typed", "PUT", {
    expectedRevision: 0,
    briefing: { ...briefing, context: employerContext },
  });
  const response = await request(
    "/api/interview/briefing/artifacts/typed/proposals",
    "POST",
    {
      expectedRevision: 0,
      context: employerContext,
      questions: [
        { id: "typed", question: "What attracts you?", category: "motivation" },
      ],
    },
  );
  expect(response.status).toBe(201);
  const [typed] = (await response.json()).briefing.questions;
  expect(typed.evidenceRefs).toEqual([]);
  expect(typed.gaps).toContain(
    "Could not verify “employer values mentoring” against your sources.",
  );
});

it("rejects a body above one MiB using actual UTF-8 bytes", async () => {
  const response = await request("/api/interview/briefing/profiles", "POST", {
    name: "Too large",
    matrix: { candidate: { note: "é".repeat(530_000) }, roles: [] },
  });
  expect(response.status).toBe(413);
});

it("prevents rewriting immutable imported revisions and proposal payloads", async () => {
  const imported = await request("/api/interview/briefing/profiles", "POST", {
    name: "Immutable",
    profileId: "immutable",
    matrix,
  });
  expect(imported.status).toBe(201);
  await expect(
    pg.worker.transaction(async (tx) => {
      await tx.query(
        "SELECT set_config('app.tenant_id','tenant-a',true), set_config('app.actor_id','alice',true), set_config('app.product_id','omnitech.interview',true)",
      );
      return tx.query(
        "UPDATE interview.candidate_profile_revisions SET name='Changed' WHERE id='immutable'",
      );
    }),
  ).rejects.toThrow(/immutable/i);
});

it("flags a shortened qualified metric that does not appear in the cited field", async () => {
  const metricMatrix = {
    candidate: {},
    roles: [
      {
        company: "Metric Co",
        title: "Engineer",
        metrics: [{ label: "reach", value: "40M+" }],
      },
    ],
  };
  await request("/api/interview/briefing/profiles", "POST", {
    name: "Metrics",
    profileId: "metrics",
    matrix: metricMatrix,
  });
  const metricContext = { ...context, profile: { id: "metrics", revision: 1 } };
  await request("/api/interview/briefing/artifacts/metric", "PUT", {
    expectedRevision: 0,
    briefing: { ...briefing, context: metricContext },
  });
  generated = {
    questions: [
      {
        id: "metric",
        answerMarkdown: "I supported 40 users.",
        talkingPoints: ["a", "b", "c"],
        citations: [
          {
            field: "answerMarkdown",
            text: "40 users",
            sourceKind: "candidate",
            pointer: "/roles/0/metrics/0/value",
            quote: "40M+",
          },
        ],
        gaps: [],
      },
    ],
  };
  const response = await request(
    "/api/interview/briefing/artifacts/metric/proposals",
    "POST",
    {
      expectedRevision: 0,
      context: metricContext,
      questions: [
        { id: "metric", question: "What scale?", category: "delivery" },
      ],
    },
  );
  expect(response.status).toBe(201);
  const [metric] = (await response.json()).briefing.questions;
  expect(metric.gaps).toContain(
    "States a figure your sources don’t support: 40. Check it before using.",
  );
});

it("accepts a metric of a cited role without quoting the metric leaf", async () => {
  const metricMatrix = {
    candidate: {},
    roles: [
      {
        company: "Metric Co",
        title: "Engineer",
        responsibilities: ["Led the platform modernization"],
        metrics: [{ label: "security incidents", value: "40%" }],
      },
      {
        company: "Other Co",
        title: "Engineer",
        metrics: [{ label: "cost", value: "75%" }],
      },
    ],
  };
  await request("/api/interview/briefing/profiles", "POST", {
    name: "Metrics",
    profileId: "role-metrics",
    matrix: metricMatrix,
  });
  const metricContext = {
    ...context,
    profile: { id: "role-metrics", revision: 1 },
  };
  await request("/api/interview/briefing/artifacts/role-metric", "PUT", {
    expectedRevision: 0,
    briefing: { ...briefing, context: metricContext },
  });
  generated = {
    questions: [
      {
        id: "metric",
        answerMarkdown:
          "I led the platform modernization, cutting security incidents by 40% and costs by 75%.",
        talkingPoints: ["a", "b", "c"],
        citations: [
          {
            field: "answerMarkdown",
            text: "led the platform modernization",
            sourceKind: "candidate",
            pointer: "/roles/0/responsibilities/0",
            quote: "Led the platform modernization",
          },
        ],
        gaps: [],
      },
    ],
  };
  const response = await request(
    "/api/interview/briefing/artifacts/role-metric/proposals",
    "POST",
    {
      expectedRevision: 0,
      context: metricContext,
      questions: [
        { id: "metric", question: "What impact?", category: "delivery" },
      ],
    },
  );
  expect(response.status).toBe(201);
  const [metric] = (await response.json()).briefing.questions;
  expect(metric.gaps).toEqual([
    "States a figure your sources don’t support: 75%. Check it before using.",
  ]);
});

it("adds a gap when the answer has no source and refuses stale one-card refinements", async () => {
  generated = {
    questions: [
      {
        id: "gap",
        answerMarkdown: "I did this.",
        talkingPoints: ["a", "b", "c"],
        citations: [],
        gaps: [],
      },
    ],
  };
  await request("/api/interview/briefing/artifacts/gap", "PUT", {
    expectedRevision: 0,
    briefing,
  });
  const noSource = await request(
    "/api/interview/briefing/artifacts/gap/proposals",
    "POST",
    {
      expectedRevision: 0,
      context,
      questions: [
        { id: "gap", question: "What did you do?", category: "background" },
      ],
    },
  );
  expect(noSource.status).toBe(201);
  expect((await noSource.json()).briefing.questions[0].gaps).toEqual([
    "No source was cited for this answer.",
  ]);
  const stale = await request(
    "/api/interview/briefing/artifacts/gap/proposals",
    "POST",
    {
      expectedRevision: 0,
      context,
      questionId: "gap",
      questions: [
        { id: "gap", question: "What did you do?", category: "background" },
      ],
    },
  );
  expect(stale.status).toBe(400);
});

it("returns a safe service failure when the provider rejects", async () => {
  generated = new Error("private provider detail");
  await request("/api/interview/briefing/artifacts/provider", "PUT", {
    expectedRevision: 0,
    briefing,
  });
  const response = await request(
    "/api/interview/briefing/artifacts/provider/proposals",
    "POST",
    {
      expectedRevision: 0,
      context,
      questions: [
        {
          id: "provider",
          question: "Tell me about yourself",
          category: "background",
        },
      ],
    },
  );
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain(
    "private provider detail",
  );
});

it("accepts a quote from a selected top-level leadership signal", async () => {
  await request("/api/interview/briefing/profiles", "POST", {
    name: "Signals",
    profileId: "signals",
    matrix: {
      candidate: {},
      roles: [{ company: "Acme", title: "Engineer" }],
      leadership_signals: [
        { signal: "Mentoring", evidence: ["Mentored engineers"] },
      ],
    },
  });
  const signalContext = { ...context, profile: { id: "signals", revision: 1 } };
  await request("/api/interview/briefing/artifacts/signals", "PUT", {
    expectedRevision: 0,
    briefing: { ...briefing, context: signalContext },
  });
  generated = {
    questions: [
      {
        id: "signal",
        answerMarkdown: "I mentored engineers.",
        talkingPoints: ["a", "b", "c"],
        citations: [
          {
            field: "answerMarkdown",
            text: "mentored engineers",
            sourceKind: "candidate",
            pointer: "/leadership_signals/0/evidence/0",
            quote: "Mentored engineers",
          },
        ],
        gaps: [],
      },
    ],
  };
  const response = await request(
    "/api/interview/briefing/artifacts/signals/proposals",
    "POST",
    {
      expectedRevision: 0,
      context: signalContext,
      questions: [
        {
          id: "signal",
          question: "How do you mentor?",
          category: "leadership",
        },
      ],
    },
  );
  expect(response.status).toBe(201);
});

it("denies profile and derived pack reads after profile revocation", async () => {
  await request("/api/interview/briefing/profiles", "POST", {
    name: "Revoked",
    profileId: "revoked",
    matrix,
  });
  const revokedContext = {
    ...context,
    profile: { id: "revoked", revision: 1 },
  };
  await request("/api/interview/briefing/artifacts/revoked", "PUT", {
    expectedRevision: 0,
    briefing: { ...briefing, context: revokedContext },
  });
  await pg.worker.transaction(async (tx) => {
    await tx.query(
      "SELECT set_config('app.tenant_id','tenant-a',true), set_config('app.actor_id','alice',true), set_config('app.product_id','omnitech.interview',true)",
    );
    await tx.query(
      "UPDATE interview.candidate_profiles SET revoked_at=now() WHERE id='revoked'",
    );
  });
  expect(
    (await request("/api/interview/briefing/profiles/revoked/revisions/1"))
      .status,
  ).toBe(404);
  expect(
    (await request("/api/interview/briefing/artifacts/revoked")).status,
  ).toBe(404);
  expect(
    (await request("/api/interview/briefing/artifacts"))
      .json()
      .then((body) =>
        body.artifacts.some((item: { id: string }) => item.id === "revoked"),
      ),
  ).resolves.toBe(false);
});

it("flags a model answer too long to say in 60 seconds", async () => {
  generated = {
    questions: [
      {
        id: "long",
        answerMarkdown: "word ".repeat(181),
        talkingPoints: ["a", "b", "c"],
        citations: [],
        gaps: ["A personal example is missing"],
      },
    ],
  };
  await request("/api/interview/briefing/artifacts/long", "PUT", {
    expectedRevision: 0,
    briefing,
  });
  const response = await request(
    "/api/interview/briefing/artifacts/long/proposals",
    "POST",
    {
      expectedRevision: 0,
      context,
      questions: [
        {
          id: "long",
          question: "Tell me about yourself",
          category: "background",
        },
      ],
    },
  );
  expect(response.status).toBe(201);
  expect((await response.json()).briefing.questions[0].gaps).toEqual([
    "A personal example is missing",
    "This runs past 60 seconds spoken; trim it.",
  ]);
});

it("preserves lower bounds and ranges verbatim in generated numeric claims", async () => {
  for (const [index, sourceValue, shortened] of [
    ["lower", "4M+", "4M"],
    ["range", "90% to 99%", "90%"],
  ] as const) {
    await request("/api/interview/briefing/profiles", "POST", {
      name: index,
      profileId: index,
      matrix: {
        candidate: {},
        roles: [
          {
            company: "Acme",
            title: "Engineer",
            metrics: [{ label: "scale", value: sourceValue }],
          },
        ],
      },
    });
    const metricContext = { ...context, profile: { id: index, revision: 1 } };
    await request(`/api/interview/briefing/artifacts/${index}`, "PUT", {
      expectedRevision: 0,
      briefing: { ...briefing, context: metricContext },
    });
    const generateMetric = async (metric: string) => {
      generated = {
        questions: [
          {
            id: index,
            answerMarkdown: `I supported ${metric} users.`,
            talkingPoints: ["a", "b", "c"],
            citations: [
              {
                field: "answerMarkdown",
                text: `supported ${metric} users`,
                sourceKind: "candidate",
                pointer: "/roles/0/metrics/0/value",
                quote: sourceValue,
              },
            ],
            gaps: [],
          },
        ],
      };
      return request(
        `/api/interview/briefing/artifacts/${index}/proposals`,
        "POST",
        {
          expectedRevision: 0,
          context: metricContext,
          questions: [
            { id: index, question: "What scale?", category: "delivery" },
          ],
        },
      );
    };
    const flagged = await (await generateMetric(shortened)).json();
    expect(flagged.briefing.questions[0].gaps).toContain(
      `Use the figure exactly as your sources state it: “${sourceValue}”.`,
    );
    const verbatim = await (await generateMetric(sourceValue)).json();
    expect(verbatim.briefing.questions[0].gaps).toEqual([]);
  }
});

it("holds the active profile lock through PUT and Save writes", async () => {
  await request("/api/interview/briefing/profiles", "POST", {
    name: "Lock",
    profileId: "lock-profile",
    matrix,
  });
  const lockContext = {
    ...context,
    profile: { id: "lock-profile", revision: 1 },
  };
  const complete = {
    ...briefing,
    context: lockContext,
    questions: [
      {
        id: "lock-q",
        question: "Introduce yourself",
        category: "background",
        answerMarkdown: "I build systems.",
        talkingPoints: ["Systems", "Teams", "Delivery"],
        evidenceRefs: [],
        gaps: [],
      },
    ],
  };
  await request("/api/interview/briefing/artifacts/lock-save", "PUT", {
    expectedRevision: 0,
    briefing: complete,
  });
  for (const [artifactId, path, method, payload, writeSql] of [
    [
      "lock-put",
      "/api/interview/briefing/artifacts/lock-put",
      "PUT",
      { expectedRevision: 0, briefing: complete },
      "INSERT INTO interview.assistant_drafts",
    ],
    [
      "lock-save",
      "/api/interview/briefing/artifacts/lock-save/save",
      "POST",
      { expectedRevision: 0, requestId: "lock-save-id" },
      "INSERT INTO interview.assistant_answer_revisions",
    ],
  ] as const) {
    let signalEntered!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const database: WorkspaceDatabasePort = {
      tenantTransaction: (tenant, fn) =>
        pg.database.tenantTransaction(tenant, (tx) =>
          fn({
            query: async (sql, values) => {
              if (sql.includes(writeSql) && values?.includes(artifactId)) {
                signalEntered();
                await paused;
              }
              return tx.query(sql, values);
            },
          }),
        ),
    };
    const response = app(database).request(`http://localhost${path}`, {
      method,
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    await entered;
    try {
      await expect(
        pg.worker.transaction(async (tx) => {
          await tx.query(
            "SELECT set_config('app.tenant_id','tenant-a',true), set_config('app.actor_id','alice',true), set_config('app.product_id','omnitech.interview',true)",
          );
          return tx.query(
            "SELECT id FROM interview.candidate_profiles WHERE id='lock-profile' FOR UPDATE NOWAIT",
          );
        }),
      ).rejects.toMatchObject({ code: "55P03" });
    } finally {
      release();
    }
    expect((await response).status).toBe(200);
  }
});

it("seeds one private default profile only for an actor with no profiles", async () => {
  let loads = 0;
  const server = app(pg.database, async () => {
    loads++;
    return { name: "My experience matrix", matrix };
  });
  const headers = { "x-actor": "seed-empty" };
  const [first, concurrent] = await Promise.all([
    server.request("http://localhost/api/interview/briefing/profiles", {
      headers,
    }),
    server.request("http://localhost/api/interview/briefing/profiles", {
      headers,
    }),
  ]);
  expect(first.status).toBe(200);
  expect(concurrent.status).toBe(200);
  expect((await first.json()).profiles).toMatchObject([
    {
      id: "local-experience-matrix",
      name: "My experience matrix",
      revision: 1,
    },
  ]);
  expect((await concurrent.json()).profiles).toHaveLength(1);
  expect(
    (
      await (
        await server.request(
          "http://localhost/api/interview/briefing/profiles",
          { headers },
        )
      ).json()
    ).profiles,
  ).toHaveLength(1);
  expect(loads).toBeGreaterThan(0);
  const version = await server.request(
    "http://localhost/api/interview/briefing/profiles/local-experience-matrix/revisions/1",
    { headers },
  );
  expect((await version.json()).matrix).toEqual(matrix);
});

it("leaves an existing scoped profile untouched when a default is offered", async () => {
  let loads = 0;
  const server = app(pg.database, async () => {
    loads++;
    return { name: "Private default", matrix };
  });
  const headers = {
    origin: "http://localhost",
    "content-type": "application/json",
    "x-actor": "seed-existing",
  };
  const imported = await server.request(
    "http://localhost/api/interview/briefing/profiles",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Chosen", profileId: "chosen", matrix }),
    },
  );
  expect(imported.status).toBe(201);
  const listed = await server.request(
    "http://localhost/api/interview/briefing/profiles",
    { headers },
  );
  expect(
    (await listed.json()).profiles.map((item: { id: string }) => item.id),
  ).toEqual(["chosen"]);
  expect(loads).toBe(1);
});

it("adds one revision when the default profile's file changes, and none when it does not", async () => {
  let current: unknown = matrix;
  const server = app(pg.database, async () => ({
    name: "My matrix",
    matrix: current,
  }));
  const headers = { "x-actor": "seed-sync" };
  const revision = async () =>
    (
      (await (
        await server.request(
          "http://localhost/api/interview/briefing/profiles",
          {
            headers,
          },
        )
      ).json()) as { profiles: Array<{ id: string; revision: number }> }
    ).profiles.find((item) => item.id === "local-experience-matrix")?.revision;
  expect(await revision()).toBe(1);
  expect(await revision()).toBe(1);
  current = {
    ...(matrix as object),
    candidate: { name: "Synthetic Candidate", email: "a@example.invalid" },
  };
  expect(await revision()).toBe(2);
  expect(await revision()).toBe(2);
});

it("reports a default-file failure safely without importing invalid data", async () => {
  const server = app(pg.database, async () => {
    throw new Error("PRIVATE FILE CONTENT");
  });
  const headers = { "x-actor": "seed-invalid" };
  const failed = await server.request(
    "http://localhost/api/interview/briefing/profiles",
    { headers },
  );
  expect(failed.status).toBe(503);
  const body = await failed.json();
  expect(body.error.code).toBe("default-profile-unavailable");
  expect(JSON.stringify(body)).not.toContain("PRIVATE FILE CONTENT");
  expect(
    (
      await (
        await request(
          "/api/interview/briefing/profiles",
          "GET",
          undefined,
          "seed-invalid",
        )
      ).json()
    ).profiles,
  ).toEqual([]);
});

it("leaves the import flow available when no local default is configured", async () => {
  const server = app(pg.database, async () => null);
  const response = await server.request(
    "http://localhost/api/interview/briefing/profiles",
    { headers: { "x-actor": "seed-unconfigured" } },
  );
  expect(response.status).toBe(200);
  expect((await response.json()).profiles).toEqual([]);
});

it("rejects a malformed local default without exposing its contents", async () => {
  const server = app(pg.database, async () => ({
    name: "Private default",
    matrix: { secret: "PRIVATE MATRIX CONTENT" },
  }));
  const response = await server.request(
    "http://localhost/api/interview/briefing/profiles",
    { headers: { "x-actor": "seed-malformed" } },
  );
  expect(response.status).toBe(503);
  const result = await response.text();
  expect(result).toContain("default-profile-unavailable");
  expect(result).not.toContain("PRIVATE MATRIX CONTENT");
});

it("accepts the browser host when the framework canonicalizes the request URL", async () => {
  const response = await app().request(
    "http://localhost:3006/api/interview/briefing/profiles",
    {
      method: "POST",
      headers: {
        host: "127.0.0.1:3006",
        origin: "http://127.0.0.1:3006",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Host test", matrix }),
    },
  );
  expect(response.status).toBe(201);
});

it("answers a question asked on the fly, redrafts it in place and caps the pack", async () => {
  const researched = {
    ...context,
    research: "The interviewer joined from ecobee",
    roleIds: ["/roles/0"],
  };
  const created = await request(
    "/api/interview/briefing/artifacts/asked",
    "PUT",
    {
      expectedRevision: 0,
      briefing: { ...briefing, context: researched, expected: [] },
    },
  );
  const start = (await created.json()).origin.artifactRevision;
  generated = {
    questions: [
      {
        id: "ignored",
        answerMarkdown: "I mentored engineers.",
        talkingPoints: ["I mentored engineers", "b", "c"],
        citations: [
          {
            field: "answerMarkdown",
            text: "mentored engineers",
            sourceKind: "candidate",
            pointer: "/roles/0/proof_points/0",
            quote: "Mentored engineers",
          },
        ],
        gaps: [],
      },
    ],
  };
  prompts.length = 0;
  const asked = await request(
    "/api/interview/briefing/artifacts/asked/ask",
    "POST",
    { expectedRevision: start, question: "How do you mentor engineers?" },
  );
  expect(asked.status).toBe(200);
  const record = await asked.json();
  const [answer] = record.value.briefing.questions;
  expect(answer).toMatchObject({
    question: "How do you mentor engineers?",
    category: "leadership",
    gaps: [],
  });
  expect(answer.id).toMatch(/^q-/);
  // The person's research reaches the model as employer material.
  expect(prompts[0]!.prompt).toContain("The interviewer joined from ecobee");

  // A stale revision is refused; a redraft keeps the answer's place and id.
  expect(
    (
      await request("/api/interview/briefing/artifacts/asked/ask", "POST", {
        expectedRevision: start,
        question: "Again?",
      })
    ).status,
  ).toBe(409);
  const redrafted = await request(
    "/api/interview/briefing/artifacts/asked/ask",
    "POST",
    {
      expectedRevision: record.origin.artifactRevision,
      question: answer.question,
      replaceId: answer.id,
    },
  );
  const redraftedRecord = await redrafted.json();
  expect(redraftedRecord.value.briefing.questions).toHaveLength(1);
  expect(redraftedRecord.value.briefing.questions[0].id).toBe(answer.id);

  // A full pack says how to make room.
  const full = {
    ...redraftedRecord.value.briefing,
    questions: Array.from({ length: 20 }, (_, index) => ({
      ...answer,
      id: `q${index}`,
    })),
  };
  const filled = await request(
    "/api/interview/briefing/artifacts/asked",
    "PUT",
    {
      expectedRevision: redraftedRecord.origin.artifactRevision,
      briefing: full,
    },
  );
  const overflow = await request(
    "/api/interview/briefing/artifacts/asked/ask",
    "POST",
    {
      expectedRevision: (await filled.json()).origin.artifactRevision,
      question: "One more?",
    },
  );
  expect(overflow.status).toBe(400);
  expect((await overflow.json()).error).toMatchObject({
    code: "pack-full",
    message: "A pack holds 20 answers. Remove one to ask another.",
  });
});

it("prepares the briefing as grounded cards the person can tick off", async () => {
  const created = await request(
    "/api/interview/briefing/artifacts/prepared",
    "PUT",
    {
      expectedRevision: 0,
      briefing: {
        ...briefing,
        context: { ...context, employerNotes: "Base salary is CAD $150–170K" },
      },
    },
  );
  const start = (await created.json()).origin.artifactRevision;
  const cards = {
    call: { summary: "Should we put you in front of Engineering?" },
    agenda: [
      { minutes: 5, topic: "Introductions" },
      { minutes: 25, topic: "Background and motivation" },
    ],
    positioning: { steps: ["Hands-on technical leader"] },
    fit: { strong: ["TypeScript"], watch: [] },
    teams: [],
    compensation: {
      summary: "Published at CAD $150–170K",
      advice: "Aim for the upper part of the range.",
    },
    stories: [
      {
        title: "Mentoring at Acme",
        shape: "Problem → coaching → outcome",
        covers: ["Leadership"],
        roleId: "/roles/0",
      },
      {
        title: "A role that does not exist",
        shape: "x",
        covers: [],
        roleId: "/roles/9",
      },
    ],
    ask: [
      {
        title: "Ask in this call",
        items: [{ question: "How does team matching work?", why: "Fit." }],
      },
    ],
    watchOuts: [{ kind: "avoid", title: "Don’t bluff", detail: "Be honest." }],
  };
  generated = {
    ...cards,
    citations: [
      {
        text: "Mentoring at Acme",
        sourceKind: "candidate",
        pointer: "/roles/0/proof_points/0",
        quote: "Mentored engineers",
      },
      {
        text: "CAD $150–170K",
        sourceKind: "employer-context",
        pointer: "/context/employerNotes",
        quote: "CAD $150–170K",
      },
      {
        text: "Led a team of 40",
        sourceKind: "candidate",
        pointer: "/roles/0/proof_points/0",
        quote: "Led a team of 40",
      },
    ],
    gaps: [],
  };
  prompts.length = 0;
  const response = await request(
    "/api/interview/briefing/artifacts/prepared/prepare",
    "POST",
    { expectedRevision: start },
  );
  expect(response.status).toBe(200);
  const record = await response.json();
  const prepared = record.value.briefing.prepared;
  expect(prepared.call.summary).toBe(
    "Should we put you in front of Engineering?",
  );
  expect(
    prepared.evidenceRefs.map((ref: { pointer: string }) => ref.pointer),
  ).toEqual(["/roles/0/proof_points/0", "/context/employerNotes"]);
  // Agenda minutes are not claims; an unverified quote becomes a gap; a
  // story from a role the matrix lacks keeps its story but not the role.
  expect(prepared.gaps).toEqual([
    "Could not verify “Led a team of 40” against your sources.",
  ]);
  expect(prepared.stories[0].roleId).toBe("/roles/0");
  expect(prepared.stories[1].roleId).toBeUndefined();
  expect(prompts[0]!.prompt).toContain('"roleId":"/roles/0"');

  // Ticking a question keeps the server's evidence; forged evidence is not
  // accepted from the browser.
  const ticked = await request(
    "/api/interview/briefing/artifacts/prepared",
    "PUT",
    {
      expectedRevision: record.origin.artifactRevision,
      briefing: {
        ...record.value.briefing,
        prepared: {
          ...prepared,
          ask: [
            {
              ...prepared.ask[0],
              items: [{ ...prepared.ask[0].items[0], asked: true }],
            },
          ],
          evidenceRefs: [],
        },
      },
    },
  );
  const tickedPrepared = (await ticked.json()).value.briefing.prepared;
  expect(tickedPrepared.ask[0].items[0].asked).toBe(true);
  expect(tickedPrepared.evidenceRefs).toHaveLength(2);

  // A reply that misses the card shape gets one correction, then fails.
  generated = { ...cards, call: {}, citations: [], gaps: [] };
  const invalid = await request(
    "/api/interview/briefing/artifacts/prepared/prepare",
    "POST",
    { expectedRevision: record.origin.artifactRevision + 1 },
  );
  expect(invalid.status).toBe(503);
  expect((await invalid.json()).error.message).toMatch(
    /did not match the required format, even after one correction: call\.summary/,
  );
});

it("condenses only the long setup fields, keeps the originals and tells the model its budget", async () => {
  const path = "/api/interview/briefing/artifacts/condensed";
  const posting = `POSTING-ORIGINAL ${"Own the platform roadmap. ".repeat(800)}`;
  const research = "RESEARCH-ORIGINAL the interviewer joined from ecobee";
  expect(posting.length).toBeGreaterThanOrEqual(20_000);
  const created = await request(path, "PUT", {
    expectedRevision: 0,
    briefing: { ...briefing, context: { ...context, research } },
  });
  const short = await created.json();
  prompts.length = 0;
  logged.length = 0;

  // [GUARD] Nothing long: the pack comes back as it is, and no model runs.
  const untouched = await request(`${path}/condense`, "POST", {
    expectedRevision: short.origin.artifactRevision,
  });
  expect(untouched.status).toBe(200);
  expect(await untouched.json()).toEqual(short);
  expect(prompts).toEqual([]);
  expect(logged.filter((line) => line.includes("briefing.condensed"))).toEqual(
    [],
  );

  const edited = await (
    await request(path, "PUT", {
      expectedRevision: short.origin.artifactRevision,
      briefing: {
        ...briefing,
        context: { ...context, jobDescription: posting, research },
      },
    })
  ).json();
  const start = edited.origin.artifactRevision;

  // [GUARD] A stale revision is refused before any model runs.
  const stale = await request(`${path}/condense`, "POST", {
    expectedRevision: start - 1,
  });
  expect(stale.status).toBe(409);
  expect((await stale.json()).error.code).toBe("revision-conflict");
  expect(
    (
      await request(`${path}/condense`, "POST", {
        expectedRevision: start,
        x: 1,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request(
        "/api/interview/briefing/artifacts/no-such-pack/condense",
        "POST",
        { expectedRevision: 0 },
      )
    ).status,
  ).toBe(404);
  expect(prompts).toEqual([]);

  // The short field is left alone even when the model returns text for it.
  generated = {
    jobDescription: "  CONDENSED-POSTING owns the platform roadmap  ",
    research: "CONDENSED-RESEARCH",
  };
  const response = await request(`${path}/condense`, "POST", {
    expectedRevision: start,
  });
  expect(response.status).toBe(200);
  const record = await response.json();
  expect(record.origin.artifactRevision).toBe(start + 1);
  expect(record.value.briefing.context).toEqual({
    ...context,
    jobDescription: posting,
    research,
    condensed: {
      jobDescription: "CONDENSED-POSTING owns the platform roadmap",
    },
  });
  expect(prompts).toHaveLength(1);
  expect(prompts[0]!.system).toContain(
    "You condense interview preparation material",
  );
  expect(JSON.parse(prompts[0]!.prompt)).toEqual({
    company: "Acme",
    role: "Engineer",
    stage: "recruiter",
    // A quarter of the original, never under 3,000 characters.
    budget: {
      jobDescription: Math.round(posting.length / 4),
      research: 3_000,
    },
    material: { jobDescription: posting, research: "" },
  });

  // The log line carries sizes only, never the text.
  const lines = logged.filter((line) => line.includes("briefing.condensed"));
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]!)).toMatchObject({
    service: "briefing",
    event: "briefing.condensed",
    artifactId: "condensed",
    jobDescriptionChars: posting.length,
    jobDescriptionCondensed: "CONDENSED-POSTING owns the platform roadmap"
      .length,
    researchChars: 0,
    researchCondensed: 0,
  });
  expect(logged.join("\n")).not.toMatch(/POSTING-ORIGINAL|CONDENSED-POSTING/);

  // The pack's own generation reads the originals, never the condensed copy.
  generated = {
    questions: [
      {
        id: "q",
        answerMarkdown: "I mentored engineers.",
        talkingPoints: ["I mentored engineers", "b", "c"],
        citations: [
          {
            field: "answerMarkdown",
            text: "mentored engineers",
            sourceKind: "candidate",
            pointer: "/roles/0/proof_points/0",
            quote: "Mentored engineers",
          },
        ],
        gaps: [],
      },
    ],
  };
  prompts.length = 0;
  const asked = await request(`${path}/ask`, "POST", {
    expectedRevision: start + 1,
    question: "Tell me about mentoring",
  });
  expect(asked.status).toBe(200);
  expect(prompts[0]!.prompt).not.toContain("CONDENSED-POSTING");
  const askedPrompt = JSON.parse(prompts[0]!.prompt);
  expect(askedPrompt.context).not.toHaveProperty("condensed");
  expect(askedPrompt.context).not.toHaveProperty("jobDescription");
  expect(
    askedPrompt.sources.find(
      (source: { pointer: string }) =>
        source.pointer === "/context/jobDescription",
    ).text,
  ).toBe(posting);
  // The answer did not touch the setup: the condensed copy is still there.
  expect((await asked.json()).value.briefing.context.condensed).toEqual({
    jobDescription: "CONDENSED-POSTING owns the platform roadmap",
  });

  // [GUARD] A result no shorter than its original is not kept, and the copy
  // made before goes with it.
  generated = { jobDescription: `${posting} and more`, research: "" };
  const longer = await (
    await request(`${path}/condense`, "POST", { expectedRevision: start + 2 })
  ).json();
  expect(longer.origin.artifactRevision).toBe(start + 3);
  expect(longer.value.briefing.context).toEqual({
    ...context,
    jobDescription: posting,
    research,
  });

  // A reply that is not the two fields fails safely and changes nothing.
  generated = { jobDescription: "CONDENSED-POSTING" };
  const invalid = await request(`${path}/condense`, "POST", {
    expectedRevision: start + 3,
  });
  expect(invalid.status).toBe(503);
  expect((await (await request(path)).json()).origin.artifactRevision).toBe(
    start + 3,
  );
});

it("names the fields of a request the server does not accept", async () => {
  const response = await request(
    "/api/interview/briefing/artifacts/fields",
    "PUT",
    { expectedRevision: 0, briefing: { ...briefing, unknownField: "secret" } },
  );
  expect(response.status).toBe(400);
  const { error } = await response.json();
  expect(error.code).toBe("invalid-input");
  expect(error.message).toMatch(
    /^The request didn’t match what this server expects: briefing: /,
  );
  expect(error.message).toContain("restart the dev server");
  expect(error.message).not.toContain("secret");
});
