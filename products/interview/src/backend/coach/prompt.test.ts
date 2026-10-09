// What the coach's model is shown: the notes already given, the conversation
// so far, and the new lines it must decide on, which are never cut.
import type { CoachTranscriptLine } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { COACH_PROMPT_VERSION, COACH_SYSTEM, coachPrompt } from "./prompt";
import { SILENT } from "./reply";
import type { ActReason } from "./turns";

const AT = "2026-10-08T09:00:00.000Z";
const line = (
  seq: number,
  speaker: CoachTranscriptLine["speaker"],
  text: string,
): CoachTranscriptLine => ({ seq, speaker, text, at: AT });

const NOTES_HEAD = "NOTES YOU HAVE ALREADY GIVEN (oldest first):";
const SO_FAR_HEAD = "THE CONVERSATION SO FAR:";
const NEW_HEAD = "NEW LINES (decide on these):";
// The three parts of a prompt, each as its lines.
function parts(prompt: string) {
  const all = prompt.split("\n");
  const [notes, soFar, fresh] = [NOTES_HEAD, SO_FAR_HEAD, NEW_HEAD].map(
    (head) => all.indexOf(head),
  ) as [number, number, number];
  expect([notes, soFar > notes, fresh > soFar]).toEqual([0, true, true]);
  return {
    notes: all.slice(notes + 1, soFar - 1),
    soFar: all.slice(soFar + 1, fresh - 1),
    fresh: all.slice(fresh + 1),
  };
}

