// The live coach against a scripted model: when it reads, when it waits, what
// it posts while a note is being written, and what it does when a call fails.
// The transcript is the real in-memory one; the clock is the test's own.
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
  type CoachOptions,
  type CoachPorts,
  createCoach,
} from "./coach";
import type { CoachContextPort, CoachFact } from "./context";
import { COACH_SYSTEM } from "./prompt";

const T0 = Date.parse("2026-10-08T09:00:00.000Z");
const SETTLE = 1_200;
const QUESTION = "How would you shard the booking table?";
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
type Call = {
  profileId: string;
  system: string;
  prompt: string;
  execution: Record<string, unknown>;
};

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

function world(
  options: CoachOptions = {},
  // The session every line is heard in, and the port its record is read by.
  live: {
    session?: CoachTranscriptSession;
    facts?: (
      session: CoachTranscriptSession,
      query: string,
    ) => Promise<CoachFact[]>;
  } = {},
) {
  let clock = T0;
  const transcript = createCoachTranscript();
  const script: Scripted[] = [];
  const calls: Call[] = [];
  const posts: CoachNoteInput[] = [];
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
    async *stream(
      input: {
        profileId: string;
        messages: { role: string; parts: { text: string }[] }[];
      },
      execution: Record<string, unknown>,
    ) {
      calls.push({
        profileId: input.profileId,
        system: input.messages[0]?.parts[0]?.text ?? "",
        prompt: input.messages[1]?.parts[0]?.text ?? "",
        execution,
      });
      const scripted = script.shift();
      if (!scripted)
        throw new Error("The coach made a call the test did not script.");
      for (const text of scripted.chunks ?? []) {
        clock += scripted.gapMs ?? 0;
        yield { type: "text" as const, text };
      }
      const end = scripted.end ?? "done";
      if (end === "done") yield { type: "done" as const, value: null };
      else if (end === "cancelled") yield { type: "cancelled" as const };
      else if (end !== "nothing")
        yield { type: "failed" as const, failure: end };
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
          posts.push(note);
        },
      },
      ...(context ? { context } : {}),
      scope: { tenantId: "tenant-test", actorId: "actor-test" },
      nowMs: () => clock,
    },
    options,
  );
  const say = (speaker: CoachSpeaker, text: string, at = clock) =>
    transcript.add(
      [{ speaker, text, at: new Date(at).toISOString() }],
      live.session,
    );
  return {
    transcript,
    script,
    calls,
    posts,
    reads,
    asked,
    say,
    advance: (ms: number) => {
      clock += ms;
    },
    tick: () => coach.tick(signal),
    reply: (...scripted: Scripted[]) => script.push(...scripted),
    // The line is heard, the speaker pauses, and the coach looks.
    async heardThenTick(speaker: CoachSpeaker, text: string) {
      say(speaker, text);
      expect(await coach.tick(signal)).toBe(false);
      clock += SETTLE;
      return coach.tick(signal);
    },
  };
}

const wordsOf = (count: number) =>
  Array.from({ length: count }, (_, at) => `word${at + 1}`).join(" ");
const newLines = (prompt: string) =>
  prompt
    .slice(prompt.indexOf("NEW LINES (decide on these):"))
    .split("\n")
    .slice(1);
const soFar = (prompt: string) =>
  prompt
    .slice(
      prompt.indexOf("THE CONVERSATION SO FAR:"),
      prompt.indexOf("\n\nNEW LINES"),
    )
    .split("\n")
    .slice(1);

