// The live coach against a model the test holds by hand: when it calls, that
// it never waits for the call, what it does when the interviewer goes on
// while a call runs, what it posts while a note is written, what it tells
// whoever watches, and what it does when a call fails. The transcript is the
// real in-memory one; the clock is the test's own. Every line said is invented.
import type { Failure } from "@omnitech/ai-engine";
import {
  type CoachNoteInput,
  type CoachSpace,
  type CoachSpeaker,
  type CoachTranscriptResponse,
  type CoachTranscriptSession,
  coachNoteInputSchema,
} from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import { createCoachTranscript } from "../coach-transcript";
import {
  COACH_LEDGER_VERSION,
  CoachCallError,
  type CoachEvent,
  type CoachLedger,
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
  // Every user message of the call, in the order given.
  users: string[];
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
    // What the coach is answered, made from what the transcript holds.
    read?: (answer: CoachTranscriptResponse) => CoachTranscriptResponse;
    // Where the coach keeps its ledger. Absent: it has nowhere to.
    ledger?: NonNullable<CoachPorts["ledger"]>;
    // The transcript the coach reads, when another coach reads it too (a
    // coach that is restarted mid-conversation). Absent: one of its own.
    transcript?: ReturnType<typeof createCoachTranscript>;
  } = {},
) {
  let clock = T0;
  const transcript = live.transcript ?? createCoachTranscript();
  const script: Scripted[] = [];
  const calls: Open[] = [];
  const posts: CoachNoteInput[] = [];
  // The space each post was made to, beside `posts`.
  const spaces: (CoachSpace | undefined)[] = [];
  // The conversation each post was written from, beside `posts`.
  const conversations: (string | undefined)[] = [];
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
        users: input.messages
          .filter((message) => message.role === "user")
          .map((message) => message.parts.map((part) => part.text).join("")),
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
          const answer = transcript.since(after);
          return live.read ? live.read(answer) : answer;
        },
      },
      notes: {
        post: async (note, _signal, space, conversation) => {
          await live.post?.(note);
          posts.push(note);
          spaces.push(space);
          conversations.push(conversation);
        },
      },
      ...(live.ledger ? { ledger: live.ledger } : {}),
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
    spaces,
    conversations,
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

  it("reads the plan as it starts to listen, before any call is made, and not again for the first call", async () => {
    let reads = 0;
    const w = world(
      {},
      {
        plan: async () => {
          reads += 1;
          return PLAN;
        },
      },
    );
    expect(await w.tick()).toBe(false);
    expect(reads).toBe(1);
    expect(w.calls).toEqual([]);
    w.reply({ chunks: [SILENT_REPLY] });
    await w.heard("interviewer", QUESTION);
    expect(under(w.calls[0]?.prompt ?? "", PLAN_HEAD)).toEqual([PLAN]);
    expect(reads).toBe(1);
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

  it("a later reply that only draws keeps what the design's one note already said: the drawing grows, the words stay", async () => {
    const w = design();
    w.reply(
      { chunks: [HIGH_LEVEL] },
      { chunks: ["DRAW: API -> Cache\n"] },
      { chunks: ["DRAW: Cache -> Store\n"] },
    );
    await w.heard("interviewer", "How would you lay it out?");
    const words = w.posts.at(-1)?.sections;
    expect(said(w.posts.at(-1))).toEqual([
      ["say", ["Start with one API in front of a store."]],
    ]);
    w.later();
    await w.heard("interviewer", "And would you cache the slots?");
    expect(w.posts.at(-1)?.sections).toEqual(words);
    expect(w.posts.at(-1)?.diagram).toBe(
      designDiagram([
        { from: "Client", to: "API", label: "book a slot" },
        { from: "API", to: "Store" },
        { from: "API", to: "Cache" },
      ]),
    );
    // And again: the words kept are still the last ones written.
    w.later();
    await w.heard("interviewer", "And where does the cache read from?");
    expect(w.posts.at(-1)?.sections).toEqual(words);
    expect(w.posts.at(-1)?.diagram).toContain('["Cache"] --> ');
    expect(w.posts.at(-1)?.key).toBe(designKey(w));
  });

  it("a later reply with words of its own replaces the note's words", async () => {
    const w = design();
    w.reply({ chunks: [HIGH_LEVEL] }, { chunks: [DETAIL] });
    await w.heard("interviewer", "How would you lay it out?");
    w.later();
    await w.heard("interviewer", "And how are the reminders sent?");
    expect(said(w.posts.at(-1))).toEqual([
      ["say", ["A queue takes the reminders off the request."]],
    ]);
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

describe("whose notes the coach writes", () => {
  it("posts a live session's notes as the person's own", async () => {
    const w = world({}, { session: SESSION });
    w.reply({ chunks: ["SAY: one.\n", "SAY: two.\n"], gapMs: 600 });
    await w.heard("interviewer", QUESTION);
    expect(w.posts.length).toBeGreaterThan(1);
    expect(w.spaces).toEqual(w.posts.map(() => "live"));
  });

  it("posts the notes of an attached transcript to the replay, every revision of them", async () => {
    const w = world();
    w.reply({ chunks: ["SAY: one.\n", "SAY: two.\n"], gapMs: 600 });
    await w.heard("interviewer", QUESTION);
    expect(w.posts.length).toBeGreaterThan(1);
    expect(w.spaces).toEqual(w.posts.map(() => "replay"));
  });

  it("reads an answer that names no space as live", async () => {
    const w = world({}, { read: ({ space: _space, ...answer }) => answer });
    w.reply({ chunks: [NOTE] });
    await w.heard("interviewer", QUESTION);
    expect(w.spaces).toEqual(["live"]);
  });

  it("follows the transcript: a replay attached after a live session is posted apart, and the live one after it is the person's own again", async () => {
    const w = world();
    const live = (text: string) =>
      w.transcript.add(
        [{ speaker: "interviewer", text, at: new Date(w.now()).toISOString() }],
        SESSION,
      );
    w.reply({ chunks: [NOTE] }, { chunks: [NOTE] }, { chunks: [NOTE] });
    live(QUESTION);
    await w.tick();
    w.advance(pauseMs);
    await w.act();
    expect(w.spaces).toEqual(["live"]);
    // Attached with no session: another conversation, under a new epoch.
    w.say("interviewer", HOT);
    await w.tick();
    await w.tick();
    w.advance(pauseMs);
    await w.act();
    expect(w.spaces).toEqual(["live", "replay"]);
    expect(w.posts[1]?.key).toBe(w.key(1));
    expect(w.posts[1]?.key).not.toBe(w.posts[0]?.key);
    live(ROLLBACK);
    await w.tick();
    await w.tick();
    w.advance(pauseMs);
    await w.act();
    expect(w.spaces).toEqual(["live", "replay", "live"]);
  });

  it("a design's one note goes where the transcript's notes go", async () => {
    const w = world(
      {},
      { plan: async () => "mode: system-design\nBooking system." },
    );
    w.reply({ chunks: ["SAY: One API.\nDRAW: Client -> API\n"] });
    await w.heard("interviewer", "How would you lay it out?");
    expect(w.spaces).toEqual(["replay"]);
  });
});

describe("the shared screen", () => {
  const SCREEN_HEAD =
    "ON THE SHARED SCREEN (text read from the latest capture; it may be cut or misread):";
  const WHY_SCREEN = "WHY NOW: what is on the shared screen has changed.";
  const TASK = "def available_slots(day): # TODO return the free slots";
  const FAILING = "FAILED test_slots.py::test_overlap - AssertionError";
  const CODING_PLAN = "mode: coding\nFix the booking service.";
  const SCREEN_NOTE = [
    "ASK: The failing slot test",
    "ANCHOR: The overlap check in available_slots",
    "CAUTION: Write the failing test first.",
  ].join("\n");
  const coding = (plan = CODING_PLAN) =>
    world({}, { session: SESSION, plan: async () => plan });
  const screenKey = (w: ReturnType<typeof world>, from: number) =>
    `coach-${w.transcript.since().epoch.slice(0, 8)}-screen-${from}`;
  const screenActs = (w: ReturnType<typeof world>) =>
    w.events.filter(
      (event) => event.what === "act" && event.reason === "screen-change",
    );

  it("is put before the new lines of every call while it is held, and left out when there is none", async () => {
    const w = world({}, { session: SESSION });
    w.reply({ chunks: [SILENT_REPLY] }, { chunks: [SILENT_REPLY] });
    await w.heard("interviewer", QUESTION);
    expect(w.calls[0]?.prompt).not.toContain("ON THE SHARED SCREEN");
    w.transcript.setScreen(TASK, SESSION);
    w.later();
    await w.heard("interviewer", HOT);
    const prompt = w.calls[1]?.prompt ?? "";
    expect(under(prompt, SCREEN_HEAD)).toEqual([TASK]);
    expect(prompt.indexOf(SCREEN_HEAD)).toBeGreaterThan(
      prompt.indexOf("THE CONVERSATION SO FAR:"),
    );
    expect(prompt.indexOf(SCREEN_HEAD)).toBeLessThan(
      prompt.indexOf("NEW LINES (decide on these):"),
    );
  });

  it.each([
    ["a conversation (no plan)", undefined],
    ["a conversation (a plan that names no mode)", "Land the ledger story."],
    ["a system design", "mode: system-design\nBooking system."],
  ])(
    "is only context in %s: a changed screen alone starts no call",
    async (_name, plan) => {
      const w = world(
        {},
        { session: SESSION, ...(plan ? { plan: async () => plan } : {}) },
      );
      w.reply({ chunks: [SILENT_REPLY] });
      await w.heard("interviewer", QUESTION);
      w.transcript.setScreen(TASK, SESSION);
      w.advance(120_000);
      expect(await w.tick()).toBe(false);
      expect(w.calls).toHaveLength(1);
      expect(screenActs(w)).toEqual([]);
    },
  );

  it("in live coding a changed screen is looked at once 15 s have passed since the coach last acted, under a key of its own", async () => {
    const w = coding();
    w.reply({ chunks: [SILENT_REPLY] }, { chunks: [SCREEN_NOTE] });
    await w.heard("interviewer", QUESTION);
    w.transcript.setScreen(TASK, SESSION);
    expect(await w.tick()).toBe(false);
    w.advance(14_999);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toHaveLength(1);
    w.advance(1);
    expect(await w.act()).toBe(true);

    expect(w.calls).toHaveLength(2);
    const prompt = w.calls[1]?.prompt ?? "";
    expect(under(prompt, SCREEN_HEAD)).toEqual([TASK]);
    // Nothing new was said: the screen is what there is to decide on.
    expect(newLines(prompt)).toEqual(["(nothing new was said)"]);
    expect(prompt).toContain(WHY_SCREEN);
    expect(prompt).toContain("MODE: LIVE CODING.");
    // The note is told as it is written, and again as it is finished.
    expect(w.told().slice(-3)).toEqual([
      ["act", "screen-change", 1, 1],
      ["note", "screen-change", 1, 1],
      ["note", "screen-change", 1, 1],
    ]);
    expect(w.events.at(-1)?.key).toBe(screenKey(w, 1));
    expect(w.posts.length).toBeGreaterThan(0);
    for (const post of w.posts)
      expect(post).toMatchObject({
        key: screenKey(w, 1),
        askId: `${screenKey(w, 1)}-ask`,
      });
    expect(said(w.posts.at(-1))).toEqual([
      ["anchors", ["The overlap check in available_slots"]],
      ["caution", ["Write the failing test first."]],
    ]);
    expect(w.spaces).toEqual(w.posts.map(() => "live"));
    expect(() => coachNoteInputSchema.parse(w.posts.at(-1))).not.toThrow();
  });

  it("is looked at once: the same screen read again is not a change, a screen that reads differently is", async () => {
    const w = coding();
    w.reply(
      { chunks: [SILENT_REPLY] },
      { chunks: [SILENT_REPLY] },
      { chunks: [SILENT_REPLY] },
    );
    await w.heard("interviewer", QUESTION);
    w.transcript.setScreen(TASK, SESSION);
    w.advance(15_000);
    expect(await w.act()).toBe(true);
    expect(screenActs(w)).toHaveLength(1);
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    // The next capture reads the same.
    w.transcript.setScreen(`  ${TASK}  `, SESSION);
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toHaveLength(2);

    w.transcript.setScreen(FAILING, SESSION);
    expect(await w.act()).toBe(true);
    expect(screenActs(w)).toHaveLength(2);
    expect(under(w.calls[2]?.prompt ?? "", SCREEN_HEAD)).toEqual([FAILING]);
  });

  it("two changes within 15 s are one more look, at the latest screen", async () => {
    const w = coding();
    w.reply(
      { chunks: [SILENT_REPLY] },
      { chunks: [SILENT_REPLY] },
      { chunks: [SILENT_REPLY] },
    );
    await w.heard("interviewer", QUESTION);
    w.transcript.setScreen(TASK, SESSION);
    w.advance(15_000);
    await w.act();
    w.transcript.setScreen("an edit in between", SESSION);
    w.advance(5_000);
    expect(await w.tick()).toBe(false);
    w.transcript.setScreen(FAILING, SESSION);
    w.advance(9_999);
    expect(await w.tick()).toBe(false);
    w.advance(1);
    expect(await w.act()).toBe(true);
    expect(w.calls).toHaveLength(3);
    expect(under(w.calls[2]?.prompt ?? "", SCREEN_HEAD)).toEqual([FAILING]);
  });

  it("waits until nothing was said for 1.5 s, then reads what was said with it; the mode is known before the first call", async () => {
    const w = coding();
    w.reply({ chunks: [SCREEN_NOTE] }, { chunks: [SILENT_REPLY] });
    expect(await w.hear("candidate", "Let me read the test first.")).toBe(
      false,
    );
    w.transcript.setScreen(TASK, SESSION);
    w.advance(1_499);
    expect(await w.tick()).toBe(false);
    // Something more is said: the quiet is counted again from it.
    expect(await w.hear("candidate", "It builds the slots per day.")).toBe(
      false,
    );
    w.advance(1_499);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toEqual([]);
    w.advance(1);
    expect(await w.act()).toBe(true);
    expect(w.told()).toEqual([
      ["act", "screen-change", 1, 2],
      ["note", "screen-change", 1, 2],
      ["note", "screen-change", 1, 2],
    ]);
    expect(w.posts[0]?.key).toBe(screenKey(w, 1));
    expect(newLines(w.calls[0]?.prompt ?? "")).toEqual([
      "CANDIDATE: Let me read the test first.",
      "CANDIDATE: It builds the slots per day.",
    ]);
    // What it read with the screen is decided on: it is not new again.
    w.later();
    await w.heard("interviewer", QUESTION);
    expect(newLines(w.calls[1]?.prompt ?? "")).toEqual([
      `INTERVIEWER: ${QUESTION}`,
    ]);
  });

  it("is not looked at while nothing has been said at all", async () => {
    const w = coding();
    w.transcript.setScreen(TASK, SESSION);
    w.advance(120_000);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toEqual([]);
    expect(w.events).toEqual([]);
  });

  it("is not looked at while a call is in hand", async () => {
    const w = coding();
    w.say("interviewer", QUESTION);
    await w.tick();
    w.advance(finishedMs);
    const call = await w.opens();
    w.transcript.setScreen(TASK, SESSION);
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toHaveLength(1);
    call.text(SILENT_REPLY);
    call.done();
    await w.idle();
    expect(await w.tick()).toBe(true);
    w.reply({ chunks: [SILENT_REPLY] });
    expect(await w.act()).toBe(true);
    expect(screenActs(w)).toHaveLength(1);
  });

  it("is forgotten with the conversation when the transcript is cleared", async () => {
    const w = coding();
    w.reply({ chunks: [SILENT_REPLY] }, { chunks: [SILENT_REPLY] });
    await w.heard("interviewer", QUESTION);
    w.transcript.setScreen(TASK, SESSION);
    await w.tick();
    w.transcript.clear();
    await w.tick();
    w.advance(60_000);
    w.say("interviewer", HOT);
    await w.tick();
    w.advance(pauseMs);
    await w.act();
    expect(w.calls).toHaveLength(2);
    expect(w.calls[1]?.prompt).not.toContain("ON THE SHARED SCREEN");
    expect(screenActs(w)).toEqual([]);
  });

  it("is never read for a replay: a transcript attached with no session holds no screen", async () => {
    const w = world({}, { plan: async () => CODING_PLAN });
    w.reply({ chunks: [SILENT_REPLY] });
    await w.heard("interviewer", QUESTION);
    w.transcript.setScreen(TASK, SESSION);
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toHaveLength(1);
  });
});

// A note written a piece at a time: three revisions of it are posted.
const WRITTEN = {
  gapMs: 500,
  chunks: [
    "KIND: technical\nSAME: no\nASK: Sharding the booking table\n",
    "SAY: I would shard by **region** first.\nSAY: Then by ",
    "tenant inside a region.\nANCHOR: region, tenant",
  ],
} as const;

describe("the conversation a note was written from", () => {
  it("is named on every post, as the transcript's epoch: every revision of a note, and every note", async () => {
    const w = world();
    w.reply(WRITTEN, { chunks: [NOTE] });
    await w.heard("interviewer", QUESTION);
    w.later();
    await w.heard("interviewer", HOT);
    const epoch = w.transcript.since().epoch;
    expect(w.posts.map((post) => post.revision)).toEqual([1, 2, 3, 1]);
    expect(w.conversations).toEqual([epoch, epoch, epoch, epoch]);
    // It is told beside the space, never instead of it.
    expect(w.spaces).toEqual(w.posts.map(() => "replay"));
  });

  it("follows the transcript: a note written after a clear names the new conversation", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] }, { chunks: [NOTE] });
    await w.heard("interviewer", QUESTION);
    const before = w.transcript.since().epoch;
    w.transcript.clear();
    await w.tick();
    await w.heard("interviewer", "What is your notice period?");
    const after = w.transcript.since().epoch;
    expect(after).not.toBe(before);
    expect(w.conversations).toEqual([before, after]);
  });

  it("is named for a live session's notes and for a design's one note alike", async () => {
    const w = world(
      {},
      {
        session: SESSION,
        plan: async () => "mode: system-design\nBooking system for a clinic.",
      },
    );
    w.reply({
      chunks: ["ASK: Booking system\nSAY: Start with one **API**."],
    });
    await w.heard("interviewer", "Design a booking system for a clinic?");
    expect(w.posts).toHaveLength(1);
    expect(w.conversations).toEqual([w.transcript.since().epoch]);
    expect(w.spaces).toEqual(["live"]);
  });

  it("a post refused because the conversation is over is a failed call like any other, and is not written again in the next one", async () => {
    // What the worker's Studio client does with a refusal is its own (it
    // reads 409 as nothing to do); here the port itself throws.
    const refused = new Error("the conversation is over");
    let over = false;
    const w = world(
      {},
      {
        post: async () => {
          if (over) throw refused;
        },
      },
    );
    await w.hear("interviewer", QUESTION);
    w.advance(finishedMs);
    const call = await w.opens();
    over = true;
    w.transcript.clear();
    call.text(NOTE);
    call.done();
    await w.flush();
    // The coach sees the new conversation: the old call is stopped and
    // nothing of it is thrown or told as a failure.
    expect(await w.tick()).toBe(true);
    await w.flush();
    expect(await w.tick()).toBe(false);
    expect(w.posts).toEqual([]);
    expect(w.events.some((event) => event.what === "failed")).toBe(false);
  });
});

