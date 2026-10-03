// Latency of the fast interpret-and-answer path over the synthetic
// recruiter-screen script, at real pacing and at 4x (E-A2). The processor runs
// for real (ingest, replay, core, fenced writes on a disposable PostgreSQL)
// against a fake gateway; time is a virtual clock so the script's own pacing
// and the settle window are exact without waiting minutes. Two figures per
// question, p50 and p95 over the questions of the script, are recorded:
//   - paced: virtual time from the question's last segment end to the draft
//     (settle window + tick quantisation + the simulated model latency);
//   - processing: real wall-clock time the processor spent from the question's
//     last ingest to the dispatch finishing (excludes the simulated model).
// A recruiter question arrives every 1-3 minutes and an answer window is 30-90
// seconds, so the budget below is a ceiling far inside the window.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Fixture, startFixture } from "./live-session-fixture.js";
import {
  buildProcessor,
  createFakeGateway,
  NEVER_ABORTED,
  startSessionFor,
} from "./processor-fixture.js";
import { ActiveSessionRepository } from "./repository.js";
import { RECRUITER_SCREEN } from "./session-replay-fixtures.js";

const SETTLE_MS = 1_500;
const TICK_MS = 100;
const SIMULATED_MODEL_MS = 800;
const PACED_BUDGET_MS = 10_000;
const PROCESSING_BUDGET_MS = 2_000;

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

async function replayAt(speed: number) {
  const started = await startSessionFor(
    fx,
    repo,
    fx.tenantA,
    `latency-${speed}x`,
  );
  const gateway = createFakeGateway();
  let virtualNow = Date.now();
  const processor = buildProcessor(fx, {
    workerId: `worker-latency-${speed}`,
    gateway,
    clock: { nowMs: () => virtualNow },
    options: { settleMs: SETTLE_MS },
  });
  const origin = virtualNow;
  const paced: number[] = [];
  const processing: number[] = [];
  // Virtual time at which each gateway call was first seen; a dispatch starts
  // inside a tick and its request is visible once the tick's work is idle.
  const calledAt: number[] = [];
  const step = async () => {
    virtualNow += TICK_MS;
    await processor.tick(NEVER_ABORTED);
    await processor.idle();
    while (calledAt.length < gateway.requests.length) calledAt.push(virtualNow);
  };
  try {
    for (const phase of RECRUITER_SCREEN) {
      let lastIngestWall = 0;
      let lastArrival = origin;
      for (const segment of phase.segments) {
        // Advance the virtual clock to this segment's paced arrival, ticking.
        const arrival = origin + segment.endMs / speed;
        while (virtualNow + TICK_MS <= arrival) await step();
        virtualNow = Math.max(virtualNow, arrival);
        await started.ingestor.ingest(segment);
        lastIngestWall = Date.now();
        lastArrival = arrival;
      }
      // Tick on until a draft is requested for something this phase ended.
      const seen = calledAt.length;
      let wallDone = 0;
      for (let i = 0; i < 200 && calledAt.length === seen; i += 1) {
        await step();
        wallDone = Date.now();
      }
      const call = calledAt[seen];
      if (call !== undefined) {
        paced.push(call + SIMULATED_MODEL_MS - lastArrival);
        processing.push(wallDone - lastIngestWall);
      }
    }
  } finally {
    await processor.close();
    await repo.controlSession(started.scope, started.sessionId, "end");
  }
  return {
    speed,
    questions: paced.length,
    paced: { p50: percentile(paced, 0.5), p95: percentile(paced, 0.95) },
    processing: {
      p50: percentile(processing, 0.5),
      p95: percentile(processing, 0.95),
    },
  };
}

describe("question end to first draft", () => {
  it.each([1, 4])(
    "records p50/p95 at %ix pacing inside the answer window",
    async (speed) => {
      const result = await replayAt(speed);
      // Recorded for the dev-loop report (ids and numbers only).
      process.stdout.write(`LATENCY ${JSON.stringify(result)}\n`);
      expect(result.questions).toBe(RECRUITER_SCREEN.length);
      expect(result.paced.p95).toBeLessThan(PACED_BUDGET_MS);
      expect(result.processing.p95).toBeLessThan(PROCESSING_BUDGET_MS);
    },
    120_000,
  );
});