describe("when the coach reads", () => {
  it("does nothing while nothing has been said", async () => {
    const w = world();
    expect(await w.tick()).toBe(false);
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toEqual([]);
    expect(w.posts).toEqual([]);
  });

  it("waits for the speaker to pause for settleMs before it asks the model", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] });
    w.say("interviewer", QUESTION);
    expect(await w.tick()).toBe(false);
    w.advance(SETTLE - 1);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toEqual([]);
    w.advance(1);
    expect(await w.tick()).toBe(true);
    expect(w.calls).toHaveLength(1);
    expect(newLines(w.calls[0]?.prompt ?? "")).toEqual([
      `INTERVIEWER: ${QUESTION}`,
    ]);
  });

  it("takes its settle time from the options", async () => {
    const w = world({ settleMs: 200 });
    w.reply({ chunks: [NOTE] });
    w.say("interviewer", QUESTION);
    expect(await w.tick()).toBe(false);
    w.advance(200);
    expect(await w.tick()).toBe(true);
  });

  it("stops waiting for a pause at maxWaitMs, while the speaker is still talking", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] });
    w.say("interviewer", QUESTION);
    expect(await w.tick()).toBe(false);
    for (let second = 1; second <= 5; second += 1) {
      w.advance(1_000);
      w.say("interviewer", `and part ${second} of the question goes on`);
      expect(await w.tick(), `after ${second}s`).toBe(false);
    }
    w.advance(999);
    w.say("interviewer", "nearly there now, still talking");
    expect(await w.tick()).toBe(false);
    expect(w.calls).toEqual([]);
    w.advance(1);
    expect(await w.tick()).toBe(true);
    expect(newLines(w.calls[0]?.prompt ?? "")).toHaveLength(7);
  });

  it("an interviewer's line of four words is worth reading; a shorter one is not", async () => {
    const w = world();
    expect(await w.heardThenTick("interviewer", "Okay, thanks.")).toBe(false);
    expect(await w.heardThenTick("interviewer", "Right. Got it.")).toBe(false);
    expect(w.calls).toEqual([]);
    w.reply({ chunks: [NOTE] });
    expect(await w.heardThenTick("interviewer", "Why that shard key?")).toBe(
      true,
    );
    // The short lines the coach did not ask about are read with the question.
    expect(newLines(w.calls[0]?.prompt ?? "")).toEqual([
      "INTERVIEWER: Okay, thanks.",
      "INTERVIEWER: Right. Got it.",
      "INTERVIEWER: Why that shard key?",
    ]);
  });

  it("an unknown speaker's line is read as an interviewer's would be", async () => {
    const w = world();
    w.reply({ chunks: [SILENT_REPLY] });
    expect(
      await w.heardThenTick("unknown", "Tell me about that project."),
    ).toBe(true);
    expect(w.calls).toHaveLength(1);
  });

  it("short talk by the candidate does not trigger it; enough of it does", async () => {
    const w = world();
    expect(await w.heardThenTick("candidate", wordsOf(15))).toBe(false);
    expect(await w.heardThenTick("candidate", wordsOf(14))).toBe(false);
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toEqual([]);
    // 15 + 14 + 1 = 30 words, unprompted: now the coach looks.
    w.reply({ chunks: [SILENT_REPLY] });
    expect(await w.heardThenTick("candidate", "more")).toBe(true);
    expect(w.calls).toHaveLength(1);
    expect(newLines(w.calls[0]?.prompt ?? "")).toHaveLength(3);
  });

  it("takes the candidate's word count from the options", async () => {
    const w = world({ candidateWords: 5 });
    expect(await w.heardThenTick("candidate", "one two three four")).toBe(
      false,
    );
    w.reply({ chunks: [SILENT_REPLY] });
    expect(await w.heardThenTick("candidate", "five")).toBe(true);
  });
});

describe("what the coach asks", () => {
  it("makes the call as a permitted-remote read of the interview product, by its profile", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] });
    await w.heardThenTick("interviewer", QUESTION);
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
    await w.heardThenTick("interviewer", QUESTION);
    w.say("candidate", "By region.");
    await w.tick();
    await w.tick();
    expect(w.reads).toEqual([0, 1, 1, 2]);
  });
});

