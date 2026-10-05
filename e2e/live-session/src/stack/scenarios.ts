// The scripted model: what each named scenario answers at each stage. A
// scenario is chosen by NAME through the control API, never by reading the
// screenshot, so every run is deterministic. The outputs are VALID against the
// stage schemas (assist-stage.ts, coding-stage.ts); the withheld-* scenarios are
// valid in shape and are stopped by the grounding guards (claims.ts), which is
// the behaviour they exist to prove.
export const SCENARIO_NAMES = [
  "plain-answer",
  "coding-answer",
  // A coding answer whose generated test fails (and fails again after the one
  // repair attempt): the real runner reports it and the drawer shows its message.
  "coding-failing-tests",
  // A coding answer with a syntax error: the real syntax check reports it.
  "coding-syntax-error",
  "missing-context",
  "no-question",
  "withheld-preference",
  "withheld-figure",
  "refusal",
  "provider-failure",
  "timeout",
] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];

// The draft sentences tests look for on screen. One place, so a spec never
// hard-codes copy the harness can change.
export const SCRIPTED = {
  plain: "Restate the question aloud, then ask which constraints apply.",
  coding: "Restate the problem, then outline the approach.",
  // D36: a category-level sentence, never screen content.
  noQuestion: "The screen shows a code editor with no question.",
  codingBriefRestatement: "Implement a sliding window rate limiter.",
  preferenceOnly: "I can start in three weeks if the team needs me.",
  ungroundedFigure: "I increased throughput by 47 percent last year.",
  missingNotes: {
    constraints: "Input size limits are not visible",
    examples: "The second example is cut off",
  },
  solutionNote: "A map of timestamps per client.",
  // The generated test names, as the real runner reports them.
  testName: "accepts a request inside the limit",
  failingTestName: "refuses a request over the limit",
  // What the failing generated test makes the runner report (bounded text).
  failureMessage: "expected false to be true",
} as const;

// A later revision's draft says which revision it is, so a spec can tell the
// revisions apart on screen (revision 1 keeps the plain sentence).
export const draftFor = (base: string, revision: number): string =>
  revision > 1 ? `${base} Revision ${revision}.` : base;

export type Failure = "provider" | "timeout" | "policy-refused";

export type Scenario = {
  name: ScenarioName;
  // Optional pause before the answer, to keep a run in flight.
  delayMs?: number;
  // Holds every run at the gate until released (or cancelled).
  hold?: boolean;
};

export type Stage = "assist" | "solve";

export type Scripted =
  | { kind: "answer"; output: Record<string, unknown> }
  | { kind: "failure"; failure: Failure };

const assist = (
  draft: string,
  extra: Record<string, unknown> = {},
  category = "other",
  revision = 1,
) => ({
  category,
  // A no-question note is a category-level sentence; it never changes.
  draft: category === "no-question" ? draft : draftFor(draft, revision),
  claims: [],
  star: null,
  logistics: null,
  codingBrief: null,
  ...extra,
});

const CODING_BRIEF = {
  language: "typescript",
  restatement: SCRIPTED.codingBriefRestatement,
  constraints: ["a fixed number of requests per client in a sliding window"],
};

type SolutionVariant = "passing" | "failing-tests" | "syntax-error";

// The solution and its tests are joined into one vitest file by the runner, so
// the test code imports vitest itself. The test names the one constraint: a
// clean run is then "fully verified" by the server's own rule. The code carries
// its revision so two revisions can be told apart on screen.
const solution = (revision: number, variant: SolutionVariant) => {
  const failing = variant === "failing-tests";
  const testName = failing ? SCRIPTED.failingTestName : SCRIPTED.testName;
  const code =
    variant === "syntax-error"
      ? `export const allow = (n: number => n > 0; // rev ${revision}`
      : `export const allow = (n: number): boolean => n > 0; // rev ${revision}`;
  return {
    language: "typescript",
    code,
    testCode: `import { expect, it } from "vitest";\n\nit("${testName}", () => {\n  expect(allow(${failing ? 0 : 1})).toBe(true);\n});`,
    coverage: [{ constraintIndex: 0, testName }],
    escalation: "none",
    notes: SCRIPTED.solutionNote,
  };
};

const VARIANT: Partial<Record<ScenarioName, SolutionVariant>> = {
  "coding-failing-tests": "failing-tests",
  "coding-syntax-error": "syntax-error",
};

export function script(
  name: ScenarioName,
  stage: Stage,
  revision: number,
): Scripted {
  if (stage === "solve")
    return {
      kind: "answer",
      output: solution(revision, VARIANT[name] ?? "passing"),
    };
  switch (name) {
    case "plain-answer":
      return {
        kind: "answer",
        output: assist(SCRIPTED.plain, {}, "other", revision),
      };
    case "coding-answer":
    case "coding-failing-tests":
    case "coding-syntax-error":
      return {
        kind: "answer",
        output: assist(
          SCRIPTED.coding,
          { codingBrief: CODING_BRIEF },
          "coding",
          revision,
        ),
      };
    case "missing-context":
      return {
        kind: "answer",
        output: assist(SCRIPTED.plain, {
          missingContext: [
            { kind: "constraints", note: SCRIPTED.missingNotes.constraints },
            { kind: "examples", note: SCRIPTED.missingNotes.examples },
          ],
        }),
      };
    case "no-question":
      return {
        kind: "answer",
        output: assist(SCRIPTED.noQuestion, {}, "no-question"),
      };
    case "withheld-preference":
      return { kind: "answer", output: assist(SCRIPTED.preferenceOnly) };
    case "withheld-figure":
      return { kind: "answer", output: assist(SCRIPTED.ungroundedFigure) };
    case "refusal":
      return { kind: "failure", failure: "policy-refused" };
    case "provider-failure":
      return { kind: "failure", failure: "provider" };
    case "timeout":
      return { kind: "failure", failure: "timeout" };
  }
}
