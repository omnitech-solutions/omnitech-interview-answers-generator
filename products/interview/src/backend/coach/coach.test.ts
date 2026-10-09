// The live coach against a model the test holds by hand: when it calls, that
// it never waits for the call, what it does when the interviewer goes on
// while a call runs, what it posts while a note is written, what it tells
// whoever watches, and what it does when a call fails. The transcript is the
// real in-memory one; the clock is the test's own. Every line said is invented.
import type { Failure } from "@omnitech/ai-engine";
import {
  type CoachNoteInput,
  type CoachSpeaker,
  type CoachTranscriptSession,
  coachNoteInputSchema,
} from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import { createCoachTranscript } from "../coach-transcript";
import {
  CoachCallError,
  type CoachEvent,
  type CoachOptions,
  type CoachPorts,
  createCoach,
} from "./coach";
import type { CoachContextPort, CoachFact } from "./context";
import { COACH_SYSTEM } from "./prompt";
import { designDiagram } from "./reply";
import { TURN_TIMING } from "./turns";

const T0 = Date.parse("2026-10-08T09:00:00.000Z");
const { finishedMs, pauseMs, trailingMs } = TURN_TIMING;
const QUESTION = "How would you shard the booking table?";
const HOT = "How would you handle one region running hot?";
const ROLLBACK = "And how would you roll that change back?";
const SILENT_REPLY = "NONE";
const NOTE = [
  "KIND: technical",
  "SAME: no",
  "ASK: Sharding the booking table",
  "SAY: I would shard by **region** first.",
].join("\n");

// One scripted call: the text the model streams (each piece after `gapMs` on
// the clock), then how the call ends.
type Scripted = {
  chunks?: readonly string[];
  gapMs?: number;
  end?: "done" | "cancelled" | "nothing" | Failure;
};
// A call the coach made. One the test did not script stays open until the
// test writes to it and ends it by hand.
type Open = {
  profileId: string;
  system: string;
  prompt: string;
  execution: Record<string, unknown>;
  // The coach stopped it (its signal was aborted).
  stopped: boolean;
  text(chunk: string, gapMs?: number): void;
  done(): void;
  fail(failure: Failure): void;
  end(how: NonNullable<Scripted["end"]>): void;
};
type Part =
  | { type: "text"; text: string }
  | { type: "done"; value: null }
  | { type: "cancelled" }
  | { type: "failed"; failure: Failure };

const failure = (retryable: boolean): Failure =>
  ({
    code: retryable ? "unavailable" : "refused",
    reason: "scripted failure",
    retryable,
  }) as Failure;

// A live session the lines were heard in, and the facts of its record.
const SESSION: CoachTranscriptSession = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  actorId: "00000000-0000-4000-8000-000000000002",
  sessionId: "00000000-0000-4000-8000-000000000003",
};
const FACTS: CoachFact[] = [
  {
    pointer: "/roles/0/proof_points/0",
    text: "Cut booking latency 40% by sharding on region",
    about: "candidate",
  },
  {
    pointer: "/context/employerBrief/1",
    text: "Stack: Kafka and Postgres across 9 regions",
    about: "employer",
  },
  {
    pointer: "/context/candidatePreferences/0",
    text: "Notice period: 4 weeks",
    about: "preference",
  },
];

// Lets whatever a call was waiting on run: the coach's call is in the
// background, so a test that writes to it by hand gives it a turn.
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function world(
  options: CoachOptions = {},
  // The session every line is heard in, the port its record is read by, and
  // the plan for the call.
  live: {
    session?: CoachTranscriptSession;
    facts?: (
      session: CoachTranscriptSession,
      query: string,
    ) => Promise<CoachFact[]>;
    plan?: () => Promise<string | undefined>;
    post?: (note: CoachNoteInput) => Promise<void>;
  } = {},
) {
  let clock = T0;
  const transcript = createCoachTranscript();
  const script: Scripted[] = [];
  const calls: Open[] = [];
  const posts: CoachNoteInput[] = [];
  const events: CoachEvent[] = [];
  const reads: number[] = [];
  const asked: { session: CoachTranscriptSession; query: string }[] = [];
  const context: CoachContextPort | undefined = live.facts && {
    facts: async (session, query) => {
      asked.push({ session, query });
      return (live.facts as NonNullable<typeof live.facts>)(session, query);
    },
  };
  const signal = new AbortController().signal;
  const engine = {
    stream(
      input: {
        profileId: string;
        messages: { role: string; parts: { text: string }[] }[];
      },
      execution: Record<string, unknown>,
    ) {
      const queue: { part: Part | null; gapMs: number }[] = [];
      let wake: (() => void) | undefined;
      const push = (part: Part | null, gapMs = 0) => {
        queue.push({ part, gapMs });
        wake?.();
      };
      const open: Open = {
        profileId: input.profileId,
        system: input.messages[0]?.parts[0]?.text ?? "",
        prompt: input.messages[1]?.parts[0]?.text ?? "",
        execution,
        stopped: false,
        text: (chunk, gapMs) => push({ type: "text", text: chunk }, gapMs),
        done: () => push({ type: "done", value: null }),
        fail: (failed) => push({ type: "failed", failure: failed }),
        end(how) {
          if (how === "done") open.done();
          else if (how === "cancelled") push({ type: "cancelled" });
          else if (how === "nothing") push(null);
          else open.fail(how);
        },
      };
      calls.push(open);
      (execution["signal"] as AbortSignal).addEventListener(
        "abort",
        () => {
          open.stopped = true;
          push({ type: "cancelled" });
        },
        { once: true },
      );
      const scripted = script.shift();
      if (scripted) {
        for (const chunk of scripted.chunks ?? [])
          open.text(chunk, scripted.gapMs);
        open.end(scripted.end ?? "done");
      }
      return (async function* () {
        for (;;) {
          while (queue.length === 0)
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          const next = queue.shift() as (typeof queue)[number];
          clock += next.gapMs;
          if (next.part === null) return;
          yield next.part;
          if (next.part.type !== "text") return;
        }
      })();
    },
  };
  const coach = createCoach(
    {
      engine: engine as unknown as CoachPorts["engine"],
      profileId: "test-coach-profile",
      transcript: {
        since: async (after) => {
          reads.push(after);
          return transcript.since(after);
        },
      },
      notes: {
        post: async (note) => {
          await live.post?.(note);
          posts.push(note);
        },
      },
      ...(context ? { context } : {}),
      ...(live.plan ? { plan: live.plan } : {}),
      scope: { tenantId: "tenant-test", actorId: "actor-test" },
      nowMs: () => clock,
      onEvent: (event) => events.push(event),
    },
    options,
  );
  const say = (speaker: CoachSpeaker, text: string, at = clock) =>
    transcript.add(
      [{ speaker, text, at: new Date(at).toISOString() }],
      live.session,
    );
  const tick = () => coach.tick(signal);
  // The coach looks; when it began a call, the call is left to finish and
  // the coach looks again, which is when it takes the call's outcome.
  const act = async () => {
    if (!(await tick())) return false;
    await coach.idle();
    return tick();
  };
  return {
    transcript,
    calls,
    posts,
    events,
    reads,
    asked,
    say,
    tick,
    // The line is said and the coach hears it: the silence after it is
    // counted from this look, as it is from the loop's.
    hear: (speaker: CoachSpeaker, text: string, at?: number) => {
      say(speaker, text, at);
      return tick();
    },
    act,
    flush,
    idle: () => coach.idle(),
    now: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
    // Long enough that what the interviewer says next is another turn, not a
    // sentence added to the one just answered.
    later: () => {
      clock += 30_000;
    },
    reply: (...scripted: Scripted[]) => script.push(...scripted),
    // The line is heard, the speaker pauses, the coach acts and the (scripted)
    // call finishes. False when the coach did not act.
    async heard(speaker: CoachSpeaker, text: string, pause = pauseMs) {
      say(speaker, text);
      // Acted at once (the other side's turn was ended by this line).
      if (await tick()) {
        await coach.idle();
        return tick();
      }
      clock += pause;
      return act();
    },
    // The coach begins a call, which stays open in the test's hand.
    async opens() {
      const before = calls.length;
      expect(await tick()).toBe(true);
      await flush();
      expect(calls).toHaveLength(before + 1);
      return calls.at(-1) as Open;
    },
    key: (from: number) =>
      `coach-${transcript.since().epoch.slice(0, 8)}-${from}`,
    told: () =>
      events.map((event) => [
        event.what,
        event.reason,
        event.from,
        event.until,
      ]),
  };
}

const points = (count: number, tag = "point") =>
  Array.from({ length: count }, (_, at) => `${tag}${at + 1}`).join(" ");
// The lines under a heading of the prompt, to the next blank line.
const under = (prompt: string, heading: string) => {
  const all = prompt.split("\n");
  const from = all.indexOf(heading);
  if (from < 0) return [];
  const rest = all.slice(from + 1);
  const end = rest.indexOf("");
  return end < 0 ? rest : rest.slice(0, end);
};
const newLines = (prompt: string) =>
  under(prompt, "NEW LINES (decide on these):");
const soFar = (prompt: string) => under(prompt, "THE CONVERSATION SO FAR:");
const GIVEN_HEAD = "NOTES YOU HAVE ALREADY GIVEN (oldest first):";
// The notes the model is reminded of, each by its kind and question (what a
// note said follows a colon, and has its own test).
const given = (prompt: string) =>
  under(prompt, GIVEN_HEAD).map((line) => line.replace(/: .*$/, ""));
const whyNow = (prompt: string) => prompt.split("\n").at(-1) ?? "";
const said = (post: CoachNoteInput | undefined) =>
  (post?.sections ?? []).map((section) => [
    section.kind,
    section.lines.map((line) =>
      line.segments.map((segment) => segment.text).join(""),
    ),
  ]);

