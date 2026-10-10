// What the coach's model writes, read into a note: silence is no note, an
// unfinished line is never shown, and whatever the model writes the note that
// comes out is one the contract takes.
import {
  COACH_NOTE_KINDS,
  coachNoteInputSchema,
  TALKING_POINT_LENGTH,
} from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  COACH_MODES,
  coachLogOf,
  DESIGN_STAGES,
  designDiagram,
  LOG_LINE_LENGTH,
  parseCoachReply,
  SILENT,
} from "./reply";

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
      // A design's arrows: none in a conversation.
      draw: [],
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

// The kind of round changes how many lines of each kind a note may hold and
// which come first. A design also carries its stage and its arrows.
describe("the kind of round", () => {
  const CROWDED = reply(
    "ASK: Everything at once",
    ...["SAY", "ANCHOR", "QUESTION", "CAUTION"].flatMap((label) =>
      Array.from({ length: 7 }, (_, at) => `${label}: ${label} ${at + 1}`),
    ),
  );
  const shape = (mode?: (typeof COACH_MODES)[number]) =>
    parseCoachReply(CROWDED, true, undefined, mode)?.note.sections?.map(
      (section) => [section.kind, section.lines.length],
    );

  it("is a conversation, a system design or live coding", () => {
    expect([...COACH_MODES]).toEqual([
      "conversation",
      "system-design",
      "coding",
    ]);
  });

  it.each([
    [
      "conversation",
      [
        ["say", 3],
        ["anchors", 3],
        ["ask", 1],
        ["caution", 1],
      ],
    ],
    [
      "system-design",
      [
        ["ask", 5],
        ["say", 3],
        ["anchors", 3],
        ["caution", 2],
      ],
    ],
    [
      "coding",
      [
        ["say", 2],
        ["anchors", 4],
        ["ask", 2],
        ["caution", 2],
      ],
    ],
  ] as const)(
    "holds a %s note to its own caps, in its own order",
    (mode, caps) => {
      expect(shape(mode)).toEqual(caps);
      // The lines kept are the first written.
      const asked = parseCoachReply(
        CROWDED,
        true,
        undefined,
        mode,
      )?.note.sections?.find((section) => section.kind === "ask");
      expect(asked?.lines[0]).toEqual(spoken("QUESTION 1"));
      expect(() =>
        coachNoteInputSchema.parse(
          parseCoachReply(CROWDED, true, undefined, mode)?.note,
        ),
      ).not.toThrow();
    },
  );

  it("is a conversation when none is named", () => {
    expect(shape()).toEqual(shape("conversation"));
  });
});

describe("the arrows of a design", () => {
  const drawn = (...lines: string[]) =>
    parseCoachReply(reply(...lines), true, undefined, "system-design");

  it("reads each DRAW line into an arrow, with or without what flows, in the order written", () => {
    expect(
      drawn(
        "SAY: The simplest design first.",
        "DRAW: Client -> API: place order",
        "DRAW:   API   -->   Order queue  ",
        "DRAW: Order queue -> Worker: one job: at least once",
      )?.draw,
    ).toEqual([
      { from: "Client", to: "API", label: "place order" },
      { from: "API", to: "Order queue" },
      { from: "Order queue", to: "Worker", label: "one job: at least once" },
    ]);
  });

  it("keeps a box name that has a hyphen whole", () => {
    expect(drawn("DRAW: Read-replica -> Primary-db: lag")?.draw).toEqual([
      { from: "Read-replica", to: "Primary-db", label: "lag" },
    ]);
  });

  it.each([
    ["no arrow", "DRAW: Client and API"],
    ["nothing after the arrow", "DRAW: Client ->"],
    ["nothing before the arrow", "DRAW: -> API"],
    ["a box name longer than 40", `DRAW: Client -> ${"b".repeat(41)}`],
    ["what flows longer than 60", `DRAW: Client -> API: ${"f".repeat(61)}`],
  ])("leaves out a DRAW line that is not an arrow: %s", (_name, line) => {
    expect(drawn("SAY: The design.", line)?.draw).toEqual([]);
  });

  it("a reply with only DRAW lines is still a note: no sections, its arrows", () => {
    const only = drawn("DRAW: Client -> API", "DRAW: API -> Store: write");
    expect(only).not.toBeNull();
    expect(only?.note.sections).toEqual([]);
    expect(only?.draw).toHaveLength(2);
    expect(() => coachNoteInputSchema.parse(only?.note)).not.toThrow();
    // While it is written, the arrow not yet ended is left out.
    expect(
      parseCoachReply(
        "DRAW: Client -> API\nDRAW: API -> Sto",
        false,
        undefined,
        "system-design",
      )?.draw,
    ).toEqual([{ from: "Client", to: "API" }]);
  });

  it("a reply that only draws is not drawn as a warning", () => {
    expect(drawn("DRAW: Client -> API")?.note.tone).toBe("say");
  });

  it("DRAW lines that are not arrows, alone, are no note", () => {
    expect(drawn("STAGE: detail", "DRAW: nothing to see")).toBeNull();
  });

  it("never shows an arrow as a line of the note", () => {
    const note = drawn("SAY: The design.", "DRAW: Client -> API: order")?.note;
    expect(JSON.stringify(note)).not.toContain("Client");
  });
});

