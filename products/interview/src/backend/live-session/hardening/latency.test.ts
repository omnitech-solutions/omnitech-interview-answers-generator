// Hardening case 9 (PB-0002 slice 3): question-end-to-first-draft latency with
// the loop-2 synthetic fixtures replayed by the FIXTURE COMPANION through the
// REAL routes into the REAL processor, at 1x and 4x, on one virtual clock.
//   paced       virtual time from the end of the utterance that triggered a
//               draft (the question, or the part-two follow-up that revised
//               it) to the draft: settle window + tick quantisation + the
//               SIMULATED model latency (a constant, below);
//   processing  real wall-clock time the processor spent from that
//               utterance's delivery (companion -> route -> store) to the
//               dispatch finishing; excludes the simulated model.
// What this does NOT measure: the real model's latency. The gateway is a fake
// that answers instantly and a constant stands in for the model, so the real
// question-to-first-draft latency stays UNOBSERVED here; it would be settled
// by one agreed rehearsal against a real provider with the packaged companion.
import * as fixture from "@omnitech/capture-companion/fixture";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INTERVIEW_SESSION_FAST_PROFILE } from "../../../assistant-profile.js";
import {
  buildProcessor,
  createFakeGateway,
  NEVER_ABORTED,
} from "../processor-fixture.js";
import { capturedLines } from "../replay-evidence-fixture.js";
import { expectedPacedDrafts } from "../replay-expected-drafts.js";
import { ALL_REPLAY_SETS } from "../replay-fixture-sets.js";
import type {
  FixtureSegment,
  ReplayPhase,
} from "../session-replay-fixtures.js";
import { startWorld, type World } from "./world.js";

const SETTLE_MS = 1_500;
const TICK_MS = 100;
const SIMULATED_MODEL_MS = 800;
// Ceilings far inside a 30-90 second answer window.
const PACED_BUDGET_MS = 10_000;
// Processing normally takes ~150-200 ms. The failing check is the MEDIAN across
// every question against this ceiling; per-set and tail (p95) processing times
// are logged as information only, because a p95 over one or two samples
// measures CPU contention on a busy machine, not the processor.
const PROCESSING_BUDGET_MS = 4_000;
// After this much virtual quiet nothing is pending, so the replay jumps to the
// next segment instead of ticking an empty processor.
const QUIET_MS = SETTLE_MS + 10 * TICK_MS;

let world: World<typeof fixture>;
beforeAll(async () => {
  world = await startWorld(fixture);
}, 120_000);
afterAll(() => world?.stop());

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

const QUESTION_SETS = Object.entries(ALL_REPLAY_SETS).filter(
  ([, set]) => !("expect" in set) || (set as any).expect.opensTasks > 0,
) as Array<[string, { phases: readonly ReplayPhase[] }]>;

type Call = {
  profileId: string;
  triggerId: string;
  calledAt: number;
  wallDone: number;
  triggerWall: number;
};