describe("when the coach calls", () => {
  it("does nothing while nothing has been said", async () => {
    const w = world();
    expect(await w.tick()).toBe(false);
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toEqual([]);
    expect(w.posts).toEqual([]);
    expect(w.events).toEqual([]);
  });

  it("waits for the pause after a finished question, and no longer", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] });
    w.say("interviewer", QUESTION);
    expect(await w.tick()).toBe(false);
    w.advance(finishedMs - 1);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toEqual([]);
    w.advance(1);
    expect(await w.tick()).toBe(true);
    expect(w.calls).toHaveLength(1);
    expect(newLines(w.calls[0]?.prompt ?? "")).toEqual([
      `INTERVIEWER: ${QUESTION}`,
    ]);
    expect(whyNow(w.calls[0]?.prompt ?? "")).toMatch(
      /^WHY NOW: the interviewer has just finished asking\./,
    );
  });

  it("waits longer after talk that is not a question", async () => {
    const w = world();
    w.reply({ chunks: [SILENT_REPLY] });
    await w.hear("interviewer", "So that covers the team.");
    w.advance(pauseMs - 1);
    expect(await w.tick()).toBe(false);
    w.advance(1);
    expect(await w.tick()).toBe(true);
    expect(whyNow(w.calls[0]?.prompt ?? "")).toMatch(
      /^WHY NOW: the interviewer has stopped talking\./,
    );
  });

  it("takes its pauses from the options", async () => {
    const w = world({ timing: { finishedMs: 200 } });
    w.reply({ chunks: [NOTE] });
    await w.hear("interviewer", QUESTION);
    w.advance(199);
    expect(await w.tick()).toBe(false);
    w.advance(1);
    expect(await w.tick()).toBe(true);
  });

  it("makes no call on half a question, however slowly it is asked", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] });
    const parts = [
      "So the first question I have is about,",
      "um,",
      "the booking table, and",
      "how you would decide when it",
      "should be split across regions,",
    ];
    for (const part of parts) {
      w.say("interviewer", part);
      expect(await w.tick(), part).toBe(false);
      // Three seconds of thinking: longer than the pause after a finished
      // question or a finished sentence.
      w.advance(3_000);
      expect(await w.tick(), `after ${part}`).toBe(false);
    }
    expect(w.calls).toEqual([]);
    expect(w.events).toEqual([]);

    w.say("interviewer", "or kept on one database?");
    expect(await w.tick()).toBe(false);
    w.advance(finishedMs);
    expect(await w.tick()).toBe(true);
    // One call, with the whole question.
    expect(w.calls).toHaveLength(1);
    expect(newLines(w.calls[0]?.prompt ?? "")).toEqual(
      [...parts, "or kept on one database?"].map(
        (part) => `INTERVIEWER: ${part}`,
      ),
    );
    expect(w.told()).toEqual([["act", "question-finished", 1, 6]]);
  });

  it("does not wait for ever on a question that trails off", async () => {
    const w = world();
    w.reply({ chunks: [SILENT_REPLY] });
    await w.hear(
      "interviewer",
      "So the first question I have is about sharding,",
    );
    w.advance(trailingMs - 1);
    expect(await w.tick()).toBe(false);
    w.advance(1);
    expect(await w.tick()).toBe(true);
    expect(w.told()).toEqual([["act", "pause", 1, 1]]);
  });

  it("an interviewer's line of four words is worth a call; acknowledgements are not", async () => {
    const w = world();
    expect(await w.heard("interviewer", "Okay, thanks")).toBe(false);
    expect(await w.heard("interviewer", "Right, got it")).toBe(false);
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toEqual([]);
    w.reply({ chunks: [NOTE] });
    expect(await w.heard("interviewer", "Why that shard key?")).toBe(true);
    // The short lines the coach did not ask about are read with the question.
    expect(newLines(w.calls[0]?.prompt ?? "")).toEqual([
      "INTERVIEWER: Okay, thanks",
      "INTERVIEWER: Right, got it",
      "INTERVIEWER: Why that shard key?",
    ]);
  });

  // DEFECT (turns.ts:63-64, `wordsOf` keeps a full stop inside a word): the
  // same acknowledgements as a speech recogniser writes them. "thanks." and
  // "Right." are then not fillers, the two lines add up to four words of
  // content, and the coach calls a model about "Okay, thanks. Right. Got it."
  it("DEFECT: makes no call on acknowledgements that end in full stops", async () => {
    const w = world();
    w.reply({ chunks: [SILENT_REPLY] });
    w.say("interviewer", "Okay, thanks.");
    await w.hear("interviewer", "Right. Got it.");
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toEqual([]);
  });

  it("an unknown speaker's sentence is read as an interviewer's would be", async () => {
    const w = world();
    w.reply({ chunks: [SILENT_REPLY] });
    expect(
      await w.heard("unknown", "Tell me about that project.", finishedMs),
    ).toBe(true);
    expect(w.calls).toHaveLength(1);
    expect(newLines(w.calls[0]?.prompt ?? "")).toEqual([
      "SPEAKER: Tell me about that project.",
    ]);
  });

  it("calls at once when the candidate starts to answer, with the interviewer's turn and not the answer", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] });
    w.say("interviewer", "So the booking table,");
    w.say("interviewer", "how would you shard it");
    expect(await w.tick()).toBe(false);
    w.say("candidate", "I would start with the region.");
    // No pause at all: the other side speaking ends the turn.
    expect(await w.tick()).toBe(true);
    const prompt = w.calls[0]?.prompt ?? "";
    expect(newLines(prompt)).toEqual([
      "INTERVIEWER: So the booking table,",
      "INTERVIEWER: how would you shard it",
    ]);
    expect(prompt).not.toContain("I would start with the region.");
    expect(whyNow(prompt)).toMatch(
      /^WHY NOW: the candidate has started to answer/,
    );
    expect(w.told()).toEqual([["act", "speaker-change", 1, 2]]);
  });
});

describe("a call runs beside the listening", () => {
  it("tick returns as soon as the call has begun, and the note arrives while the coach goes on looking", async () => {
    const w = world();
    await w.hear("interviewer", QUESTION);
    w.advance(finishedMs);
    const call = await w.opens();
    // The model has said nothing yet, and the coach is not waiting on it.
    expect(w.posts).toEqual([]);
    expect(await w.tick()).toBe(false);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toHaveLength(1);

    call.text(`${NOTE}\n`);
    await w.flush();
    expect(w.posts.map((post) => post.revision)).toEqual([1]);
    // Still running: nothing to take yet.
    expect(await w.tick()).toBe(false);

    call.done();
    await w.idle();
    // The finished call is taken on the next look, and only once.
    expect(await w.tick()).toBe(true);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toHaveLength(1);
    expect(call.stopped).toBe(false);
  });

  it("idle settles at once when no call is in hand", async () => {
    const w = world();
    await w.idle();
    w.say("interviewer", "Okay, thanks");
    await w.tick();
    await w.idle();
    expect(w.calls).toEqual([]);
  });

  it("makes one call at a time: a second question waits for the first call to be taken", async () => {
    const w = world();
    await w.hear("interviewer", QUESTION);
    w.advance(finishedMs);
    const first = await w.opens();
    w.say("candidate", "I would start with the region.");
    await w.hear("interviewer", "And what happens when one region runs hot?");
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toHaveLength(1);
    first.text(NOTE);
    first.done();
    await w.idle();
    expect(await w.tick()).toBe(true);
    const second = await w.opens();
    expect(newLines(second.prompt)).toEqual([
      "CANDIDATE: I would start with the region.",
      "INTERVIEWER: And what happens when one region runs hot?",
    ]);
  });
});

describe("the interviewer goes on while a call runs", () => {
  it("stops the call and makes it again with the whole turn, under the same note, its revisions carrying on", async () => {
    const w = world();
    await w.hear("interviewer", HOT);
    w.advance(finishedMs);
    const first = await w.opens();
    first.text("ASK: A hot region\nSAY: I would split the **region**.\n");
    await w.flush();
    expect(w.posts.map((post) => [post.key, post.revision])).toEqual([
      [w.key(1), 1],
    ]);

    w.say("interviewer", ROLLBACK);
    expect(await w.tick()).toBe(true);
    expect(first.stopped).toBe(true);
    // The whole turn is waited on as any turn is: nothing until its pause.
    expect(await w.tick()).toBe(false);
    expect(w.calls).toHaveLength(1);
    w.advance(finishedMs);
    const second = await w.opens();
    expect(newLines(second.prompt)).toEqual([
      `INTERVIEWER: ${HOT}`,
      `INTERVIEWER: ${ROLLBACK}`,
    ]);
    // The half-written first note is not one the coach has given.
    expect(given(second.prompt)).toEqual(["(none)"]);

    second.text(
      "ASK: Hot region and rollback\nSAY: Split the **region** and keep the old path live.",
    );
    second.done();
    await w.idle();
    expect(await w.tick()).toBe(true);
    expect(await w.tick()).toBe(false);

    // One note, replaced in place.
    expect(new Set(w.posts.map((post) => post.key))).toEqual(
      new Set([w.key(1)]),
    );
    expect(new Set(w.posts.map((post) => post.askId))).toEqual(
      new Set([`${w.key(1)}-ask`]),
    );
    expect(w.posts.length).toBeGreaterThanOrEqual(2);
    expect(w.posts.map((post) => post.revision)).toEqual(
      w.posts.map((_, at) => at + 1),
    );
    expect(w.posts.at(-1)).toMatchObject({
      ask: "Hot region and rollback",
      // The note is for the end of the whole turn.
      at: new Date(T0 + finishedMs).toISOString(),
    });
    expect(said(w.posts.at(-1))).toEqual([
      ["say", ["Split the region and keep the old path live."]],
    ]);
    expect(w.told().filter(([what]) => what !== "note")).toEqual([
      ["act", "question-finished", 1, 1],
      ["recall", "question-finished", 1, 1],
      ["act", "question-finished", 1, 2],
    ]);

    // Only the finished note is one the coach has given.
    w.reply({ chunks: [SILENT_REPLY] });
    await w.heard("interviewer", "And who would you tell before doing it?");
    expect(given(w.calls[2]?.prompt ?? "")).toEqual([
      "- [direct-answer] Hot region and rollback",
    ]);
  });

  it("a call stopped to be made again is not a failure: nothing is thrown, told or counted", async () => {
    const w = world();
    await w.hear("interviewer", HOT);
    w.advance(finishedMs);
    await w.opens();
    w.say("interviewer", ROLLBACK);
    // The tick that stops the call does not throw.
    await expect(w.tick()).resolves.toBe(true);
    w.advance(finishedMs);
    const second = await w.opens();
    expect(w.events.some((event) => event.what === "failed")).toBe(false);
    // The call made again is a first attempt, not a second.
    const epoch = w.transcript.since().epoch;
    expect(second.execution["idempotencyKey"]).toBe(`coach:${epoch}:2:0`);

    // A real failure of the call made again is still retried once.
    second.fail(failure(true));
    await w.idle();
    await expect(w.tick()).rejects.toBeInstanceOf(CoachCallError);
    const third = await w.opens();
    expect(third.execution["idempotencyKey"]).toBe(`coach:${epoch}:2:1`);
  });

  it("leaves the call alone once the candidate has begun to answer", async () => {
    const w = world();
    await w.hear("interviewer", HOT);
    w.advance(finishedMs);
    const first = await w.opens();
    w.say("candidate", "I would split the hot region first.");
    expect(await w.tick()).toBe(false);
    w.say("interviewer", ROLLBACK);
    expect(await w.tick()).toBe(false);
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    expect(first.stopped).toBe(false);
    expect(w.calls).toHaveLength(1);

    // What the interviewer then asked is the next stretch, with its own note.
    first.text(NOTE);
    first.done();
    await w.idle();
    expect(await w.tick()).toBe(true);
    const second = await w.opens();
    expect(newLines(second.prompt)).toEqual([
      "CANDIDATE: I would split the hot region first.",
      `INTERVIEWER: ${ROLLBACK}`,
    ]);
    second.text(NOTE);
    second.done();
    await w.idle();
    await w.tick();
    expect(w.posts.map((post) => post.key)).toEqual([w.key(1), w.key(2)]);
    expect(w.events.some((event) => event.what === "recall")).toBe(false);
  });

  it.each([
    ["an acknowledgement from the interviewer", "interviewer", "okay, right"],
    ["a word or two from the interviewer", "interviewer", "by tomorrow"],
    ["noise from the candidate", "candidate", "um, yeah"],
    ["a few words from an unnamed speaker", "unknown", "mhm okay"],
  ] as const)("leaves the call alone on %s", async (_, speaker, text) => {
    const w = world();
    await w.hear("interviewer", HOT);
    w.advance(finishedMs);
    const first = await w.opens();
    w.say(speaker, text);
    expect(await w.tick()).toBe(false);
    expect(first.stopped).toBe(false);
    expect(w.calls).toHaveLength(1);
  });

  it("makes a turn's call again at most twice, then lets the call in hand finish", async () => {
    const w = world();
    await w.hear("interviewer", HOT);
    w.advance(finishedMs);
    const first = await w.opens();

    w.say("interviewer", ROLLBACK);
    expect(await w.tick()).toBe(true);
    w.advance(finishedMs);
    const second = await w.opens();

    w.say("interviewer", "And who would you tell before doing it?");
    expect(await w.tick()).toBe(true);
    w.advance(finishedMs);
    const third = await w.opens();

    w.say("interviewer", "And what would you measure afterwards?");
    expect(await w.tick()).toBe(false);
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    expect([first.stopped, second.stopped, third.stopped]).toEqual([
      true,
      true,
      false,
    ]);
    expect(w.calls).toHaveLength(3);
    expect(w.events.filter((event) => event.what === "recall")).toHaveLength(2);
    expect(newLines(third.prompt)).toHaveLength(3);

    third.text(NOTE);
    third.done();
    await w.idle();
    expect(await w.tick()).toBe(true);
    // What was said after the last call began (a minute ago by now) is the
    // next stretch, with a note of its own.
    const fourth = await w.opens();
    expect(newLines(fourth.prompt)).toEqual([
      "INTERVIEWER: And what would you measure afterwards?",
    ]);
    expect(
      w.events
        .filter((event) => event.what === "act")
        .map((event) => event.key),
    ).toEqual([w.key(1), w.key(1), w.key(1), w.key(4)]);

    // A call for what was added may be made again in its turn.
    w.say("interviewer", "And how long would all of that take?");
    expect(await w.tick()).toBe(true);
    expect(fourth.stopped).toBe(true);
    expect(w.events.filter((event) => event.what === "recall")).toHaveLength(3);
  });

  it("a look at the candidate's answer is never made again because the interviewer spoke", async () => {
    const w = world();
    await w.hear("candidate", points(TURN_TIMING.candidateWords));
    w.advance(TURN_TIMING.candidateGapMs);
    const look = await w.opens();
    expect(w.told()).toEqual([["act", "answer-check", 1, 1]]);
    w.say("interviewer", ROLLBACK);
    expect(await w.tick()).toBe(false);
    expect(look.stopped).toBe(false);
  });

  // DEFECT (coach.ts:456-460, `added` in tick): whether to make the call again is decided from
  // the lines added after the call began ALONE, so the question itself is not
  // there to tell an echo by. The question heard again through the microphone
  // just after the call began counts as the candidate answering, and the
  // interviewer's second part no longer joins the question.
  it("DEFECT: an echo of the question through the microphone does not stop the call being made again", async () => {
    const w = world();
    await w.hear("interviewer", HOT);
    w.advance(finishedMs);
    const first = await w.opens();
    w.say("candidate", "how would you handle one region running hot");
    w.say("interviewer", ROLLBACK);
    expect(await w.tick()).toBe(true);
    expect(first.stopped).toBe(true);
  });
});