describe("what the coach posts", () => {
  it("posts nothing for a silent reply, and does not ask about those lines again", async () => {
    const w = world();
    w.reply({ chunks: ["NO", "NE"] });
    expect(
      await w.heardThenTick("interviewer", "So that covers the team."),
    ).toBe(true);
    expect(w.posts).toEqual([]);
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toHaveLength(1);

    // The next question is new; the line it was silent on is behind it.
    w.reply({ chunks: [NOTE] });
    await w.heardThenTick("interviewer", QUESTION);
    expect(soFar(w.calls[1]?.prompt ?? "")).toEqual([
      "INTERVIEWER: So that covers the team.",
    ]);
    expect(newLines(w.calls[1]?.prompt ?? "")).toEqual([
      `INTERVIEWER: ${QUESTION}`,
    ]);
    expect(w.calls[1]?.prompt).toContain("(oldest first):\n(none)");
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
    expect(await w.heardThenTick("interviewer", QUESTION)).toBe(true);

    expect(w.posts.map((post) => post.revision)).toEqual([1, 2, 3]);
    expect(new Set(w.posts.map((post) => post.key)).size).toBe(1);
    const key = `coach-${w.transcript.since().epoch.slice(0, 8)}-1`;
    expect(w.posts[0]?.key).toBe(key);
    expect(new Set(w.posts.map((post) => post.askId))).toEqual(
      new Set([`${key}-ask`]),
    );
    const said = (post: CoachNoteInput | undefined) =>
      (post?.sections ?? []).map((section) => [
        section.kind,
        section.lines.map((line) =>
          line.segments.map((segment) => segment.text).join(""),
        ),
      ]);
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
    const w = world();
    w.reply({
      gapMs: 100,
      chunks: [
        "ASK: Sharding\nSAY: One.\n",
        "SAY: Two.\n",
        "ANCHOR: three\n",
        "ANCHOR: four",
      ],
    });
    await w.heardThenTick("interviewer", QUESTION);
    expect(
      w.posts.map((post) => [
        post.revision,
        (post.sections ?? []).map((section) => section.lines.length),
      ]),
    ).toEqual([
      [1, [1]],
      [2, [2, 2]],
    ]);
  });

  it("posts a reply that arrives whole once, as revision 1", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] });
    await w.heardThenTick("interviewer", QUESTION);
    expect(w.posts).toHaveLength(1);
    expect(w.posts[0]).toMatchObject({ revision: 1, kind: "technical" });
  });

  it("stamps the note with the time of the last line it answers", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] });
    w.say("interviewer", "Let us talk about data.", T0 - 90_000);
    w.say("interviewer", QUESTION, T0 - 30_000);
    await w.tick();
    w.advance(SETTLE);
    await w.tick();
    expect(w.posts).toHaveLength(1);
    expect(w.posts[0]?.at).toBe(new Date(T0 - 30_000).toISOString());
  });

  it("a note for the same question joins the last note's question; another gets its own", async () => {
    const w = world();
    const same = NOTE.replace("SAME: no", "SAME: yes");
    w.reply({ chunks: [NOTE] }, { chunks: [same] }, { chunks: [NOTE] });
    await w.heardThenTick("interviewer", QUESTION);
    await w.heardThenTick("interviewer", "And what about hot regions?");
    await w.heardThenTick("interviewer", "Now, tell me about on-call.");
    const prefix = `coach-${w.transcript.since().epoch.slice(0, 8)}`;
    expect(
      w.posts.map((post) => [post.key, post.askId, post.revision]),
    ).toEqual([
      [`${prefix}-1`, `${prefix}-1-ask`, 1],
      [`${prefix}-2`, `${prefix}-1-ask`, 1],
      [`${prefix}-3`, `${prefix}-3-ask`, 1],
    ]);
  });

  it("a first note that claims the same question has none to join", async () => {
    const w = world();
    w.reply({ chunks: [NOTE.replace("SAME: no", "SAME: yes")] });
    await w.heardThenTick("interviewer", QUESTION);
    expect(w.posts[0]?.askId).toBe(`${w.posts[0]?.key}-ask`);
  });

  it("tells the model the notes it has given, oldest first", async () => {
    const w = world();
    w.reply(
      { chunks: [NOTE] },
      { chunks: ["KIND: follow-up\nASK: Hot regions\nSAY: Split them."] },
      { chunks: [SILENT_REPLY] },
    );
    await w.heardThenTick("interviewer", QUESTION);
    await w.heardThenTick("interviewer", "And what about hot regions?");
    await w.heardThenTick("interviewer", "Thanks, that makes sense to me.");
    expect(w.calls[2]?.prompt).toContain(
      [
        "NOTES YOU HAVE ALREADY GIVEN (oldest first):",
        "- [technical] Sharding the booking table",
        "- [follow-up] Hot regions",
        "",
      ].join("\n"),
    );
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
    await w.heardThenTick("interviewer", QUESTION);
    await w.heardThenTick("interviewer", "And what about hot regions?");
    expect(w.posts).toHaveLength(2);
    expect(w.calls[1]?.prompt).toContain(
      "- [technical] Sharding the booking table",
    );
    expect(w.posts[1]?.askId).toBe(w.posts[0]?.askId);
  });

  it("names a note by its conversation and the last line of its stretch, not by a count", async () => {
    const w = world();
    // The first stretch gets no note; the second note is still named by its line.
    w.reply({ chunks: [SILENT_REPLY] }, { chunks: [NOTE] });
    await w.heardThenTick("interviewer", "So that covers the team.");
    w.say("candidate", "Sure.");
    await w.heardThenTick("interviewer", QUESTION);
    const epoch = w.transcript.since().epoch;
    expect(w.posts.map((post) => [post.key, post.askId])).toEqual([
      [`coach-${epoch.slice(0, 8)}-3`, `coach-${epoch.slice(0, 8)}-3-ask`],
    ]);
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
    w.say("interviewer", QUESTION);
    await w.tick();
    w.advance(SETTLE);
    await expect(w.tick()).rejects.toBeInstanceOf(CoachCallError);
    expect(w.posts.map((post) => post.revision)).toEqual([1, 2]);
    expect(await w.tick()).toBe(true);

    const key = `coach-${w.transcript.since().epoch.slice(0, 8)}-1`;
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
    await w.heardThenTick("interviewer", "And what about hot regions?");
    expect(w.calls[2]?.prompt.match(/^- \[.*$/gm)).toEqual([
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
    await w.heardThenTick("interviewer", QUESTION);
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
    expect(await w.heardThenTick("interviewer", QUESTION)).toBe(true);
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
    w.say("candidate", "By region, I think.");
    w.say("unknown", "And why that key?");
    await w.tick();
    w.advance(SETTLE);
    await w.tick();
    expect(w.asked).toEqual([
      {
        session: SESSION,
        query:
          "Right, so how would you shard it? And why that key? I would start with the data. By region, I think.",
      },
    ]);
    // The next stretch asks by its own lines only.
    await w.heardThenTick("interviewer", "And the rollback plan there?");
    expect(w.asked[1]).toEqual({
      session: SESSION,
      query: "And the rollback plan there?",
    });
  });

  it("puts the facts in the prompt and makes the call as the session's owner", async () => {
    const w = world({}, { session: SESSION, facts: async () => FACTS });
    w.reply({ chunks: [NOTE] });
    await w.heardThenTick("interviewer", QUESTION);
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
    await w.heardThenTick("interviewer", QUESTION);
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
    await w.heardThenTick("interviewer", QUESTION);
    await w.heardThenTick("interviewer", "And what about hot regions?");
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
    expect(await w.heardThenTick("interviewer", QUESTION)).toBe(true);
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
  });

  it("keeps the session across a cleared transcript", async () => {
    const w = world({}, { session: SESSION, facts: async () => FACTS });
    w.reply({ chunks: [SILENT_REPLY] }, { chunks: [NOTE] });
    await w.heardThenTick("interviewer", QUESTION);
    w.transcript.clear();
    await w.tick();
    await w.heardThenTick("interviewer", "What is your notice period?");
    expect(w.asked.map((each) => each.session)).toEqual([SESSION, SESSION]);
    expect(w.calls[1]?.execution["scope"]).toMatchObject({
      tenantId: SESSION.tenantId,
    });
  });
});

describe("a new conversation", () => {
  it("forgets the last one when the transcript is cleared: its lines, its notes and its question", async () => {
    const w = world();
    w.reply({ chunks: [NOTE] });
    await w.heardThenTick("interviewer", QUESTION);
    const before = w.transcript.since().epoch;

    w.transcript.clear();
    // The coach sees the new epoch and looks again at once, from the start.
    expect(await w.tick()).toBe(true);
    expect(await w.tick()).toBe(false);
    expect(w.reads.slice(-2)).toEqual([1, 0]);

    w.reply({ chunks: [NOTE.replace("SAME: no", "SAME: yes")] });
    expect(
      await w.heardThenTick("interviewer", "What is your notice period?"),
    ).toBe(true);
    const epoch = w.transcript.since().epoch;
    expect(epoch).not.toBe(before);
    const prompt = w.calls[1]?.prompt ?? "";
    expect(prompt).toContain("(oldest first):\n(none)");
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
    expect(note?.key?.startsWith(`coach-${epoch.slice(0, 8)}-`)).toBe(true);
    expect(note?.askId).toBe(`${note?.key}-ask`);
    expect(note?.key).not.toBe(w.posts[0]?.key);
  });

  it("reads lines already there when the cleared transcript is seen", async () => {
    const w = world();
    w.reply({ chunks: [SILENT_REPLY] }, { chunks: [SILENT_REPLY] });
    await w.heardThenTick("interviewer", QUESTION);
    w.transcript.clear();
    w.say("interviewer", "A first line of the next conversation.");
    expect(await w.tick()).toBe(true);
    expect(await w.tick()).toBe(false);
    w.advance(SETTLE);
    expect(await w.tick()).toBe(true);
    expect(newLines(w.calls[1]?.prompt ?? "")).toEqual([
      "INTERVIEWER: A first line of the next conversation.",
    ]);
  });
});

describe("a backlog", () => {
  it("is read a stretch at a time, in order, each note at its own moment", async () => {
    const w = world();
    const at = (minute: number) => T0 - (10 - minute) * 60_000;
    const long = (tag: string) => `${tag} ${"x".repeat(800)}`;
    w.say("interviewer", long("Q1"), at(1));
    w.say("candidate", long("A1"), at(2));
    w.say("interviewer", long("Q2"), at(3));
    w.say("candidate", long("A2a"), at(4));
    w.say("candidate", long("A2b"), at(5));
    w.say("interviewer", "Q3 short and last one", at(6));
    const note = (ask: string) => ({
      chunks: [`ASK: ${ask}\nSAY: An answer to ${ask}.`],
    });
    w.reply(note("first"), note("second"), note("third"));

    expect(await w.tick()).toBe(false);
    w.advance(SETTLE);
    expect(await w.tick()).toBe(true);
    expect(await w.tick()).toBe(true);
    expect(await w.tick()).toBe(true);
    expect(await w.tick()).toBe(false);

    const tags = (lines: string[]) => lines.map((line) => line.split(" ")[1]);
    expect(w.calls.map((call) => tags(newLines(call.prompt)))).toEqual([
      ["Q1", "A1"],
      ["Q2", "A2a", "A2b"],
      ["Q3"],
    ]);
    // A stretch is put to the model without what was said after it.
    expect(soFar(w.calls[0]?.prompt ?? "")).toEqual([
      "(nothing before the new lines)",
    ]);
    expect(w.calls.slice(1).map((call) => tags(soFar(call.prompt)))).toEqual([
      ["Q1", "A1"],
      ["Q1", "A1", "Q2", "A2a", "A2b"],
    ]);
    expect(w.calls[0]?.prompt).not.toContain("Q2");
    expect(w.posts.map((post) => [post.ask, post.at])).toEqual([
      ["first", new Date(at(2)).toISOString()],
      ["second", new Date(at(5)).toISOString()],
      ["third", new Date(at(6)).toISOString()],
    ]);
    const epoch = w.transcript.since().epoch;
    expect(w.calls.map((call) => call.execution["idempotencyKey"])).toEqual([
      `coach:${epoch}:2:0`,
      `coach:${epoch}:5:0`,
      `coach:${epoch}:6:0`,
    ]);
  });
});

describe("a call that does not finish", () => {
  it("throws for a retryable failure, then passes the stretch over on the second attempt", async () => {
    const w = world();
    w.reply({ end: failure(true) }, { end: failure(true) });
    w.say("interviewer", QUESTION);
    await w.tick();
    w.advance(SETTLE);

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

    expect(await w.tick()).toBe(true);
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

    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toHaveLength(2);
    expect(w.posts).toEqual([]);

    // The next stretch starts with a clean count of attempts.
    w.reply({ chunks: [NOTE] });
    expect(
      await w.heardThenTick("interviewer", "And the rollback plan there?"),
    ).toBe(true);
    expect(w.calls[2]?.execution["idempotencyKey"]).toBe(`coach:${epoch}:2:0`);
    expect(newLines(w.calls[2]?.prompt ?? "")).toEqual([
      "INTERVIEWER: And the rollback plan there?",
    ]);
    expect(w.posts).toHaveLength(1);
  });

  it("answers on the second attempt when the first failed", async () => {
    const w = world();
    w.reply({ end: failure(true) }, { chunks: [NOTE] });
    w.say("interviewer", QUESTION);
    await w.tick();
    w.advance(SETTLE);
    await expect(w.tick()).rejects.toBeInstanceOf(CoachCallError);
    expect(await w.tick()).toBe(true);
    expect(w.posts).toHaveLength(1);
    expect(w.posts[0]).toMatchObject({ revision: 1, kind: "technical" });
  });

  it("passes a stretch over at once when the failure cannot be retried", async () => {
    const w = world();
    w.reply({ end: failure(false) });
    w.say("interviewer", QUESTION);
    await w.tick();
    w.advance(SETTLE);
    expect(await w.tick()).toBe(true);
    expect(w.calls).toHaveLength(1);
    w.advance(60_000);
    expect(await w.tick()).toBe(false);
    expect(w.calls).toHaveLength(1);
    expect(w.posts).toEqual([]);
  });

  it.each(["cancelled", "nothing"] as const)(
    "treats a call that ends with %s as one to try again",
    async (end) => {
      const w = world();
      w.reply({ end }, { chunks: [NOTE] });
      w.say("interviewer", QUESTION);
      await w.tick();
      w.advance(SETTLE);
      const first = await w.tick().catch((error: unknown) => error);
      expect(first).toBeInstanceOf(CoachCallError);
      expect((first as CoachCallError).failure).toBeUndefined();
      expect(await w.tick()).toBe(true);
      expect(w.posts).toHaveLength(1);
    },
  );

  it("lets a failure to post through as it is, and asks again", async () => {
    const refused = new Error("Studio answered 503.");
    let clock = T0;
    const transcript = createCoachTranscript();
    let attempts = 0;
    let calls = 0;
    const coach = createCoach({
      engine: {
        async *stream() {
          calls += 1;
          yield { type: "text" as const, text: NOTE };
          yield { type: "done" as const, value: null };
        },
      } as unknown as CoachPorts["engine"],
      profileId: "test-coach-profile",
      transcript: { since: async (after) => transcript.since(after) },
      notes: {
        post: async () => {
          attempts += 1;
          if (attempts === 1) throw refused;
        },
      },
      scope: { tenantId: "tenant-test", actorId: "actor-test" },
      nowMs: () => clock,
    });
    const signal = new AbortController().signal;
    transcript.add([{ speaker: "interviewer", text: QUESTION }]);
    await coach.tick(signal);
    clock += SETTLE;
    await expect(coach.tick(signal)).rejects.toBe(refused);
    expect(await coach.tick(signal)).toBe(true);
    expect([calls, attempts]).toEqual([2, 2]);
  });
});