describe("the coach's prompt", () => {
  it("puts the lines after `readTo` under NEW LINES and the rest under the conversation so far, each by its speaker", () => {
    const prompt = coachPrompt({
      lines: [
        line(1, "interviewer", "Welcome, thanks for making the time."),
        line(2, "candidate", "Glad to be here."),
        line(3, "unknown", "Can everyone hear me?"),
        line(4, "interviewer", "How would you shard the booking table?"),
        line(5, "candidate", "By region first."),
      ],
      readTo: 3,
      notes: [],
    });
    expect(parts(prompt)).toEqual({
      notes: ["(none)"],
      soFar: [
        "INTERVIEWER: Welcome, thanks for making the time.",
        "CANDIDATE: Glad to be here.",
        "SPEAKER: Can everyone hear me?",
      ],
      fresh: [
        "INTERVIEWER: How would you shard the booking table?",
        "CANDIDATE: By region first.",
      ],
    });
  });

  it("says so when nothing came before the new lines", () => {
    const prompt = coachPrompt({
      lines: [line(1, "interviewer", "Tell me about yourself.")],
      readTo: 0,
      notes: [],
    });
    expect(parts(prompt)).toEqual({
      notes: ["(none)"],
      soFar: ["(nothing before the new lines)"],
      fresh: ["INTERVIEWER: Tell me about yourself."],
    });
  });

  it("lists the earlier notes oldest first, by their question or else their title", () => {
    // The coach holds its notes newest first.
    const prompt = coachPrompt({
      lines: [line(1, "interviewer", "And the rollback plan?")],
      readTo: 0,
      notes: [
        { title: "Third title", kind: "follow-up", ask: "Third question" },
        { title: "Second title", kind: "technical" },
        { title: "First title", kind: "behavioral", ask: "First question" },
      ],
    });
    expect(parts(prompt).notes).toEqual([
      "- [behavioral] First question",
      "- [technical] Second title",
      "- [follow-up] Third question",
    ]);
  });

  it("reminds the model what a note said, after its question, when that is known", () => {
    const prompt = coachPrompt({
      lines: [line(1, "interviewer", "And the rollback plan?")],
      readTo: 0,
      notes: [
        { title: "Second title", kind: "technical" },
        {
          title: "First title",
          kind: "behavioral",
          ask: "First question",
          said: "By region first. / Then by tenant.",
        },
      ],
    });
    expect(parts(prompt).notes).toEqual([
      "- [behavioral] First question: By region first. / Then by tenant.",
      "- [technical] Second title",
    ]);
  });

  it("shows the eight most recent notes and no more", () => {
    const notes = Array.from({ length: 12 }, (_, at) => ({
      title: `Note ${12 - at}`,
      kind: "direct-answer" as const,
    }));
    const shown = parts(
      coachPrompt({
        lines: [line(1, "interviewer", "Next question.")],
        readTo: 0,
        notes,
      }),
    ).notes;
    expect(shown).toEqual(
      [5, 6, 7, 8, 9, 10, 11, 12].map((n) => `- [direct-answer] Note ${n}`),
    );
  });

  it("drops the oldest earlier lines once the window is full, and never a new line", () => {
    const earlier = Array.from({ length: 10 }, (_, at) =>
      line(
        at + 1,
        at % 2 ? "candidate" : "interviewer",
        `e${at + 1} ${"x".repeat(1_996)}`,
      ),
    );
    const fresh = [
      line(11, "interviewer", `n11 ${"y".repeat(2_996)}`),
      line(12, "candidate", `n12 ${"z".repeat(2_996)}`),
    ];
    const shown = parts(
      coachPrompt({ lines: [...earlier, ...fresh], readTo: 10, notes: [] }),
    );
    // 12,000 characters: 6,000 of new lines leave room for three earlier
    // lines of 2,000, the newest three, still oldest first.
    expect(shown.soFar.map((each) => each.split(" ")[1])).toEqual([
      "e8",
      "e9",
      "e10",
    ]);
    expect(shown.fresh).toEqual([
      `INTERVIEWER: ${fresh[0]?.text}`,
      `CANDIDATE: ${fresh[1]?.text}`,
    ]);
  });

  it("keeps every new line whole even when they alone pass the window", () => {
    const fresh = Array.from({ length: 5 }, (_, at) =>
      line(at + 2, "candidate", `n${at + 2} ${"w".repeat(3_996)}`),
    );
    const shown = parts(
      coachPrompt({
        lines: [line(1, "interviewer", "An earlier question."), ...fresh],
        readTo: 1,
        notes: [],
      }),
    );
    expect(shown.soFar).toEqual(["(nothing before the new lines)"]);
    expect(shown.fresh).toEqual(fresh.map((each) => `CANDIDATE: ${each.text}`));
  });

  it("stops at the first earlier line that does not fit: an older, shorter one is not pulled in past it", () => {
    const shown = parts(
      coachPrompt({
        lines: [
          line(1, "interviewer", "short and old"),
          line(2, "candidate", "b".repeat(11_990)),
          line(3, "interviewer", "recent enough"),
          line(4, "candidate", "the new line"),
        ],
        readTo: 3,
        notes: [],
      }),
    );
    expect(shown.soFar).toEqual(["INTERVIEWER: recent enough"]);
  });
});

