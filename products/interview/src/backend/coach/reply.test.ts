// What the coach's model writes, read into a note: silence is no note, an
// unfinished line is never shown, and whatever the model writes the note that
// comes out is one the contract takes.
import {
  COACH_NOTE_KINDS,
  coachNoteInputSchema,
  TALKING_POINT_LENGTH,
} from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { parseCoachReply, SILENT } from "./reply";

const reply = (...lines: string[]) => lines.join("\n");
const spoken = (text: string) => ({ segments: [{ text, role: "spoken" }] });
// The person's own facts the model was given, by pointer. All invented.
const KNOWN = new Map([
  [
    "/roles/0/proof_points/0",
    "Cut checkout latency 40% at Harbourline by moving reads to a replica",
  ],
  ["/roles/1/technologies/0", "Kafka"],
  ["/roles/1/responsibilities/2", "Ran the on-call rota for 12 engineers"],
]);
const segmentsOf = (say: string, known?: ReadonlyMap<string, string>) =>
  parseCoachReply(reply("ASK: Evidence", `SAY: ${say}`), true, known)?.note
    .sections?.[0]?.lines[0]?.segments;
const FULL = reply(
  "KIND: technical",
  "SAME: no",
  "ASK: Keeping two services consistent",
  "HEARD: How do you keep the order and billing services consistent?",
  "SAY: I start from an outbox in the same transaction as the write.",
  "ANCHOR: outbox, idempotent consumer",
  "QUESTION: How do you handle replays today?",
  "CAUTION: Do not promise exactly-once; say effectively-once.",
);

describe("a reply that says nothing", () => {
  it.each([
    ["the silent word", SILENT],
    ["the silent word and a newline", `${SILENT}\n`],
    ["nothing at all", ""],
    ["prose with no labelled line", "I have nothing useful to add here."],
    [
      "the header fields alone",
      reply("KIND: technical", "SAME: no", "ASK: Consistency"),
    ],
    [
      "labels with nothing after them",
      reply("KIND: technical", "SAY:", "CAUTION:   "),
    ],
    [
      "a label in lower case",
      reply("KIND: technical", "say: Lead with the outbox."),
    ],
    ["a line of bold marks only", reply("ASK: Consistency", "SAY: ****")],
  ])("is no note: %s", (_name, text) => {
    expect(SILENT).toBe("NONE");
    expect(parseCoachReply(text, true)).toBeNull();
    expect(parseCoachReply(text, false)).toBeNull();
  });
});