describe("who is speaking, as the coach hears it", () => {
  // The feed says who is speaking: the coach is answered that with the lines.
  function speaking(
    first: CoachSpeaker[] | undefined,
    options: CoachOptions = {},
  ) {
    const said: { now: CoachSpeaker[] | undefined } = { now: first };
    const w = world(options, {
      read: (answer) => {
        const { speaking: _dropped, ...rest } = answer;
        return said.now ? { ...rest, speaking: said.now } : rest;
      },
    });
    return {
      w,
      speaks: (...who: CoachSpeaker[]) => {
        said.now = who;
      },
      unknown: () => {
        said.now = undefined;
      },
    };
  }
  const TRAILING = "So the booking platform runs across nine regions and";

  it("makes no call on a finished question while the interviewer is still speaking, however long since a line arrived", async () => {
    const { w, speaks } = speaking(["interviewer"]);
    await w.hear("interviewer", QUESTION);
    for (const waited of [finishedMs, pauseMs, trailingMs, 120_000]) {
      w.advance(waited);
      expect(await w.tick()).toBe(false);
    }
    expect(w.calls).toEqual([]);
    expect(w.events).toEqual([]);
    // They stop: the question is acted on at the next look.
    speaks();
    w.reply({ chunks: [NOTE] });
    expect(await w.act()).toBe(true);
    expect(w.told()[0]).toEqual(["act", "question-finished", 1, 1]);
    expect(w.posts).toHaveLength(1);
  });

  it("makes no call when the candidate starts to answer while the interviewer is still speaking", async () => {
    const { w, speaks } = speaking(["interviewer"]);
    await w.hear("interviewer", "How would you shard the booking table,");
    expect(
      await w.hear("candidate", "I would start with the region first."),
    ).toBe(false);
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toEqual([]);
    // The rest of the question lands; they stop; the answer has begun.
    w.say(
      "interviewer",
      "given that nearly all of the traffic stays inside one region?",
    );
    speaks();
    w.reply({ chunks: [NOTE] });
    expect(await w.act()).toBe(true);
    expect(w.told()[0]).toEqual(["act", "speaker-change", 1, 1]);
  });

  it("an unnamed voice speaking counts as the interviewer speaking", async () => {
    const { w, speaks } = speaking(["unknown"]);
    await w.hear("interviewer", QUESTION);
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toEqual([]);
    // Beside the candidate's voice it still holds the coach back.
    speaks("candidate", "unknown");
    expect(await w.tick()).toBe(false);
    speaks();
    expect(await w.tick()).toBe(true);
    expect(w.told()[0]).toEqual(["act", "question-finished", 1, 1]);
  });

  it("the candidate speaking does not hold the question's call back", async () => {
    const { w } = speaking(["candidate"]);
    await w.hear("interviewer", QUESTION);
    w.advance(finishedMs - 1);
    expect(await w.tick()).toBe(false);
    w.advance(1);
    expect(await w.tick()).toBe(true);
    expect(w.told()[0]).toEqual(["act", "question-finished", 1, 1]);
  });

  it("a turn that trails off is acted on after the ordinary pause once nobody is known to be speaking", async () => {
    const { w } = speaking([]);
    await w.hear("interviewer", TRAILING);
    w.advance(pauseMs - 1);
    expect(await w.tick()).toBe(false);
    w.advance(1);
    expect(await w.tick()).toBe(true);
    expect(w.told()[0]).toEqual(["act", "pause", 1, 1]);
  });

  it("where the feed cannot tell who is speaking the coach waits out the long pause, as before", async () => {
    const { w } = speaking(undefined);
    await w.hear("interviewer", TRAILING);
    w.advance(pauseMs);
    expect(await w.tick()).toBe(false);
    w.advance(trailingMs - pauseMs - 1);
    expect(await w.tick()).toBe(false);
    w.advance(1);
    expect(await w.tick()).toBe(true);
    expect(w.told()[0]).toEqual(["act", "pause", 1, 1]);
  });

  it("is read afresh at every look: a feed that stops telling is not remembered as still speaking", async () => {
    const { w, unknown } = speaking(["interviewer"]);
    await w.hear("interviewer", QUESTION);
    w.advance(finishedMs);
    expect(await w.tick()).toBe(false);
    unknown();
    expect(await w.tick()).toBe(true);
  });

  it("takes the shorter pause from the options", async () => {
    const { w } = speaking([], { timing: { pauseMs: 400 } });
    await w.hear("interviewer", TRAILING);
    w.advance(399);
    expect(await w.tick()).toBe(false);
    w.advance(1);
    expect(await w.tick()).toBe(true);
  });

  it("hears it from the transcript itself: what an audio source reported holds the coach back until it says it stopped", async () => {
    const w = world();
    // The first line begins the conversation; the report is of it.
    await w.hear("interviewer", "Thanks for joining us today.");
    w.transcript.setSpeaking("interviewer", true);
    await w.hear("interviewer", QUESTION);
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    w.transcript.setSpeaking("interviewer", false);
    expect(await w.tick()).toBe(true);
    expect(w.told()[0]).toEqual(["act", "question-finished", 1, 2]);
  });

  it("the look at the candidate's answer is made at a gap in the text, whoever is said to be speaking", async () => {
    const { candidateWords, candidateEveryMs } = TURN_TIMING;
    const { w } = speaking(["candidate"]);
    w.reply({ chunks: [NOTE] }, { chunks: [SILENT_REPLY] });
    await w.heard("interviewer", QUESTION, finishedMs);
    await w.hear("candidate", points(candidateWords));
    w.advance(candidateEveryMs);
    expect(await w.act()).toBe(true);
    expect(w.told().filter(([what]) => what === "act")).toEqual([
      ["act", "question-finished", 1, 1],
      ["act", "answer-check", 2, 2],
    ]);
  });
});