describe("the stage of a design", () => {
  it.each([...DESIGN_STAGES])("reads the stage %s", (stage) => {
    expect(
      parseCoachReply(
        reply(`STAGE: ${stage}`, "SAY: Next."),
        true,
        undefined,
        "system-design",
      )?.stage,
    ).toBe(stage);
  });

  it("names the four stages, in the order a design goes through them", () => {
    expect([...DESIGN_STAGES]).toEqual([
      "requirements",
      "high-level",
      "detail",
      "issues",
    ]);
  });

  it.each(["Detail", "design", "high level", "detail, mostly"])(
    "carries no stage for one it does not know: %s",
    (stage) => {
      const parsed = parseCoachReply(
        reply(`STAGE: ${stage}`, "SAY: Next."),
        true,
        undefined,
        "system-design",
      );
      expect(parsed).not.toBeNull();
      expect(parsed).not.toHaveProperty("stage");
    },
  );

  it("a stage alone is no note", () => {
    expect(
      parseCoachReply("STAGE: detail", true, undefined, "system-design"),
    ).toBeNull();
  });
});

describe("the design as a diagram", () => {
  it("is nothing when nothing is drawn", () => {
    expect(designDiagram([])).toBeUndefined();
  });

  it("is a left-to-right flowchart, an arrow per line, labelled when something flows", () => {
    expect(
      designDiagram([
        { from: "Client", to: "API Gateway", label: "place order" },
        { from: "API Gateway", to: "Order queue" },
      ]),
    ).toBe(
      [
        "flowchart LR",
        '  n1["Client"] -->|place order| n2["API Gateway"]',
        '  n2["API Gateway"] --> n3["Order queue"]',
      ].join("\n"),
    );
  });

  it("numbers a box by where it first appears, so the same name, in any case, is one box", () => {
    const diagram = designDiagram([
      { from: "Client", to: "API gateway" },
      { from: "API GATEWAY", to: "Store" },
      { from: " api gateway ", to: "Cache" },
      { from: "client", to: "Store" },
    ]) as string;
    const ids = [...diagram.matchAll(/\b(n\d+)\["/g)].map((match) => match[1]);
    expect(ids).toEqual(["n1", "n2", "n2", "n3", "n2", "n4", "n1", "n3"]);
    // Each arrow shows the name as that arrow wrote it.
    expect(diagram.split("\n")[2]).toBe('  n2["API GATEWAY"] --> n3["Store"]');
  });

  it("a name written with other spacing or marks is another box", () => {
    const diagram = designDiagram([
      { from: "API gateway", to: "api-gateway" },
      { from: "API  gateway", to: "Store" },
    ]) as string;
    expect([...diagram.matchAll(/\b(n\d+)\["/g)].map((m) => m[1])).toEqual([
      "n1",
      "n2",
      "n3",
      "n4",
    ]);
  });

  it("strips the marks Mermaid reads as its own from every label, and closes up the space", () => {
    const diagram = designDiagram([
      {
        from: 'Orders [primary] (eu) "db"',
        to: "Cache | hot {keys} <ttl>",
        label: "read (cached) | write [sync]",
      },
    ]) as string;
    expect(diagram.split("\n")[1]).toBe(
      '  n1["Orders primary eu db"] -->|read cached write sync| n2["Cache hot keys ttl"]',
    );
  });

  it("cuts a label to 48 characters", () => {
    const diagram = designDiagram([
      { from: "a".repeat(60), to: "B", label: "f".repeat(60) },
    ]) as string;
    expect(diagram).toContain(`["${"a".repeat(47)}…"]`);
    expect(diagram).toContain(`|${"f".repeat(47)}…|`);
  });

  it("is cut at a whole arrow under 1,500 characters, the first arrows kept", () => {
    const edges = Array.from({ length: 80 }, (_, at) => ({
      from: `Service number ${at}`,
      to: `Store number ${at}`,
      label: `what flows in arrow ${at}`,
    }));
    const diagram = designDiagram(edges) as string;
    const lines = diagram.split("\n");
    expect(diagram.length).toBeLessThanOrEqual(1_500);
    expect(lines.length).toBeGreaterThan(5);
    expect(lines.length).toBeLessThan(81);
    expect(lines[0]).toBe("flowchart LR");
    for (const line of lines.slice(1))
      expect(line).toMatch(
        /^ {2}n\d+\["[^"]+"\] -->\|[^|]+\| n\d+\["[^"]+"\]$/,
      );
    expect(lines[1]).toContain("Service number 0");
    // One more whole arrow would not have fitted.
    const next = designDiagram(edges.slice(0, lines.length)) as string;
    expect(next).toBe(diagram);
    expect(() =>
      coachNoteInputSchema.parse({ title: "Design", diagram }),
    ).not.toThrow();
  });

  it("is still a diagram when the very first arrow is as long as an arrow can be", () => {
    const diagram = designDiagram([
      { from: "a".repeat(40), to: "b".repeat(40), label: "c".repeat(60) },
    ]) as string;
    expect(diagram.split("\n")).toHaveLength(2);
  });

  it.each(["()", "[]", "{ }", "<>", '"|"', "   "])(
    "an arrow whose label is only marks (%j) is drawn unlabelled",
    (label) => {
      expect(designDiagram([{ from: "Client", to: "API", label }])).toBe(
        'flowchart LR\n  n1["Client"] --> n2["API"]',
      );
    },
  );

  it("a box whose name is only marks is drawn as a question mark", () => {
    expect(designDiagram([{ from: "()", to: "API" }])).toBe(
      'flowchart LR\n  n1["?"] --> n2["API"]',
    );
  });

  it("two boxes named in another script are two boxes, each with its name", () => {
    expect(
      designDiagram([
        { from: "Client", to: "数据库" },
        { from: "Client", to: "缓存" },
        { from: "数据库", to: "缓存" },
      ]),
    ).toBe(
      [
        "flowchart LR",
        '  n1["Client"] --> n2["数据库"]',
        '  n1["Client"] --> n3["缓存"]',
        '  n2["数据库"] --> n3["缓存"]',
      ].join("\n"),
    );
  });
});

describe("what the coach writes for itself", () => {
  it("is each LOG line, in the order written, wherever it stands in the reply", () => {
    expect(
      coachLogOf(
        reply(
          "LOG: The interviewer owns the pricing rules",
          FULL,
          "  LOG:   Two of five questions asked  ",
        ),
      ),
    ).toEqual([
      "The interviewer owns the pricing rules",
      "Two of five questions asked",
    ]);
  });

  it("is read after a first line of the silent word too", () => {
    const text = reply(SILENT, "LOG: The ledger story has been used");
    expect(coachLogOf(text)).toEqual(["The ledger story has been used"]);
    // And the reply is still no note.
    expect(parseCoachReply(text, true)).toBeNull();
  });

  it("is three lines at most: the first three", () => {
    expect(
      coachLogOf(reply(...[1, 2, 3, 4, 5].map((at) => `LOG: fact ${at}`))),
    ).toEqual(["fact 1", "fact 2", "fact 3"]);
  });

  it("cuts a line to 200 characters, ending it with an ellipsis", () => {
    expect(LOG_LINE_LENGTH).toBe(200);
    const [exact, long] = coachLogOf(
      reply(`LOG: ${"a".repeat(200)}`, `LOG: ${"b".repeat(201)}`),
    );
    expect(exact).toBe("a".repeat(200));
    expect(long).toBe(`${"b".repeat(199)}…`);
  });

  it.each([
    ["nothing", ""],
    ["the silent word", SILENT],
    ["a note with no LOG line", FULL],
    ["a LOG label with nothing after it", "LOG:\nLOG:    "],
    ["a label in lower case", "log: remember this"],
    ["the word inside a line", "SAY: Keep a LOG: of it."],
  ])("is nothing for %s", (_name, text) => {
    expect(coachLogOf(text)).toEqual([]);
  });

  it("reads CRLF line ends", () => {
    expect(coachLogOf("NONE\r\nLOG: one\r\nLOG: two\r\n")).toEqual([
      "one",
      "two",
    ]);
  });

  it("is never part of the note", () => {
    const note = parseCoachReply(
      reply(FULL, "LOG: The interviewer owns the pricing rules"),
      true,
    )?.note;
    expect(note).toEqual(parseCoachReply(FULL, true)?.note);
    expect(JSON.stringify(note)).not.toContain("pricing");
  });
});

describe("a pointer left in the spoken words", () => {
  const shown = (say: string) =>
    (segmentsOf(say, KNOWN) ?? []).map((segment) => segment.text).join("");

  it.each([
    "I ran the rota [/roles/1/responsibilities/2] for a year.",
    "I ran the rota [/roles/1/responsibilities/2 for a year.",
    "I ran the rota /roles/1/responsibilities/2] for a year.",
    "I moved reads to a replica [/context/employerBrief/1].",
    "[/roles/0/proof_points/0] I moved reads to a replica.",
  ])("is never shown: %s", (say) => {
    const text = shown(say);
    expect(text).not.toMatch(/\[|\]|\/roles|\/context/);
    expect(text).toMatch(/I (ran the rota|moved reads)/);
    // It verifies nothing by standing there: every piece is spoken.
    expect(
      (segmentsOf(say, KNOWN) ?? []).every(
        (segment) => segment.role === "spoken",
      ),
    ).toBe(true);
  });

  it("leaves ordinary words with a slash or a bracket as they are", () => {
    for (const say of [
      "I split the read/write paths early.",
      "It was [roughly] a week of work.",
      "We ran TCP/IP checks and CI/CD on every merge.",
    ])
      expect(shown(say)).toBe(say);
  });
});

describe("a figure said with or without a space before its unit", () => {
  const FACTS = new Map([
    ["/roles/0/proof_points/0", "Cut p95 latency to 45 ms across 2.1M users"],
    ["/roles/0/proof_points/1", "Held error rate under 3% at 900rps"],
  ]);
  const evidence = (say: string) =>
    (segmentsOf(say, FACTS) ?? []).filter(
      (segment) => segment.role === "evidence",
    );

  it.each([
    ["**45ms**[/roles/0/proof_points/0]", "/roles/0/proof_points/0"],
    ["**45 ms**[/roles/0/proof_points/0]", "/roles/0/proof_points/0"],
    ["**2.1 m users**[/roles/0/proof_points/0]", "/roles/0/proof_points/0"],
    ["**2.1M users**[/roles/0/proof_points/0]", "/roles/0/proof_points/0"],
    ["**900 rps**[/roles/0/proof_points/1]", "/roles/0/proof_points/1"],
    // Uncited: one fact holds every word once the figure is apart from its unit.
    ["**p95 latency to 45ms**", "/roles/0/proof_points/0"],
    ["**error rate under 3% at 900 rps**", "/roles/0/proof_points/1"],
  ])("verifies %s", (say, source) => {
    expect(evidence(`I got it to ${say}.`)).toEqual([
      expect.objectContaining({ grounding: "verified", source }),
    ]);
  });

  it.each([
    "**54ms**[/roles/0/proof_points/0]",
    "**45s**[/roles/0/proof_points/1]",
    "**2.2M users**[/roles/0/proof_points/0]",
    "**p95 latency to 54ms**",
    // The figure is the fact's, its percent sign is not.
    "**45%**[/roles/0/proof_points/0]",
  ])("does not verify another figure: %s", (say) => {
    expect(evidence(`I got it to ${say}.`)).toEqual([
      expect.objectContaining({ grounding: "inferred" }),
    ]);
  });
});

// ---- Who asked, in a panel ------------------------------------------------------

describe("who asked", () => {
  const PANEL = ["Priya", "Marcus", "Tom", "Elena", "Aisha"];
  const asked = (from: string, voices?: readonly string[]) =>
    parseCoachReply(
      reply(
        "KIND: technical",
        "SAME: no",
        "ASK: Charged only once",
        ...(from ? [from] : []),
        "SAY: I key the ledger by correlation id.",
      ),
      true,
      undefined,
      "conversation",
      voices,
    )?.note;

  it("is carried on the note when the name is one the coach was given", () => {
    expect(asked("FROM: Marcus", PANEL)?.from).toBe("Marcus");
  });

  it("is in the given name's own spelling, whatever case the model wrote", () => {
    expect(asked("FROM: MARCUS", PANEL)?.from).toBe("Marcus");
    expect(asked("FROM: marcus.", PANEL)?.from).toBe("Marcus");
  });

  it("takes a first name for a full one, and a name followed by what they do", () => {
    expect(asked("FROM: Marcus", ["Marcus Lee", "Tom Park"])?.from).toBe(
      "Marcus Lee",
    );
    expect(asked("FROM: Marcus (staff engineer)", PANEL)?.from).toBe("Marcus");
  });

  it("is dropped when the name is nobody the coach was given", () => {
    const note = asked("FROM: Dana", PANEL);
    expect(note).toBeDefined();
    expect(note && "from" in note).toBe(false);
  });

  it("is dropped when a first name could be two people", () => {
    expect(
      asked("FROM: Sam", ["Sam Okoro", "Sam Lindqvist"])?.from,
    ).toBeUndefined();
  });

  it.each([
    "FROM: the interviewer",
    "FROM: Marcus and Elena",
    "FROM: unknown",
    "FROM: ",
    "",
  ])("is absent for %j", (from) => {
    expect(asked(from, PANEL)?.from).toBeUndefined();
  });

  it("is never carried when the coach was given no names: a two-person call names nobody", () => {
    expect(asked("FROM: Marcus")?.from).toBeUndefined();
    expect(asked("FROM: Marcus", [])?.from).toBeUndefined();
  });

  it("leaves the rest of the note exactly as it is without the line", () => {
    const { from: _from, ...withName } = asked("FROM: Marcus", PANEL) ?? {};
    expect(withName).toEqual(asked("", PANEL));
    expect(asked("FROM: Dana", PANEL)).toEqual(asked("", PANEL));
  });

  it("is never read as a line to say, and makes no note by itself", () => {
    expect(
      parseCoachReply("FROM: Marcus", true, undefined, "conversation", PANEL),
    ).toBeNull();
    expect(
      asked("FROM: Marcus", PANEL)?.sections?.flatMap((section) =>
        section.lines.map((line) => line.segments[0]?.text),
      ),
    ).toEqual(["I key the ledger by correlation id."]);
  });

  it("is shown as soon as its line is whole, and not before", () => {
    const partial = (text: string) =>
      parseCoachReply(text, false, undefined, "conversation", PANEL)?.note;
    expect(
      partial("ASK: Charged once\nFROM: Marcus\nSAY: I key it.\nSAY: An")?.from,
    ).toBe("Marcus");
    expect(
      partial("ASK: Charged once\nSAY: I key it.\nFROM: Mar")?.from,
    ).toBeUndefined();
  });

  it("gives a note the contract takes, in every kind of round", () => {
    for (const mode of COACH_MODES) {
      const parsed = parseCoachReply(
        reply("ASK: Charged once", "FROM: Elena", "SAY: I key it."),
        true,
        undefined,
        mode,
        PANEL,
      );
      expect(parsed?.note.from).toBe("Elena");
      expect(coachNoteInputSchema.safeParse(parsed?.note).success).toBe(true);
    }
  });
});