describe("a finished reply", () => {
  it("becomes a note with its kind, question, what was heard and each section", () => {
    const parsed = parseCoachReply(FULL, true);
    expect(parsed).toEqual({
      sameQuestion: false,
      note: {
        title: "Keeping two services consistent",
        kind: "technical",
        tone: "say",
        ask: "Keeping two services consistent",
        heard: "How do you keep the order and billing services consistent?",
        sections: [
          {
            kind: "say",
            lines: [
              spoken(
                "I start from an outbox in the same transaction as the write.",
              ),
            ],
          },
          { kind: "anchors", lines: [spoken("outbox, idempotent consumer")] },
          { kind: "ask", lines: [spoken("How do you handle replays today?")] },
          {
            kind: "caution",
            lines: [
              spoken("Do not promise exactly-once; say effectively-once."),
            ],
          },
        ],
      },
    });
  });

  it("reads CRLF line ends and padded lines the same way", () => {
    expect(
      parseCoachReply(
        FULL.split("\n")
          .map((line) => `  ${line}  `)
          .join("\r\n"),
        true,
      ),
    ).toEqual(parseCoachReply(FULL, true));
  });

  it("puts the sections in the window's order whatever order they were written in", () => {
    const parsed = parseCoachReply(
      reply(
        "CAUTION: Avoid the word rewrite.",
        "QUESTION: What does the team own?",
        "ANCHOR: three stages",
        "SAY: First line.",
        "ASK: Rollout",
        "KIND: behavioral",
        "SAY: Second line.",
      ),
      true,
    );
    expect(parsed?.note.sections?.map((section) => section.kind)).toEqual([
      "say",
      "anchors",
      "ask",
      "caution",
    ]);
    expect(parsed?.note.sections?.[0]?.lines).toEqual([
      spoken("First line."),
      spoken("Second line."),
    ]);
    expect(parsed?.note).toMatchObject({ kind: "behavioral", ask: "Rollout" });
  });

  it("keeps the first lines of a section up to its cap: 3 to say, 3 anchors, 1 question, 1 caution", () => {
    const many = (label: string) =>
      Array.from({ length: 6 }, (_, at) => `${label}: ${label} ${at + 1}`);
    const parsed = parseCoachReply(
      reply(
        "ASK: Caps",
        ...many("SAY"),
        ...many("ANCHOR"),
        ...many("QUESTION"),
        ...many("CAUTION"),
      ),
      true,
    );
    const texts = Object.fromEntries(
      (parsed?.note.sections ?? []).map((section) => [
        section.kind,
        section.lines.map((line) => line.segments[0]?.text),
      ]),
    );
    expect(texts).toEqual({
      say: ["SAY 1", "SAY 2", "SAY 3"],
      anchors: ["ANCHOR 1", "ANCHOR 2", "ANCHOR 3"],
      ask: ["QUESTION 1"],
      caution: ["CAUTION 1"],
    });
  });

  it("marks **bold** as evidence the coach inferred, and the rest as spoken", () => {
    const parsed = parseCoachReply(
      reply(
        "ASK: Migration",
        "SAY: I led the **Postgres** migration for **40 services** at Harbourline.",
        "SAY: **Kafka** carried the events.",
        "SAY: It ended on **an unclosed mark",
      ),
      true,
    );
    expect(parsed?.note.sections?.[0]?.lines).toEqual([
      {
        segments: [
          { text: "I led the ", role: "spoken" },
          { text: "Postgres", role: "evidence", grounding: "inferred" },
          { text: " migration for ", role: "spoken" },
          { text: "40 services", role: "evidence", grounding: "inferred" },
          { text: " at Harbourline.", role: "spoken" },
        ],
      },
      {
        segments: [
          { text: "Kafka", role: "evidence", grounding: "inferred" },
          { text: " carried the events.", role: "spoken" },
        ],
      },
      // A mark that was never closed is dropped; its words are only spoken.
      { segments: [{ text: "It ended on an unclosed mark", role: "spoken" }] },
    ]);
  });

  it("cuts a line longer than a talking point, ending it with an ellipsis", () => {
    const parsed = parseCoachReply(
      reply("ASK: Long", `SAY: ${"word ".repeat(80)}`),
      true,
    );
    const text = parsed?.note.sections?.[0]?.lines[0]?.segments[0]?.text ?? "";
    expect(text.length).toBeLessThanOrEqual(TALKING_POINT_LENGTH);
    expect(text.endsWith("…")).toBe(true);
    expect(text.startsWith("word word")).toBe(true);
    expect(
      parseCoachReply(reply("ASK: Fits", `SAY: ${"a".repeat(240)}`), true)?.note
        .sections?.[0]?.lines[0]?.segments[0]?.text,
    ).toBe("a".repeat(240));
  });

  it("holds a line to twelve pieces", () => {
    const parsed = parseCoachReply(
      reply("ASK: Pieces", `SAY: ${"a **b** ".repeat(10)}`),
      true,
    );
    expect(parsed?.note.sections?.[0]?.lines[0]?.segments).toHaveLength(12);
  });

  it("cuts a long question to 80 characters and what was heard to 600", () => {
    const parsed = parseCoachReply(
      reply(
        `ASK: ${"q".repeat(100)}`,
        `HEARD: ${"h".repeat(700)}`,
        "SAY: Answer.",
      ),
      true,
    );
    expect(parsed?.note.ask).toBe(`${"q".repeat(79)}…`);
    expect(parsed?.note.title).toBe(parsed?.note.ask);
    expect(parsed?.note.heard).toBe(`${"h".repeat(599)}…`);
  });

  it("titles the note by its question, else by what was heard (cut to 120), else Coach", () => {
    expect(parseCoachReply(reply("SAY: Answer."), true)?.note).toEqual({
      title: "Coach",
      kind: "direct-answer",
      tone: "say",
      sections: [{ kind: "say", lines: [spoken("Answer.")] }],
    });
    const heard = parseCoachReply(
      reply(`HEARD: ${"h".repeat(200)}`, "SAY: Answer."),
      true,
    );
    expect(heard?.note.title).toBe(`${"h".repeat(119)}…`);
    expect(heard?.note.heard).toBe("h".repeat(200));
    expect(heard?.note).not.toHaveProperty("ask");
  });

  it.each([...COACH_NOTE_KINDS])("keeps the kind %s", (kind) => {
    expect(
      parseCoachReply(reply(`KIND: ${kind}`, "SAY: Answer."), true)?.note.kind,
    ).toBe(kind);
  });

  it.each(["steer", "Technical", "technical, mostly", ""])(
    "falls back to direct-answer for the kind %j",
    (kind) => {
      expect(
        parseCoachReply(reply(`KIND: ${kind}`, "SAY: Answer."), true)?.note
          .kind,
      ).toBe("direct-answer");
    },
  );

  it("keeps the first of a field written twice", () => {
    expect(
      parseCoachReply(
        reply(
          "KIND: closing",
          "KIND: technical",
          "ASK: One",
          "ASK: Two",
          "SAY: A.",
        ),
        true,
      )?.note,
    ).toMatchObject({ kind: "closing", ask: "One" });
  });

  it.each([
    ["yes", true],
    ["YES", true],
    ["true", true],
    ["no", false],
    ["maybe", false],
    ["yes, the same one", false],
  ])("SAME: %s joins the last question: %s", (same, joins) => {
    expect(
      parseCoachReply(reply(`SAME: ${same}`, "SAY: Answer."), true)
        ?.sameQuestion,
    ).toBe(joins);
  });

  it("is for another question when SAME is left out", () => {
    expect(parseCoachReply("SAY: Answer.", true)?.sameQuestion).toBe(false);
  });

  it("draws a note that only warns as a warning, and any other as something to say", () => {
    expect(
      parseCoachReply(
        reply(
          "KIND: missed-opportunity",
          "CAUTION: You skipped the result; add the **30%** drop.",
        ),
        true,
      )?.note,
    ).toMatchObject({
      tone: "watch",
      sections: [{ kind: "caution" }],
    });
    expect(
      parseCoachReply(reply("SAY: Answer.", "CAUTION: Careful."), true)?.note
        .tone,
    ).toBe("say");
    expect(parseCoachReply(reply("ANCHOR: one thing"), true)?.note.tone).toBe(
      "say",
    );
  });

  it("ignores prose, Markdown fences and labels it does not know around the labelled lines", () => {
    const parsed = parseCoachReply(
      reply(
        "Here is the note:",
        "```",
        "ASK: Rollout",
        "NOTE: something else",
        "- a bullet",
        "SAY: Answer.",
        "```",
      ),
      true,
    );
    expect(parsed?.note).toEqual({
      title: "Rollout",
      kind: "direct-answer",
      tone: "say",
      ask: "Rollout",
      sections: [{ kind: "say", lines: [spoken("Answer.")] }],
    });
  });
});

