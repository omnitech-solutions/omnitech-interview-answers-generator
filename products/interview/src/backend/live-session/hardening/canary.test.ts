// Hardening case 8 (PB-0002 slice 3): the no-content logging canary over the
// WHOLE path, including the fixture companion. One unique string is planted
// as spoken text, as a screenshot window label, in a refused message, and in a
// failing model's error. It travels companion -> real routes -> real processor
// -> purge. Everything the process could emit (console, stdout/stderr, traces,
// the companion's visible state, every server answer and the tombstone) is
// then searched for it, and a POSITIVE CONTROL proves the same search catches a
// deliberate leak on each sink.
import { randomUUID } from "node:crypto";
import * as fixture from "@omnitech/capture-companion/fixture";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { QUESTION } from "../coding-fixture";
import { PNG_BYTES } from "../live-session-fixture";
import {
  buildProcessor,
  type CollectedTrace,
  collectTraces,
  createFakeGateway,
  settle,
} from "../processor-fixture";
import { ActiveSessionRepository } from "../repository";
import { purgeSession } from "../session-purge";
import { RECRUITER_SCREEN } from "../session-replay-fixtures";
import { startWorld, type World } from "./world";

let world: World<typeof fixture>;
beforeAll(async () => {
  world = await startWorld(fixture);
}, 120_000);
afterEach(() => vi.restoreAllMocks());
afterAll(() => world?.stop());

// Every sink the process (and the companion) could emit through.
function watch() {
  const emitted: string[] = [];
  const write = (chunk: unknown) => {
    emitted.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  };
  for (const method of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      emitted.push(args.map(String).join(" "));
    });
  vi.spyOn(process.stdout, "write").mockImplementation(write as never);
  vi.spyOn(process.stderr, "write").mockImplementation(write as never);
  const traces: CollectedTrace = collectTraces();
  const answers: string[] = [];
  const companions: unknown[] = [];
  return {
    emitted,
    traces,
    answers,
    companions,
    // Everything searched for the canary.
    everything: () =>
      JSON.stringify({
        emitted,
        traces: traces.events,
        answers,
        companions,
      }),
  };
}