describe("the coach's ledger of the conversation", () => {
  // A place a ledger is kept, as the Studio keeps it: the latest only, given
  // back whatever conversation is asked for (the coach checks that itself).
  function keeping(first?: CoachLedger) {
    const store: {
      kept: CoachLedger | undefined;
      saved: CoachLedger[];
      loads: string[];
    } = { kept: first, saved: [], loads: [] };
    const port: NonNullable<CoachPorts["ledger"]> = {
      load: async (epoch) => {
        store.loads.push(epoch);
        return store.kept ? structuredClone(store.kept) : undefined;
      },
      save: async (ledger) => {
        const copy = structuredClone(ledger);
        store.saved.push(copy);
        store.kept = copy;
      },
    };
    return { store, port };
  }
  // A coach started on a conversation another coach had begun: the same
  // transcript, the same place for the ledger, nothing else carried over.
  const restarted = (
    from: ReturnType<typeof world>,
    port: NonNullable<CoachPorts["ledger"]>,
    live: Parameters<typeof world>[1] = {},
    options: CoachOptions = {},
  ) => world(options, { ...live, transcript: from.transcript, ledger: port });
  const LOG_HEAD = "WHAT YOU HAVE NOTED SO FAR IN THIS CALL (oldest first):";
  const empty = (
    epoch: string,
    more: Partial<CoachLedger> = {},
  ): CoachLedger => ({
    version: COACH_LEDGER_VERSION,
    epoch,
    readTo: 0,
    given: [],
    log: [],
    cautions: [],
    design: { edges: [] },
    revisions: [],
    looks: 0,
    nudged: false,
    ...more,
  });

  it("is version 1", () => {
    expect(COACH_LEDGER_VERSION).toBe(1);
  });

  describe("kept", () => {
    it("is saved when a revision is posted (the revision alone) and again when the call has settled: how far the coach read, the note it gave and its last revision", async () => {
      const { store, port } = keeping();
      const w = world({}, { ledger: port });
      await w.hear("interviewer", QUESTION);
      const epoch = w.transcript.since().epoch;
      w.advance(finishedMs);
      const call = await w.opens();
      // A call that has written nothing has changed nothing.
      expect(store.saved).toEqual([]);
      call.text(NOTE);
      call.done();
      await w.idle();
      // The note is posted, the call's outcome not yet taken: the revision is
      // kept at once, the lines are not yet behind the coach and the note is
      // not yet one it has given.
      expect(w.posts).toHaveLength(1);
      expect(store.saved).toEqual([
        empty(epoch, { revisions: [[w.key(1), 1]] }),
      ]);
      expect(store.saved[0]).not.toHaveProperty("lastAskId");
      expect(await w.tick()).toBe(true);
      expect(store.saved).toHaveLength(2);
      expect(store.saved.slice(1)).toEqual([
        {
          version: COACH_LEDGER_VERSION,
          epoch,
          readTo: 1,
          given: [
            {
              key: w.key(1),
              title: expect.any(String),
              kind: "technical",
              ask: "Sharding the booking table",
              said: "I would shard by region first.",
            },
          ],
          log: [],
          cautions: [],
          design: { edges: [] },
          lastAskId: `${w.key(1)}-ask`,
          revisions: [[w.key(1), 1]],
          looks: 0,
          nudged: false,
        },
      ]);
    });

    it("is saved once per revision posted and once per settled call, each time as it then stands", async () => {
      const { store, port } = keeping();
      const w = world({}, { ledger: port });
      w.reply(
        { chunks: [NOTE] },
        { chunks: [NOTE] },
        { chunks: [SILENT_REPLY] },
      );
      await w.heard("interviewer", QUESTION);
      w.later();
      await w.heard("interviewer", HOT);
      w.later();
      await w.heard("interviewer", "Thanks, that covers the sharding part.");
      // Two notes of one revision each, then three settled calls (the silent
      // one posts nothing): a save at each post, before its call's lines are
      // behind the coach, and a save as each call settles.
      expect(store.saved.map((each) => each.readTo)).toEqual([0, 1, 1, 2, 3]);
      expect(store.saved.map((each) => each.given.length)).toEqual([
        0, 1, 1, 2, 2,
      ]);
      expect(store.saved.map((each) => each.revisions.length)).toEqual([
        1, 1, 2, 2, 2,
      ]);
      // The newest note first, as the model is reminded of them.
      expect(store.saved.at(-1)?.given.map((note) => note.key)).toEqual([
        w.key(2),
        w.key(1),
      ]);
      expect(store.saved.at(-1)?.revisions).toEqual([
        [w.key(1), 1],
        [w.key(2), 1],
      ]);
      // Looking with nothing to do keeps nothing.
      w.advance(60_000);
      expect(await w.tick()).toBe(false);
      expect(store.saved).toHaveLength(5);
    });

    it("is saved after a silent reply too: those lines are behind the coach, with no note and no question to join", async () => {
      const { store, port } = keeping();
      const w = world({}, { ledger: port });
      w.reply({ chunks: [SILENT_REPLY] });
      await w.heard("interviewer", QUESTION);
      expect(store.saved).toEqual([
        empty(w.transcript.since().epoch, { readTo: 1 }),
      ]);
      expect(store.saved[0]).not.toHaveProperty("lastAskId");
    });

    it("holds the last revision posted of a note written a piece at a time", async () => {
      const { store, port } = keeping();
      const w = world({}, { ledger: port });
      w.reply(WRITTEN);
      await w.heard("interviewer", QUESTION);
      expect(w.posts.map((post) => post.revision)).toEqual([1, 2, 3]);
      // Each revision as it was posted, then the settled call.
      expect(store.saved.map((each) => each.revisions)).toEqual([
        [[w.key(1), 1]],
        [[w.key(1), 2]],
        [[w.key(1), 3]],
        [[w.key(1), 3]],
      ]);
      expect(store.saved.map((each) => each.readTo)).toEqual([0, 0, 0, 1]);
    });

    it("already holds revision 2 of a note once two revisions of it are posted, before the call settles", async () => {
      const { store, port } = keeping();
      const w = world({}, { ledger: port });
      await w.hear("interviewer", QUESTION);
      w.advance(finishedMs);
      const call = await w.opens();
      // The first piece is not yet a note; the next two are a revision each.
      for (const piece of WRITTEN.chunks) call.text(piece, WRITTEN.gapMs);
      await w.flush();
      expect(w.posts.map((post) => [post.key, post.revision])).toEqual([
        [w.key(1), 1],
        [w.key(1), 2],
      ]);
      // The call is still being written: nothing of it has been taken.
      expect(w.events.map((event) => event.what)).toEqual([
        "act",
        "note",
        "note",
      ]);
      expect(await w.tick()).toBe(false);
      expect(store.saved).toHaveLength(2);
      expect(new Map(store.saved.at(-1)?.revisions).get(w.key(1))).toBe(2);
      expect(new Map(store.kept?.revisions).get(w.key(1))).toBe(2);
      // And only that: the lines are not behind the coach, the note not given.
      expect(store.saved.at(-1)).toEqual(
        empty(w.transcript.since().epoch, { revisions: [[w.key(1), 2]] }),
      );
      call.done();
      await w.idle();
      await w.tick();
    });

    it("holds what the model chose to remember, and the warnings it gave", async () => {
      const { store, port } = keeping();
      const w = world({}, { ledger: port });
      w.reply({
        chunks: [
          [
            NOTE,
            "CAUTION: Say NestJS not Express when naming the framework",
            "LOG: The interviewer owns the pricing rules",
          ].join("\n"),
        ],
      });
      await w.heard("interviewer", QUESTION);
      expect(store.saved.at(-1)).toMatchObject({
        log: ["The interviewer owns the pricing rules"],
        cautions: [
          {
            key: w.key(1),
            text: "Say NestJS not Express when naming the framework",
          },
        ],
      });
    });

    it("holds the looks at the answer in hand, and that it was nudged", async () => {
      const { candidateWords, candidateEveryMs } = TURN_TIMING;
      const { store, port } = keeping();
      const w = world({}, { ledger: port });
      w.reply(
        { chunks: [NOTE] },
        { chunks: [SILENT_REPLY] },
        { chunks: ["ASK: Land it\nSAY: Name the **figure** now."] },
      );
      await w.heard("interviewer", QUESTION, finishedMs);
      for (const round of ["first", "second"]) {
        await w.hear("candidate", points(candidateWords, round));
        w.advance(candidateEveryMs);
        expect(await w.act(), round).toBe(true);
      }
      expect(
        store.saved.map((each) => [each.readTo, each.looks, each.nudged]),
      ).toEqual([
        // The question's note as it was posted, then its call settled.
        [0, 0, false],
        [1, 0, false],
        // A look that came to nothing.
        [2, 1, false],
        // The nudge as it was posted, then its call settled.
        [2, 2, false],
        [3, 2, true],
      ]);
      // The nudge is filed under the question's note.
      expect(store.saved.at(-1)?.lastAskId).toBe(`${w.key(1)}-ask`);
    });

    it("holds a design: its stage, its arrows and the words of its one note", async () => {
      const { store, port } = keeping();
      const w = world(
        {},
        {
          ledger: port,
          plan: async () => "mode: system-design\nBooking system for a clinic.",
        },
      );
      w.reply({
        chunks: [
          [
            "ASK: Booking system",
            "STAGE: high-level",
            "SAY: Start with one **API** in front of a store.",
            "DRAW: Client -> API: book a slot",
            "DRAW: API -> Store",
          ].join("\n"),
        ],
      });
      await w.heard("interviewer", "Design a booking system for a clinic?");
      const key = `coach-${w.transcript.since().epoch.slice(0, 8)}-design`;
      const kept = store.saved.at(-1);
      expect(kept?.design.stage).toBe("high-level");
      expect(kept?.design.edges).toHaveLength(2);
      expect(JSON.stringify(kept?.design.edges)).toContain("book a slot");
      expect(JSON.stringify(kept?.design.sections)).toContain(
        "in front of a store.",
      );
      expect(kept?.revisions).toEqual([[key, w.posts.at(-1)?.revision]]);
      expect(kept?.lastAskId).toBe(`${key}-ask`);
    });

    it("survives being written as JSON and read back, as it is over HTTP", async () => {
      const { store, port } = keeping();
      const w = world({}, { ledger: port });
      w.reply({ chunks: [`${NOTE}\nLOG: Two of five questions asked`] });
      await w.heard("interviewer", QUESTION);
      const kept = store.saved.at(-1);
      expect(JSON.parse(JSON.stringify(kept))).toEqual(kept);
    });

    it("is saved when a stretch is passed over after failing twice; the first failure, thrown to be tried again, keeps nothing", async () => {
      const { store, port } = keeping();
      const w = world({}, { ledger: port });
      w.reply({ end: failure(true) }, { end: failure(true) });
      await w.hear("interviewer", QUESTION);
      w.advance(finishedMs);
      expect(await w.tick()).toBe(true);
      await w.idle();
      await expect(w.tick()).rejects.toBeInstanceOf(CoachCallError);
      expect(store.saved).toEqual([]);
      expect(await w.act()).toBe(true);
      expect(store.saved).toEqual([
        empty(w.transcript.since().epoch, { readTo: 1 }),
      ]);
    });

    it("is of the conversation in hand: after a clear the next one saved names the new epoch and holds nothing of the old", async () => {
      const { store, port } = keeping();
      const w = world({}, { ledger: port });
      w.reply({
        chunks: [`${NOTE}\nLOG: The interviewer owns the pricing rules`],
      });
      await w.heard("interviewer", QUESTION);
      const before = w.transcript.since().epoch;
      w.transcript.clear();
      // As the Studio does: the ledger goes with the conversation.
      store.kept = undefined;
      await w.tick();
      w.reply({ chunks: [SILENT_REPLY] });
      await w.heard("interviewer", "What is your notice period?");
      const after = w.transcript.since().epoch;
      // The first conversation's note as it was posted and its call settled;
      // the second's one silent call.
      expect(store.saved.map((each) => each.epoch)).toEqual([
        before,
        before,
        after,
      ]);
      expect(store.saved.at(-1)).toEqual(empty(after, { readTo: 1 }));
    });

    it("is not kept by a coach that was given nowhere to keep it", async () => {
      const w = world();
      w.reply({ chunks: [NOTE] });
      expect(await w.heard("interviewer", QUESTION)).toBe(true);
      expect(w.posts).toHaveLength(1);
    });
  });

  describe("taken up by a coach that is restarted", () => {
    it("is asked for once per conversation, by its epoch, when the coach first sees it", async () => {
      const { store, port } = keeping();
      const w = world({}, { ledger: port });
      expect(store.loads).toEqual([]);
      w.say("interviewer", QUESTION);
      const first = w.transcript.since().epoch;
      await w.tick();
      await w.tick();
      w.reply({ chunks: [SILENT_REPLY] }, { chunks: [SILENT_REPLY] });
      w.advance(finishedMs);
      await w.act();
      w.later();
      await w.heard("interviewer", HOT);
      expect(w.calls).toHaveLength(2);
      expect(store.loads).toEqual([first]);
      w.transcript.clear();
      store.kept = undefined;
      await w.tick();
      await w.tick();
      expect(store.loads).toEqual([first, w.transcript.since().epoch]);
    });

    it("does not act again on lines at or before where the last coach read to, however long it waits", async () => {
      const { store, port } = keeping();
      const first = world({}, { ledger: port });
      first.reply({ chunks: [NOTE] });
      await first.heard("interviewer", QUESTION);
      await first.hear("candidate", "I would start with the region.");
      expect(store.kept?.readTo).toBe(1);

      const again = restarted(first, port);
      expect(await again.tick()).toBe(false);
      // It read the whole conversation, to have it as background.
      expect(again.reads).toEqual([0]);
      for (const waited of [finishedMs, pauseMs, trailingMs, 120_000]) {
        again.advance(waited);
        expect(await again.tick()).toBe(false);
      }
      expect(again.calls).toEqual([]);
      expect(again.posts).toEqual([]);
      expect(again.events).toEqual([]);
    });

    it("without the ledger a restarted coach coaches the same question again: that is what the ledger is for", async () => {
      const first = world();
      first.reply({ chunks: [NOTE] });
      await first.heard("interviewer", QUESTION);
      const again = world({}, { transcript: first.transcript });
      await again.tick();
      again.advance(finishedMs);
      expect(await again.tick()).toBe(true);
      expect(again.told()[0]).toEqual(["act", "question-finished", 1, 1]);
    });

    it("acts on what is said after it, as new lines, with what came before as the conversation so far", async () => {
      const { port } = keeping();
      const first = world({}, { ledger: port });
      first.reply({ chunks: [NOTE] });
      await first.heard("interviewer", QUESTION);

      const again = restarted(first, port);
      await again.tick();
      again.reply({
        chunks: [NOTE.replace("Sharding the booking table", "A hot region")],
      });
      again.later();
      expect(await again.heard("interviewer", HOT, finishedMs)).toBe(true);
      const prompt = again.calls[0]?.prompt ?? "";
      expect(newLines(prompt)).toEqual([`INTERVIEWER: ${HOT}`]);
      expect(soFar(prompt)).toEqual([`INTERVIEWER: ${QUESTION}`]);
      expect(again.told()[0]).toEqual(["act", "question-finished", 2, 2]);
      // Its note is the second of the conversation, not the first again.
      expect(again.posts.map((post) => [post.key, post.revision])).toEqual([
        [again.key(2), 1],
      ]);
    });

    it("remembers the notes already given and what was logged, in its next prompt", async () => {
      const { port } = keeping();
      const first = world({}, { ledger: port });
      first.reply({
        chunks: [`${NOTE}\nLOG: The interviewer owns the pricing rules`],
      });
      await first.heard("interviewer", QUESTION);

      const again = restarted(first, port);
      await again.tick();
      again.reply({ chunks: [SILENT_REPLY] });
      again.later();
      await again.heard("interviewer", HOT, finishedMs);
      const prompt = again.calls[0]?.prompt ?? "";
      expect(under(prompt, GIVEN_HEAD)).toHaveLength(1);
      expect(under(prompt, GIVEN_HEAD)[0]).toContain(
        "Sharding the booking table",
      );
      expect(under(prompt, GIVEN_HEAD)[0]).toContain(
        "I would shard by region first.",
      );
      expect(under(prompt, LOG_HEAD)).toEqual([
        "- The interviewer owns the pricing rules",
      ]);
      // The same prompt the first coach would have made for these lines.
      first.reply({ chunks: [SILENT_REPLY] });
      first.later();
      await first.tick();
      first.advance(finishedMs);
      await first.act();
      expect(first.calls[1]?.prompt).toBe(prompt);
    });

    it("joins a note for the same question to the last coach's question", async () => {
      const { port } = keeping();
      const first = world({}, { ledger: port });
      first.reply({ chunks: [NOTE] });
      await first.heard("interviewer", QUESTION);

      const again = restarted(first, port);
      await again.tick();
      again.reply({ chunks: [NOTE.replace("SAME: no", "SAME: yes")] });
      again.later();
      await again.heard("interviewer", "And what about hot regions?");
      expect(again.posts.map((post) => [post.key, post.askId])).toEqual([
        [again.key(2), `${again.key(1)}-ask`],
      ]);
    });

    it("does not give again a warning the last coach gave", async () => {
      const { port } = keeping();
      const first = world({}, { ledger: port });
      first.reply({
        chunks: [
          `${NOTE}\nCAUTION: Say NestJS not Express when naming the framework`,
        ],
      });
      await first.heard("interviewer", QUESTION);

      const again = restarted(first, port);
      await again.tick();
      again.reply({
        chunks: [
          [
            "KIND: technical",
            "SAME: no",
            "ASK: Hot region",
            "SAY: Split it.",
            "CAUTION: Name NestJS not Express for the framework",
          ].join("\n"),
        ],
      });
      again.later();
      await again.heard("interviewer", HOT);
      expect(said(again.posts.at(-1))).toEqual([["say", ["Split it."]]]);
    });

    it("does not look again at an answer the last coach already nudged", async () => {
      const { candidateWords, candidateEveryMs } = TURN_TIMING;
      const { store, port } = keeping();
      const first = world({}, { ledger: port });
      first.reply(
        { chunks: [NOTE] },
        { chunks: ["ASK: Land it\nSAY: Name the **figure** now."] },
      );
      await first.heard("interviewer", QUESTION, finishedMs);
      await first.hear("candidate", points(candidateWords, "first"));
      first.advance(candidateEveryMs);
      expect(await first.act()).toBe(true);
      expect(store.kept?.nudged).toBe(true);

      const again = restarted(first, port);
      await again.tick();
      await again.hear("candidate", points(candidateWords, "second"));
      again.advance(candidateEveryMs);
      expect(await again.tick()).toBe(false);
      again.advance(60_000);
      expect(await again.tick()).toBe(false);
      expect(again.calls).toEqual([]);
    });

    it("goes on with a design: the same one note, its revisions carrying on, the arrows already drawn kept", async () => {
      const plan = async () =>
        "mode: system-design\nBooking system for a clinic.";
      const { store, port } = keeping();
      const first = world({}, { ledger: port, plan });
      first.reply({
        chunks: [
          [
            "ASK: Booking system",
            "STAGE: high-level",
            "SAY: Start with one **API** in front of a store.",
            "DRAW: Client -> API: book a slot",
            "DRAW: API -> Store",
          ].join("\n"),
        ],
      });
      await first.heard("interviewer", "Design a booking system for a clinic?");
      const key = `coach-${first.transcript.since().epoch.slice(0, 8)}-design`;
      const last = first.posts.at(-1)?.revision ?? 0;
      expect(last).toBeGreaterThan(0);
      expect(store.kept?.revisions).toEqual([[key, last]]);

      const again = restarted(first, port, { plan });
      await again.tick();
      again.reply({
        chunks: [
          [
            "ASK: Booking system",
            "DRAW: API -> Reminder queue: after commit",
          ].join("\n"),
        ],
      });
      again.later();
      await again.heard("interviewer", "And where do the reminders go?");
      const prompt = again.calls[0]?.prompt ?? "";
      expect(prompt).toContain("THE DESIGN SO FAR (stage: high-level):");
      expect(prompt).toContain("book a slot");
      // One note still: the next revision of the same key.
      expect(again.posts.map((post) => [post.key, post.revision])).toEqual([
        [key, last + 1],
      ]);
      // The drawing grew; the words the last coach wrote stay.
      expect(again.posts[0]?.diagram).toContain("Reminder queue");
      expect(again.posts[0]?.diagram).toContain("Client");
      expect(said(again.posts[0])).toEqual([
        ["say", ["Start with one API in front of a store."]],
      ]);
      expect(store.kept?.revisions).toEqual([[key, last + 1]]);
      expect(store.kept?.design.edges).toHaveLength(3);
    });

    it("keeps the ledger going from where it took it up", async () => {
      const { store, port } = keeping();
      const first = world({}, { ledger: port });
      first.reply({ chunks: [NOTE] });
      await first.heard("interviewer", QUESTION);

      const again = restarted(first, port);
      await again.tick();
      again.reply({
        chunks: [NOTE.replace("Sharding the booking table", "A hot region")],
      });
      again.later();
      await again.heard("interviewer", HOT, finishedMs);
      // Each coach kept its note as it was posted and as its call settled.
      expect(store.saved.map((each) => each.readTo)).toEqual([0, 1, 1, 2]);
      // What the restarted coach kept mid-note already had the first's note.
      expect(store.saved[2]).toMatchObject({
        revisions: [
          [again.key(1), 1],
          [again.key(2), 1],
        ],
      });
      expect(store.saved[2]?.given.map((note) => note.ask)).toEqual([
        "Sharding the booking table",
      ]);
      expect(store.kept).toMatchObject({
        epoch: first.transcript.since().epoch,
        readTo: 2,
        revisions: [
          [again.key(1), 1],
          [again.key(2), 1],
        ],
      });
      expect(store.kept?.given.map((note) => note.ask)).toEqual([
        "A hot region",
        "Sharding the booking table",
      ]);
    });

    it("a coach that is running takes up a ledger already kept for a conversation it comes to", async () => {
      const { store, port } = keeping();
      const w = world({}, { ledger: port });
      w.reply({ chunks: [SILENT_REPLY] });
      await w.heard("interviewer", QUESTION);
      w.transcript.clear();
      w.say("interviewer", "A first question of the next conversation?");
      // Another coach had read that line and said so.
      store.kept = empty(w.transcript.since().epoch, { readTo: 1 });
      expect(await w.tick()).toBe(true);
      expect(await w.tick()).toBe(false);
      w.advance(60_000);
      expect(await w.tick()).toBe(false);
      expect(w.calls).toHaveLength(1);
    });

    it("takes up a ledger that holds only how far was read", async () => {
      const first = world();
      first.say("interviewer", QUESTION);
      const epoch = first.transcript.since().epoch;
      const { port } = keeping({
        version: COACH_LEDGER_VERSION,
        epoch,
        readTo: 1,
      } as unknown as CoachLedger);
      const again = restarted(first, port);
      await again.tick();
      again.advance(60_000);
      expect(await again.tick()).toBe(false);
      again.reply({ chunks: [NOTE] });
      expect(await again.heard("interviewer", HOT, finishedMs)).toBe(true);
      expect(again.posts.map((post) => [post.key, post.revision])).toEqual([
        [again.key(2), 1],
      ]);
    });
  });

  describe("a ledger that is not trusted", () => {
    // The conversation: one question, heard and not yet coached by this coach.
    const begun = () => {
      const first = world();
      first.say("interviewer", QUESTION);
      return { first, epoch: first.transcript.since().epoch };
    };
    const told = (epoch: string, more: Partial<CoachLedger> = {}) =>
      empty(epoch, {
        readTo: 1,
        given: [
          {
            key: `coach-${epoch.slice(0, 8)}-1`,
            title: "Sharding",
            kind: "technical",
            ask: "A note from the ledger",
            said: "By tenant first.",
          },
        ],
        log: ["A thing only the ledger says"],
        revisions: [[`coach-${epoch.slice(0, 8)}-1`, 7]],
        ...more,
      });
    // The coach started from nothing: it acts on the question, as revision 1,
    // and its prompt knows of no note and no log.
    const startsFromNothing = async (again: ReturnType<typeof world>) => {
      again.reply({ chunks: [NOTE] });
      await again.tick();
      again.advance(finishedMs);
      expect(await again.act()).toBe(true);
      expect(again.told()[0]).toEqual(["act", "question-finished", 1, 1]);
      const prompt = again.calls[0]?.prompt ?? "";
      expect(given(prompt)).toEqual(["(none)"]);
      expect(prompt).not.toContain("A note from the ledger");
      expect(prompt).not.toContain("A thing only the ledger says");
      expect(again.posts.map((post) => post.revision)).toEqual([1]);
    };

    it("is trusted when it is this conversation's, of this version (the cases below differ from it in one thing)", async () => {
      const { first, epoch } = begun();
      const again = restarted(first, keeping(told(epoch)).port);
      await again.tick();
      again.advance(60_000);
      expect(await again.tick()).toBe(false);
      expect(again.calls).toEqual([]);
    });

    it.each<[string, (epoch: string) => unknown]>([
      ["of a later version", (epoch) => ({ ...told(epoch), version: 2 })],
      ["of an earlier version", (epoch) => ({ ...told(epoch), version: 0 })],
      ["of no version", (epoch) => ({ ...told(epoch), version: undefined })],
      [
        "of a version said as a word",
        (epoch) => ({ ...told(epoch), version: "1" }),
      ],
      ["of another conversation", () => told("another-conversation")],
      ["of no conversation", (epoch) => ({ ...told(epoch), epoch: undefined })],
      [
        "that read to a line that is not a whole number",
        (epoch) => told(epoch, { readTo: 0.5 }),
      ],
      [
        "that read to a line before the first",
        (epoch) => told(epoch, { readTo: -1 }),
      ],
      [
        "that says how far it read as a word",
        (epoch) => ({ ...told(epoch), readTo: "1" }),
      ],
      [
        "that does not say how far it read",
        (epoch) => ({ ...told(epoch), readTo: undefined }),
      ],
      ["that is nothing", () => null],
    ])(
      "one %s is ignored: the coach starts from nothing",
      async (_name, ledger) => {
        const { first, epoch } = begun();
        const { store, port } = keeping();
        store.kept = ledger(epoch) as CoachLedger;
        await startsFromNothing(restarted(first, port));
      },
    );

    it("one that read further than the transcript goes is not followed there: the coach acts on what was heard", async () => {
      const { first, epoch } = begun();
      const again = restarted(first, keeping(told(epoch, { readTo: 2 })).port);
      again.reply({ chunks: [NOTE] });
      await again.tick();
      again.advance(finishedMs);
      expect(await again.act()).toBe(true);
      expect(again.told()[0]).toEqual(["act", "question-finished", 1, 1]);
    });

    // What such a ledger says was read is not in what was heard: it is of
    // some other state of the conversation, and none of it is taken (not its
    // notes, its log or its revisions, as well as how far it read).
    it("one that read further than the transcript goes is ignored whole, not only in how far it read", async () => {
      const { first, epoch } = begun();
      await startsFromNothing(
        restarted(first, keeping(told(epoch, { readTo: 2 })).port),
      );
    });

    it("one that read exactly as far as the transcript goes is trusted", async () => {
      const { first, epoch } = begun();
      first.say("candidate", "I would start with the region.");
      const again = restarted(first, keeping(told(epoch, { readTo: 2 })).port);
      await again.tick();
      again.advance(60_000);
      expect(await again.tick()).toBe(false);
      expect(again.calls).toEqual([]);
    });
  });

  describe("a place to keep it that fails", () => {
    const down = new Error("the ledger cannot be reached");

    it("a load that fails never fails a look: the coach starts from nothing and coaches", async () => {
      const saved: CoachLedger[] = [];
      const w = world(
        {},
        {
          ledger: {
            load: async () => {
              throw down;
            },
            save: async (ledger) => {
              saved.push(structuredClone(ledger));
            },
          },
        },
      );
      w.reply({ chunks: [NOTE] });
      await expect(w.tick()).resolves.toBe(false);
      expect(await w.heard("interviewer", QUESTION)).toBe(true);
      expect(w.posts).toHaveLength(1);
      expect(w.events.some((event) => event.what === "failed")).toBe(false);
      // And it goes on keeping its own.
      expect(saved.map((each) => each.readTo)).toEqual([0, 1]);
      expect(saved.map((each) => each.revisions)).toEqual([
        [[w.key(1), 1]],
        [[w.key(1), 1]],
      ]);
    });

    it("a save that fails never fails a look, is not told as a failed call, and is tried again at the next revision and the next call", async () => {
      let asked = 0;
      const w = world(
        {},
        {
          ledger: {
            load: async () => undefined,
            save: async () => {
              asked += 1;
              throw down;
            },
          },
        },
      );
      w.reply({ chunks: [NOTE] }, { chunks: [NOTE] });
      expect(await w.heard("interviewer", QUESTION)).toBe(true);
      await w.flush();
      w.later();
      expect(await w.heard("interviewer", HOT)).toBe(true);
      await w.flush();
      // Two notes of one revision each, and two settled calls.
      expect(asked).toBe(4);
      expect(w.posts).toHaveLength(2);
      expect(w.events.some((event) => event.what === "failed")).toBe(false);
      // The stretch whose ledger could not be kept is not coached again.
      w.advance(60_000);
      expect(await w.tick()).toBe(false);
      expect(w.calls).toHaveLength(2);
    });

    it("a load that never comes back before the transcript is cleared does not carry a ledger into the next conversation", async () => {
      // The store answers for whatever epoch it is asked: the coach checks.
      const { store, port } = keeping();
      const w = world({}, { ledger: port });
      w.reply({ chunks: [NOTE] });
      await w.heard("interviewer", QUESTION);
      w.transcript.clear();
      // The old conversation's ledger is still what the store gives back.
      expect(store.kept?.readTo).toBe(1);
      w.say("interviewer", "What is your notice period?");
      expect(await w.tick()).toBe(true);
      w.reply({ chunks: [NOTE] });
      await w.tick();
      w.advance(finishedMs);
      expect(await w.act()).toBe(true);
      expect(given(w.calls[1]?.prompt ?? "")).toEqual(["(none)"]);
      expect(w.posts[1]?.key).toBe(w.key(1));
    });

    // A port that throws before it returns a promise (a plain function that
    // validates its argument, a client that throws while building its
    // request) costs the ledger only, as one that rejects does.
    it("a load that throws outright never fails a look: the coach starts from nothing and coaches", async () => {
      const w = world(
        {},
        {
          ledger: {
            load: () => {
              throw down;
            },
            save: async () => undefined,
          },
        },
      );
      await expect(w.tick()).resolves.toBe(false);
      w.reply({ chunks: [NOTE] });
      await expect(w.heard("interviewer", QUESTION)).resolves.toBe(true);
      expect(w.posts.map((post) => post.revision)).toEqual([1]);
      expect(w.events.some((event) => event.what === "failed")).toBe(false);
    });

    it("a save that throws outright never fails a look, neither as a revision is posted nor as the call settles", async () => {
      let asked = 0;
      const w = world(
        {},
        {
          ledger: {
            load: async () => undefined,
            save: () => {
              asked += 1;
              throw down;
            },
          },
        },
      );
      w.reply({ chunks: [NOTE] });
      await expect(w.heard("interviewer", QUESTION)).resolves.toBe(true);
      expect(asked).toBe(2);
      expect(w.posts.map((post) => post.revision)).toEqual([1]);
      expect(w.events.map((event) => event.what)).toEqual(["act", "note"]);
      // The stretch whose ledger could not be kept is not coached again.
      w.advance(60_000);
      expect(await w.tick()).toBe(false);
      expect(w.calls).toHaveLength(1);
    });
  });

  describe("a call that never settled", () => {
    // A revision posted is a revision kept: the ledger is saved straight
    // after each one, so a coach that is replaced mid-note (the worker
    // restarted while the model was still writing) leaves a ledger that knows
    // of the revisions on show. The coach that takes over answers the same
    // stretch under the same key and goes on from them; a note numbered from
    // 1 again would be refused by the Studio as older than the one it holds.
    it("the coach that takes over a note half written does not post an older revision of it", async () => {
      const { port } = keeping();
      const first = world({}, { ledger: port });
      await first.hear("interviewer", QUESTION);
      first.advance(finishedMs);
      const call = await first.opens();
      for (const piece of WRITTEN.chunks) call.text(piece, WRITTEN.gapMs);
      await first.flush();
      const shown = first.posts.at(-1)?.revision ?? 0;
      // Two revisions are on show; the note was never finished.
      expect(shown).toBe(2);
      // The first coach is gone before its call ends.

      const again = restarted(first, port);
      again.reply({ chunks: [NOTE] });
      await again.tick();
      again.advance(finishedMs);
      expect(await again.act()).toBe(true);
      expect(again.told()[0]).toEqual(["act", "question-finished", 1, 1]);
      expect(again.posts[0]?.key).toBe(first.posts[0]?.key);
      expect(again.posts[0]?.revision).toBe(shown + 1);
    });

    // By another road: a first attempt that posted part of a note and then
    // failed is thrown to be tried again. Nothing is kept as it fails, and
    // nothing needs to be: its revisions were kept as they were posted.
    it("nor does the coach that takes over after a first attempt failed part-way", async () => {
      const { port } = keeping();
      const first = world({}, { ledger: port });
      first.reply({ ...WRITTEN, end: failure(true) });
      await first.hear("interviewer", QUESTION);
      first.advance(finishedMs);
      expect(await first.tick()).toBe(true);
      await first.idle();
      await expect(first.tick()).rejects.toBeInstanceOf(CoachCallError);
      const shown = first.posts.at(-1)?.revision ?? 0;
      expect(shown).toBeGreaterThan(0);

      const again = restarted(first, port);
      again.reply({ chunks: [NOTE] });
      await again.tick();
      again.advance(finishedMs);
      expect(await again.act()).toBe(true);
      expect(again.posts[0]?.key).toBe(first.posts[0]?.key);
      expect(again.posts[0]?.revision).toBe(shown + 1);
    });
  });
});