describe("the candidate's own answer", () => {
  const { candidateWords, candidateEveryMs, candidateGapMs } = TURN_TIMING;

  it("is looked at once enough is said, time has passed since the last call, and they pause; then not again too soon", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] });
    expect(await w.heard("interviewer", QUESTION, finishedMs)).toBe(true);
    const actedAt = w.now();

    // Half of enough, long after the question: too little said.
    await w.hear("candidate", points(candidateWords / 2, "first"));
    w.advance(candidateEveryMs);
    expect(await w.tick()).toBe(false);
    // Enough, but mid-sentence.
    w.say("candidate", points(candidateWords / 2, "second"));
    expect(await w.tick()).toBe(false);
    w.advance(candidateGapMs - 1);
    expect(await w.tick()).toBe(false);
    w.advance(1);
    w.reply({ chunks: [SILENT_REPLY] });
    expect(await w.act()).toBe(true);
    const lookedAt = w.now();
    expect(lookedAt - actedAt).toBeGreaterThanOrEqual(candidateEveryMs);
    expect(newLines(w.calls[1]?.prompt ?? "")).toHaveLength(2);
    expect(whyNow(w.calls[1]?.prompt ?? "")).toMatch(
      /^WHY NOW: the candidate is in the middle of answering|^WHY NOW: the candidate has been answering/,
    );

    // Enough again and a pause, straight away: looked at too recently.
    await w.hear("candidate", points(candidateWords, "third"));
    w.advance(candidateGapMs);
    expect(await w.tick()).toBe(false);
    w.advance(candidateEveryMs - candidateGapMs - 1);
    expect(await w.tick()).toBe(false);
    w.advance(1);
    w.reply({ chunks: [SILENT_REPLY] });
    expect(await w.act()).toBe(true);
    expect(w.now() - lookedAt).toBe(candidateEveryMs);

    expect(w.calls).toHaveLength(3);
    expect(w.told().filter(([what]) => what === "act")).toEqual([
      ["act", "question-finished", 1, 1],
      ["act", "answer-check", 2, 3],
      ["act", "answer-check", 4, 4],
    ]);
  });

  it("is not looked at for the time of a call just made for the question", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] });
    await w.heard("interviewer", QUESTION, finishedMs);
    await w.hear("candidate", points(candidateWords));
    w.advance(candidateEveryMs - 1);
    expect(await w.tick()).toBe(false);
    w.advance(1);
    expect(await w.tick()).toBe(true);
  });

  it("takes how much, how often and how long a gap from the options", async () => {
    const w = world({
      timing: {
        candidateWords: 5,
        candidateEveryMs: 3_000,
        candidateGapMs: 100,
      },
    });
    await w.hear("candidate", points(4));
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    await w.hear("candidate", "five");
    w.advance(99);
    expect(await w.tick()).toBe(false);
    w.advance(1);
    w.reply({ chunks: [SILENT_REPLY] });
    expect(await w.act()).toBe(true);
    await w.hear("candidate", points(5, "more"));
    w.advance(2_999);
    expect(await w.tick()).toBe(false);
    w.advance(1);
    expect(await w.tick()).toBe(true);
  });

  it("is looked at twice at most; the next question's answer is looked at afresh", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] });
    await w.heard("interviewer", QUESTION, finishedMs);
    for (const round of ["first", "second"]) {
      await w.hear("candidate", points(candidateWords, round));
      w.advance(candidateEveryMs);
      w.reply({ chunks: [SILENT_REPLY] });
      expect(await w.act(), round).toBe(true);
    }
    await w.hear("candidate", points(candidateWords, "third"));
    w.advance(candidateEveryMs);
    expect(await w.tick()).toBe(false);
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toHaveLength(3);

    // What was not looked at is behind the coach, not waiting for it.
    w.reply({ chunks: [NOTE] });
    await w.heard("interviewer", "And what about hot regions?", finishedMs);
    expect(newLines(w.calls[3]?.prompt ?? "")).toEqual([
      "INTERVIEWER: And what about hot regions?",
    ]);
    await w.hear("candidate", points(candidateWords, "fourth"));
    w.advance(candidateEveryMs);
    w.reply({ chunks: [SILENT_REPLY] });
    expect(await w.act()).toBe(true);
    expect(w.told().filter(([what]) => what === "act")).toEqual([
      ["act", "question-finished", 1, 1],
      ["act", "answer-check", 2, 2],
      ["act", "answer-check", 3, 3],
      ["act", "question-finished", 5, 5],
      ["act", "answer-check", 6, 6],
    ]);
  });

  it("is not looked at again once it has been nudged", async () => {
    const w = world();
    w.reply(
      { chunks: [NOTE] },
      { chunks: ["ASK: Land it\nCAUTION: Name the **figure** now."] },
    );
    await w.heard("interviewer", QUESTION, finishedMs);
    await w.hear("candidate", points(candidateWords, "first"));
    w.advance(candidateEveryMs);
    expect(await w.act()).toBe(true);
    expect(w.posts).toHaveLength(2);
    await w.hear("candidate", points(candidateWords, "second"));
    w.advance(candidateEveryMs);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toHaveLength(2);
  });

  it("gets a nudge, not a second answer: one line, as a follow-up under the question's note", async () => {
    const w = world();
    w.reply(
      { chunks: [NOTE] },
      {
        chunks: [
          [
            "KIND: missed-opportunity",
            "SAME: no",
            "ASK: Land the result",
            "SAY: Name the **latency** figure now.",
            "SAY: Then the rollback.",
            "ANCHOR: figure, rollback",
          ].join("\n"),
        ],
      },
    );
    await w.heard("interviewer", QUESTION, finishedMs);
    await w.hear("candidate", points(candidateWords));
    w.advance(candidateEveryMs);
    expect(await w.act()).toBe(true);
    expect(w.posts).toHaveLength(2);
    expect(w.posts[1]).toMatchObject({
      kind: "follow-up",
      key: w.key(2),
      askId: w.posts[0]?.askId,
    });
    expect(said(w.posts[1])).toEqual([
      ["say", ["Name the latency figure now."]],
    ]);
    for (const post of w.posts)
      expect(() => coachNoteInputSchema.parse(post)).not.toThrow();
  });
});

describe("the interviewer adds to a question already answered", () => {
  const MORE = "And what about hot regions?";
  const REVISED =
    "ASK: Sharding and the hot region\nSAY: By **region**, then split the hot one.";

  it("revises the note in place while the candidate has not spoken: the same key, its revisions carrying on, remembered once", async () => {
    const w = world();
    w.reply(
      { chunks: [NOTE] },
      { chunks: [REVISED] },
      { chunks: [SILENT_REPLY] },
    );
    await w.heard("interviewer", QUESTION, finishedMs);
    // The call has been answered and taken; a few seconds on, one more sentence.
    w.advance(3_000);
    await w.heard("interviewer", MORE, finishedMs);
    expect(
      w.posts.map((post) => [post.key, post.askId, post.revision]),
    ).toEqual([
      [w.key(1), `${w.key(1)}-ask`, 1],
      [w.key(1), `${w.key(1)}-ask`, 2],
    ]);
    // The added sentence is what is new; the question is behind it.
    expect(newLines(w.calls[1]?.prompt ?? "")).toEqual([
      `INTERVIEWER: ${MORE}`,
    ]);
    expect(soFar(w.calls[1]?.prompt ?? "")).toEqual([
      `INTERVIEWER: ${QUESTION}`,
    ]);
    w.later();
    await w.heard("interviewer", "Now, tell me about on-call.");
    expect(given(w.calls[2]?.prompt ?? "")).toEqual([
      "- [direct-answer] Sharding and the hot region",
    ]);
  });

  it("a backchannel from the candidate does not make it another turn", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] }, { chunks: [REVISED] });
    await w.heard("interviewer", QUESTION, finishedMs);
    await w.hear("candidate", "yeah, okay");
    await w.heard("interviewer", MORE, finishedMs);
    expect(w.posts.map((post) => [post.key, post.revision])).toEqual([
      [w.key(1), 1],
      [w.key(1), 2],
    ]);
  });

  it("gives it a note of its own once the candidate has spoken", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] }, { chunks: [REVISED] });
    await w.heard("interviewer", QUESTION, finishedMs);
    await w.hear("candidate", "I would start with the region.");
    await w.heard("interviewer", MORE, finishedMs);
    expect(w.posts.map((post) => [post.key, post.revision])).toEqual([
      [w.key(1), 1],
      [w.key(2), 1],
    ]);
  });

  it("gives it a note of its own when it comes long after", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] }, { chunks: [REVISED] });
    await w.heard("interviewer", QUESTION, finishedMs);
    w.later();
    await w.heard("interviewer", MORE, finishedMs);
    expect(w.posts.map((post) => [post.key, post.revision])).toEqual([
      [w.key(1), 1],
      [w.key(2), 1],
    ]);
  });

  // DEFECT (coach.ts:510-512 `from` in tick, against :233 in coachOn): for a sentence added to
  // a turn already answered, the call's "act" event (and its "failed" or
  // "recall") names the stretch from the FIRST line of the earlier turn,
  // while the "note" and "silent" events of the same call name it from the
  // added line. One call is told of as two different stretches.
  it("DEFECT: the events of one call name one stretch", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] }, { chunks: [SILENT_REPLY] });
    await w.heard("interviewer", QUESTION, finishedMs);
    await w.heard("interviewer", MORE, finishedMs);
    const [acted, silent] = w.events.slice(-2);
    expect([acted?.what, silent?.what]).toEqual(["act", "silent"]);
    expect(silent?.key).toBe(acted?.key);
    expect(silent?.from).toBe(acted?.from);
  });
});

