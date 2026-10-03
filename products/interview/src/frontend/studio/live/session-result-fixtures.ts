// Synthetic published results, shaped like what the backend stores
// (assist-stage.ts resultFor, coding-path.ts publish, session-drafts.ts
// workspace outcome). Placeholders only: Example Corp, Candidate.

const ref = (pointer: string, quote: string, revision = 3) => ({
  sourceId: `entry-${pointer.replaceAll("/", "-")}`,
  revision,
  pointer,
  quote,
});

export function answerResult(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    stage: "draft-answer",
    category: "experience-story",
    draft: "I led the migration at Example Corp and kept the service up.",
    sections: [],
    claims: [
      {
        kind: "matrix-backed",
        text: "I led a migration at Example Corp.",
        refs: [ref("/roles/1/summary", "Led a database migration.")],
      },
      {
        kind: "suggested-interpretation",
        text: "Framing it as risk reduction fits the question.",
        refs: [],
      },
      {
        kind: "general-knowledge",
        text: "Blue-green releases keep the old version warm.",
        refs: [],
      },
    ],
    star: null,
    logistics: null,
    codingBrief: null,
    pinned: { profileId: "profile-1", revision: 3 },
    contextRevisions: { profile: 3, draft: null },
    meta: { profileId: "fast", processingPolicy: "device-only" },
    ...overrides,
  };
}

export function codingAnswer(
  constraints: string[],
  restatement = "Implement a rate limiter for a Node service.",
): Record<string, unknown> {
  return answerResult({
    category: "coding",
    draft: "A small rate limiter with a configurable window.",
    claims: [],
    codingBrief: { language: "typescript", restatement, constraints },
  });
}

export function codeResult(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    stage: "solve-code",
    language: "typescript",
    code: "export const allow = () => true;",
    usageCode: "",
    testCode: "it('allows', () => {});",
    coverage: [],
    escalation: "none",
    notes: "A sliding window per client.",
    states: {
      generated: true,
      testsPassed: true,
      fullyVerified: false,
      reasons: ["constraint_uncovered"],
    },
    tests: {
      total: 5,
      passed: 5,
      failed: 0,
      skipped: 0,
      results: [{ name: "allows", status: "passed" }],
    },
    run: { available: true, exitCode: 0, timedOut: false, durationMs: 840 },
    syntax: { checked: true, clean: true },
    repair: { attempted: false, succeeded: false },
    agent: { jobRequested: false, reason: "not_requested" },
    replacesRevision: null,
    workspace: {
      published: true,
      workspaceId: "active-session:0b1f6a52-7c7e-4f0e-9e1b-2c3d4e5f6a7b",
      artifactId: "coding:task-1",
      artifactRevision: 2,
    },
    ...overrides,
  };
}

export const starResult = (): Record<string, unknown> =>
  answerResult({
    category: "leadership-behavioural",
    claims: [
      {
        kind: "matrix-backed",
        text: "Mentored two junior developers.",
        refs: [ref("/roles/0/summary", "Mentored two juniors.")],
      },
      {
        kind: "matrix-backed",
        text: "Both were promoted within a year.",
        refs: [ref("/roles/0/metrics/0/value", "Two promotions.")],
      },
    ],
    star: {
      situation: { text: "Two new juniors joined.", claimIndexes: [0] },
      task: { text: "", claimIndexes: [] },
      action: { text: "I paired with them weekly.", claimIndexes: [0, 9] },
      result: { text: "Both were promoted.", claimIndexes: [1] },
      missing: ["task"],
    },
  });

export const logisticsResult = (): Record<string, unknown> =>
  answerResult({
    category: "logistics",
    claims: [
      {
        kind: "preference-backed",
        text: "My notice period is one month.",
        refs: [ref("/context/notice/0", "Notice period: one month.")],
      },
    ],
    logistics: {
      found: [{ field: "notice-period", claimIndex: 0 }],
      missing: ["compensation"],
    },
  });