describe("one session of the model kept for the call", () => {
  const PLAN_HEAD = "THE PLAN FOR THIS CALL:";
  const LOG_HEAD = "WHAT YOU HAVE NOTED SO FAR IN THIS CALL (oldest first):";
  const RECORD_HEAD = "THE CANDIDATE'S RECORD (cite a fact by its [pointer]):";
  const EMPLOYER_HEAD = "EMPLOYER MATERIAL (not the candidate's experience):";
  const SCREEN_HEAD =
    "ON THE SHARED SCREEN (text read from the latest capture; it may be cut or misread):";
  const NEW_HEAD = "NEW LINES (decide on these):";
  const SO_FAR_HEAD = "THE CONVERSATION SO FAR:";
  const conversationOf = (call: Open | undefined) =>
    call?.execution["conversation"];
  // A call with everything a prompt can hold: a plan, a record, a screen, a
  // note already given and a line already logged. Two calls are made.
  const rich = async (options: CoachOptions) => {
    const w = world(options, {
      session: SESSION,
      facts: async () => FACTS,
      plan: async () => "Land the migration story.",
      read: (answer) => ({
        ...answer,
        screen: {
          text: "def book(slot): return slot",
          at: new Date(T0).toISOString(),
        },
      }),
    });
    w.reply(
      { chunks: [`${NOTE}\nLOG: The interviewer owns the pricing rules`] },
      { chunks: [SILENT_REPLY] },
    );
    expect(await w.heard("interviewer", QUESTION)).toBe(true);
    w.later();
    expect(await w.heard("interviewer", HOT)).toBe(true);
    expect(w.calls).toHaveLength(2);
    return w;
  };

  it.each<[string, CoachOptions]>([
    ["not asked for", {}],
    ["said to be off", { retain: false }],
  ])(
    "%s: every call is one user message, the whole prompt, and names no conversation",
    async (_name, options) => {
      const w = await rich(options);
      for (const call of w.calls) {
        expect(call.users).toHaveLength(1);
        expect(call.users[0]).toBe(call.prompt);
        expect(call.execution).not.toHaveProperty("conversation");
        expect(call.system).toBe(COACH_SYSTEM);
      }
      const whole = w.calls[1]?.users[0]?.split("\n") ?? [];
      for (const head of [
        PLAN_HEAD,
        LOG_HEAD,
        RECORD_HEAD,
        EMPLOYER_HEAD,
        GIVEN_HEAD,
        SO_FAR_HEAD,
        SCREEN_HEAD,
        NEW_HEAD,
      ])
        expect(whole, head).toContain(head);
    },
  );

  it("kept: every call is two user messages after the system's, the background then the turn", async () => {
    const w = await rich({ retain: true });
    for (const call of w.calls) {
      expect(call.system).toBe(COACH_SYSTEM);
      expect(call.users).toHaveLength(2);
    }
    const [background, turn] = (w.calls[1]?.users ?? []).map((each) =>
      each.split("\n"),
    ) as [string[], string[]];
    // What the session is told when it opens: where the call stands.
    expect(under(background.join("\n"), PLAN_HEAD)).toEqual([
      "Land the migration story.",
    ]);
    expect(under(background.join("\n"), LOG_HEAD)).toEqual([
      "- The interviewer owns the pricing rules",
    ]);
    expect(under(background.join("\n"), GIVEN_HEAD)).toEqual([
      "- [technical] Sharding the booking table: I would shard by region first.",
    ]);
    expect(soFar(background.join("\n"))).toEqual([`INTERVIEWER: ${QUESTION}`]);
    // What is new this time.
    expect(under(turn.join("\n"), RECORD_HEAD)).toEqual([
      "[/roles/0/proof_points/0] Cut booking latency 40% by sharding on region",
      "[/context/candidatePreferences/0] Notice period: 4 weeks",
    ]);
    expect(under(turn.join("\n"), EMPLOYER_HEAD)).toEqual([
      "[/context/employerBrief/1] Stack: Kafka and Postgres across 9 regions",
    ]);
    expect(under(turn.join("\n"), SCREEN_HEAD)).toEqual([
      "def book(slot): return slot",
    ]);
    expect(newLines(turn.join("\n"))).toEqual([`INTERVIEWER: ${HOT}`]);
    expect(turn.at(-1)).toMatch(/^WHY NOW: /);
    for (const head of [RECORD_HEAD, EMPLOYER_HEAD, SCREEN_HEAD, NEW_HEAD])
      expect(background, head).not.toContain(head);
    for (const head of [PLAN_HEAD, LOG_HEAD, GIVEN_HEAD, SO_FAR_HEAD])
      expect(turn, head).not.toContain(head);
  });

  it("kept or not, the model is told the same things: the two messages hold every line of the one, once", async () => {
    const kept = await rich({ retain: true });
    const plain = await rich({});
    for (const at of [0, 1]) {
      const whole = (plain.calls[at]?.users[0] ?? "").split("\n").sort();
      const both = (kept.calls[at]?.users ?? [])
        .flatMap((each) => each.split("\n"))
        .sort();
      expect(whole.length).toBeGreaterThan(8);
      expect(both).toEqual(whole);
    }
  });

  it("kept or not, the same notes are posted and the same things are told", async () => {
    const kept = await rich({ retain: true });
    const plain = await rich({});
    const shape = (post: CoachNoteInput) => ({
      ...post,
      key: post.key?.replace(/^coach-[^-]+-/, ""),
      askId: post.askId?.replace(/^coach-[^-]+-/, ""),
    });
    expect(kept.posts.map(shape)).toEqual(plain.posts.map(shape));
    expect(kept.posts).toHaveLength(1);
    expect(kept.told()).toEqual(plain.told());
  });

  it("names the conversation by its epoch, and leaves the rest of the execution as it is without", async () => {
    const kept = await rich({ retain: true });
    const plain = await rich({});
    const epoch = kept.transcript.since().epoch;
    expect(kept.calls.map(conversationOf)).toEqual([
      { id: `coach:${epoch}:0` },
      { id: `coach:${epoch}:0` },
    ]);
    const others = (call: Open | undefined) =>
      Object.keys(call?.execution ?? {})
        .filter((key) => key !== "conversation")
        .sort();
    expect(others(kept.calls[0])).toEqual(others(plain.calls[0]));
    expect(kept.calls[0]?.execution).toMatchObject({
      policy: "permitted-remote",
      permissions: ["interview.read"],
      idempotencyKey: `coach:${epoch}:1:0`,
      for: { kind: "coach", id: epoch },
      scope: {
        tenantId: SESSION.tenantId,
        actorId: SESSION.actorId,
        productId: INTERVIEW_PRODUCT_ID,
      },
    });
  });

  // The coach makes `count` calls, one a question, each answered with silence.
  const asks = async (w: ReturnType<typeof world>, count: number) => {
    for (let each = 0; each < count; each += 1) {
      w.reply({ chunks: [SILENT_REPLY] });
      w.later();
      const before = w.calls.length;
      expect(
        await w.heard(
          "interviewer",
          `How would you handle part ${before + 1} of the migration?`,
        ),
      ).toBe(true);
      expect(w.calls).toHaveLength(before + 1);
    }
  };
  const sessionOf = (call: Open | undefined) =>
    Number(
      /^coach:.+:(\d+)$/.exec(
        (conversationOf(call) as { id: string } | undefined)?.id ?? "",
      )?.[1],
    );

  it("begins the session anew every 12 calls: the first 12 are session 0, the next 12 session 1, the 25th session 2", async () => {
    const w = world({ retain: true });
    await asks(w, 25);
    const epoch = w.transcript.since().epoch;
    expect(w.calls.map(sessionOf)).toEqual([
      ...Array.from({ length: 12 }, () => 0),
      ...Array.from({ length: 12 }, () => 1),
      2,
    ]);
    expect(conversationOf(w.calls[11])).toEqual({ id: `coach:${epoch}:0` });
    expect(conversationOf(w.calls[12])).toEqual({ id: `coach:${epoch}:1` });
    // A session begun anew is told where things stand: the background of its
    // first call holds the conversation up to it.
    expect(soFar(w.calls[12]?.users[0] ?? "")).toHaveLength(12);
    expect(newLines(w.calls[12]?.users[1] ?? "")).toEqual([
      "INTERVIEWER: How would you handle part 13 of the migration?",
    ]);
  });

  it("without it no call names a conversation, however many are made", async () => {
    const w = world();
    await asks(w, 13);
    expect(w.calls.map(conversationOf)).toEqual(
      Array.from({ length: 13 }, () => undefined),
    );
  });

  it("a call that fails is a call of the session too: the one made again for its stretch names the same conversation", async () => {
    const w = world({ retain: true });
    w.reply({ end: failure(true) }, { chunks: [NOTE] });
    await w.hear("interviewer", QUESTION);
    w.advance(finishedMs);
    expect(await w.tick()).toBe(true);
    await w.idle();
    await expect(w.tick()).rejects.toBeInstanceOf(CoachCallError);
    expect(await w.act()).toBe(true);
    const epoch = w.transcript.since().epoch;
    expect(w.calls.map(conversationOf)).toEqual([
      { id: `coach:${epoch}:0` },
      { id: `coach:${epoch}:0` },
    ]);
    expect(w.calls.map((call) => call.users.length)).toEqual([2, 2]);
  });

  it("a new conversation has a new session: its id names the new epoch", async () => {
    const w = world({ retain: true });
    await asks(w, 2);
    const before = w.transcript.since().epoch;
    w.transcript.clear();
    await w.tick();
    await asks(w, 1);
    const after = w.transcript.since().epoch;
    expect(after).not.toBe(before);
    expect(conversationOf(w.calls[2])).toEqual({ id: `coach:${after}:0` });
    // Nothing of the conversation before is in what the new session is told.
    expect(soFar(w.calls[2]?.users[0] ?? "")).toEqual([
      "(nothing before the new lines)",
    ]);
  });

  // The calls are counted for the conversation, not for the coach's life.
  it("a new conversation counts its 12 calls from its own first", async () => {
    const w = world({ retain: true });
    await asks(w, 11);
    w.transcript.clear();
    await w.tick();
    await asks(w, 3);
    const after = w.transcript.since().epoch;
    expect(w.calls.slice(11).map(conversationOf)).toEqual([
      { id: `coach:${after}:0` },
      { id: `coach:${after}:0` },
      { id: `coach:${after}:0` },
    ]);
  });

  it("a coach that takes up a conversation begins at session 0 of it, told the conversation so far", async () => {
    const saved: CoachLedger[] = [];
    const ledger: NonNullable<CoachPorts["ledger"]> = {
      load: async () => structuredClone(saved.at(-1)),
      save: async (kept) => {
        saved.push(structuredClone(kept));
      },
    };
    const first = world({ retain: true }, { ledger });
    await asks(first, 13);
    const epoch = first.transcript.since().epoch;
    expect(conversationOf(first.calls.at(-1))).toEqual({
      id: `coach:${epoch}:1`,
    });
    const again = world(
      { retain: true },
      { ledger, transcript: first.transcript },
    );
    await again.tick();
    await asks(again, 1);
    expect(conversationOf(again.calls[0])).toEqual({ id: `coach:${epoch}:0` });
    expect(soFar(again.calls[0]?.users[0] ?? "")).toHaveLength(13);
  });
});

