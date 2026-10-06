// Technical provenance for figures (claims.ts TechnicalScope): a coding or
// concept answer is not gated by approved experience, a statement about the
// candidate still is. Regression: a coding follow-up ("what is the time
// complexity?") was withheld for O(n^2) and "up to 1000" although the session
// had no experience matrix.
import { describe, expect, it } from "vitest";
import { createAssistStage } from "./assist-stage";
import { nonGeneralFigures, type TechnicalScope } from "./claims";
import { buildContextSnapshot } from "./context-snapshot";
import { planAssist } from "./service";

const stage = createAssistStage();
const snapshot = buildContextSnapshot({ matrix: null, profile: null });
const EXERCISE = [
  "Find the longest palindromic substring of s.",
  "1 <= s.length <= 1000",
  "Example: s = babad returns bab",
];

const BRIEF = {
  language: "typescript",
  restatement: "Longest palindromic substring",
  constraints: ["1 <= s.length <= 1000"],
};

const answer = (overrides: {
  category?: string;
  draft: string;
  claims?: { kind: string; text: string }[];
  codingBrief?: unknown;
}) =>
  JSON.stringify({
    category: overrides.category ?? "coding",
    draft: overrides.draft,
    claims: (overrides.claims ?? []).map((claim) => ({ ...claim, refs: [] })),
    star: null,
    logistics: null,
    codingBrief:
      overrides.codingBrief ??
      ((overrides.category ?? "coding") === "coding" ? BRIEF : null),
  });
const validate = (
  raw: string,
  extra: { exercise?: string[]; captured?: string[] } = {},
) =>
  stage.validate(raw, {
    snapshot,
    screenBased: true,
    captured: extra.captured ?? ["What is the time complexity?"],
    ...(extra.exercise ? { exercise: extra.exercise } : {}),
  });