describe("whether a claim is the person's own", () => {
  it("verifies a cited claim whose pointer is a known fact and whose figures are that fact's", () => {
    expect(
      segmentsOf(
        "I **cut checkout latency 40%**[/roles/0/proof_points/0] there.",
        KNOWN,
      ),
    ).toEqual([
      { text: "I ", role: "spoken" },
      {
        text: "cut checkout latency 40%",
        role: "evidence",
        grounding: "verified",
        source: "/roles/0/proof_points/0",
      },
      { text: " there.", role: "spoken" },
    ]);
  });

  it("verifies a cited claim with no figure by its pointer alone, whatever its words", () => {
    expect(
      segmentsOf("I used **event streaming**[/roles/1/technologies/0].", KNOWN),
    ).toEqual([
      { text: "I used ", role: "spoken" },
      {
        text: "event streaming",
        role: "evidence",
        grounding: "verified",
        source: "/roles/1/technologies/0",
      },
      { text: ".", role: "spoken" },
    ]);
  });

  it.each([
    ["a pointer that is not one of the facts", "/roles/7/proof_points/3"],
    ["a pointer into the employer's material", "/context/employerBrief/2"],
  ])(
    "a claim cited with %s is inferred unless a fact holds its words",
    (_name, pointer) => {
      // The words match no fact: inferred, and the pointer is not kept.
      expect(segmentsOf(`I **led the rewrite**[${pointer}].`, KNOWN)).toEqual([
        { text: "I ", role: "spoken" },
        { text: "led the rewrite", role: "evidence", grounding: "inferred" },
        { text: ".", role: "spoken" },
      ]);
      // The words are a fact's own: it verifies as that fact, not as cited.
      expect(segmentsOf(`I used **Kafka**[${pointer}].`, KNOWN)?.[1]).toEqual({
        text: "Kafka",
        role: "evidence",
        grounding: "verified",
        source: "/roles/1/technologies/0",
      });
    },
  );

  it.each([
    "cut checkout latency 60%",
    "cut checkout latency 40% across 9 services",
    "cut p99 latency",
  ])(
    "a cited claim with a figure the fact does not have is inferred: %s",
    (claim) => {
      expect(
        segmentsOf(`I **${claim}**[/roles/0/proof_points/0].`, KNOWN)?.[1],
      ).toEqual({ text: claim, role: "evidence", grounding: "inferred" });
    },
  );

  it("verifies an uncited claim when one fact holds all its words, as that fact", () => {
    expect(
      segmentsOf(
        "I ran **the on-call rota for 12 engineers** and used **KAFKA**.",
        KNOWN,
      ),
    ).toEqual([
      { text: "I ran ", role: "spoken" },
      {
        text: "the on-call rota for 12 engineers",
        role: "evidence",
        grounding: "verified",
        source: "/roles/1/responsibilities/2",
      },
      { text: " and used ", role: "spoken" },
      {
        text: "KAFKA",
        role: "evidence",
        grounding: "verified",
        source: "/roles/1/technologies/0",
      },
      { text: ".", role: "spoken" },
    ]);
  });

  it.each([
    ["a word no fact has", "Postgres"],
    ["a figure no fact has", "the rota for 30 engineers"],
    ["words spread over two facts", "Kafka at Harbourline"],
    ["small words only", "the of and"],
  ])("an uncited claim is inferred, with no source: %s", (_name, claim) => {
    expect(segmentsOf(`It was **${claim}**.`, KNOWN)?.[1]).toEqual({
      text: claim,
      role: "evidence",
      grounding: "inferred",
    });
  });

  it("verifies nothing when no facts were given, cited or not", () => {
    for (const known of [undefined, new Map<string, string>()])
      expect(
        segmentsOf(
          "I **cut checkout latency 40%**[/roles/0/proof_points/0] with **Kafka**.",
          known,
        ),
      ).toEqual([
        { text: "I ", role: "spoken" },
        {
          text: "cut checkout latency 40%",
          role: "evidence",
          grounding: "inferred",
        },
        { text: " with ", role: "spoken" },
        { text: "Kafka", role: "evidence", grounding: "inferred" },
        { text: ".", role: "spoken" },
      ]);
  });

  it("never shows a pointer, a stray mark or an unfinished pointer as text", () => {
    for (const say of [
      "I **cut checkout latency 40%**[/roles/0/proof_points/0] and then ** more [/roles",
      "I **cut checkout latency 40%**[/roles/0/proof_points/0] [/roles/1/techno",
      "Stray ** mark then **Kafka**[/roles/1/technologies/0] [/roles/9]",
    ]) {
      const shown = (segmentsOf(say, KNOWN) ?? [])
        .map((segment) => segment.text)
        .join("");
      expect(shown).not.toMatch(/\*\*|\[|\]|\/roles/);
    }
  });

  // DEFECT (reply.ts:53, `tokens`): a token keeps a trailing full stop, so a
  // fact whose sentence ends on the figure or the word ("... by 40%.",
  // "... then Postgres.") holds "40%." and "postgres.", and a claim of "40%"
  // or "Postgres" never matches it: a true, correctly cited figure is shown
  // as the coach's inference. Remove `.fails` when that is fixed.
  it("verifies a figure or a word that ends the fact's sentence", () => {
    const known = new Map([
      ["/roles/0/proof_points/0", "Cut checkout latency by 40%."],
      ["/roles/0/technologies/1", "Moved to Kafka, then Postgres."],
    ]);
    expect(
      segmentsOf("I **cut latency 40%**[/roles/0/proof_points/0].", known)?.[1],
    ).toMatchObject({ grounding: "verified" });
    expect(segmentsOf("It was **Postgres**.", known)?.[1]).toMatchObject({
      grounding: "verified",
    });
  });

  // DEFECT (reply.ts:72 `sourceOf` / coach.ts:163 `known`): any known pointer
  // is given back as the claim's `source`, but the contract takes only
  // "/roles/N/..." and "/context/..." there. The session context also has
  // candidate facts outside the roles ("/candidate/headline"), so a claim
  // that verifies against one makes a note the Studio refuses (400) and the
  // coach's post throws. Remove `.fails` when that is fixed.
  it("gives a note the contract takes when the fact is not under a role", () => {
    const parsed = parseCoachReply(
      "SAY: I am a **platform engineer**[/candidate/headline].",
      true,
      new Map([["/candidate/headline", "Platform engineer"]]),
    );
    expect(coachNoteInputSchema.safeParse(parsed?.note).success).toBe(true);
  });

  it("gives a note the contract takes, its sources in the contract's pointer form", () => {
    const parsed = parseCoachReply(
      reply(
        "KIND: behavioral",
        "ASK: A result you are proud of",
        "SAY: I **cut checkout latency 40%**[/roles/0/proof_points/0] at Harbourline.",
        "SAY: I ran **the on-call rota for 12 engineers** and **Kafka**[/roles/1/technologies/0].",
        "ANCHOR: **Postgres**[/roles/9/technologies/4]",
      ),
      true,
      KNOWN,
    );
    const note = coachNoteInputSchema.parse(parsed?.note);
    const evidence = (note.sections ?? []).flatMap((section) =>
      section.lines.flatMap((line) =>
        line.segments.filter((segment) => segment.role === "evidence"),
      ),
    );
    expect(evidence.map((each) => [each.grounding, each.source])).toEqual([
      ["verified", "/roles/0/proof_points/0"],
      ["verified", "/roles/1/responsibilities/2"],
      ["verified", "/roles/1/technologies/0"],
      ["inferred", undefined],
    ]);
  });
});