// ---- A panel --------------------------------------------------------------------

describe("a panel of interviewers", () => {
  const PANEL_HEAD = "THE PANEL: more than one interviewer is on this call.";
  const PLAN =
    "Panel round for a tech lead role.\npanel: Priya (hiring manager), Marcus (staff engineer: reliability), Tom (director: pushes back), Elena (product)\nLead with the decision rule.";
  const CHARGED =
    "If a broker double-clicks submit, how do you make sure they are only charged once?";
  const noteFrom = (from?: string) =>
    [
      "KIND: technical",
      "SAME: no",
      "ASK: Charged only once",
      ...(from === undefined ? [] : [`FROM: ${from}`]),
      "SAY: I key the ledger by **correlation id**.",
    ].join("\n");
  // A world whose lines may name the interviewer who spoke, as a recorder's
  // labels or a diarizer would. "me" is the candidate.
  const panelWorld = (
    live: Parameters<typeof world>[1] = {},
    options: CoachOptions = {},
  ) => {
    const w = world(options, live);
    const voice = (who: string | null, text: string) =>
      w.transcript.add(
        [
          {
            speaker: who === "me" ? "candidate" : "interviewer",
            ...(who && who !== "me" ? { name: who } : {}),
            text,
            at: new Date(w.now()).toISOString(),
          },
        ],
        live.session,
      );
    return {
      ...w,
      voice,
      // Said, then the pause after a finished question, then the call.
      async asks(who: string | null, text: string, pause = finishedMs) {
        voice(who, text);
        if (await w.tick()) {
          await w.idle();
          return w.tick();
        }
        w.advance(pause);
        return w.act();
      },
    };
  };
  const withPlan = { plan: async () => PLAN };

  describe("where the lines name who spoke", () => {
    it("gives the model each voice under its own name, and the rules of a panel", async () => {
      const w = panelWorld(withPlan);
      w.reply({ chunks: [noteFrom("Marcus")] });
      w.voice("Elena", "Can I ask about, um, how you work with product when");
      w.voice("Marcus", "And what about idempotency, if a");
      w.voice("Marcus", "Sorry, go ahead, Elena.");
      w.voice("Elena", "No, no, you go, mine is a longer one.");
      expect(await w.asks("Marcus", CHARGED)).toBe(true);
      expect(w.calls).toHaveLength(1);
      const prompt = w.calls[0]?.prompt ?? "";
      expect(newLines(prompt)).toEqual([
        "ELENA (interviewer): Can I ask about, um, how you work with product when",
        "MARCUS (interviewer): And what about idempotency, if a",
        "MARCUS (interviewer): Sorry, go ahead, Elena.",
        "ELENA (interviewer): No, no, you go, mine is a longer one.",
        `MARCUS (interviewer): ${CHARGED}`,
      ]);
      expect(under(prompt, PANEL_HEAD).slice(0, 5)).toEqual([
        "- Priya: hiring manager",
        "- Marcus: staff engineer: reliability",
        "- Tom: director: pushes back",
        "- Elena: product",
        "Rules for a panel:",
      ]);
      expect(prompt).toContain("as the lines name them");
      expect(w.calls[0]?.system).toBe(COACH_SYSTEM);
    });

    it("carries who asked on the note when the model names someone who spoke in the turn", async () => {
      const w = panelWorld(withPlan);
      w.reply({ chunks: [noteFrom("Marcus")] });
      w.voice("Elena", "Can I ask about, um, how you work with product when");
      await w.asks("Marcus", CHARGED);
      expect(w.posts.at(-1)?.from).toBe("Marcus");
      expect(w.posts.at(-1)?.ask).toBe("Charged only once");
      expect(coachNoteInputSchema.safeParse(w.posts.at(-1)).success).toBe(true);
    });

    it("drops a name the model gives for someone who did not speak in the turn, even one on the roster", async () => {
      const w = panelWorld(withPlan);
      w.reply({ chunks: [noteFrom("Tom")] });
      w.voice("Elena", "Can I ask about, um, how you work with product when");
      await w.asks("Marcus", CHARGED);
      expect(w.posts).toHaveLength(1);
      expect(w.posts[0] && "from" in w.posts[0]).toBe(false);
    });

    it("names nobody when two spoke in the turn and the model does not say who asked", async () => {
      const w = panelWorld(withPlan);
      w.reply({ chunks: [noteFrom()] });
      w.voice("Elena", "Can I ask about, um, how you work with product when");
      await w.asks("Marcus", CHARGED);
      expect(w.posts[0] && "from" in w.posts[0]).toBe(false);
    });

    it("says the one interviewer who spoke in the turn asked, whether or not the model wrote it", async () => {
      for (const written of [undefined, "Marcus", "Tom", "somebody"]) {
        const w = panelWorld(withPlan);
        w.reply({ chunks: [noteFrom(written)] });
        await w.asks("Marcus", CHARGED);
        expect(w.posts.at(-1)?.from, String(written)).toBe("Marcus");
      }
    });

    it("needs no roster and no plan: the names on the lines are enough", async () => {
      const w = panelWorld();
      w.reply({ chunks: [noteFrom("elena")] });
      w.voice("Marcus", "And what about idempotency, if a");
      await w.asks(
        "Elena",
        "How do you work with product on a date you cannot meet?",
      );
      expect(w.posts.at(-1)?.from).toBe("Elena");
      const prompt = w.calls[0]?.prompt ?? "";
      expect(prompt.split("\n").slice(0, 2)).toEqual([
        PANEL_HEAD,
        "Rules for a panel:",
      ]);
    });

    it("names the person from the first revision shown, and on every one after", async () => {
      const w = panelWorld(withPlan, { postEveryMs: 0 });
      w.voice("Marcus", CHARGED);
      await w.tick();
      w.advance(finishedMs);
      const call = await w.opens();
      call.text(
        "KIND: technical\nSAME: no\nASK: Charged only once\nFROM: Marcus\nSAY: I key the ledger.\n",
      );
      await w.flush();
      call.text("ANCHOR: correlation id\n");
      await w.flush();
      call.done();
      await w.idle();
      expect(w.posts.length).toBeGreaterThanOrEqual(2);
      expect(w.posts.map((post) => post.from)).toEqual(
        w.posts.map(() => "Marcus"),
      );
      expect(w.posts.map((post) => post.revision)).toEqual(
        w.posts.map((_, at) => at + 1),
      );
    });

    it("acts at the same moments, on the same stretches, as it does when nobody is named", async () => {
      const run = async (named: boolean) => {
        const w = panelWorld(withPlan);
        const who = (name: string) => (named ? name : null);
        w.reply(
          { chunks: [SILENT_REPLY] },
          { chunks: [noteFrom("Marcus")] },
          { chunks: [SILENT_REPLY] },
        );
        w.voice(who("Priya"), "I'm going to hand over to Marcus now.");
        await w.asks(
          who("Marcus"),
          "Thanks, Priya. Can everyone hear me okay?",
        );
        w.later();
        w.voice(
          who("Elena"),
          "Can I ask about, um, how you work with product when",
        );
        w.voice(who("Marcus"), "And what about idempotency, if a");
        await w.asks(who("Marcus"), CHARGED);
        await w.asks(
          "me",
          "I key the ledger by correlation id, so a second request is a no-op.",
        );
        w.later();
        await w.asks(
          who("Tom"),
          "I don't buy that. What happens when the ledger is down?",
        );
        return w.told();
      };
      const named = await run(true);
      expect(named).toEqual(await run(false));
      expect(named.filter(([what]) => what === "act")).toHaveLength(3);
    });

    it("makes a call again when another panelist adds to the question, and the note then names one who spoke", async () => {
      const w = panelWorld(withPlan);
      w.voice("Aisha", "Are you legally able to work here?");
      await w.tick();
      w.advance(finishedMs);
      const first = await w.opens();
      w.voice("Priya", "And what notice period do you have?");
      w.reply({ chunks: [noteFrom("Aisha")] });
      expect(await w.tick()).toBe(true);
      expect(first.stopped).toBe(true);
      w.advance(finishedMs);
      await w.act();
      expect(w.events.map((event) => event.what)).toContain("recall");
      expect(newLines(w.calls[1]?.prompt ?? "")).toEqual([
        "AISHA (interviewer): Are you legally able to work here?",
        "PRIYA (interviewer): And what notice period do you have?",
      ]);
      expect(w.posts.at(-1)?.from).toBe("Aisha");
    });
  });

  describe("where the lines do not say who spoke (a call heard live)", () => {
    it("tells the model the roster and to name the asker only on an explicit cue", async () => {
      const w = panelWorld(withPlan);
      w.reply({ chunks: [noteFrom()] });
      await w.asks(null, CHARGED);
      const prompt = w.calls[0]?.prompt ?? "";
      expect(newLines(prompt)).toEqual([`INTERVIEWER: ${CHARGED}`]);
      expect(under(prompt, PANEL_HEAD)).toContain(
        "- Marcus: staff engineer: reliability",
      );
      expect(prompt).toContain(
        "PANEL: the lines do not say which interviewer spoke (Priya, Marcus, Tom, Elena).",
      );
      expect(prompt).toContain("Never guess from what was asked.");
      expect(w.posts[0] && "from" in w.posts[0]).toBe(false);
    });

    it("takes a name the model gives only when it is on the plan's roster", async () => {
      for (const [written, kept] of [
        ["Marcus", "Marcus"],
        ["ELENA", "Elena"],
        ["Aisha", undefined],
        ["Dana", undefined],
        ["the interviewer", undefined],
      ] as const) {
        const w = panelWorld(withPlan);
        w.reply({ chunks: [noteFrom(written)] });
        w.voice(null, "Great. I'm going to hand over to Marcus now.");
        await w.asks(null, CHARGED);
        expect(w.posts.at(-1)?.from, written).toBe(kept);
      }
    });

    it("never fills in a name itself", async () => {
      const w = panelWorld(withPlan);
      w.reply({ chunks: [noteFrom()] });
      w.voice(null, "Over to you, Marcus.");
      await w.asks(null, CHARGED);
      expect(w.posts).toHaveLength(1);
      expect(w.posts[0] && "from" in w.posts[0]).toBe(false);
    });
  });

  describe("a call with one interviewer", () => {
    it("is asked exactly what it was asked before: no panel, no names, no FROM", async () => {
      const w = world(
        {},
        { plan: async () => "Land the ledger migration story." },
      );
      w.reply({ chunks: [NOTE] });
      await w.heard("interviewer", QUESTION, finishedMs);
      const prompt = w.calls[0]?.prompt ?? "";
      expect(prompt).not.toContain("PANEL");
      expect(prompt).not.toContain("FROM");
      expect(prompt).not.toContain("(interviewer)");
      expect(newLines(prompt)).toEqual([`INTERVIEWER: ${QUESTION}`]);
    });

    it("is not made a panel by a plan that lists one person", async () => {
      const w = world({}, { plan: async () => "panel: Dana (hiring manager)" });
      w.reply({ chunks: [noteFrom("Dana")] });
      await w.heard("interviewer", CHARGED, finishedMs);
      const prompt = w.calls[0]?.prompt ?? "";
      expect(prompt).not.toContain("THE PANEL");
      expect(prompt).not.toContain("FROM");
      expect(w.posts).toHaveLength(1);
      expect(w.posts[0] && "from" in w.posts[0]).toBe(false);
    });

    it("names nobody, whatever the model writes", async () => {
      const plain = world();
      plain.reply({ chunks: [noteFrom()] });
      await plain.heard("interviewer", CHARGED, finishedMs);
      const told = world();
      told.reply({ chunks: [noteFrom("Marcus")] });
      await told.heard("interviewer", CHARGED, finishedMs);
      expect(told.posts).toHaveLength(1);
      expect(told.posts[0] && "from" in told.posts[0]).toBe(false);
      const { key: _a, askId: _b, ...one } = told.posts[0] as CoachNoteInput;
      const { key: _c, askId: _d, ...other } = plain.posts[0] as CoachNoteInput;
      expect(one).toEqual(other);
    });
  });

  describe("a look at the candidate's own answer", () => {
    it("is asked by nobody: a nudge never names a panelist, named lines or not", async () => {
      for (const named of [true, false]) {
        const w = panelWorld(withPlan);
        w.reply(
          { chunks: [noteFrom("Marcus")] },
          {
            chunks: [
              "KIND: follow-up\nSAME: yes\nASK: Charged only once\nFROM: Marcus\nSAY: Close on the **ledger**.",
            ],
          },
        );
        await w.asks(named ? "Marcus" : null, CHARGED);
        w.voice("me", `I would start from the request id. ${points(70)}`);
        await w.tick();
        w.advance(TURN_TIMING.candidateEveryMs);
        expect(await w.act()).toBe(true);
        expect(w.events.at(-1)?.reason).toBe("answer-check");
        expect(w.posts).toHaveLength(2);
        expect(w.posts[0]?.from).toBe("Marcus");
        expect(w.posts[1]?.kind).toBe("follow-up");
        expect(w.posts[1] && "from" in w.posts[1]).toBe(false);
      }
    });
  });

  describe("one session of the model kept for the call", () => {
    it("tells the panel with the plan, in what the session is told once", async () => {
      const w = panelWorld(withPlan, { retain: true });
      w.reply({ chunks: [noteFrom("Marcus")] });
      await w.asks("Marcus", CHARGED);
      const [background, turn] = w.calls[0]?.users ?? [];
      expect(background).toContain(PANEL_HEAD);
      expect(background).toContain("- Tom: director: pushes back");
      expect(turn).not.toContain(PANEL_HEAD);
      // The rule for who asked is said with every turn.
      expect(turn).toContain("PANEL: straight after ASK, add the line FROM:");
      expect(background).not.toContain("FROM");
      expect(turn).toContain(`MARCUS (interviewer): ${CHARGED}`);
      expect(w.posts.at(-1)?.from).toBe("Marcus");
    });
  });

  describe("what the coach tells whoever watches", () => {
    it("still carries ids, counts and reasons only: never a name", async () => {
      const w = panelWorld(withPlan);
      w.reply({ chunks: [noteFrom("Marcus")] });
      await w.asks("Marcus", CHARGED);
      expect(JSON.stringify(w.events)).not.toMatch(/Marcus|Priya|charged/i);
    });
  });
});

