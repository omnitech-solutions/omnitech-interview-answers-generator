import { describe, expect, it } from "vitest";
import { CompanionError } from "../errors";
import { FAKE_CREDENTIAL, fakeStudio } from "./fake-studio";
import {
  createFixtureCompanion,
  replayInputOf,
  replayInto,
  replaySet,
  sourceForRole,
  VirtualClock,
} from "./index";
import type { ReplaySet } from "./replayer";

// A synthetic, content-free-of-real-names script in the shape the Interview
// product's replay sets use: two phases, both roles, one ASR correction.
const SET: ReplaySet = {
  phases: [
    {
      name: "opening",
      segments: [
        {
          eventId: "s1",
          role: "interviewer",
          startMs: 0,
          endMs: 4000,
          text: "Tell me about a recent project.",
        },
        {
          eventId: "s2",
          role: "candidate",
          startMs: 4000,
          endMs: 12_000,
          text: "I built a Node service with PostgreSQL.",
        },
      ],
    },
    {
      name: "follow-up",
      segments: [
        {
          eventId: "s3",
          role: "interviewer",
          startMs: 12_000,
          endMs: 20_000,
          text: "Which framework was that?",
        },
        {
          eventId: "s3b",
          role: "interviewer",
          startMs: 12_000,
          endMs: 20_000,
          text: "Which framework was that, Django?",
          supersedes: "s3",
        },
      ],
    },
  ],
};

async function play(speed: number) {
  const clock = new VirtualClock();
  const studio = fakeStudio();
  const { companion } = createFixtureCompanion({
    baseUrl: "https://studio.example.test",
    tenantSlug: "acme",
    credential: FAKE_CREDENTIAL,
    fetch: studio.fetch,
    clock,
  });
  await companion.start();
  const result = await clock.drive(
    replayInto(companion, SET, { speed, clock }),
  );
  const sent = studio.requests
    .filter((request) => request.message.kind === "transcript.final")
    .map((request) => request.message);
  return { result, sent, clock };
}

describe("replayer", () => {
  it("maps interviewer to application audio and candidate to the microphone", () => {
    expect(sourceForRole("interviewer")).toBe("application-audio");
    expect(sourceForRole("candidate")).toBe("microphone");
    expect(replayInputOf(SET.phases[1]?.segments[1] ?? never())).toMatchObject({
      source: "application-audio",
      supersedes: "s3",
    });
    expect(
      "supersedes" in replayInputOf(SET.phases[0]?.segments[0] ?? never()),
    ).toBe(false);
  });

  it("replays at 1x and 4x with the same ids and a quarter of the time", async () => {
    const real = await play(1);
    const fast = await play(4);
    const ids = (run: typeof real) =>
      run.sent.map((message) => [
        message.sourceId,
        message.eventId,
        message.sequence,
      ]);
    expect(real.result.eventIds).toEqual(["s1", "s2", "s3", "s3b"]);
    expect(fast.result.eventIds).toEqual(real.result.eventIds);
    expect(ids(fast)).toEqual(ids(real));
    expect(ids(real)).toEqual([
      ["application-audio", "s1", 0],
      ["microphone", "s2", 0],
      ["application-audio", "s3", 1],
      ["application-audio", "s3b", 2],
    ]);
    expect(real.result.elapsedMs).toBe(20_000);
    expect(fast.result.elapsedMs).toBe(real.result.elapsedMs / 4);
    // Both sources and the correction survive the trip.
    expect(real.sent[3]).toMatchObject({
      content: { source: "application-audio", supersedes: "s3" },
    });
  });

  it("rejects a speed that is not a positive number", async () => {
    const clock = new VirtualClock();
    for (const speed of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        replaySet(SET, { speed, clock }, () => undefined),
      ).rejects.toBeInstanceOf(CompanionError);
    }
  });

  it("emits in recording order even when a segment ends before its predecessor", async () => {
    const clock = new VirtualClock();
    const seen: string[] = [];
    const result = await clock.drive(
      replaySet(
        {
          phases: [
            {
              name: "p",
              segments: [
                {
                  eventId: "a",
                  role: "candidate",
                  startMs: 0,
                  endMs: 5000,
                  text: "t",
                },
                {
                  eventId: "b",
                  role: "candidate",
                  startMs: 0,
                  endMs: 1000,
                  text: "t",
                },
              ],
            },
          ],
        },
        { clock },
        (input) => {
          seen.push(input.eventId);
        },
      ),
    );
    expect(seen).toEqual(["a", "b"]);
    expect(result.elapsedMs).toBe(5000);
  });
});

describe("virtual clock", () => {
  it("advances time and fires timers in order", async () => {
    const clock = new VirtualClock(1000);
    const fired: number[] = [];
    void clock.sleep(30).then(() => fired.push(30));
    void clock.sleep(10).then(() => fired.push(10));
    await clock.advance(20);
    expect(fired).toEqual([10]);
    expect(clock.now()).toBe(1020);
    await clock.advance(20);
    expect(fired).toEqual([10, 30]);
    expect(clock.elapsedMs).toBe(40);
  });

  it("drive returns the value, rethrows errors and reports a deadlock", async () => {
    const clock = new VirtualClock();
    expect(await clock.drive(clock.sleep(50).then(() => "done"))).toBe("done");
    await expect(
      clock.drive(clock.sleep(5).then(() => Promise.reject(new Error("boom")))),
    ).rejects.toThrow("boom");
    await expect(
      clock.drive(new Promise(() => undefined)),
    ).rejects.toMatchObject({ code: "clock_deadlock" });
  });
});

function never(): never {
  throw new Error("fixture segment missing");
}