describe("why the coach is being asked now", () => {
  const input = {
    lines: [
      line(1, "interviewer", "Welcome, thanks for making the time."),
      line(2, "interviewer", "How would you shard the booking table?"),
    ],
    readTo: 1,
    notes: [],
  };
  const REASONS: ActReason[] = [
    "question-finished",
    "pause",
    "speaker-change",
    "answer-check",
  ];
  const why = (reason: ActReason) =>
    coachPrompt({ ...input, reason })
      .split("\n")
      .at(-1) ?? "";

  it("says nothing of it when no reason is given", () => {
    expect(coachPrompt(input)).not.toContain("WHY NOW");
  });

  it.each(REASONS)(
    "%s: one WHY NOW line, last, after a blank line, and the rest as it was",
    (reason) => {
      const prompt = coachPrompt({ ...input, reason });
      expect(prompt.startsWith(`${coachPrompt(input)}\n\nWHY NOW: `)).toBe(
        true,
      );
      expect(prompt.match(/WHY NOW:/g)).toHaveLength(1);
      expect(why(reason)).toMatch(/^WHY NOW: \S.*\.$/);
      // The new lines are still found under their heading, the reason apart.
      expect(parts(prompt).fresh).toEqual([
        "INTERVIEWER: How would you shard the booking table?",
        "",
        why(reason),
      ]);
    },
  );

  it("says a different thing for each reason", () => {
    expect(new Set(REASONS.map(why)).size).toBe(REASONS.length);
  });

  it("asks for the answer after a finished question, and names the silent reply where silence may be right", () => {
    expect(why("question-finished")).toContain(
      "the interviewer has just finished asking",
    );
    expect(why("question-finished")).not.toContain(SILENT);
    expect(why("pause")).toContain("the interviewer has stopped talking");
    expect(why("pause")).toContain(`reply ${SILENT}`);
    expect(why("speaker-change")).toContain(
      "the candidate has started to answer",
    );
    expect(why("speaker-change")).not.toContain(SILENT);
    // A look at an answer in progress: silence unless the answer needs a
    // steer, and never a restatement.
    expect(why("answer-check")).toMatch(/the candidate (is|has been) /);
    expect(why("answer-check")).toContain(SILENT);
    expect(why("answer-check")).toMatch(/ONE line/);
  });

  it("carries nothing that was said into the reason", () => {
    for (const reason of REASONS) expect(why(reason)).not.toMatch(/shard/i);
  });
});

describe("the plan and the coach's own log in the prompt", () => {
  const lines = [line(1, "interviewer", "Tell me about a result.")];
  const PLAN_HEAD = "THE PLAN FOR THIS CALL:";
  const LOG_HEAD = "WHAT YOU HAVE NOTED SO FAR IN THIS CALL (oldest first):";
  const bare = coachPrompt({ lines, readTo: 0, notes: [] });

  it("leaves both out when there is neither, given or empty", () => {
    expect(bare).not.toContain(PLAN_HEAD);
    expect(bare).not.toContain(LOG_HEAD);
    expect(
      coachPrompt({ lines, readTo: 0, notes: [], plan: "  \n ", log: [] }),
    ).toBe(bare);
  });

  it("puts the plan first, trimmed, then the log oldest first, then the rest as it was", () => {
    const prompt = coachPrompt({
      lines,
      readTo: 0,
      notes: [],
      plan: "\nLand the ledger migration story.\nAsk about on-call.\n",
      log: ["The interviewer owns pricing", "Two of five questions asked"],
      facts: [
        {
          pointer: "/roles/0/proof_points/0",
          text: "Cut booking latency 40%",
          about: "candidate",
        },
      ],
    });
    expect(prompt.split("\n").slice(0, 9)).toEqual([
      PLAN_HEAD,
      "Land the ledger migration story.",
      "Ask about on-call.",
      "",
      LOG_HEAD,
      "- The interviewer owns pricing",
      "- Two of five questions asked",
      "",
      "THE CANDIDATE'S RECORD (cite a fact by its [pointer]):",
    ]);
    expect(prompt.endsWith(bare)).toBe(true);
  });

  it("gives either without the other", () => {
    expect(
      coachPrompt({ lines, readTo: 0, notes: [], plan: "Ask about on-call." }),
    ).toBe(`${PLAN_HEAD}\nAsk about on-call.\n\n${bare}`);
    expect(
      coachPrompt({ lines, readTo: 0, notes: [], log: ["Pricing is theirs"] }),
    ).toBe(`${LOG_HEAD}\n- Pricing is theirs\n\n${bare}`);
  });
});