describe("what the coach tells whoever watches", () => {
  const KEYS = new Set([
    "atMs",
    "what",
    "reason",
    "from",
    "until",
    "key",
    "revision",
    "final",
  ]);

  it("tells each thing it does, in order, at the moment it does it", async () => {
    const w = world();
    // A note written in three pieces, half a second apart.
    w.reply({
      gapMs: 500,
      chunks: [
        "ASK: Sharding\nSAY: By **region**.\n",
        "SAY: Then by tenant.\n",
        "ANCHOR: region, tenant",
      ],
    });
    await w.hear("interviewer", QUESTION);
    w.advance(finishedMs);
    const at = w.now();
    expect(await w.act()).toBe(true);
    // Then, later, a stretch the model stays silent on.
    w.later();
    w.reply({ chunks: [SILENT_REPLY] });
    await w.hear("interviewer", "So that covers the team.");
    w.advance(pauseMs);
    const silentAt = w.now();
    expect(await w.act()).toBe(true);

    const key = w.key(1);
    expect(w.events).toEqual([
      {
        atMs: at,
        what: "act",
        reason: "question-finished",
        from: 1,
        until: 1,
        key,
      },
      {
        atMs: at + 500,
        what: "note",
        reason: "question-finished",
        from: 1,
        until: 1,
        key,
        revision: 1,
        final: false,
      },
      {
        atMs: at + 1_000,
        what: "note",
        reason: "question-finished",
        from: 1,
        until: 1,
        key,
        revision: 2,
        final: false,
      },
      {
        atMs: at + 1_500,
        what: "note",
        reason: "question-finished",
        from: 1,
        until: 1,
        key,
        revision: 3,
        final: true,
      },
      {
        atMs: silentAt,
        what: "act",
        reason: "pause",
        from: 2,
        until: 2,
        key: w.key(2),
      },
      {
        atMs: silentAt,
        what: "silent",
        reason: "pause",
        from: 2,
        until: 2,
        key: w.key(2),
      },
    ]);
    // Each note event is a revision that was posted.
    expect(
      w.events
        .filter((event) => event.what === "note")
        .map((event) => [event.key, event.revision]),
    ).toEqual(w.posts.map((post) => [post.key, post.revision]));
  });

  it("tells of a call made again and of a call that failed", async () => {
    const w = world();
    await w.hear("interviewer", HOT);
    w.advance(finishedMs);
    await w.opens();
    w.say("interviewer", ROLLBACK);
    await w.tick();
    w.advance(finishedMs);
    w.reply({ end: failure(true) }, { end: failure(true) });
    await w.tick();
    await w.idle();
    await expect(w.tick()).rejects.toBeInstanceOf(CoachCallError);
    expect(await w.act()).toBe(true);
    expect(w.told()).toEqual([
      ["act", "question-finished", 1, 1],
      ["recall", "question-finished", 1, 1],
      ["act", "question-finished", 1, 2],
      ["failed", "question-finished", 1, 2],
      ["act", "question-finished", 1, 2],
      ["failed", "question-finished", 1, 2],
    ]);
    expect(new Set(w.events.map((event) => event.key))).toEqual(
      new Set([w.key(1)]),
    );
  });

  // [SAFETY] Ids, counts and reasons only.
  it("never tells what was said, asked, written or remembered", async () => {
    const w = world(
      {},
      {
        session: SESSION,
        facts: async () => FACTS,
        plan: async () => "Land the ledger migration story.",
      },
    );
    w.reply(
      {
        gapMs: 500,
        chunks: [
          "KIND: technical\nASK: Sharding the booking table\nHEARD: How to shard it.\n",
          "SAY: I **cut booking latency 40%**[/roles/0/proof_points/0].\n",
          "LOG: The interviewer owns the pricing rules",
        ],
      },
      { chunks: [SILENT_REPLY] },
      { end: failure(false) },
    );
    await w.heard("interviewer", QUESTION, finishedMs);
    await w.heard("interviewer", "So that covers the team.");
    await w.heard("interviewer", "Tell me about the ledger migration.");
    // The second "note" says the note is finished: its last line had already
    // been shown while it was written.
    expect(w.events.map((event) => event.what)).toEqual([
      "act",
      "note",
      "note",
      "act",
      "silent",
      "act",
      "failed",
    ]);

    const keyShape = /^coach-[0-9a-f-]{8}-\d+$/;
    const reasons = new Set([
      "question-finished",
      "pause",
      "speaker-change",
      "answer-check",
    ]);
    for (const event of w.events) {
      for (const name of Object.keys(event))
        expect(KEYS.has(name), name).toBe(true);
      expect(typeof event.atMs).toBe("number");
      expect(typeof event.from).toBe("number");
      expect(typeof event.until).toBe("number");
      expect(event.key).toMatch(keyShape);
      expect(reasons.has(event.reason ?? "")).toBe(true);
      // The only strings are the kind of event, the reason and the key.
      expect(
        Object.entries(event)
          .filter(([, value]) => typeof value === "string")
          .map(([name]) => name)
          .sort(),
      ).toEqual(["key", "reason", "what"]);
      // A revision and whether it is the last are told of a note alone.
      expect("revision" in event).toBe(event.what === "note");
      expect("final" in event).toBe(event.what === "note");
    }
    expect(JSON.stringify(w.events)).not.toMatch(
      /shard|booking|latency|ledger|pricing|covers|scripted|unavailable|refused/i,
    );
  });

  it("works with nobody watching", async () => {
    const transcript = createCoachTranscript();
    let clock = T0;
    const coach = createCoach({
      engine: {
        async *stream() {
          yield { type: "text" as const, text: NOTE };
          yield { type: "done" as const, value: null };
        },
      } as unknown as CoachPorts["engine"],
      profileId: "test-coach-profile",
      transcript: { since: async (after) => transcript.since(after) },
      notes: { post: async () => undefined },
      scope: { tenantId: "tenant-test", actorId: "actor-test" },
      nowMs: () => clock,
    });
    const signal = new AbortController().signal;
    transcript.add([{ speaker: "interviewer", text: QUESTION }]);
    expect(await coach.tick(signal)).toBe(false);
    clock += finishedMs;
    expect(await coach.tick(signal)).toBe(true);
    await coach.idle();
    expect(await coach.tick(signal)).toBe(true);
  });
});

describe("what the coach asks", () => {
  it("makes the call as a permitted-remote read of the interview product, by its profile", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] });
    await w.heard("interviewer", QUESTION);
    const call = w.calls[0];
    expect(call?.profileId).toBe("test-coach-profile");
    expect(call?.system).toBe(COACH_SYSTEM);
    const epoch = w.transcript.since().epoch;
    expect(call?.execution).toMatchObject({
      policy: "permitted-remote",
      scope: {
        tenantId: "tenant-test",
        actorId: "actor-test",
        productId: INTERVIEW_PRODUCT_ID,
      },
      permissions: ["interview.read"],
      for: { kind: "coach", id: epoch },
      idempotencyKey: `coach:${epoch}:1:0`,
      traceId: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
    expect(call?.execution["signal"]).toBeInstanceOf(AbortSignal);
    // [SAFETY] No id the engine keeps carries what was said.
    expect(JSON.stringify(call?.execution)).not.toContain("shard");
  });

  it("reads the transcript from its cursor each time", async () => {
    const w = world();
    w.reply({ chunks: [SILENT_REPLY] });
    // Heard, then the look that begins the call, then the look that takes it.
    await w.heard("interviewer", QUESTION);
    w.say("candidate", "By region.");
    await w.tick();
    await w.tick();
    expect(w.reads).toEqual([0, 1, 1, 1, 2]);
  });
});

describe("what the coach posts", () => {
  it("posts nothing for a silent reply, and does not ask about those lines again", async () => {
    const w = world();
    w.reply({ chunks: ["NO", "NE"] });
    expect(await w.heard("interviewer", "So that covers the team.")).toBe(true);
    expect(w.posts).toEqual([]);
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toHaveLength(1);

    // The next question is new; the line it was silent on is behind it.
    w.reply({ chunks: [NOTE] });
    await w.heard("interviewer", QUESTION);
    expect(soFar(w.calls[1]?.prompt ?? "")).toEqual([
      "INTERVIEWER: So that covers the team.",
    ]);
    expect(newLines(w.calls[1]?.prompt ?? "")).toEqual([
      `INTERVIEWER: ${QUESTION}`,
    ]);
    expect(given(w.calls[1]?.prompt ?? "")).toEqual(["(none)"]);
  });

  it("posts a note as it is written: rising revisions of one key, the finished note last", async () => {
    const w = world();
    w.reply({
      gapMs: 500,
      chunks: [
        "KIND: technical\nSAME: no\nASK: Sharding the booking table\n",
        "SAY: I would shard by **region** first.\nSAY: Then by ",
        "tenant inside a region.\nANCHOR: region, tenant",
      ],
    });
    expect(await w.heard("interviewer", QUESTION)).toBe(true);

    expect(w.posts.map((post) => post.revision)).toEqual([1, 2, 3]);
    expect(new Set(w.posts.map((post) => post.key)).size).toBe(1);
    const key = w.key(1);
    expect(w.posts[0]?.key).toBe(key);
    expect(new Set(w.posts.map((post) => post.askId))).toEqual(
      new Set([`${key}-ask`]),
    );
    expect(w.posts.map(said)).toEqual([
      [["say", ["I would shard by region first."]]],
      [
        [
          "say",
          ["I would shard by region first.", "Then by tenant inside a region."],
        ],
      ],
      [
        [
          "say",
          ["I would shard by region first.", "Then by tenant inside a region."],
        ],
        ["anchors", ["region, tenant"]],
      ],
    ]);
    expect(w.posts.at(-1)).toMatchObject({
      title: "Sharding the booking table",
      ask: "Sharding the booking table",
      kind: "technical",
      tone: "say",
    });
    for (const post of w.posts)
      expect(() => coachNoteInputSchema.parse(post)).not.toThrow();
  });

  it("posts no more often than postEveryMs while writing, and always the finished note", async () => {
    const script: Scripted = {
      gapMs: 100,
      chunks: [
        "ASK: Sharding\nSAY: One.\n",
        "SAY: Two.\n",
        "ANCHOR: three\n",
        "ANCHOR: four",
      ],
    };
    const w = world();
    w.reply(script);
    await w.heard("interviewer", QUESTION);
    const lines = (posts: CoachNoteInput[]) =>
      posts.map((post) => [
        post.revision,
        (post.sections ?? []).map((section) => section.lines.length),
      ]);
    expect(lines(w.posts)).toEqual([
      [1, [1]],
      [2, [2, 2]],
    ]);

    // And the least time between revisions is the caller's to set.
    const quick = world({ postEveryMs: 100 });
    quick.reply(script);
    await quick.heard("interviewer", QUESTION);
    expect(lines(quick.posts)).toEqual([
      [1, [1]],
      [2, [2]],
      [3, [2, 1]],
      [4, [2, 2]],
    ]);
  });

  it("posts a reply that arrives whole once, as revision 1", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] });
    await w.heard("interviewer", QUESTION);
    expect(w.posts).toHaveLength(1);
    expect(w.posts[0]).toMatchObject({ revision: 1, kind: "technical" });
  });

  it("stamps the note with the time of the last line it answers", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] });
    w.say("interviewer", "Let us talk about data.", T0 - 90_000);
    await w.hear("interviewer", QUESTION, T0 - 30_000);
    w.advance(finishedMs);
    await w.act();
    expect(w.posts).toHaveLength(1);
    expect(w.posts[0]?.at).toBe(new Date(T0 - 30_000).toISOString());
  });

  it("a note for the same question joins the last note's question; another gets its own", async () => {
    const w = world();
    const same = NOTE.replace("SAME: no", "SAME: yes");
    w.reply({ chunks: [NOTE] }, { chunks: [same] }, { chunks: [NOTE] });
    await w.heard("interviewer", QUESTION);
    w.later();
    await w.heard("interviewer", "And what about hot regions?");
    w.later();
    await w.heard("interviewer", "Now, tell me about on-call.");
    expect(
      w.posts.map((post) => [post.key, post.askId, post.revision]),
    ).toEqual([
      [w.key(1), `${w.key(1)}-ask`, 1],
      [w.key(2), `${w.key(1)}-ask`, 1],
      [w.key(3), `${w.key(3)}-ask`, 1],
    ]);
  });

  it("reminds the model what each note said, in a line", async () => {
    const w = world();
    w.reply(
      {
        chunks: [
          "KIND: technical\nASK: Sharding\nSAY: By **region** first.\nSAY: Then by tenant.\nANCHOR: region, tenant",
        ],
      },
      { chunks: [SILENT_REPLY] },
    );
    await w.heard("interviewer", QUESTION);
    w.later();
    await w.heard("interviewer", "And what about hot regions?");
    expect(under(w.calls[1]?.prompt ?? "", GIVEN_HEAD)).toEqual([
      "- [technical] Sharding: By region first. / Then by tenant. / region, tenant",
    ]);
  });

  // DEFECT (coach.ts:296-310, `post`): a "note" event is told only when a revision is
  // posted. When the finished note reads as the last revision shown while it
  // was written (the usual case: the reply's last line ends with a newline,
  // or LOG lines follow it), nothing is posted at the end and so no event
  // ever says `final: true`: a watcher cannot tell the note is finished, and
  // the replay's time of a note's last line (coach-replay.ts, `lastMs`) is
  // never set.
  it("DEFECT: tells that a note is finished even when its last revision was already on show", async () => {
    const w = world();
    w.reply({ chunks: [`${NOTE}\n`] });
    await w.heard("interviewer", QUESTION);
    expect(w.posts).toHaveLength(1);
    expect(
      w.events.some((event) => event.what === "note" && event.final === true),
    ).toBe(true);
  });

  it("a first note that claims the same question has none to join", async () => {
    const w = world();
    w.reply({ chunks: [NOTE.replace("SAME: no", "SAME: yes")] });
    await w.heard("interviewer", QUESTION);
    expect(w.posts[0]?.askId).toBe(`${w.posts[0]?.key}-ask`);
  });

  it("tells the model the notes it has given, oldest first", async () => {
    const w = world();
    w.reply(
      { chunks: [NOTE] },
      { chunks: ["KIND: follow-up\nASK: Hot regions\nSAY: Split them."] },
      { chunks: [SILENT_REPLY] },
    );
    await w.heard("interviewer", QUESTION);
    w.later();
    await w.heard("interviewer", "And what about hot regions?");
    w.later();
    await w.heard("interviewer", "Thanks, that makes sense to me.");
    expect(given(w.calls[2]?.prompt ?? "")).toEqual([
      "- [technical] Sharding the booking table",
      "- [follow-up] Hot regions",
    ]);
  });

  // The reply's last line ended with a newline and was posted while it was
  // streaming: the finished note is the same, so nothing more is posted, and
  // the note is still one the coach has given.
  it("remembers a note whose last revision was already posted while it was written", async () => {
    const w = world();
    w.reply(
      { chunks: [`${NOTE}\n`] },
      { chunks: [NOTE.replace("SAME: no", "SAME: yes")] },
    );
    await w.heard("interviewer", QUESTION);
    w.later();
    await w.heard("interviewer", "And what about hot regions?");
    expect(w.posts).toHaveLength(2);
    expect(given(w.calls[1]?.prompt ?? "")).toEqual([
      "- [technical] Sharding the booking table",
    ]);
    expect(w.posts[1]?.askId).toBe(w.posts[0]?.askId);
  });

  it("names a note by its conversation and the FIRST line of its stretch, not by a count or its last line", async () => {
    const w = world();
    // The first stretch gets no note; the second note is still named by where
    // its own stretch begins: what the candidate said before the question.
    w.reply({ chunks: [SILENT_REPLY] }, { chunks: [NOTE] });
    await w.heard("interviewer", "So that covers the team.");
    w.say("candidate", "I would like to hear more about it.");
    await w.heard("interviewer", QUESTION);
    const epoch = w.transcript.since().epoch;
    expect(newLines(w.calls[1]?.prompt ?? "")).toHaveLength(2);
    expect(w.posts.map((post) => [post.key, post.askId])).toEqual([
      [`coach-${epoch.slice(0, 8)}-2`, `coach-${epoch.slice(0, 8)}-2-ask`],
    ]);
    // The engine's own id for the call is by the last line it read.
    expect(w.calls[1]?.execution["idempotencyKey"]).toBe(`coach:${epoch}:3:0`);
  });

  it("a second attempt at a stretch takes the first one's key and carries its revisions on", async () => {
    const w = world();
    w.reply(
      {
        gapMs: 500,
        chunks: ["ASK: Sharding\nSAY: One.\n", "SAY: Two.\n", "SAY: Thr"],
        end: failure(true),
      },
      { gapMs: 500, chunks: ["ASK: Sharding\nSAY: Other.\n", "SAY: End."] },
    );
    await w.hear("interviewer", QUESTION);
    w.advance(finishedMs);
    await expect(w.act()).rejects.toBeInstanceOf(CoachCallError);
    expect(w.posts.map((post) => post.revision)).toEqual([1, 2]);
    expect(await w.act()).toBe(true);

    const key = w.key(1);
    expect(w.posts.map((post) => [post.key, post.revision])).toEqual([
      [key, 1],
      [key, 2],
      [key, 3],
      [key, 4],
    ]);
    expect(new Set(w.posts.map((post) => post.askId))).toEqual(
      new Set([`${key}-ask`]),
    );
    // The window ends on the second attempt's note alone.
    expect(
      w.posts
        .at(-1)
        ?.sections?.[0]?.lines.map((line) => line.segments[0]?.text),
    ).toEqual(["Other.", "End."]);
    // The half-written first attempt is not a note the coach has given.
    w.reply({ chunks: [SILENT_REPLY] });
    await w.heard("interviewer", "And what about hot regions?");
    expect(given(w.calls[2]?.prompt ?? "")).toEqual([
      "- [direct-answer] Sharding",
    ]);
  });
});

