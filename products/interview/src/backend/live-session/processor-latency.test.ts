// Latency of the fast interpret-and-answer path over EVERY synthetic replay set
// that has questions (recruiter screen, the grounding-hazard sets, the
// engineering-manager set and the live-coding first draft), at real pacing (1x)
// and at 4x (E-A2). The processor runs for real (ingest, replay, core, fenced
// writes on a disposable PostgreSQL) against a fake gateway; time is a virtual
// clock so each set's own pacing and the settle window are exact without
// waiting minutes. Two figures per question, p50 and p95 over every question
// of a set and over every question of a speed, are recorded:
//   - paced: virtual time from the end of the utterance that triggered the
//     draft (the question, or the part-two follow-up that revised it) to the
//     draft (settle window + tick quantisation + the simulated model latency);
//   - processing: real wall-clock time the processor spent from that
//     utterance's ingest to the dispatch finishing (excludes the simulated
//     model).
// A recruiter question arrives every 1-3 minutes and an answer window is 30-90
// seconds, so the budgets below are ceilings far inside the window.
//
// Coding latency is measured separately: time from the triggering utterance to
// the solve-code result (a second action kind after the prose draft, with its
// own simulated model and test-run time), and the prose draft must precede it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  INTERVIEW_ANSWER_PROFILE,
  INTERVIEW_SESSION_FAST_PROFILE,
} from "../../assistant-profile.js";
import {
  fakeRunner,
  isSolutionRequest,
  RESTATEMENT,
  revisionOf,
  solutionFor,
} from "./coding-fixture.js";
import { type Fixture, startFixture } from "./live-session-fixture.js";
import {
  buildProcessor,
  createFakeGateway,
  NEVER_ABORTED,
  startSessionFor,
} from "./processor-fixture.js";
import { capturedLines } from "./replay-evidence-fixture.js";
import { expectedPacedDrafts } from "./replay-expected-drafts.js";
import { ALL_REPLAY_SETS } from "./replay-fixture-sets.js";
import { LIVE_CODING_EXPECT } from "./replay-fixtures-coding.js";
import { ActiveSessionRepository } from "./repository.js";
import type { FixtureSegment, ReplayPhase } from "./session-replay-fixtures.js";

const SETTLE_MS = 1_500;
const TICK_MS = 100;
const SIMULATED_MODEL_MS = 800;
// The solution call is a larger structured call followed by the sandboxed
// test run.
const SIMULATED_SOLVE_MS = 4_000;
const PACED_BUDGET_MS = 10_000;
const PROCESSING_BUDGET_MS = 2_000;
const CODING_BUDGET_MS = 30_000;
// After this much virtual quiet nothing is pending, so the replay jumps to
// the next segment instead of ticking an empty processor.
const QUIET_MS = SETTLE_MS + 10 * TICK_MS;
// How long after the audio it corrects an ASR re-finalisation arrives.
const CORRECTION_DELAY_MS = 3_000;

let fx: Fixture;
let repo: ActiveSessionRepository;
beforeAll(async () => {
  fx = await startFixture();
  repo = new ActiveSessionRepository(fx.member);
}, 120_000);
afterAll(() => fx.stop());

const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)
    ] ?? 0
  );
};
const summary = (values: number[]) => ({
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
});

// Sets that have questions: the recruiter screen and every set whose fixture
// states that it opens at least one task.
const QUESTION_SETS = Object.entries(ALL_REPLAY_SETS).filter(
  ([, set]) => !("expect" in set) || (set as any).expect.opensTasks > 0,
) as Array<[string, { phases: readonly ReplayPhase[] }]>;

type Call = {
  profileId: string;
  revision: number;
  // The utterance whose arrival triggered this call.
  triggerId: string;
  calledAt: number;
  wallDone: number;
  triggerWall: number;
};