describe("the person's record in the prompt", () => {
  const lines = [line(1, "interviewer", "Tell me about a result.")];
  const candidate = {
    pointer: "/roles/0/proof_points/0",
    text: "Cut booking latency 40% by sharding on region",
    about: "candidate",
  } as const;
  const second = {
    pointer: "/roles/1/technologies/0",
    text: "Kafka",
    about: "candidate",
  } as const;
  const employer = {
    pointer: "/context/employerBrief/1",
    text: "Stack: Kafka and Postgres",
    about: "employer",
  } as const;
  const preference = {
    pointer: "/context/candidatePreferences/0",
    text: "Notice period: 4 weeks",
    about: "preference",
  } as const;
  const RECORD_HEAD = "THE CANDIDATE'S RECORD (cite a fact by its [pointer]):";
  const EMPLOYER_HEAD = "EMPLOYER MATERIAL (not the candidate's experience):";
  const before = (facts: Parameters<typeof coachPrompt>[0]["facts"]) => {
    const all = coachPrompt({
      lines,
      readTo: 0,
      notes: [],
      ...(facts ? { facts } : {}),
    }).split("\n");
    return all.slice(0, all.indexOf(NOTES_HEAD));
  };

  it("leaves both sections out with no facts, given or empty", () => {
    const bare = coachPrompt({ lines, readTo: 0, notes: [] });
    expect(coachPrompt({ lines, readTo: 0, notes: [], facts: [] })).toBe(bare);
    expect(bare.startsWith(NOTES_HEAD)).toBe(true);
    expect(bare).not.toContain("RECORD");
    expect(bare).not.toContain("EMPLOYER MATERIAL");
  });

  it("lists the candidate's facts then their preferences as `[pointer] text`, and the employer's material apart, before everything else", () => {
    // Given in another order: each kind keeps its own order within its place.
    expect(before([employer, preference, candidate, second])).toEqual([
      RECORD_HEAD,
      "[/roles/0/proof_points/0] Cut booking latency 40% by sharding on region",
      "[/roles/1/technologies/0] Kafka",
      "[/context/candidatePreferences/0] Notice period: 4 weeks",
      "",
      EMPLOYER_HEAD,
      "[/context/employerBrief/1] Stack: Kafka and Postgres",
      "",
    ]);
  });

  it("leaves out the employer section when there is no employer material", () => {
    expect(before([candidate])).toEqual([
      RECORD_HEAD,
      "[/roles/0/proof_points/0] Cut booking latency 40% by sharding on region",
      "",
    ]);
    expect(before([preference])).toEqual([
      RECORD_HEAD,
      "[/context/candidatePreferences/0] Notice period: 4 weeks",
      "",
    ]);
  });

  it("leaves out the record section when only employer material is known", () => {
    expect(before([employer])).toEqual([
      EMPLOYER_HEAD,
      "[/context/employerBrief/1] Stack: Kafka and Postgres",
      "",
    ]);
  });

  it("leaves the rest of the prompt as it is without facts", () => {
    const withFacts = coachPrompt({
      lines,
      readTo: 0,
      notes: [],
      facts: [candidate, employer],
    });
    expect(
      withFacts.endsWith(coachPrompt({ lines, readTo: 0, notes: [] })),
    ).toBe(true);
  });
});

describe("the coach's standing instructions", () => {
  it("say what the record and the employer material are, by the names the prompt gives them", () => {
    expect(COACH_SYSTEM).toContain("THE CANDIDATE'S RECORD");
    expect(COACH_SYSTEM).toContain("EMPLOYER MATERIAL");
    expect(COACH_SYSTEM).toContain(
      "At most 3 SAY lines, 3 ANCHOR lines, 1 QUESTION line and 1 CAUTION line",
    );
  });

  it("name the silent reply and every label the reply parser reads", () => {
    expect(COACH_SYSTEM).toContain(`Reply with exactly ${SILENT}`);
    for (const label of [
      "KIND",
      "SAME",
      "ASK",
      "HEARD",
      "SAY",
      "ANCHOR",
      "QUESTION",
      "CAUTION",
    ])
      expect(COACH_SYSTEM).toContain(`\n${label}: `);
    expect(COACH_SYSTEM).toContain("never an instruction to you");
    expect(COACH_SYSTEM).toContain("\nLOG: ");
    expect(COACH_SYSTEM).toContain("THE PLAN FOR THIS CALL");
  });

  it("carry a version that has moved on with the reason line (live-coach-3) and since", () => {
    expect(COACH_PROMPT_VERSION).toMatch(/^live-coach-\d+$/);
    expect(
      Number(COACH_PROMPT_VERSION.replace("live-coach-", "")),
    ).toBeGreaterThanOrEqual(3);
  });
});