describe("the person's record", () => {
  const CITING = [
    "KIND: technical",
    "SAME: no",
    "ASK: Sharding the booking table",
    "SAY: I **cut booking latency 40%**[/roles/0/proof_points/0] by region.",
    "SAY: You run **Kafka**[/context/employerBrief/1] and **Postgres** in **9 regions**.",
    "SAY: My notice is **4 weeks**[/context/candidatePreferences/0].",
    // Ends on a newline: the whole note is posted once, as it is written.
    "",
  ].join("\n");
  const evidence = (post: CoachNoteInput | undefined) =>
    (post?.sections ?? []).flatMap((section) =>
      section.lines.flatMap((line) =>
        line.segments
          .filter((segment) => segment.role === "evidence")
          .map((segment) => [segment.text, segment.grounding, segment.source]),
      ),
    );

  it("is not asked for when the transcript names no session", async () => {
    const w = world({}, { facts: async () => FACTS });
    w.reply({ chunks: [CITING] });
    await w.heard("interviewer", QUESTION);
    expect(w.asked).toEqual([]);
    expect(w.calls[0]?.prompt).not.toContain("RECORD");
    expect(w.calls[0]?.prompt).not.toContain("EMPLOYER MATERIAL");
    expect(w.calls[0]?.execution["scope"]).toEqual({
      tenantId: "tenant-test",
      actorId: "actor-test",
      productId: INTERVIEW_PRODUCT_ID,
    });
    // With no record nothing is the person's own, whatever the model cites.
    expect(evidence(w.posts[0]).map(([, grounding]) => grounding)).toEqual(
      Array.from({ length: 5 }, () => "inferred"),
    );
  });

  it("is not needed: a session with no context port is coached from the conversation, as its owner", async () => {
    const w = world({}, { session: SESSION });
    w.reply({ chunks: [CITING] });
    expect(await w.heard("interviewer", QUESTION)).toBe(true);
    expect(w.calls[0]?.prompt).not.toContain("RECORD");
    expect(w.calls[0]?.execution["scope"]).toEqual({
      tenantId: SESSION.tenantId,
      actorId: SESSION.actorId,
      productId: INTERVIEW_PRODUCT_ID,
    });
    expect(
      evidence(w.posts[0]).every(
        ([, g, source]) => g === "inferred" && !source,
      ),
    ).toBe(true);
  });

  it("is asked for once per call, for the session, with what the others said before what the candidate said", async () => {
    const w = world({}, { session: SESSION, facts: async () => FACTS });
    w.reply({ chunks: [SILENT_REPLY] }, { chunks: [SILENT_REPLY] });
    w.say("candidate", "I would start with the data.");
    w.say("interviewer", "Right, so how would you shard it?");
    await w.hear("unknown", "And why would you pick that key?");
    w.advance(finishedMs);
    expect(await w.act()).toBe(true);
    expect(w.asked).toEqual([
      {
        session: SESSION,
        query:
          "Right, so how would you shard it? And why would you pick that key? I would start with the data.",
      },
    ]);
    // The next stretch asks by its own lines only.
    await w.heard("interviewer", "And the rollback plan there?");
    expect(w.asked[1]).toEqual({
      session: SESSION,
      query: "And the rollback plan there?",
    });
  });

  it("puts the facts in the prompt and makes the call as the session's owner", async () => {
    const w = world({}, { session: SESSION, facts: async () => FACTS });
    w.reply({ chunks: [NOTE] });
    await w.heard("interviewer", QUESTION);
    expect(w.calls[0]?.prompt.split("\n").slice(0, 7)).toEqual([
      "THE CANDIDATE'S RECORD (cite a fact by its [pointer]):",
      "[/roles/0/proof_points/0] Cut booking latency 40% by sharding on region",
      "[/context/candidatePreferences/0] Notice period: 4 weeks",
      "",
      "EMPLOYER MATERIAL (not the candidate's experience):",
      "[/context/employerBrief/1] Stack: Kafka and Postgres across 9 regions",
      "",
    ]);
    expect(w.calls[0]?.execution).toMatchObject({
      scope: {
        tenantId: SESSION.tenantId,
        actorId: SESSION.actorId,
        productId: INTERVIEW_PRODUCT_ID,
      },
      policy: "permitted-remote",
      permissions: ["interview.read"],
    });
    // [SAFETY] No id the engine keeps carries the record.
    expect(JSON.stringify(w.calls[0]?.execution)).not.toContain("latency");
  });

  it("only what is the person's own makes a claim theirs: their record and what they want do, employer material never does", async () => {
    const w = world({}, { session: SESSION, facts: async () => FACTS });
    w.reply({ chunks: [CITING] });
    await w.heard("interviewer", QUESTION);
    expect(evidence(w.posts[0])).toEqual([
      ["cut booking latency 40%", "verified", "/roles/0/proof_points/0"],
      // Cited to the employer's material, and its words are the employer's.
      ["Kafka", "inferred", undefined],
      ["Postgres", "inferred", undefined],
      ["9 regions", "inferred", undefined],
      // Cited to a preference: what the person wants is theirs to state.
      ["4 weeks", "verified", "/context/candidatePreferences/0"],
    ]);
    for (const post of w.posts)
      expect(() => coachNoteInputSchema.parse(post)).not.toThrow();
  });

  it("verifies against the facts of this call, not of an earlier one", async () => {
    let round = 0;
    const w = world(
      {},
      {
        session: SESSION,
        facts: async () => {
          round += 1;
          return round === 1 ? FACTS : [];
        },
      },
    );
    const claim =
      "ASK: Latency\nSAY: I **cut booking latency 40%**[/roles/0/proof_points/0].";
    w.reply({ chunks: [claim] }, { chunks: [claim] });
    await w.heard("interviewer", QUESTION);
    await w.heard("interviewer", "And what about hot regions?");
    expect(w.posts.map((post) => evidence(post)[0]?.[1])).toEqual([
      "verified",
      "inferred",
    ]);
    expect(w.calls[1]?.prompt).not.toContain("RECORD");
  });

  it("keeps working, with no facts, when the record cannot be read", async () => {
    const w = world(
      {},
      {
        session: SESSION,
        facts: async () => {
          throw new Error("the session context is unavailable");
        },
      },
    );
    w.reply({ chunks: [CITING] });
    expect(await w.heard("interviewer", QUESTION)).toBe(true);
    expect(w.asked).toHaveLength(1);
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0]?.prompt).not.toContain("RECORD");
    expect(w.calls[0]?.prompt).not.toContain("EMPLOYER MATERIAL");
    expect(w.calls[0]?.execution["scope"]).toMatchObject({
      tenantId: SESSION.tenantId,
      actorId: SESSION.actorId,
    });
    expect(w.posts).toHaveLength(1);
    expect(evidence(w.posts[0]).map(([, grounding]) => grounding)).toEqual(
      Array.from({ length: 5 }, () => "inferred"),
    );
    expect(w.events.some((event) => event.what === "failed")).toBe(false);
  });

  it("keeps the session across a cleared transcript", async () => {
    const w = world({}, { session: SESSION, facts: async () => FACTS });
    w.reply({ chunks: [SILENT_REPLY] }, { chunks: [NOTE] });
    await w.heard("interviewer", QUESTION);
    w.transcript.clear();
    await w.tick();
    await w.heard("interviewer", "What is your notice period?");
    expect(w.asked.map((each) => each.session)).toEqual([SESSION, SESSION]);
    expect(w.calls[1]?.execution["scope"]).toMatchObject({
      tenantId: SESSION.tenantId,
    });
  });
});