// The words of a phrase arrive after its voice stops. Where the feed says
// when the voice stopped, the silence after a question is counted from then.
describe("silence counted from when the interviewer's voice stopped", () => {
  const { finishedMs } = TURN_TIMING;
  // A feed that says nobody is speaking and when the interviewer stopped.
  const stoppedAt = (ago: (now: number) => number | undefined) => {
    const held: { w?: ReturnType<typeof world> } = {};
    held.w = world(
      {},
      {
        read: (answer) => {
          const at = ago((held.w as ReturnType<typeof world>).now());
          return {
            ...answer,
            speaking: [],
            ...(at === undefined
              ? {}
              : {
                  stopped: [
                    {
                      speaker: "interviewer" as const,
                      at: new Date(at).toISOString(),
                    },
                  ],
                }),
          };
        },
      },
    );
    return held.w;
  };

  it("acts as soon as the voice has been quiet long enough, though the words only just arrived", async () => {
    // The voice stopped 600 ms before the words were heard.
    const w = stoppedAt(() => T0 - 600);
    expect(await w.hear("interviewer", QUESTION)).toBe(false);
    w.advance(finishedMs - 600);
    expect(await w.tick()).toBe(true);
  });

  it("without a stop it waits the whole time from the words", async () => {
    const w = stoppedAt(() => undefined);
    expect(await w.hear("interviewer", QUESTION)).toBe(false);
    w.advance(finishedMs - 600);
    expect(await w.tick()).toBe(false);
    w.advance(600);
    expect(await w.tick()).toBe(true);
  });

  it("a stop from long before the words is some earlier phrase's: the words' arrival is counted from", async () => {
    const w = stoppedAt(() => T0 - 10_000);
    expect(await w.hear("interviewer", QUESTION)).toBe(false);
    w.advance(finishedMs - 600);
    expect(await w.tick()).toBe(false);
    w.advance(600);
    expect(await w.tick()).toBe(true);
  });

  it("a stop after the words (the voice went on) is waited from", async () => {
    const w = stoppedAt((now) => (now >= T0 + 500 ? T0 + 500 : undefined));
    expect(await w.hear("interviewer", QUESTION)).toBe(false);
    w.advance(finishedMs);
    // 800 ms since the words, 300 ms since the voice stopped.
    expect(await w.tick()).toBe(false);
    w.advance(500);
    expect(await w.tick()).toBe(true);
  });

  it("a stop dated after now is another clock's: the words' arrival is counted from", async () => {
    const w = stoppedAt((now) => now + 60_000);
    expect(await w.hear("interviewer", QUESTION)).toBe(false);
    w.advance(finishedMs);
    expect(await w.tick()).toBe(true);
  });

  it("the candidate's stop is not the interviewer's", async () => {
    const held: { w?: ReturnType<typeof world> } = {};
    held.w = world(
      {},
      {
        read: (answer) => ({
          ...answer,
          speaking: [],
          stopped: [
            { speaker: "candidate", at: new Date(T0 - 600).toISOString() },
          ],
        }),
      },
    );
    const w = held.w;
    expect(await w.hear("interviewer", QUESTION)).toBe(false);
    w.advance(finishedMs - 600);
    expect(await w.tick()).toBe(false);
  });
});