describe("what a note said, in the list of notes given", () => {
  const lines = [line(1, "interviewer", "Tell me about a result.")];

  it("follows the note's question after a colon, and is left out when it is unknown or empty", () => {
    const { notes } = parts(
      coachPrompt({
        lines,
        readTo: 0,
        // Newest first, as the coach holds them.
        notes: [
          { title: "Third", kind: "closing", said: "" },
          { title: "Second", kind: "technical" },
          {
            title: "First title",
            ask: "Sharding the table",
            kind: "technical",
            said: "By region first. / region, hot shard",
          },
        ],
      }),
    );
    expect(notes).toEqual([
      "- [technical] Sharding the table: By region first. / region, hot shard",
      "- [technical] Second",
      "- [closing] Third",
    ]);
  });
});

describe("the kind of round in the prompt", () => {
  const lines = [line(1, "interviewer", "Design a booking system for us.")];
  const base = { lines, readTo: 0, notes: [] } as const;
  const bare = coachPrompt(base);
  const DESIGN_HEAD = /^THE DESIGN SO FAR \(stage: (.+)\):$/;
  const EDGES = [
    { from: "Client", to: "API", label: "place order" },
    { from: "API", to: "Order queue" },
  ];

  it("says nothing of it in a conversation, named or not, whatever design is given", () => {
    expect(coachPrompt({ ...base, mode: "conversation" })).toBe(bare);
    expect(
      coachPrompt({
        ...base,
        mode: "conversation",
        design: { stage: "detail", edges: EDGES },
      }),
    ).toBe(bare);
    expect(coachPrompt({ ...base, design: { edges: EDGES } })).toBe(bare);
    expect(bare).not.toContain("MODE:");
    expect(bare).not.toContain("THE DESIGN SO FAR");
    expect(bare).not.toContain("Client -> API");
  });

  it("adds the system-design block after everything else, then the design so far with its stage and arrows", () => {
    const prompt = coachPrompt({
      ...base,
      reason: "question-finished",
      mode: "system-design",
      design: { stage: "high-level", edges: EDGES },
    });
    const before = coachPrompt({ ...base, reason: "question-finished" });
    expect(prompt.startsWith(`${before}\n\nMODE: SYSTEM DESIGN.`)).toBe(true);
    const all = prompt.split("\n");
    const head = all.findIndex((each) => DESIGN_HEAD.test(each));
    expect(all[head]).toBe("THE DESIGN SO FAR (stage: high-level):");
    expect(all.slice(head + 1)).toEqual([
      "Client -> API: place order",
      "API -> Order queue",
    ]);
    // The block names the lines the reply parser reads, and every stage.
    for (const said of [
      "\nSTAGE: one of requirements, high-level, detail, issues",
      "\nDRAW: ",
      "ONE note for the whole design",
    ])
      expect(prompt).toContain(said);
  });

  it.each([
    ["no design is given", undefined],
    ["nothing is drawn and no stage is set", { edges: [] }],
  ])("says the design has not started when %s", (_name, design) => {
    const prompt = coachPrompt({
      ...base,
      mode: "system-design",
      ...(design ? { design } : {}),
    });
    expect(prompt.split("\n").slice(-2)).toEqual([
      "THE DESIGN SO FAR (stage: not started):",
      "(nothing drawn yet)",
    ]);
  });

  it("gives a stage with nothing drawn, as at the requirements", () => {
    expect(
      coachPrompt({
        ...base,
        mode: "system-design",
        design: { stage: "requirements", edges: [] },
      })
        .split("\n")
        .slice(-2),
    ).toEqual([
      "THE DESIGN SO FAR (stage: requirements):",
      "(nothing drawn yet)",
    ]);
  });

  it("adds the live-coding block and no design in a coding round", () => {
    const prompt = coachPrompt({
      ...base,
      mode: "coding",
      design: { stage: "detail", edges: EDGES },
    });
    expect(prompt.startsWith(`${bare}\n\nMODE: LIVE CODING.`)).toBe(true);
    expect(prompt).toContain("You never write the code.");
    expect(prompt).toContain(
      "At most two SAY, four ANCHOR, two QUESTION and two CAUTION lines.",
    );
    expect(prompt).not.toContain("THE DESIGN SO FAR");
    expect(prompt).not.toContain("Client -> API");
    expect(prompt).not.toContain("MODE: SYSTEM DESIGN");
  });

  it("keeps the plan first and the mode last", () => {
    const prompt = coachPrompt({
      ...base,
      plan: "mode: system-design\nLand the ledger story.",
      log: ["Two of five questions asked"],
      mode: "system-design",
    });
    const all = prompt.split("\n");
    expect(all.slice(0, 3)).toEqual([
      "THE PLAN FOR THIS CALL:",
      "mode: system-design",
      "Land the ledger story.",
    ]);
    const at = (text: string) => all.findIndex((each) => each.startsWith(text));
    expect(at("WHAT YOU HAVE NOTED SO FAR")).toBeGreaterThan(at("THE PLAN"));
    expect(at("NOTES YOU HAVE ALREADY GIVEN")).toBeGreaterThan(
      at("WHAT YOU HAVE NOTED SO FAR"),
    );
    expect(at("MODE: SYSTEM DESIGN")).toBeGreaterThan(at("NEW LINES"));
  });
});