// Replays one set at one speed on a virtual clock and returns the calls the
// processor made, each with the arrival time of its triggering utterance.
async function replayAt(
  speed: number,
  name: string,
  phases: readonly ReplayPhase[],
  gateway = createFakeGateway(),
  codeRunner?: ReturnType<typeof fakeRunner>["runner"],
) {
  const started = await startSessionFor(
    fx,
    repo,
    fx.tenantA,
    `latency-${name}-${speed}x`.slice(0, 40),
  );
  let virtualNow = Date.now();
  const processor = buildProcessor(fx, {
    workerId: `worker-latency-${name}-${speed}`,
    gateway,
    ...(codeRunner ? { codeRunner } : {}),
    clock: { nowMs: () => virtualNow },
    options: { settleMs: SETTLE_MS },
  });
  const origin = virtualNow;
  const segments = phases.flatMap((phase) => phase.segments);
  // Per event id: wall time of its ingest and virtual time of its arrival.
  const ingestWall = new Map<string, number>();
  const arrivals = new Map<string, number>();
  const calls: Call[] = [];
  const trigger = (request: Parameters<typeof capturedLines>[0]) => {
    const last = capturedLines(request).at(-1)?.text ?? "";
    // A coalesced utterance holds several segments' text; the latest wins.
    const matches = segments.filter(
      (segment) => segment.text !== "" && last.includes(segment.text),
    );
    return matches.reduce<FixtureSegment | undefined>(
      (latest, segment) =>
        !latest || segment.endMs >= latest.endMs ? segment : latest,
      undefined,
    );
  };
  // A dispatch starts inside a tick and its request is visible once the
  // tick's work is idle.
  const step = async () => {
    virtualNow += TICK_MS;
    await processor.tick(NEVER_ABORTED);
    await processor.idle();
    const wallDone = Date.now();
    while (calls.length < gateway.requests.length) {
      const request = gateway.requests[calls.length];
      if (!request) break;
      const segment = trigger(request);
      calls.push({
        profileId: request.profileId ?? "",
        revision: revisionOf(request),
        triggerId: segment?.eventId ?? "",
        calledAt: virtualNow,
        wallDone,
        triggerWall: ingestWall.get(segment?.eventId ?? "") ?? wallDone,
      });
    }
  };
  let actions: Awaited<ReturnType<typeof repo.listActions>> = [];
  try {
    let lastIngestAt = virtualNow;
    for (const segment of segments) {
      // A segment arrives when its audio ends. An ASR correction re-finalises
      // earlier audio, so it arrives a little after the segment it replaces
      // (a gap of CORRECTION_DELAY_MS of recorded time), not at the same
      // instant.
      const arrival = Math.max(
        origin + segment.endMs / speed,
        segment.supersedes === undefined
          ? 0
          : lastIngestAt + CORRECTION_DELAY_MS / speed,
      );
      while (virtualNow + TICK_MS <= arrival) {
        if (virtualNow - lastIngestAt > QUIET_MS) break;
        await step();
      }
      virtualNow = Math.max(virtualNow, arrival);
      await started.ingestor.ingest(segment);
      ingestWall.set(segment.eventId, Date.now());
      arrivals.set(segment.eventId, virtualNow);
      lastIngestAt = virtualNow;
    }
    // Let the trailing utterance settle and be answered.
    for (let i = 0; i < QUIET_MS / TICK_MS + 40; i += 1) await step();
    actions = await repo.listActions(started.scope, started.sessionId);
  } finally {
    await processor.close();
    await repo.controlSession(started.scope, started.sessionId, "end");
  }
  const arrivalOf = (eventId: string) => arrivals.get(eventId) ?? origin;
  return { calls, arrivalOf, origin, actions };
}

type Measured = {
  name: string;
  paced: number[];
  processing: number[];
  // Succeeded prose drafts as (task, revision) pairs, one per stored action.
  drafts: string[];
};

async function measureSet(
  speed: number,
  name: string,
  phases: readonly ReplayPhase[],
): Promise<Measured> {
  const { calls, arrivalOf, actions } = await replayAt(speed, name, phases);
  const drafts = calls.filter(
    (call) => call.profileId === INTERVIEW_SESSION_FAST_PROFILE,
  );
  return {
    name,
    paced: drafts.map(
      (call) => call.calledAt + SIMULATED_MODEL_MS - arrivalOf(call.triggerId),
    ),
    processing: drafts.map((call) => call.wallDone - call.triggerWall),
    drafts: actions
      .filter(
        (action) =>
          action.actionKind === "draft-answer" &&
          action.dispatchStatus === "succeeded",
      )
      .map((action) => `${action.taskId}@r${action.taskRevision}`),
  };
}