describe("the canary never leaves a store", () => {
  it("is absent from logs, traces, the companion's state, server answers and the tombstone", async () => {
    const CANARY = `canary-${randomUUID()}-secret`;
    const sinks = watch();
    const owner = await world.begin("canary-path", {
      processingPolicy: "permitted-remote",
      // The screen is NOT permitted: the companion's screenshot is refused.
      captureSources: ["microphone", "application-audio"],
    });
    const run = world.companion(owner, {
      sources: ["microphone", "application-audio", "screen"],
      fetch: async (url: string, init: RequestInit) => {
        const response = await world.app.request(url, init);
        sinks.answers.push(
          `${response.status} ${await response.clone().text()}`,
        );
        return response;
      },
    });
    await run.open();

    // Spoken text carrying the canary, through the real routes.
    for (const segment of RECRUITER_SCREEN[0]?.segments ?? []) {
      const last = segment === RECRUITER_SCREEN[0]?.segments.at(-1);
      await run.companion.observeTranscript({
        eventId: segment.eventId,
        source:
          segment.role === "interviewer" ? "application-audio" : "microphone",
        text: last ? `${segment.text} ${CANARY}` : segment.text,
        startMs: segment.startMs,
        endMs: segment.endMs,
      });
    }
    // A changed resend (conflict), a message the companion itself rejects as
    // invalid (far past the text bound) and a screenshot Studio refuses.
    await run.companion.observeTranscript({
      eventId: QUESTION.eventId,
      source: "application-audio",
      text: `original ${CANARY}`,
      startMs: 0,
      endMs: 100,
    });
    await run.companion.observeTranscript({
      eventId: QUESTION.eventId,
      source: "application-audio",
      text: `changed ${CANARY}`,
      startMs: 0,
      endMs: 100,
    });
    await run.companion.observeTranscript({
      eventId: "too-long",
      source: "microphone",
      text: `${CANARY}${"x".repeat(200_000)}`,
      startMs: 0,
      endMs: 100,
    });
    await run.companion.observeScreenshot({
      payload: PNG_BYTES,
      mediaType: "image/png",
      windowLabel: CANARY,
    });
    sinks.companions.push(run.companion.snapshot());
    // The companion shows fixed codes only.
    const codes = run.companion.snapshot().notices.map((n) => n.code);
    expect(codes).toEqual(
      expect.arrayContaining(["event_conflict", "invalid_message"]),
    );

    // Dispatch: the real processor, then a failing gateway on a second path.
    const gateway = createFakeGateway();
    const processor = buildProcessor(world.fx, {
      workerId: "worker-canary-path",
      gateway,
      trace: sinks.traces,
    });
    await settle(processor);
    await processor.close();
    expect(gateway.requests.length).toBeGreaterThan(0);
    // The model call itself carries the question: the plant reached the
    // dispatch, so its absence from the sinks means something.
    expect(JSON.stringify(gateway.requests)).toContain(CANARY);
    // And the owner's own stream holds it: the plant reached storage.
    expect(JSON.stringify(await world.page(owner))).toContain(CANARY);

    const failing = await world.begin("canary-failure");
    const failingRun = world.companion(failing, {
      fetch: async (url: string, init: RequestInit) => {
        const response = await world.app.request(url, init);
        sinks.answers.push(
          `${response.status} ${await response.clone().text()}`,
        );
        return response;
      },
    });
    await failingRun.open();
    for (const segment of RECRUITER_SCREEN[0]?.segments ?? [])
      await failingRun.companion.observeTranscript({
        eventId: segment.eventId,
        source:
          segment.role === "interviewer" ? "application-audio" : "microphone",
        text: `${segment.text} ${CANARY}`,
        startMs: segment.startMs,
        endMs: segment.endMs,
      });
    const failingGateway = createFakeGateway({
      fail: () => new Error(`gateway failed on ${CANARY}`),
    });
    const failingProcessor = buildProcessor(world.fx, {
      workerId: "worker-canary-failing",
      gateway: failingGateway,
      trace: sinks.traces,
      options: { maxAttempts: 2 },
    });
    await settle(failingProcessor, 12);
    await failingProcessor.close();
    const failedActions = await new ActiveSessionRepository(
      world.fx.member,
    ).listActions(failing.scope, failing.id);
    expect(failedActions.map((a) => a.dispatchStatus)).toContain("failed");
    // A failed action keeps no error text.
    expect(JSON.stringify(failedActions)).not.toContain("gateway failed");

    // The owner's reads, the end, the delete and the purge.
    world.as(owner.person);
    // The session detail and current are content-free reads; the stream is
    // the owner's own content and is deliberately not a sink here.
    for (const path of [`/${owner.id}`, "/current"])
      sinks.answers.push(await (await world.get(path)).text());
    for (const [path, body, method] of [
      [
        `/${owner.id}/control`,
        { version: 1, kind: "session.control", action: "end" },
        "POST",
      ],
      [`/${owner.id}`, undefined, "DELETE"],
    ] as const)
      sinks.answers.push(await (await world.send(path, body, method)).text());
    const purged = await purgeSession(
      world.fx.member,
      {
        tenantId: world.fx.tenantA,
        ownerUserId: owner.person.id,
        sessionId: owner.id,
      },
      { trigger: "owner-delete", waitMs: 0, pollMs: 1, sleep: async () => {} },
    );
    sinks.answers.push(JSON.stringify(purged));
    sinks.answers.push(
      String(
        (
          await world.fx.owner.query(
            "SELECT row_to_json(s)::text AS row FROM interview.active_sessions s WHERE id=$1",
            [owner.id],
          )
        ).rows[0].row,
      ),
    );
    // Nothing of it is left in storage either.
    expect(
      (
        await world.fx.owner.query(
          "SELECT count(*)::int AS n FROM platform.artifacts WHERE metadata::text LIKE $1",
          [`%${CANARY}%`],
        )
      ).rows[0].n,
    ).toBe(0);

    // The assertion that matters.
    expect(sinks.traces.events.length).toBeGreaterThan(0);
    expect(sinks.answers.length).toBeGreaterThan(10);
    const everything = sinks.everything();
    expect(everything).not.toContain(CANARY);
    expect(everything).not.toContain("canary-");
    expect(everything).not.toContain(owner.credential);
    expect(everything).not.toContain(failing.credential);
    // Console and stdout/stderr stayed silent on every path, expected or not.
    expect(sinks.emitted).toEqual([]);
  }, 120_000);

  it("catches a deliberate leak on every sink (positive control)", async () => {
    const PLANT = `control-${randomUUID()}`;
    const leaks: Array<[string, (sinks: ReturnType<typeof watch>) => void]> = [
      ["console.log", () => console.log(`spoken: ${PLANT}`)],
      ["console.error", () => console.error(new Error(PLANT))],
      ["stdout", () => process.stdout.write(`${PLANT}\n`)],
      ["stderr", () => process.stderr.write(`${PLANT}\n`)],
      [
        "trace",
        (sinks) =>
          sinks.traces.emit({
            event: "dispatch.published",
            sessionId: "s",
            tenantId: "t",
            fence: 1,
            localityDecision: "none",
            durationMs: 0,
            byteCounts: { input: 0, output: 0 },
            outcome: PLANT,
          }),
      ],
      ["server answer", (sinks) => sinks.answers.push(`200 ${PLANT}`)],
      [
        "companion state",
        (sinks) => sinks.companions.push({ notices: [{ code: PLANT }] }),
      ],
    ];
    for (const [name, leak] of leaks) {
      const sinks = watch();
      expect(sinks.everything(), name).not.toContain(PLANT);
      leak(sinks);
      expect(sinks.everything(), name).toContain(PLANT);
      vi.restoreAllMocks();
    }
  });
});