describe("the plan for the call and what the coach remembers of it", () => {
  const PLAN = "Land the ledger migration story.";
  const PLAN_HEAD = "THE PLAN FOR THIS CALL:";
  const LOG_HEAD = "WHAT YOU HAVE NOTED SO FAR IN THIS CALL (oldest first):";

  it("puts the plan before everything else, and reads it again only after a minute", async () => {
    let reads = 0;
    let plan = PLAN;
    const w = world(
      {},
      {
        plan: async () => {
          reads += 1;
          return plan;
        },
      },
    );
    w.reply(
      { chunks: [SILENT_REPLY] },
      { chunks: [SILENT_REPLY] },
      { chunks: [SILENT_REPLY] },
    );
    await w.heard("interviewer", QUESTION);
    expect(w.calls[0]?.prompt.split("\n").slice(0, 3)).toEqual([
      PLAN_HEAD,
      PLAN,
      "",
    ]);
    // Changed during the call: the plan held is used until it is a minute old.
    plan = "Ask about the on-call rotation.";
    await w.heard("interviewer", "And what about hot regions?");
    expect(under(w.calls[1]?.prompt ?? "", PLAN_HEAD)).toEqual([PLAN]);
    expect(reads).toBe(1);
    w.advance(60_000);
    await w.heard("interviewer", "And the rollback plan there?");
    expect(under(w.calls[2]?.prompt ?? "", PLAN_HEAD)).toEqual([plan]);
    expect(reads).toBe(2);
  });

  it.each([
    ["there is none", async () => undefined],
    ["it is empty", async () => "  \n"],
    [
      "it cannot be read",
      async () => {
        throw new Error("Studio answered 503.");
      },
    ],
  ])("makes the call without a plan when %s", async (_, plan) => {
    const w = world({}, { plan });
    w.reply({ chunks: [NOTE] });
    expect(await w.heard("interviewer", QUESTION)).toBe(true);
    expect(w.calls[0]?.prompt).not.toContain(PLAN_HEAD);
    expect(w.posts).toHaveLength(1);
    expect(w.events.some((event) => event.what === "failed")).toBe(false);
  });

  it("carries what the model chose to remember into its later calls, never into a note", async () => {
    const w = world();
    w.reply(
      { chunks: [`${NOTE}\nLOG: The interviewer owns the pricing rules`] },
      // A reply that is otherwise silent may still remember something.
      { chunks: [`${SILENT_REPLY}\nLOG: Two of five questions asked`] },
      // The same thing is remembered once.
      { chunks: [`${SILENT_REPLY}\nLOG: Two of five questions asked`] },
      { chunks: [SILENT_REPLY] },
    );
    await w.heard("interviewer", QUESTION);
    expect(w.calls[0]?.prompt).not.toContain(LOG_HEAD);
    await w.heard("interviewer", "So that covers the team.");
    expect(under(w.calls[1]?.prompt ?? "", LOG_HEAD)).toEqual([
      "- The interviewer owns the pricing rules",
    ]);
    await w.heard("interviewer", "Thanks, that makes sense to me.");
    await w.heard("interviewer", "And the rollback plan there?");
    expect(under(w.calls[3]?.prompt ?? "", LOG_HEAD)).toEqual([
      "- The interviewer owns the pricing rules",
      "- Two of five questions asked",
    ]);
    // Only the first reply was a note, and it shows nothing of the log.
    expect(w.posts).toHaveLength(1);
    expect(JSON.stringify(w.posts)).not.toContain("pricing");
    expect(w.events.filter((event) => event.what === "silent")).toHaveLength(3);
  });

  it("forgets what it remembered when the transcript is cleared", async () => {
    const w = world();
    w.reply(
      { chunks: [`${NOTE}\nLOG: The interviewer owns the pricing rules`] },
      { chunks: [SILENT_REPLY] },
    );
    await w.heard("interviewer", QUESTION);
    w.transcript.clear();
    await w.tick();
    await w.heard("interviewer", "What is your notice period?");
    expect(w.calls[1]?.prompt).not.toContain(LOG_HEAD);
    expect(w.calls[1]?.prompt).not.toContain("pricing");
  });
});

describe("a new conversation", () => {
  it("forgets the last one when the transcript is cleared: its lines, its notes and its question", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] });
    await w.heard("interviewer", QUESTION);
    const before = w.transcript.since().epoch;

    w.transcript.clear();
    // The coach sees the new epoch and looks again at once, from the start.
    expect(await w.tick()).toBe(true);
    expect(await w.tick()).toBe(false);
    expect(w.reads.slice(-2)).toEqual([1, 0]);

    w.reply({ chunks: [NOTE.replace("SAME: no", "SAME: yes")] });
    expect(await w.heard("interviewer", "What is your notice period?")).toBe(
      true,
    );
    const epoch = w.transcript.since().epoch;
    expect(epoch).not.toBe(before);
    const prompt = w.calls[1]?.prompt ?? "";
    expect(given(prompt)).toEqual(["(none)"]);
    expect(soFar(prompt)).toEqual(["(nothing before the new lines)"]);
    expect(newLines(prompt)).toEqual([
      "INTERVIEWER: What is your notice period?",
    ]);
    expect(prompt).not.toContain("shard");
    expect(w.calls[1]?.execution).toMatchObject({
      for: { kind: "coach", id: epoch },
      idempotencyKey: `coach:${epoch}:1:0`,
    });
    // Its note is under the new conversation, and joins no earlier question.
    const note = w.posts[1];
    expect(note?.key).toBe(`coach-${epoch.slice(0, 8)}-1`);
    expect(note?.askId).toBe(`${note?.key}-ask`);
    expect(note?.key).not.toBe(w.posts[0]?.key);
    // A note of the new conversation starts its revisions again.
    expect(note?.revision).toBe(1);
  });

  it("reads lines already there when the cleared transcript is seen", async () => {
    const w = world();
    w.reply({ chunks: [SILENT_REPLY] }, { chunks: [SILENT_REPLY] });
    await w.heard("interviewer", QUESTION);
    w.transcript.clear();
    w.say("interviewer", "A first line of the next conversation.");
    expect(await w.tick()).toBe(true);
    expect(await w.tick()).toBe(false);
    w.advance(pauseMs);
    expect(await w.tick()).toBe(true);
    expect(newLines(w.calls[1]?.prompt ?? "")).toEqual([
      "INTERVIEWER: A first line of the next conversation.",
    ]);
  });

  it("stops the call in hand, and nothing of it reaches the new conversation", async () => {
    const w = world();
    await w.hear("interviewer", QUESTION);
    w.advance(finishedMs);
    const old = await w.opens();
    w.transcript.clear();
    expect(await w.tick()).toBe(true);
    expect(old.stopped).toBe(true);
    await w.flush();
    expect(await w.tick()).toBe(false);
    expect(w.posts).toEqual([]);
    expect(w.events.some((event) => event.what === "failed")).toBe(false);

    w.reply({ chunks: [NOTE] });
    expect(await w.heard("interviewer", "What is your notice period?")).toBe(
      true,
    );
    expect(w.posts.map((post) => [post.key, post.revision])).toEqual([
      [w.key(1), 1],
    ]);
  });

  it("has nothing held when it first sees a transcript: a first look is not a new conversation", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] });
    await w.hear("interviewer", QUESTION);
    w.advance(finishedMs);
    // The first look reads, decides and calls in one go.
    expect(await w.tick()).toBe(true);
    expect(w.calls).toHaveLength(1);
  });
});

describe("a backlog", () => {
  it("is read a question at a time, in order, each note at its own moment", async () => {
    const w = world();
    const at = (minute: number) => T0 - (10 - minute) * 60_000;
    const Q1 = QUESTION;
    const A1 = "I would shard it by region first.";
    const Q2 = "And what happens when one region runs hot?";
    const A2a = "I would split that region again.";
    const A2b = "Then move the largest tenants out.";
    const Q3 = "Tell me about a time you led a migration.";
    w.say("interviewer", Q1, at(1));
    w.say("candidate", A1, at(2));
    w.say("interviewer", Q2, at(3));
    w.say("candidate", A2a, at(4));
    w.say("candidate", A2b, at(5));
    w.say("interviewer", Q3, at(6));
    const note = (ask: string) => ({
      chunks: [`ASK: ${ask}\nSAY: An answer to ${ask}.`],
    });
    w.reply(note("first"), note("second"), note("third"));

    // The two answered questions are certainly over: no pause is waited for.
    expect(await w.act()).toBe(true);
    expect(await w.act()).toBe(true);
    // The last has no answer yet: it waits for its pause like any other.
    expect(await w.tick()).toBe(false);
    w.advance(finishedMs);
    expect(await w.act()).toBe(true);
    expect(await w.tick()).toBe(false);

    const texts = (lines: string[]) =>
      lines.map((line) => line.replace(/^[A-Z]+: /, ""));
    expect(w.calls.map((call) => texts(newLines(call.prompt)))).toEqual([
      [Q1],
      [A1, Q2],
      [A2a, A2b, Q3],
    ]);
    // A stretch is put to the model without what was said after it.
    expect(soFar(w.calls[0]?.prompt ?? "")).toEqual([
      "(nothing before the new lines)",
    ]);
    expect(w.calls.slice(1).map((call) => texts(soFar(call.prompt)))).toEqual([
      [Q1],
      [Q1, A1, Q2],
    ]);
    expect(w.calls[0]?.prompt).not.toContain(A1);
    expect(w.calls[0]?.prompt).not.toContain(Q2);
    expect(w.calls[1]?.prompt).not.toContain(A2a);
    expect(w.posts.map((post) => [post.ask, post.at])).toEqual([
      ["first", new Date(at(1)).toISOString()],
      ["second", new Date(at(3)).toISOString()],
      ["third", new Date(at(6)).toISOString()],
    ]);
    const epoch = w.transcript.since().epoch;
    expect(w.calls.map((call) => call.execution["idempotencyKey"])).toEqual([
      `coach:${epoch}:1:0`,
      `coach:${epoch}:3:0`,
      `coach:${epoch}:6:0`,
    ]);
    expect(w.posts.map((post) => post.key)).toEqual([
      w.key(1),
      w.key(2),
      w.key(4),
    ]);
    expect(w.told().filter(([what]) => what === "act")).toEqual([
      ["act", "speaker-change", 1, 1],
      ["act", "speaker-change", 2, 3],
      ["act", "question-finished", 4, 6],
    ]);
  });
});

describe("a call that does not finish", () => {
  it("is taken on the next look: thrown the first time, then the same stretch is tried again and passed over", async () => {
    const w = world();
    w.reply({ end: failure(true) }, { end: failure(true) });
    await w.hear("interviewer", QUESTION);
    w.advance(finishedMs);

    // The look that begins the call does not fail: the call is in the
    // background.
    expect(await w.tick()).toBe(true);
    await w.idle();
    const first = await w.tick().catch((error: unknown) => error);
    expect(first).toBeInstanceOf(CoachCallError);
    expect((first as CoachCallError).failure).toMatchObject({
      code: "unavailable",
      retryable: true,
    });
    // [SAFETY] The error says nothing of what was said.
    expect((first as CoachCallError).message).toBe(
      "The coach's call did not finish.",
    );

    // The same stretch, again; its second failure is passed over in silence.
    expect(await w.act()).toBe(true);
    expect(w.calls).toHaveLength(2);
    const epoch = w.transcript.since().epoch;
    // The second attempt is its own call to the engine, not a replay.
    expect(w.calls.map((call) => call.execution["idempotencyKey"])).toEqual([
      `coach:${epoch}:1:0`,
      `coach:${epoch}:1:1`,
    ]);
    expect(w.calls[1]?.execution["traceId"]).toBe(
      w.calls[0]?.execution["traceId"],
    );
    expect(newLines(w.calls[1]?.prompt ?? "")).toEqual([
      `INTERVIEWER: ${QUESTION}`,
    ]);
    expect(w.told()).toEqual([
      ["act", "question-finished", 1, 1],
      ["failed", "question-finished", 1, 1],
      ["act", "question-finished", 1, 1],
      ["failed", "question-finished", 1, 1],
    ]);

    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toHaveLength(2);
    expect(w.posts).toEqual([]);

    // The next stretch starts with a clean count of attempts.
    w.reply({ chunks: [NOTE] });
    expect(await w.heard("interviewer", "And the rollback plan there?")).toBe(
      true,
    );
    expect(w.calls[2]?.execution["idempotencyKey"]).toBe(`coach:${epoch}:2:0`);
    expect(newLines(w.calls[2]?.prompt ?? "")).toEqual([
      "INTERVIEWER: And the rollback plan there?",
    ]);
    expect(w.posts).toHaveLength(1);
  });

  it("answers on the second attempt when the first failed", async () => {
    const w = world();
    w.reply({ end: failure(true) }, { chunks: [NOTE] });
    await w.hear("interviewer", QUESTION);
    w.advance(finishedMs);
    await expect(w.act()).rejects.toBeInstanceOf(CoachCallError);
    expect(await w.act()).toBe(true);
    expect(w.posts).toHaveLength(1);
    expect(w.posts[0]).toMatchObject({ revision: 1, kind: "technical" });
    expect(w.events.map((event) => event.what)).toEqual([
      "act",
      "failed",
      "act",
      "note",
    ]);
  });

  it("passes a stretch over at once when the failure cannot be retried", async () => {
    const w = world();
    w.reply({ end: failure(false) });
    await w.hear("interviewer", QUESTION);
    w.advance(finishedMs);
    // Nothing is thrown: the outcome is taken and the stretch is behind it.
    expect(await w.act()).toBe(true);
    expect(w.calls).toHaveLength(1);
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toHaveLength(1);
    expect(w.posts).toEqual([]);
    expect(w.told()).toEqual([
      ["act", "question-finished", 1, 1],
      ["failed", "question-finished", 1, 1],
    ]);
  });

  it.each(["cancelled", "nothing"] as const)(
    "treats a call that ends with %s as one to try again",
    async (end) => {
      const w = world();
      w.reply({ end }, { chunks: [NOTE] });
      await w.hear("interviewer", QUESTION);
      w.advance(finishedMs);
      const first = await w.act().catch((error: unknown) => error);
      expect(first).toBeInstanceOf(CoachCallError);
      expect((first as CoachCallError).failure).toBeUndefined();
      expect(await w.act()).toBe(true);
      expect(w.posts).toHaveLength(1);
    },
  );

  it("lets a failure to post through as it is, and asks again", async () => {
    const refused = new Error("Studio answered 503.");
    let attempts = 0;
    const w = world(
      {},
      {
        post: async () => {
          attempts += 1;
          if (attempts === 1) throw refused;
        },
      },
    );
    w.reply({ chunks: [NOTE] }, { chunks: [NOTE] });
    await w.hear("interviewer", QUESTION);
    w.advance(finishedMs);
    await expect(w.act()).rejects.toBe(refused);
    expect(await w.act()).toBe(true);
    expect([w.calls.length, attempts]).toEqual([2, 2]);
    expect(w.posts.map((post) => [post.key, post.revision])).toEqual([
      // The revision the window never got is not used again.
      [w.key(1), 2],
    ]);
  });
});