describe("technical answers without an experience matrix", () => {
  it("publishes a complexity answer", () => {
    const result = validate(
      answer({
        draft:
          "Expanding around each of the 2n-1 centres is O(n^2) time and O(1) space; Manacher brings it to O(n), and O(n log n) hashing is slower. n² pairs, 2^n subsets, log₂ n depth.",
        claims: [
          {
            kind: "general-knowledge",
            text: "Center expansion runs in O(n²) time with O(1) extra space, versus 2^n for brute-force subsets.",
          },
        ],
      }),
      { exercise: EXERCISE },
    );
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  });

  it("publishes exercise constraints and examples with provenance", () => {
    const result = validate(
      answer({
        draft:
          "The input length is at most 1000, so O(n^2) is fine. For babad the answer is bab.",
        claims: [
          {
            kind: "general-knowledge",
            text: "With s.length up to 1000, a quadratic scan makes about 1000000 steps.",
          },
        ],
      }),
      { exercise: EXERCISE },
    );
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  });

  it("publishes a screenshot answer whose own brief carries the limit", () => {
    const result = validate(
      answer({
        draft: "Length is at most 4096, so a quadratic scan is fine.",
        claims: [
          {
            kind: "general-knowledge",
            text: "The exercise caps the input at 4096 characters.",
          },
        ],
        codingBrief: { ...BRIEF, constraints: ["s.length <= 4096"] },
      }),
    );
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  });

  it("still withholds a headcount claim about the candidate", () => {
    const result = validate(
      answer({
        category: "technical-concept",
        draft: "I led a team of 12 engineers on this.",
        claims: [
          {
            kind: "general-knowledge",
            text: "I led a team of 12 engineers.",
          },
        ],
      }),
      { exercise: [...EXERCISE, "at most 12 items"] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.violations.join(" ")).toMatch(
        /ungrounded_figure|personal_claim_unsourced/,
      );
  });

  it("still withholds an achievement percentage and an unprovenanced team size", () => {
    for (const text of [
      "I improved latency by 40% last year.",
      "The team of 12 shipped it.",
      "I managed 300 servers.",
    ]) {
      const result = validate(
        answer({
          draft: text,
          claims: [{ kind: "general-knowledge", text }],
        }),
        { exercise: EXERCISE },
      );
      expect(result.ok, text).toBe(false);
    }
  });

  it("still withholds a salary or notice figure", () => {
    for (const category of ["coding", "technical-concept", "logistics"]) {
      const result = validate(
        answer({
          category,
          draft: "My salary expectation is 150000 and my notice is 30 days.",
          claims: [
            {
              kind: "general-knowledge",
              text: "My salary expectation is 150000.",
            },
          ],
        }),
        { exercise: [...EXERCISE, "150000"] },
      );
      expect(result.ok, category).toBe(false);
    }
  });

  it("withholds a plain figure outside a technical category", () => {
    const result = validate(
      answer({
        category: "background",
        draft: "The service handled 5000 requests.",
        claims: [
          { kind: "general-knowledge", text: "It handled 5000 requests." },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("nonGeneralFigures notation", () => {
  const scope: TechnicalScope = { provenance: new Set(), companies: [] };
  it("never counts notation, with or without a scope", () => {
    for (const text of [
      "O(n^2) and Θ(n log n) and Ω(2^n)",
      "n² then 10^5 then 2^20 and log₂ n and 10⁵",
      "n**2 and log2 n",
    ]) {
      expect(nonGeneralFigures(text), text).toEqual([]);
      expect(nonGeneralFigures(text, scope), text).toEqual([]);
    }
  });
  it("keeps the strict default without a scope", () => {
    expect(nonGeneralFigures("up to 1000 items")).toEqual(["1000"]);
    expect(nonGeneralFigures("up to 1000 items", scope)).toEqual([]);
  });
});

describe("a follow-up on an open coding task", () => {
  it("publishes with the exercise carried from the earlier revision, no matrix", async () => {
    const task = {
      taskId: "task-i.r-1",
      taskKey: "r-1",
      revision: 2,
      revisions: [],
    };
    const run = {
      context: { snapshot, matrix: null },
      transcript: { segments: {} },
      ownerInputs: new Map(),
      // The first revision's brief, noted when its draft published.
      coding: new Map([
        ["task-i.r-1:1", { taskId: "task-i.r-1", revision: 1, brief: BRIEF }],
      ]),
    };
    const plan = await planAssist(run as never, task as never, {
      store: {} as never,
      stage,
      deviceOnly: false,
    });
    if (plan.outcome !== "ready") throw new Error("expected a ready plan");
    const raw = answer({
      category: "technical-concept",
      draft: "Quadratic time, constant space; up to 1000 characters is fine.",
      claims: [
        {
          kind: "general-knowledge",
          text: "Expanding around centres is O(n^2) time and O(1) space for s.length up to 1000.",
        },
      ],
    });
    expect(plan.validate(raw)).toMatchObject({ ok: true });
  });
});

// L-1: the availability-wording rule is for the candidate's own availability.
// A scheduling-themed CODING draft ("start time", "cooldown", "can start in 5
// seconds") must not be withheld as preference-only.
describe("availability wording on a coding task", () => {
  const SCHEDULING = [
    "Schedule tasks on workers; a worker waits out a cooldown between tasks.",
    "Each task needs 3 days and a 2 day cooldown follows it.",
  ];
  const draft =
    "Sort the tasks by start time, then keep the workers in a min-heap by the moment each is available again. Each task holds a worker for 3 days plus a 2 day cooldown, so pop the earliest worker and push it back 5 days later.";

  it("publishes a scheduling-themed coding draft", () => {
    const result = validate(answer({ draft }), {
      exercise: SCHEDULING,
      captured: ["Schedule the tasks"],
    });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  });

  it("still withholds the candidate's own availability on a logistics answer", () => {
    const result = validate(
      JSON.stringify({
        category: "logistics",
        draft: "I can start in 5 weeks.",
        claims: [],
        star: null,
        logistics: { topic: "notice-period" },
        codingBrief: null,
      }),
      { exercise: SCHEDULING },
    );
    expect(result.ok).toBe(false);
  });

  it("still withholds a notice period said inside a coding draft", () => {
    const result = validate(
      answer({ draft: `${draft} Also, my notice period is 3 months.` }),
      { exercise: SCHEDULING, captured: ["Schedule the tasks"] },
    );
    expect(result.ok).toBe(false);
  });
});