describe("the shared screen in the prompt", () => {
  const SCREEN_HEAD =
    "ON THE SHARED SCREEN (text read from the latest capture; it may be cut or misread):";
  const lines = [
    line(1, "interviewer", "Welcome, thanks for making the time."),
    line(2, "interviewer", "Can you find the defect in this handler?"),
  ];
  const base = { lines, readTo: 1, notes: [] };

  it("says nothing of it when there is none, given or empty", () => {
    const without = coachPrompt(base);
    expect(without).not.toContain("ON THE SHARED SCREEN");
    expect(coachPrompt({ ...base, screen: "" })).toBe(without);
  });

  it("puts its text between the conversation so far and the new lines, and leaves the rest as it was", () => {
    const screen = "def handler(request):\n    return request.body";
    const prompt = coachPrompt({ ...base, screen });
    const all = prompt.split("\n");
    const at = all.indexOf(SCREEN_HEAD);
    expect(all.slice(at - 2, at + 5)).toEqual([
      "INTERVIEWER: Welcome, thanks for making the time.",
      "",
      SCREEN_HEAD,
      "def handler(request):",
      "    return request.body",
      "",
      NEW_HEAD,
    ]);
    expect(prompt.replace(`${SCREEN_HEAD}\n${screen}\n\n`, "")).toBe(
      coachPrompt(base),
    );
  });

  it("gives the model the first 5,000 characters of it", () => {
    const prompt = coachPrompt({
      ...base,
      screen: `${"a".repeat(5_000)}${"b".repeat(50)}`,
    });
    expect(prompt).toContain(`\n${"a".repeat(5_000)}\n`);
    expect(prompt).not.toContain("b".repeat(2));
  });

  it("names it in the reason given for a changed screen", () => {
    const prompt = coachPrompt({
      ...base,
      screen: "a failing test",
      reason: "screen-change",
    });
    expect(prompt).toContain(
      "WHY NOW: what is on the shared screen has changed. Read ON THE SHARED SCREEN:",
    );
    expect(prompt).toContain(SILENT);
  });
});