describe("a system design", () => {
  const DESIGN_PLAN = "mode: system-design\nBooking system for a clinic.";
  const DESIGN_HEAD = /^THE DESIGN SO FAR \(stage: (.+)\):$/;
  const design = (options: CoachOptions = {}) =>
    world(options, { plan: async () => DESIGN_PLAN });
  // The stage and arrows the model is told the design holds so far.
  const soFarDrawn = (prompt: string) => {
    const all = prompt.split("\n");
    const head = all.findIndex((each) => DESIGN_HEAD.test(each));
    return {
      stage: DESIGN_HEAD.exec(all[head] ?? "")?.[1],
      arrows: all.slice(head + 1).filter((each) => each.includes(" -> ")),
    };
  };
  const designKey = (w: ReturnType<typeof world>) =>
    `coach-${w.transcript.since().epoch.slice(0, 8)}-design`;
  const REQUIREMENTS = [
    "KIND: direct-answer",
    "SAME: no",
    "ASK: Booking system",
    "STAGE: requirements",
    "QUESTION: Who books, and how many a day?",
    "QUESTION: What must never be lost?",
  ].join("\n");
  const HIGH_LEVEL = [
    "ASK: Booking system",
    "STAGE: high-level",
    "SAY: Start with one **API** in front of a store.",
    "DRAW: Client -> API: book a slot",
    "DRAW: API -> Store",
  ].join("\n");
  const DETAIL = [
    "ASK: Booking system",
    "SAY: A queue takes the reminders off the request.",
    "DRAW: api -> STORE: write",
    "DRAW: API -> Reminder queue: after commit",
  ].join("\n");

  it.each([
    ["mode: system-design", true],
    ["  Mode: System-Design\nand the rest", true],
    ["mode: coding", false],
    ["Land the ledger story.\nmode: system-design", false],
    ["mode: system design", false],
  ])(
    "is the round when the plan's first line says so: %j",
    async (plan, designing) => {
      const w = world({}, { plan: async () => plan });
      w.reply({ chunks: [NOTE] });
      await w.heard("interviewer", QUESTION);
      expect(w.calls[0]?.prompt.includes("MODE: SYSTEM DESIGN.")).toBe(
        designing,
      );
      expect(w.posts.at(-1)?.key).toBe(designing ? designKey(w) : w.key(1));
    },
  );

  it("tells the model it is live coding for a plan that says so, and names the note as a conversation's", async () => {
    const w = world({}, { plan: async () => "mode: coding\nFind the N+1." });
    w.reply({
      chunks: [
        [
          "ASK: The slow list",
          "SAY: one",
          "SAY: two",
          "SAY: three",
          ...[1, 2, 3, 4, 5].map((at) => `ANCHOR: place ${at}`),
        ].join("\n"),
      ],
    });
    await w.heard("interviewer", QUESTION);
    expect(w.calls[0]?.prompt).toContain("MODE: LIVE CODING.");
    expect(w.calls[0]?.prompt).not.toContain("THE DESIGN SO FAR");
    // The coding caps: two to say, four anchors.
    expect(
      said(w.posts.at(-1)).map(([kind, lines]) => [kind, lines?.length]),
    ).toEqual([
      ["say", 2],
      ["anchors", 4],
    ]);
    expect(w.posts.at(-1)).toMatchObject({
      key: w.key(1),
      askId: `${w.key(1)}-ask`,
    });
    expect(w.posts.at(-1)).not.toHaveProperty("diagram");
  });

  it("says nothing of a mode without a plan", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] });
    await w.heard("interviewer", QUESTION);
    expect(w.calls[0]?.prompt).not.toContain("MODE:");
    expect(w.calls[0]?.prompt).not.toContain("THE DESIGN SO FAR");
  });

  it("keeps ONE note for the whole design: every reply revises it, under one question, as a technical note", async () => {
    const w = design();
    w.reply(
      { chunks: [REQUIREMENTS] },
      { chunks: [HIGH_LEVEL] },
      { chunks: [DETAIL] },
    );
    await w.heard("interviewer", "Design a booking system for a clinic?");
    w.later();
    await w.heard("interviewer", "Fine, how would you lay it out?");
    w.later();
    await w.heard("interviewer", "And where do the reminders go?");
    const key = designKey(w);
    expect(key).toMatch(/^coach-[\w-]{8}-design$/);
    expect(w.posts.length).toBeGreaterThanOrEqual(3);
    for (const post of w.posts) {
      expect(post).toMatchObject({
        key,
        askId: `${key}-ask`,
        kind: "technical",
      });
      expect(() => coachNoteInputSchema.parse(post)).not.toThrow();
    }
    // Its revisions carry on across the calls.
    expect(w.posts.map((post) => post.revision)).toEqual(
      w.posts.map((_, at) => at + 1),
    );
    // The model is reminded of it once, as it now reads.
    w.later();
    w.reply({ chunks: [SILENT_REPLY] });
    await w.heard("interviewer", "What happens when the store is down?");
    expect(under(w.calls[3]?.prompt ?? "", GIVEN_HEAD)).toHaveLength(1);
    expect(under(w.calls[3]?.prompt ?? "", GIVEN_HEAD)[0]).toContain(
      "A queue takes the reminders off the request.",
    );
  });

  it("gathers the arrows across calls, each once whatever its case, the first one's label kept, and draws them on the note", async () => {
    const w = design();
    w.reply(
      { chunks: [REQUIREMENTS] },
      { chunks: [HIGH_LEVEL] },
      { chunks: [DETAIL] },
      { chunks: [SILENT_REPLY] },
    );
    await w.heard("interviewer", "Design a booking system for a clinic?");
    expect(w.posts.at(-1)).not.toHaveProperty("diagram");
    expect(soFarDrawn(w.calls[0]?.prompt ?? "")).toEqual({
      stage: "not started",
      arrows: [],
    });
    w.later();
    await w.heard("interviewer", "Fine, how would you lay it out?");
    expect(soFarDrawn(w.calls[1]?.prompt ?? "")).toEqual({
      stage: "requirements",
      arrows: [],
    });
    expect(w.posts.at(-1)?.diagram).toBe(
      designDiagram([
        { from: "Client", to: "API", label: "book a slot" },
        { from: "API", to: "Store" },
      ]),
    );
    w.later();
    await w.heard("interviewer", "And where do the reminders go?");
    expect(soFarDrawn(w.calls[2]?.prompt ?? "")).toEqual({
      stage: "high-level",
      arrows: ["Client -> API: book a slot", "API -> Store"],
    });
    const drawn = [
      { from: "Client", to: "API", label: "book a slot" },
      { from: "API", to: "Store" },
      { from: "API", to: "Reminder queue", label: "after commit" },
    ];
    expect(w.posts.at(-1)?.diagram).toBe(designDiagram(drawn));
    // The reply named no stage: the last one is carried forward.
    w.later();
    await w.heard("interviewer", "What happens when the store is down?");
    expect(soFarDrawn(w.calls[3]?.prompt ?? "")).toEqual({
      stage: "high-level",
      arrows: [
        "Client -> API: book a slot",
        "API -> Store",
        "API -> Reminder queue: after commit",
      ],
    });
  });

  it("a reply that only draws revises the note: its drawing, and nothing to read", async () => {
    const w = design();
    w.reply({ chunks: ["DRAW: Client -> API\nDRAW: API -> Store\n"] });
    expect(await w.heard("interviewer", "How would you lay it out?")).toBe(
      true,
    );
    expect(w.posts.at(-1)).toMatchObject({
      key: designKey(w),
      sections: [],
      diagram: designDiagram([
        { from: "Client", to: "API" },
        { from: "API", to: "Store" },
      ]),
    });
    expect(() => coachNoteInputSchema.parse(w.posts.at(-1))).not.toThrow();
    expect(w.events.some((event) => event.what === "silent")).toBe(false);
  });

  // DEFECT (coach.ts:332-333, 356-359): the note is posted whole each time,
  // from THIS reply's lines and the design's arrows. A reply that adds one
  // arrow and one line therefore replaces everything the one design note
  // said before it (the five questions, the sentence that introduced the
  // design) though the note is said to hold "the whole design". Remove
  // `.fails` if the note is meant to keep what it said; delete this test if
  // each revision is meant to show only the latest lines.
  it.fails("DEFECT: a later reply does not wipe what the design's one note already said", async () => {
    const w = design();
    w.reply({ chunks: [HIGH_LEVEL] }, { chunks: ["DRAW: API -> Cache\n"] });
    await w.heard("interviewer", "How would you lay it out?");
    w.later();
    await w.heard("interviewer", "And would you cache the slots?");
    expect(JSON.stringify(w.posts.at(-1)?.sections)).toContain(
      "in front of a store",
    );
  });

  it("holds forty arrows at most: the first forty", async () => {
    const w = design();
    const arrows = (from: number, count: number) =>
      Array.from(
        { length: count },
        (_, at) => `DRAW: A${from + at} -> B${from + at}`,
      ).join("\n");
    w.reply(
      { chunks: [`SAY: The first half.\n${arrows(1, 25)}`] },
      { chunks: [`SAY: The second half.\n${arrows(26, 25)}`] },
      { chunks: [SILENT_REPLY] },
    );
    await w.heard("interviewer", "How would you lay it out?");
    w.later();
    await w.heard("interviewer", "And the rest of it there?");
    w.later();
    await w.heard("interviewer", "Is that the whole of it?");
    const held = soFarDrawn(w.calls[2]?.prompt ?? "").arrows;
    expect(held).toHaveLength(40);
    expect([held[0], held.at(-1)]).toEqual(["A1 -> B1", "A40 -> B40"]);
    for (const post of w.posts)
      expect(() => coachNoteInputSchema.parse(post)).not.toThrow();
  });

  it("does not hold the arrows of a reply that was stopped to be made again", async () => {
    const w = design();
    await w.hear("interviewer", "How would you lay it out?");
    w.advance(finishedMs);
    const first = await w.opens();
    first.text("SAY: One API.\nDRAW: Client -> Gateway\nDRAW: Gate");
    await w.flush();
    expect(w.posts.at(-1)?.diagram).toContain("Gateway");
    // The interviewer goes on: the call is made again with the whole turn.
    await w.hear("interviewer", "And say how the clinics are kept apart?");
    expect(first.stopped).toBe(true);
    w.advance(finishedMs);
    const second = await w.opens();
    expect(soFarDrawn(second.prompt).arrows).toEqual([]);
    second.text("SAY: One API per clinic.\nDRAW: Client -> Router\n");
    second.done();
    await w.idle();
    await w.tick();
    expect(w.posts.at(-1)?.diagram).toBe(
      designDiagram([{ from: "Client", to: "Router" }]),
    );
  });

  it("is forgotten with the conversation: a cleared transcript starts a design from nothing, under another note", async () => {
    const w = design();
    w.reply({ chunks: [HIGH_LEVEL] }, { chunks: [REQUIREMENTS] });
    await w.heard("interviewer", "How would you lay it out?");
    const before = designKey(w);
    expect(w.posts.at(-1)?.diagram).toBeDefined();
    w.transcript.clear();
    await w.tick();
    await w.heard("interviewer", "Design a feed for a news site?");
    expect(soFarDrawn(w.calls[1]?.prompt ?? "")).toEqual({
      stage: "not started",
      arrows: [],
    });
    const after = w.posts.at(-1);
    expect(after?.key).toBe(designKey(w));
    expect(after?.key).not.toBe(before);
    // Its revisions start again, and nothing of the old drawing is on it.
    expect(w.posts.find((post) => post.key === after?.key)?.revision).toBe(1);
    expect(after).not.toHaveProperty("diagram");
  });

  it("does not trim a look at the answer to a one-line nudge: the design's note is revised whole", async () => {
    const { candidateWords, candidateEveryMs } = TURN_TIMING;
    const w = design();
    w.reply(
      { chunks: [HIGH_LEVEL] },
      {
        chunks: [
          [
            "KIND: missed-opportunity",
            "ASK: Booking system",
            "STAGE: detail",
            "SAY: Say where the **double booking** is stopped.",
            "SAY: Then the reminder path.",
            "ANCHOR: unique slot, queue",
            "DRAW: API -> Lock: hold the slot",
          ].join("\n"),
        ],
      },
      { chunks: [SILENT_REPLY] },
    );
    await w.heard("interviewer", "How would you lay it out?", finishedMs);
    await w.hear("candidate", points(candidateWords));
    w.advance(candidateEveryMs);
    expect(await w.act()).toBe(true);
    expect(w.events.some((event) => event.reason === "answer-check")).toBe(
      true,
    );
    const last = w.posts.at(-1);
    expect(last).toMatchObject({
      key: designKey(w),
      askId: `${designKey(w)}-ask`,
      kind: "technical",
    });
    expect(said(last)).toEqual([
      [
        "say",
        ["Say where the double booking is stopped.", "Then the reminder path."],
      ],
      ["anchors", ["unique slot, queue"]],
    ]);
    expect(last?.diagram).toContain("hold the slot");
  });

  it("tells the three things of a call by one stretch and one key", async () => {
    const w = design();
    w.reply({ chunks: [HIGH_LEVEL] }, { chunks: [SILENT_REPLY] });
    await w.heard("interviewer", "How would you lay it out?");
    w.later();
    await w.heard("interviewer", "And would you cache the slots?");
    const first = w.events.slice(0, -2);
    const second = w.events.slice(-2);
    expect(second.map((event) => event.what)).toEqual(["act", "silent"]);
    expect(first.map((event) => event.what)).toEqual([
      "act",
      ...first.slice(1).map(() => "note"),
    ]);
    for (const events of [first, second]) {
      expect(new Set(events.map((event) => event.from)).size).toBe(1);
      expect(new Set(events.map((event) => event.key)).size).toBe(1);
    }
    expect(first.at(-1)).toMatchObject({ what: "note", final: true });
  });
});