describe("question end to first draft, every set with questions", () => {
  it.each([1, 4])(
    "records p50/p95 at %ix pacing inside the answer window",
    async (speed) => {
      const sets: Measured[] = [];
      for (const [name, set] of QUESTION_SETS)
        sets.push(await measureSet(speed, name, set.phases));

      // Recorded for the dev-loop report (ids and numbers only).
      for (const set of sets)
        process.stdout.write(
          `LATENCY ${JSON.stringify({
            speed,
            scope: "set",
            set: set.name,
            questions: set.paced.length,
            paced: summary(set.paced),
            processing: summary(set.processing),
          })}\n`,
        );
      const paced = sets.flatMap((set) => set.paced);
      const processing = sets.flatMap((set) => set.processing);
      const overall = {
        speed,
        scope: "all",
        sets: sets.length,
        questions: paced.length,
        paced: summary(paced),
        processing: summary(processing),
      };
      process.stdout.write(`LATENCY ${JSON.stringify(overall)}\n`);

      // Every set with questions produced drafts, and every set stays inside
      // the budgets at its own p95.
      expect(sets.map((set) => set.name)).toEqual(
        QUESTION_SETS.map(([name]) => name),
      );
      for (const set of sets) {
        expect(set.paced.length, set.name).toBe(
          expectedPacedDrafts(set.name, speed),
        );
        expect(new Set(set.drafts).size, set.name).toBe(set.drafts.length);
        expect(set.drafts.length, set.name).toBe(set.paced.length);
        expect(summary(set.paced).p95, set.name).toBeLessThan(PACED_BUDGET_MS);
        expect(summary(set.processing).p95, set.name).toBeLessThan(
          PROCESSING_BUDGET_MS,
        );
      }
      expect(overall.paced.p95).toBeLessThan(PACED_BUDGET_MS);
      expect(overall.processing.p95).toBeLessThan(PROCESSING_BUDGET_MS);
    },
    600_000,
  );
});

describe("question end to a published solution (live coding)", () => {
  it.each([1, 4])(
    "records the time to solve-code at %ix and shows the prose draft first",
    async (speed) => {
      const gateway = createFakeGateway({
        result: (request) =>
          isSolutionRequest(request)
            ? solutionFor(request)
            : {
                category: "coding",
                draft: "Restate the problem, then outline the approach.",
                claims: [],
                star: null,
                logistics: null,
                codingBrief: {
                  language: "typescript",
                  restatement: RESTATEMENT,
                  constraints: [
                    ...(LIVE_CODING_EXPECT.revisions[revisionOf(request) - 1]
                      ?.constraints ?? []),
                  ],
                },
              },
      });
      const { runner } = fakeRunner();
      const { calls, arrivalOf } = await replayAt(
        speed,
        "live-coding-solve",
        ALL_REPLAY_SETS["live-coding"]?.phases ?? [],
        gateway,
        runner,
      );
      const prose = calls.filter(
        (call) => call.profileId === INTERVIEW_SESSION_FAST_PROFILE,
      );
      const solves = calls.filter(
        (call) => call.profileId === INTERVIEW_ANSWER_PROFILE,
      );
      expect(solves.length).toBeGreaterThan(0);

      const coding: number[] = [];
      const proseOnly: number[] = [];
      for (const solve of solves) {
        const first = prose.find((call) => call.revision === solve.revision);
        expect(
          first,
          `prose draft for revision ${solve.revision}`,
        ).toBeDefined();
        if (!first) continue;
        const proseReadyAt = first.calledAt + SIMULATED_MODEL_MS;
        // The solution call starts after the prose call, never before it, and
        // finishes after the prose draft was already shown.
        expect(first.calledAt).toBeLessThanOrEqual(solve.calledAt);
        const solveStart = Math.max(solve.calledAt, proseReadyAt);
        const solvedAt = solveStart + SIMULATED_SOLVE_MS;
        expect(proseReadyAt).toBeLessThan(solvedAt);
        const arrival = arrivalOf(solve.triggerId || first.triggerId);
        proseOnly.push(proseReadyAt - arrival);
        coding.push(solvedAt - arrival);
      }
      expect(Math.max(...proseOnly)).toBeLessThan(Math.min(...coding) + 1);
      process.stdout.write(
        `LATENCY_CODING ${JSON.stringify({
          speed,
          revisions: coding.length,
          proseDraft: summary(proseOnly),
          solveCode: summary(coding),
        })}\n`,
      );
      expect(summary(coding).p95).toBeLessThan(CODING_BUDGET_MS);
      expect(summary(proseOnly).p95).toBeLessThan(PACED_BUDGET_MS);
    },
    300_000,
  );
});
