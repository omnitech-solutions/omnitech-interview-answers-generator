// Test support for the coding path suites: a scripted fake gateway that answers
// the prose call with a coding draft and the solution call with a closed
// solution, a fake runner that reports the tests the code declares, and the
// synthetic spoken lines of a live-coding exchange (Interviewer and Candidate
// placeholders only). Tests, not production code, import this.
import type { AiExecutionRequest } from "@omnitech/ai-contracts";
import type { RunResult } from "@omnitech/interview-contracts";
import { vi } from "vitest";
import { createFakeGateway } from "./processor-fixture.js";
import { seg } from "./session-replay-fixtures.js";
import type { SessionCodeRunner } from "./session-run.js";

export const RESTATEMENT = "Implement a rate limiter for a Node service.";
const CONSTRAINTS_BY_REVISION: Record<number, string[]> = {
  1: ["a fixed number of requests per client in a sliding window"],
  2: [
    "a fixed number of requests per client in a sliding window",
    "a small burst above the limit is allowed",
  ],
  3: [
    "a token bucket with a refill rate replaces the sliding window",
    "a small burst above the limit is allowed",
  ],
};
export const revisionOf = (request: AiExecutionRequest) =>
  Number(/^REVISION: (\d+)$/m.exec(request.task.prompt)?.[1]);
const briefOf = (request: AiExecutionRequest) => {
  const lines = request.task.prompt.split("\n");
  const at = lines.findIndex((line) => line.startsWith("BEGIN TASK BRIEF"));
  return JSON.parse(lines[at + 1] ?? "{}") as { constraints: string[] };
};
export const isSolutionRequest = (request: AiExecutionRequest) =>
  request.task.prompt.startsWith("TASK: solve_code");
export const codingDraft = (request: AiExecutionRequest) => ({
  category: "coding",
  draft: "Restate the problem, then outline the approach.",
  claims: [],
  star: null,
  logistics: null,
  codingBrief: {
    language: "typescript",
    restatement: RESTATEMENT,
    constraints: CONSTRAINTS_BY_REVISION[revisionOf(request)] ?? [],
  },
});
export const solutionFor = (
  request: AiExecutionRequest,
  overrides: Record<string, unknown> = {},
) => {
  const constraints = briefOf(request).constraints;
  const revision = revisionOf(request);
  return {
    language: "typescript",
    code: `export const allow = () => ${revision}; // CODE-CANARY-${revision}`,
    testCode: constraints.map((_, i) => `it("t${i}", () => {});`).join("\n"),
    coverage: constraints.map((_, constraintIndex) => ({
      constraintIndex,
      testName: `t${constraintIndex}`,
    })),
    escalation: "none",
    notes: "A map of timestamps per client.",
    ...overrides,
  };
};
export const scriptedGateway = (
  options: {
    solution?: (request: AiExecutionRequest, call: number) => unknown;
  } = {},
) => {
  let solutionCalls = 0;
  return createFakeGateway({
    result: (request) => {
      if (!isSolutionRequest(request)) return codingDraft(request);
      solutionCalls += 1;
      return options.solution?.(request, solutionCalls) ?? solutionFor(request);
    },
  });
};

export const runResult = (overrides: Partial<RunResult> = {}): RunResult => ({
  stdout: "",
  stderr: "",
  exitCode: 0,
  durationMs: 12,
  timedOut: false,
  ...overrides,
});
// Reports every test the code declares as passed, unless told otherwise.
export const passingTests = (code: string) =>
  [...code.matchAll(/it\("(t\d+)"/g)].map((match) => ({
    name: String(match[1]),
    status: "passed" as const,
  }));
export const fakeRunner = (
  script?: (
    call: number,
    input: Parameters<SessionCodeRunner["runAll"]>[0],
  ) => RunResult,
  syntax: "clean" | "none" = "clean",
) => {
  let calls = 0;
  const runAll = vi.fn(
    async (input: Parameters<SessionCodeRunner["runAll"]>[0]) => {
      calls += 1;
      return (
        script?.(calls, input) ??
        runResult({ tests: passingTests(input.testCode) })
      );
    },
  );
  const checkSyntax = vi.fn(async () => runResult());
  const runner: SessionCodeRunner =
    syntax === "clean" ? { runAll, checkSyntax } : { runAll };
  return { runner, runAll, checkSyntax };
};

export const QUESTION = seg(
  "q1",
  "interviewer",
  0,
  "Can you implement a rate limiter in TypeScript for a Node service that allows a fixed number of requests per client in a sliding window?",
);
export const BURSTS = seg(
  "q2",
  "interviewer",
  20_000,
  "Now handle bursts, so allow a small burst above the limit for a client.",
);
export const BUCKET = seg(
  "q3",
  "interviewer",
  40_000,
  "Instead, make it a token bucket with a refill rate.",
);
// The candidate's narration between interviewer lines keeps them separate
// utterances (adjacent same-source segments coalesce); it carries no
// constraint cue, so only the interviewer's lines revise the task.
export const NARRATE_1 = seg(
  "c1",
  "candidate",
  8_000,
  "I will keep a map from client id to a list of timestamps.",
);
export const NARRATE_2 = seg(
  "c2",
  "candidate",
  28_000,
  "That means a bucket per client and a clock passed in as a parameter.",
);