describe("a warning already given", () => {
  const FIRST = "Say NestJS not Express when naming the framework";
  const AGAIN = "Name NestJS not Express for the framework";
  const OTHER = "Give the rollback before the migration figure";
  const note = (ask: string, ...lines: string[]) =>
    ["KIND: technical", "SAME: no", `ASK: ${ask}`, ...lines].join("\n");
  const cautions = (post: CoachNoteInput | undefined) =>
    said(post).find(([kind]) => kind === "caution")?.[1] ?? [];

  it("is dropped from a later note, which keeps its other lines", async () => {
    const w = world();
    w.reply(
      { chunks: [note("Sharding", "SAY: By region.", `CAUTION: ${FIRST}`)] },
      { chunks: [note("Hot region", "SAY: Split it.", `CAUTION: ${AGAIN}`)] },
    );
    await w.heard("interviewer", QUESTION);
    w.later();
    await w.heard("interviewer", HOT);
    expect(cautions(w.posts.findLast((post) => post.key === w.key(1)))).toEqual(
      [FIRST],
    );
    const second = w.posts.at(-1);
    expect(second?.key).toBe(w.key(2));
    expect(said(second)).toEqual([["say", ["Split it."]]]);
    expect(
      JSON.stringify(w.posts.filter((post) => post.key === w.key(2))),
    ).not.toContain("NestJS");
  });

  it("leaves a later note that had nothing else unposted: the reply is told as silent", async () => {
    const w = world();
    w.reply(
      { chunks: [note("Sharding", "SAY: By region.", `CAUTION: ${FIRST}`)] },
      { chunks: [note("Hot region", `CAUTION: ${AGAIN}`)] },
      { chunks: [SILENT_REPLY] },
    );
    await w.heard("interviewer", QUESTION);
    const before = w.posts.length;
    w.later();
    expect(await w.heard("interviewer", HOT)).toBe(true);
    expect(w.posts).toHaveLength(before);
    expect(w.events.at(-1)).toMatchObject({ what: "silent", from: 2 });
    // Nothing was given, so nothing is remembered as given.
    w.later();
    await w.heard("interviewer", ROLLBACK);
    expect(given(w.calls[2]?.prompt ?? "")).toEqual(["- [technical] Sharding"]);
  });

  it("is kept when it says another thing", async () => {
    const w = world();
    w.reply(
      { chunks: [note("Sharding", "SAY: By region.", `CAUTION: ${FIRST}`)] },
      { chunks: [note("Hot region", "SAY: Split it.", `CAUTION: ${OTHER}`)] },
    );
    await w.heard("interviewer", QUESTION);
    w.later();
    await w.heard("interviewer", HOT);
    expect(cautions(w.posts.at(-1))).toEqual([OTHER]);
  });

  it.each([
    // Of the five words that carry the later warning, how many the first has.
    ["three of five", "NestJS Express framework alpha bravo", false],
    ["two of five", "NestJS Express alpha bravo charlie", true],
  ])(
    "repeats it when most of its carrying words are shared: %s",
    async (_name, later, kept) => {
      const w = world();
      w.reply(
        { chunks: [note("Sharding", "SAY: By region.", `CAUTION: ${FIRST}`)] },
        { chunks: [note("Hot region", "SAY: Split it.", `CAUTION: ${later}`)] },
      );
      await w.heard("interviewer", QUESTION);
      w.later();
      await w.heard("interviewer", HOT);
      expect(cautions(w.posts.at(-1))).toEqual(kept ? [later] : []);
    },
  );

  it("stays on the note it was given in when that note is revised in place", async () => {
    const w = world();
    w.reply(
      { chunks: [note("Sharding", "SAY: By region.", `CAUTION: ${FIRST}`)] },
      {
        chunks: [
          note(
            "Sharding and the hot region",
            "SAY: By region, then split.",
            `CAUTION: ${AGAIN}`,
          ),
        ],
      },
      { chunks: [note("Rollback", "SAY: Flag it off.", `CAUTION: ${FIRST}`)] },
    );
    await w.heard("interviewer", QUESTION, finishedMs);
    // Added before the candidate spoke: the same note, revised.
    await w.heard("interviewer", "And what about hot regions?", finishedMs);
    const revised = w.posts.at(-1);
    expect(revised?.key).toBe(w.key(1));
    expect(cautions(revised)).toEqual([AGAIN]);
    // It is still a warning given: another note does not give it again.
    w.later();
    await w.heard("interviewer", ROLLBACK);
    expect(w.posts.at(-1)?.key).toBe(w.key(3));
    expect(cautions(w.posts.at(-1))).toEqual([]);
  });

  it("is shown as it is written within its own note: the finished note keeps it", async () => {
    const w = world();
    w.reply({
      chunks: [
        `${note("Sharding", "SAY: By region.", `CAUTION: ${FIRST}`)}\n`,
        "ANCHOR: region\n",
      ],
      gapMs: 600,
    });
    await w.heard("interviewer", QUESTION);
    expect(w.posts.length).toBeGreaterThan(1);
    for (const post of w.posts) expect(cautions(post)).toEqual([FIRST]);
  });

  it("is forgotten with the conversation", async () => {
    const w = world();
    w.reply(
      { chunks: [note("Sharding", "SAY: By region.", `CAUTION: ${FIRST}`)] },
      { chunks: [note("Hot region", "SAY: Split it.", `CAUTION: ${AGAIN}`)] },
    );
    await w.heard("interviewer", QUESTION);
    w.transcript.clear();
    await w.tick();
    await w.heard("interviewer", HOT);
    expect(cautions(w.posts.at(-1))).toEqual([AGAIN]);
  });

  it("a look at the answer that only repeats it posts nothing", async () => {
    const { candidateWords, candidateEveryMs } = TURN_TIMING;
    const w = world();
    w.reply(
      { chunks: [note("Sharding", "SAY: By region.", `CAUTION: ${FIRST}`)] },
      { chunks: [note("Sharding", `CAUTION: ${AGAIN}`)] },
    );
    await w.heard("interviewer", QUESTION, finishedMs);
    const before = w.posts.length;
    await w.hear("candidate", points(candidateWords));
    w.advance(candidateEveryMs);
    expect(await w.act()).toBe(true);
    expect(w.posts).toHaveLength(before);
    expect(w.events.at(-1)).toMatchObject({
      what: "silent",
      reason: "answer-check",
    });
  });
});

describe("how much the coach remembers of a call", () => {
  const LOG_HEAD = "WHAT YOU HAVE NOTED SO FAR IN THIS CALL (oldest first):";

  it("carries thirty of its own lines at most, the oldest falling away, each cut to 200 characters", async () => {
    const w = world();
    // Eleven silent replies of three lines each, then one more call to read
    // what is held.
    for (let call = 0; call < 11; call += 1)
      w.reply({
        chunks: [
          [
            SILENT_REPLY,
            ...[1, 2, 3].map((at) =>
              call === 10 && at === 3
                ? `LOG: ${"z".repeat(260)}`
                : `LOG: fact ${call * 3 + at}`,
            ),
            // A fourth line of one reply is never taken.
            `LOG: surplus ${call}`,
          ].join("\n"),
        ],
      });
    w.reply({ chunks: [SILENT_REPLY] });
    for (let call = 0; call < 12; call += 1) {
      w.later();
      expect(
        await w.heard("interviewer", `And what about topic ${call} there?`),
      ).toBe(true);
    }
    const held = under(w.calls[11]?.prompt ?? "", LOG_HEAD);
    expect(held).toHaveLength(30);
    expect(held[0]).toBe("- fact 4");
    expect(held[28]).toBe("- fact 32");
    expect(held[29]).toBe(`- ${"z".repeat(199)}…`);
    expect(held.join("\n")).not.toContain("surplus");
    expect(w.posts).toEqual([]);
  });

  it("remembers what a reply logged beside a note that was not posted", async () => {
    const w = world();
    w.reply(
      { chunks: ["KIND: technical\nLOG: The panel is three engineers"] },
      { chunks: [SILENT_REPLY] },
    );
    await w.heard("interviewer", QUESTION);
    w.later();
    await w.heard("interviewer", HOT);
    expect(w.posts).toEqual([]);
    expect(under(w.calls[1]?.prompt ?? "", LOG_HEAD)).toEqual([
      "- The panel is three engineers",
    ]);
  });
});