async function replayAt(
  speed: number,
  name: string,
  set: { phases: readonly ReplayPhase[] },
) {
  const owner = await world.begin(`lat-${name}-${speed}x`.slice(0, 40));
  const run = world.companion(owner);
  const { clock } = run;
  await run.open();
  const gateway = createFakeGateway();
  const processor = buildProcessor(world.fx, {
    workerId: `worker-latency-${name}-${speed}`,
    gateway,
    clock: { nowMs: () => clock.now() },
    options: { settleMs: SETTLE_MS },
  });
  const origin = clock.now();
  const segments = set.phases.flatMap((phase) => phase.segments);
  const ingestWall = new Map<string, number>();
  const arrivals = new Map<string, number>();
  const calls: Call[] = [];
  let lastIngestAt = origin;

  const trigger = (request: Parameters<typeof capturedLines>[0]) => {
    const last = capturedLines(request).at(-1)?.text ?? "";
    // A coalesced utterance holds several segments' text; the latest wins.
    return segments
      .filter((segment) => segment.text !== "" && last.includes(segment.text))
      .reduce<FixtureSegment | undefined>(
        (latest, segment) =>
          !latest || segment.endMs >= latest.endMs ? segment : latest,
        undefined,
      );
  };
  // One tick of the real processor at the next virtual instant; a dispatch
  // started inside it has its request visible once the tick's work is idle.
  const step = async () => {
    await clock.advance(TICK_MS);
    await processor.tick(NEVER_ABORTED);
    await processor.idle();
    const wallDone = Date.now();
    while (calls.length < gateway.requests.length) {
      const request = gateway.requests[calls.length];
      if (!request) break;
      const segment = trigger(request);
      calls.push({
        profileId: request.profileId ?? "",
        triggerId: segment?.eventId ?? "",
        calledAt: clock.now(),
        wallDone,
        triggerWall: ingestWall.get(segment?.eventId ?? "") ?? wallDone,
      });
    }
  };
  // The replayer waits on THIS clock: waiting is where the processor ticks.
  const pacing = {
    now: () => clock.now(),
    async sleep(ms: number) {
      const target = clock.now() + ms;
      while (clock.now() + TICK_MS <= target) {
        if (clock.now() - lastIngestAt > QUIET_MS) break;
        await step();
      }
      await clock.advance(target - clock.now());
    },
  };
  try {
    // The fixture companion replays the recording at `speed`: each segment is
    // delivered when its utterance ends, through the real ingest route.
    await fixture.replaySet(set, { speed, clock: pacing }, async (input) => {
      await run.companion.observeTranscript(input);
      ingestWall.set(input.eventId, Date.now());
      arrivals.set(input.eventId, clock.now());
      lastIngestAt = clock.now();
    });
    // Let the trailing utterance settle and be answered.
    for (let i = 0; i < QUIET_MS / TICK_MS + 40; i += 1) await step();
    expect(run.companion.pending).toBe(0);
  } finally {
    await processor.close();
    await world.send(`/${owner.id}/control`, {
      version: 1,
      kind: "session.control",
      action: "end",
    });
  }
  const arrivalOf = (eventId: string) => arrivals.get(eventId) ?? origin;
  return { calls, arrivalOf };
}

describe("question end to first draft, replayed by the fixture companion", () => {
  it.each([1, 4])(
    "records p50/p95 at %ix through the real routes and processor",
    async (speed) => {
      const sets: Array<{
        name: string;
        paced: number[];
        processing: number[];
      }> = [];
      for (const [name, set] of QUESTION_SETS) {
        world.as(null);
        const { calls, arrivalOf } = await replayAt(speed, name, set);
        const drafts = calls.filter(
          (call) => call.profileId === INTERVIEW_SESSION_FAST_PROFILE,
        );
        sets.push({
          name,
          paced: drafts.map(
            (call) =>
              call.calledAt + SIMULATED_MODEL_MS - arrivalOf(call.triggerId),
          ),
          processing: drafts.map((call) => call.wallDone - call.triggerWall),
        });
      }
      for (const set of sets)
        process.stdout.write(
          `HARDENING_LATENCY ${JSON.stringify({
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
      process.stdout.write(
        `HARDENING_LATENCY ${JSON.stringify({
          speed,
          scope: "all",
          sets: sets.length,
          questions: paced.length,
          simulatedModelMs: SIMULATED_MODEL_MS,
          paced: summary(paced),
          processing: summary(processing),
          realModel: "unobserved",
        })}\n`,
      );

      expect(sets.map((set) => set.name)).toEqual(
        QUESTION_SETS.map(([name]) => name),
      );
      for (const set of sets) {
        expect(set.paced.length, set.name).toBe(
          expectedPacedDrafts(set.name, speed, "companion"),
        );
        expect(summary(set.paced).p95, set.name).toBeLessThan(PACED_BUDGET_MS);
      }
      expect(summary(paced).p95).toBeLessThan(PACED_BUDGET_MS);
      expect(summary(processing).p50).toBeLessThan(PROCESSING_BUDGET_MS);
    },
    900_000,
  );
});