describe("a line cut to a talking point", () => {
  const total = (segments: readonly { text: string }[] | undefined) =>
    (segments ?? []).reduce((sum, segment) => sum + segment.text.length, 0);

  it("cuts inside a claim after its marks are read: no half mark, and its grounding kept", () => {
    const segments = segmentsOf(
      `${"a".repeat(230)} **cut checkout latency 40%**[/roles/0/proof_points/0] and more`,
      KNOWN,
    );
    expect(total(segments)).toBeLessThanOrEqual(TALKING_POINT_LENGTH);
    expect(segments).toHaveLength(2);
    expect(segments?.[1]).toEqual({
      text: "cut chec…",
      role: "evidence",
      grounding: "verified",
      source: "/roles/0/proof_points/0",
    });
    expect(segments?.map((each) => each.text).join("")).not.toMatch(/\*|\[/);
  });

  it("drops what follows a full line, pointer and all", () => {
    const segments = segmentsOf(
      `${"a".repeat(240)}**Kafka**[/roles/1/technologies/0] tail`,
      KNOWN,
    );
    expect(segments).toEqual([{ text: "a".repeat(240), role: "spoken" }]);
  });

  it("cuts a pointer that the length falls in without showing any of it", () => {
    const segments = segmentsOf(
      `${"a".repeat(228)} **Kafka**[/roles/1/technologies/0] and on`,
      KNOWN,
    );
    expect(total(segments)).toBeLessThanOrEqual(TALKING_POINT_LENGTH);
    expect(segments?.map((each) => each.text)).toEqual([
      `${"a".repeat(228)} `,
      "Kafka",
      " and…",
    ]);
    expect(segments?.[1]).toMatchObject({ grounding: "verified" });
  });
});

describe("a reply still being written", () => {
  it("leaves out its last line, which is unfinished", () => {
    const text = reply(
      "KIND: technical",
      "ASK: Consistency",
      "SAY: I start from an out",
    );
    expect(parseCoachReply(text, false)).toBeNull();
    expect(parseCoachReply(text, true)?.note.sections?.[0]?.lines).toEqual([
      spoken("I start from an out"),
    ]);
  });

  it("shows every line that has ended, and the next only once it ends", () => {
    const first =
      "KIND: technical\nASK: Consistency\nSAY: I start from an outbox.\n";
    expect(parseCoachReply(first, false)?.note.sections).toEqual([
      { kind: "say", lines: [spoken("I start from an outbox.")] },
    ]);
    const growing = `${first}SAY: Then an idempotent cons`;
    expect(parseCoachReply(growing, false)).toEqual(
      parseCoachReply(first, false),
    );
    expect(
      parseCoachReply(`${growing}umer.\n`, false)?.note.sections?.[0]?.lines,
    ).toEqual([
      spoken("I start from an outbox."),
      spoken("Then an idempotent consumer."),
    ]);
  });

  it("does not take a half-written silent word for a note", () => {
    for (const text of ["N", "NON", "NONE"])
      expect(parseCoachReply(text, false)).toBeNull();
  });

  it("uses a placeholder title until the question has been written", () => {
    expect(
      parseCoachReply("SAY: Answer first.\nASK: Late", false)?.note.title,
    ).toBe("Coach");
  });
});

describe("whatever the model writes", () => {
  it.each([
    ["the full reply", FULL],
    [
      "every cap passed and every line too long",
      reply(
        "KIND: nonsense",
        `ASK: ${"q ".repeat(200)}`,
        `HEARD: ${"h ".repeat(900)}`,
        ...["SAY", "ANCHOR", "QUESTION", "CAUTION"].flatMap((label) =>
          Array.from(
            { length: 8 },
            () => `${label}: ${"long **bold** words ".repeat(40)}`,
          ),
        ),
      ),
    ],
    ["a warning alone", "CAUTION: Slow down."],
    ["bold marks cut by the length", `SAY: ${"a".repeat(237)}**b**`],
  ])("the note is one the contract takes: %s", (_name, text) => {
    const parsed = parseCoachReply(text, true);
    expect(parsed).not.toBeNull();
    expect(() => coachNoteInputSchema.parse(parsed?.note)).not.toThrow();
    // As the coach posts it: with a key, a revision, a question id and a time.
    expect(() =>
      coachNoteInputSchema.parse({
        ...parsed?.note,
        key: "coach-1a2b3c4d-1",
        askId: "coach-1a2b3c4d-1-ask",
        revision: 3,
        at: "2026-10-08T09:00:00.000Z",
      }),
    ).not.toThrow();
  });
});
