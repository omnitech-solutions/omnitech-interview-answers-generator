// What a note says, scored in code: whose evidence its verified claims are,
// what it was offered, and what it states that nobody gave it. Invented
// people and employers only.
import type { CoachPorts } from "@omnitech/product-interview/session-worker";
import { describe, expect, it } from "vitest";
import {
  employerOf,
  expectationOf,
  figuresIn,
  inventedIn,
  noteText,
  scoreEvidence,
  scoreNote,
  scriptedReply,
  totalsLine,
  totalsOf,
  verifiedSources,
} from "./coach-notes-score";

type Note = Parameters<CoachPorts["notes"]["post"]>[0];
type Segment = NonNullable<
  Note["sections"]
>[number]["lines"][number]["segments"][number];

const EMPLOYERS = ["Harbourline", "Quayside Freight", "Tidewater Labs"];
const spoken = (text: string): Segment => ({ text, role: "spoken" });
const verified = (text: string, source?: string): Segment => ({
  text,
  role: "evidence",
  grounding: "verified",
  ...(source ? { source } : {}),
});
const inferred = (text: string): Segment => ({
  text,
  role: "evidence",
  grounding: "inferred",
});
const note = (...lines: Segment[][]): Note => ({
  title: "A note",
  kind: "direct-answer",
  sections: [{ kind: "say", lines: lines.map((segments) => ({ segments })) }],
});
const FACTS = [
  {
    pointer: "/roles/0/proof_points/0",
    text: "At Harbourline: cut tide-table query latency from 900ms to 120ms",
  },
  {
    pointer: "/roles/1/proof_points/0",
    text: "At Quayside Freight: built a reporting service for 42,000 invoices a day",
  },
  { pointer: "/candidate/name", text: "Name: Marisol Okonkwo-Reyes" },
];

describe("what expected.json says of a question's evidence", () => {
  it("names the employers a right note may draw on", () => {
    expect(expectationOf({ evidence: ["Harbourline"] })).toEqual({
      kind: "employers",
      accepted: ["Harbourline"],
    });
  });

  it("reads an empty list, or `nothing`, as: the material has nothing for it", () => {
    expect(expectationOf({ evidence: [] })).toEqual({ kind: "nothing" });
    expect(expectationOf({ nothing: true })).toEqual({ kind: "nothing" });
    expect(expectationOf({ nothing: true, evidence: ["Harbourline"] })).toEqual(
      { kind: "nothing" },
    );
  });

  it("expects nothing of a question that says neither, as every question before this did", () => {
    expect(expectationOf({})).toBeNull();
    expect(expectationOf({ nothing: false })).toBeNull();
  });
});

describe("the employer a fact belongs to", () => {
  it("is the company of the role it is under, and of the role itself", () => {
    expect(employerOf("/roles/1/proof_points/0", EMPLOYERS)).toBe(
      "Quayside Freight",
    );
    expect(employerOf("/roles/2", EMPLOYERS)).toBe("Tidewater Labs");
  });

  it("is nobody for the person's own fields, the employer's material, an extracted record, or a role the matrix does not have", () => {
    for (const pointer of [
      "/candidate/name",
      "/context/employerBrief/company",
      "brief:prepNotes:ad99d8e9b8a8",
      "research:1@chars:120-180",
      "/story_selector/3",
      "/roles/9/proof_points/0",
      "/roles/x",
    ])
      expect(employerOf(pointer, EMPLOYERS)).toBeUndefined();
  });
});

describe("the evidence a note draws on", () => {
  const drawn = note(
    [
      spoken("At "),
      verified(
        "Harbourline we cut latency to 120ms",
        "/roles/0/proof_points/0",
      ),
    ],
    [
      verified("42,000 invoices a day", "/roles/1/proof_points/0"),
      inferred("a team of nine"),
      // Verified with no place to open: the person's name.
      verified("Marisol"),
    ],
    // The same place cited twice is one source.
    [verified("900ms to 120ms", "/roles/0/proof_points/0")],
  );

  it("reads the places its claims were verified against, each once, from the coach's own marks", () => {
    expect(verifiedSources(drawn)).toEqual([
      "/roles/0/proof_points/0",
      "/roles/1/proof_points/0",
    ]);
  });

  it("counts verified claims under an accepted employer and under a wrong one, and the claims left inferred", () => {
    expect(
      scoreEvidence(
        drawn,
        FACTS,
        { kind: "employers", accepted: ["harbourline "] },
        EMPLOYERS,
      ),
    ).toEqual({
      accepted: 1,
      wrong: 1,
      other: 0,
      inferred: 1,
      // "a team of nine" is in nothing the coach was given.
      own: 0,
      unbacked: 1,
      uncited: { accepted: 0, wrong: 0 },
      // The note's words name the accepted employer and no other.
      named: { accepted: 1, other: 0 },
      sources: ["/roles/0/proof_points/0", "/roles/1/proof_points/0"],
      offeredAccepted: 1,
      offeredOther: 1,
      offered: true,
    });
  });

  it("tells whose an unverified claim is: the person's own notes or plan, a fact of the record it did not cite, or nobody's", () => {
    const facts = [
      ...FACTS.map((fact) => ({ ...fact, about: "candidate" })),
      {
        pointer: "brief:prepNotes:a1",
        text: "Service boundaries: logical boundary first; extract only for independent deployment or scaling.",
        about: "notes",
      },
      {
        pointer: "brief:mustHaves:b2",
        text: "Experience with event sourcing is required.",
        about: "employer",
      },
    ];
    const built = note(
      // The person's own prepared words.
      [inferred("logical boundary first")],
      // The record's, said without a pointer (the window shows it inferred).
      [spoken("We "), inferred("cut tide-table query latency to 120ms")],
      // The employer's requirement, and something said in the call.
      [inferred("event sourcing"), inferred("the harbour pilots")],
      // The plan for the call is the person's own too.
      [inferred("ledger story")],
      // Nobody's.
      [inferred("a saga orchestrator")],
    );
    const score = scoreEvidence(
      built,
      facts,
      { kind: "employers", accepted: ["Harbourline"] },
      EMPLOYERS,
      {
        plan: "Lead with the ledger story.",
        conversation: ["How do the harbour pilots book?"],
      },
    );
    expect(score).toMatchObject({
      accepted: 0,
      wrong: 0,
      inferred: 6,
      own: 2,
      uncited: { accepted: 1, wrong: 0 },
      unbacked: 1,
    });
  });

  it("counts a claim that rests on a fact given EARLIER in the call, which a kept session still holds", () => {
    const later = note([inferred("42,000 invoices a day")]);
    const wanted = {
      kind: "employers",
      accepted: ["Quayside Freight"],
    } as const;
    const now = [{ pointer: "/candidate/name", text: "Name: Marisol" }];
    expect(scoreEvidence(later, now, wanted, EMPLOYERS).uncited).toEqual({
      accepted: 0,
      wrong: 0,
    });
    expect(
      scoreEvidence(later, now, wanted, EMPLOYERS, { earlier: FACTS }).uncited,
    ).toEqual({ accepted: 1, wrong: 0 });
  });

  it("names the employers a note's words name, accepted and other", () => {
    const told = note([
      spoken("At Quayside Freight we shipped it; Harbourline came later."),
    ]);
    expect(
      scoreEvidence(
        told,
        FACTS,
        { kind: "employers", accepted: ["Quayside Freight"] },
        EMPLOYERS,
      ).named,
    ).toEqual({ accepted: 1, other: 1 });
  });

  it("tells a pack that never offered the right employer from a note that ignored it", () => {
    const silent = note([spoken("Lead with the decision rule.")]);
    const wanted = { kind: "employers", accepted: ["Tidewater Labs"] } as const;
    const never = scoreEvidence(silent, FACTS, wanted, EMPLOYERS);
    expect([never.accepted, never.offered]).toEqual([0, false]);
    const ignored = scoreEvidence(
      silent,
      [...FACTS, { pointer: "/roles/2/proof_points/0", text: "Rails flow" }],
      wanted,
      EMPLOYERS,
    );
    expect([ignored.accepted, ignored.offered]).toEqual([0, true]);
    expect(ignored.offeredAccepted).toBe(1);
  });

  it("with nothing expected, every employer cited is a wrong one", () => {
    const score = scoreEvidence(drawn, FACTS, { kind: "nothing" }, EMPLOYERS);
    expect([score.accepted, score.wrong, score.offered]).toEqual([0, 2, null]);
  });

  it("judges no employer for a question with no expectation, and for no note at all", () => {
    const unjudged = scoreEvidence(drawn, FACTS, null, EMPLOYERS);
    expect([unjudged.accepted, unjudged.wrong, unjudged.other]).toEqual([
      0, 0, 2,
    ]);
    expect(unjudged.offered).toBeNull();
    expect(
      scoreEvidence(
        undefined,
        FACTS,
        { kind: "employers", accepted: ["Harbourline"] },
        EMPLOYERS,
      ),
    ).toMatchObject({ accepted: 0, wrong: 0, sources: [], offered: true });
  });
});

describe("figures", () => {
  it("are read as plain numbers, whatever unit, sign or separator they carry", () => {
    expect(
      figuresIn("Cut p95 from 900ms to 120 ms, 40%; 2.1M calls, 3,000 users."),
    ).toEqual(["95", "900", "120", "40", "2.1", "3000"]);
    expect(figuresIn("No figure here.")).toEqual([]);
    // Each once.
    expect(figuresIn("40% then 40 percent")).toEqual(["40"]);
  });
});

describe("what a note states that nobody gave the coach", () => {
  const given = [
    "At Harbourline: cut tide-table query latency from 900ms to 120ms",
    "INTERVIEWER: you said forty percent of the fleet, over twenty five ports, in four weeks?",
  ];

  it("is nothing when every figure and employer is in the facts or was said", () => {
    expect(
      inventedIn(
        "At Harbourline we cut latency from 900 ms to 120ms: 40% of the fleet, 25 ports, 4 weeks.",
        given,
        EMPLOYERS,
      ),
    ).toEqual({ figures: [], employers: [] });
  });

  it("is a figure that is in neither, and an employer of the matrix that is in neither", () => {
    expect(
      inventedIn(
        "At Quayside Freight we cut it 65%, to 120ms, across 3 regions.",
        given,
        EMPLOYERS,
      ),
    ).toEqual({ figures: ["65", "3"], employers: ["Quayside Freight"] });
  });

  it("takes an employer's name whole, whatever its case, and never inside another word", () => {
    expect(
      inventedIn("the HARBOURLINE years", [], EMPLOYERS).employers,
    ).toEqual(["Harbourline"]);
    expect(inventedIn("the Harbourliners", [], EMPLOYERS).employers).toEqual(
      [],
    );
    // Named in what was given, in another case: not invented.
    expect(
      inventedIn("At Harbourline.", ["harbourline, 2022"], EMPLOYERS).employers,
    ).toEqual([]);
  });

  it("CANNOT catch a technology, a made-up company, a figure moved to another claim, or a figure written in words", () => {
    // The limits said in inventedIn's comment, held here so a change to them
    // is a decision: each of these is invented and none is flagged.
    expect(
      inventedIn(
        "At Saltmarsh Robotics I rewrote it in Rust and cut costs by 120, then ninety percent.",
        given,
        EMPLOYERS,
      ),
    ).toEqual({ figures: [], employers: [] });
  });

  it("does not flag a figure plainly worked out from two that were given: their difference or their sum", () => {
    // 900ms to 120ms was given: 780 is their difference, 1020 their sum.
    expect(
      inventedIn("That is 780ms saved.", given, EMPLOYERS).figures,
    ).toEqual([]);
    expect(inventedIn("Together 1020ms.", given, EMPLOYERS).figures).toEqual(
      [],
    );
  });

  it("still flags what follows from nothing given, and never reads small numbers as sums: 65% is not forty and twenty five", () => {
    expect(
      inventedIn(
        "In 2019 we cut it 65%, to 4.5 seconds, across 3 regions.",
        given,
        EMPLOYERS,
      ).figures,
    ).toEqual(["2019", "65", "4.5", "3"]);
  });
});

describe("one question's note", () => {
  const right = note([
    spoken("We "),
    verified("cut latency from 900ms to 120ms", "/roles/0/proof_points/0"),
  ]);
  const base = {
    facts: FACTS,
    conversation: ["How did you make it faster?"],
    employers: EMPLOYERS,
  };

  it("reads every line of the note, joined as it is shown", () => {
    expect(noteText(right)).toBe("We cut latency from 900ms to 120ms");
  });

  it("is right when a verified claim is an accepted employer's and none is another's", () => {
    const score = scoreNote({
      ...base,
      note: right,
      expectation: { kind: "employers", accepted: ["Harbourline"] },
    });
    expect(score.right).toBe(true);
    expect(score.invented).toEqual({ figures: 0, employers: 0 });
  });

  it("is wrong when it draws on another employer, or on none, or was never written", () => {
    const wanted = { kind: "employers", accepted: ["Tidewater Labs"] } as const;
    expect(scoreNote({ ...base, note: right, expectation: wanted }).right).toBe(
      false,
    );
    expect(
      scoreNote({
        ...base,
        note: note([spoken("Lead with the rule.")]),
        expectation: wanted,
      }).right,
    ).toBe(false);
    expect(
      scoreNote({ ...base, note: undefined, expectation: wanted }).right,
    ).toBe(false);
  });

  it("with nothing expected, is right only when it cites no employer and invents nothing", () => {
    const nothing = { kind: "nothing" } as const;
    expect(
      scoreNote({
        ...base,
        note: note([spoken("Give the shape: from X to Y.")]),
        expectation: nothing,
      }).right,
    ).toBe(true);
    expect(
      scoreNote({ ...base, note: undefined, expectation: nothing }).right,
    ).toBe(true);
    expect(
      scoreNote({ ...base, note: right, expectation: nothing }).right,
    ).toBe(false);
    const invented = scoreNote({
      ...base,
      note: note([spoken("Say you cut it by 70%.")]),
      expectation: nothing,
    });
    expect(invented.right).toBe(false);
    expect(invented.inventedItems).toEqual({ figures: ["70"], employers: [] });
  });

  it("is GROUNDED, though not right, when it rests on the person's own notes and cites no other employer", () => {
    const wanted = { kind: "employers", accepted: ["Harbourline"] } as const;
    const prepared = scoreNote({
      ...base,
      facts: [
        ...FACTS,
        {
          pointer: "brief:prepNotes:a1",
          text: "Boundaries: logical boundary first, a modular monolith otherwise.",
          about: "notes",
        },
      ],
      note: note([inferred("logical boundary first")]),
      expectation: wanted,
    });
    expect([prepared.right, prepared.grounded, prepared.inferenceOnly]).toEqual(
      [false, true, false],
    );
    // The same words with no note of theirs behind them are the model's own.
    const bare = scoreNote({
      ...base,
      note: note([inferred("logical boundary first")]),
      expectation: wanted,
    });
    expect([bare.right, bare.grounded, bare.inferenceOnly]).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("is grounded when it says an accepted employer's fact without citing it", () => {
    const score = scoreNote({
      ...base,
      note: note([
        spoken("At Harbourline we "),
        inferred("cut tide-table query latency to 120ms"),
      ]),
      expectation: { kind: "employers", accepted: ["Harbourline"] },
    });
    expect([score.right, score.grounded, score.wrongEmployer]).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("tells a second employer's story beside the right one from the wrong employer alone", () => {
    const wanted = { kind: "employers", accepted: ["Harbourline"] } as const;
    const both = scoreNote({
      ...base,
      note: note([
        verified("900ms to 120ms", "/roles/0/proof_points/0"),
        verified("42,000 invoices a day", "/roles/1/proof_points/0"),
      ]),
      expectation: wanted,
    });
    expect([both.right, both.mixed, both.wrongEmployer, both.grounded]).toEqual(
      [false, true, false, true],
    );
    const other = scoreNote({
      ...base,
      note: note([
        verified("42,000 invoices a day", "/roles/1/proof_points/0"),
      ]),
      expectation: wanted,
    });
    expect([other.mixed, other.wrongEmployer, other.grounded]).toEqual([
      false,
      true,
      false,
    ]);
    // With nothing verified, the only employer it names decides.
    const named = scoreNote({
      ...base,
      note: note([spoken("At Quayside Freight I owned the reporting.")]),
      expectation: wanted,
    });
    expect([named.wrongEmployer, named.grounded]).toEqual([true, false]);
    // A question with no employer expected is never the wrong employer.
    expect(
      scoreNote({
        ...base,
        note:
          other.right === false
            ? note([
                verified("42,000 invoices a day", "/roles/1/proof_points/0"),
              ])
            : undefined,
        expectation: null,
      }).wrongEmployer,
    ).toBe(false);
  });

  it("counts a figure of a fact given earlier in the call as given, not invented", () => {
    const later = note([spoken("That was 42,000 invoices a day.")]);
    const now = [{ pointer: "/candidate/name", text: "Name: Marisol" }];
    const asked = { ...base, facts: now, note: later, expectation: null };
    expect(scoreNote(asked).invented.figures).toBe(1);
    expect(scoreNote({ ...asked, earlier: FACTS }).invented.figures).toBe(0);
  });

  it("counts a figure from the plan for the call as given, not invented", () => {
    const planned = note([spoken("Ask for the range before naming 140.")]);
    const without = scoreNote({ ...base, note: planned, expectation: null });
    expect(without.invented.figures).toBe(1);
    expect(without.right).toBeNull();
    expect(
      scoreNote({
        ...base,
        note: planned,
        plan: "Salary: 140 is the floor.",
        expectation: null,
      }).invented.figures,
    ).toBe(0);
  });
});

describe("the run's totals", () => {
  const scored = (
    right: boolean | null,
    wrong: number,
    figures: number,
    more: {
      grounded?: boolean;
      inferenceOnly?: boolean;
      offered?: boolean;
    } = {},
  ): Parameters<typeof totalsOf>[0][number]["note"] => ({
    right,
    grounded: right === null ? null : (more.grounded ?? right),
    mixed: wrong > 0 && right === true,
    wrongEmployer: wrong > 0 && right !== true,
    inferenceOnly: more.inferenceOnly ?? false,
    evidence: {
      accepted: right ? 1 : 0,
      wrong,
      other: 0,
      inferred: 0,
      own: 0,
      unbacked: 0,
      uncited: { accepted: 0, wrong: 0 },
      named: { accepted: 0, other: 0 },
      sources: [],
      offeredAccepted: 0,
      offeredOther: 0,
      offered: more.offered ?? null,
    },
    invented: { figures, employers: 0 },
  });

  it("count right evidence over the questions that expect any, wrong employers by question, everything invented, and in time over the questions that must be answered", () => {
    const totals = totalsOf([
      { optional: false, inTime: true, note: scored(true, 0, 0) },
      { optional: false, inTime: false, note: scored(false, 2, 1) },
      // No expectation: its invention counts, its evidence is not judged.
      { optional: false, inTime: true, note: scored(null, 0, 2) },
      // Optional: not owed a note in time; its evidence is still judged. It
      // rests on the person's own notes: grounded, though not right, and
      // the pack had offered the right employer's fact.
      {
        optional: true,
        inTime: null,
        note: scored(false, 0, 0, { grounded: true, offered: true }),
      },
      // All its claims are the model's own, and the pack offered nothing.
      {
        optional: false,
        inTime: true,
        note: scored(false, 0, 0, { inferenceOnly: true, offered: false }),
      },
      // Timing only: nothing was written.
      { optional: false, inTime: null, note: null },
    ]);
    expect(totals).toEqual({
      rightEvidence: { right: 1, of: 4 },
      grounded: { right: 2, of: 4 },
      inferenceOnly: 1,
      offered: { right: 1, of: 2 },
      wrongEmployer: 1,
      mixed: 0,
      invented: 3,
      inTime: { right: 3, of: 5 },
    });
    expect(totalsLine(totals)).toBe(
      "right evidence 1 of 4, grounded 2 of 4, offered 1 of 2, inference only 1, wrong employer 1, two employers 0, invented 3, in time 3 of 5",
    );
  });
});

describe("the scripted note-writer", () => {
  const facts = [
    { pointer: "/candidate/name", text: "Name: Marisol", about: "candidate" },
    {
      pointer: "/context/employerBrief/company",
      text: "Company: Saltmarsh",
      about: "employer",
    },
    {
      pointer: "/roles/1",
      text: "Senior Engineer, Quayside Freight",
      about: "candidate",
    },
    {
      pointer: "/roles/0/proof_points/0",
      text: "At Harbourline: cut [p95] latency from 900ms to **120ms**",
      about: "candidate",
    },
  ];

  it("cites the first fact of a role the coach was given, by its pointer, without the marks its own format reads", () => {
    expect(scriptedReply({ reason: "question-finished", facts })).toBe(
      [
        "KIND: direct-answer",
        "SAME: no",
        "ASK: Scripted note",
        "SAY: From the record: **At Harbourline: cut p95 latency from 900ms to 120ms**[/roles/0/proof_points/0]",
      ].join("\n"),
    );
  });

  it("never cites the person's own notes either: they are theirs to say and no part of the record", () => {
    const withNotes = [
      {
        pointer: "brief:prepNotes:a1",
        text: "Lead with the ledger story.",
        about: "notes",
      },
      ...facts.slice(1, 2),
    ];
    const reply = scriptedReply({ reason: "pause", facts: withNotes });
    expect(reply).toContain("CAUTION: ");
    expect(reply).not.toContain("ledger");
  });

  it("falls back to the role, then to the person's own first fact, and never cites the employer's material", () => {
    expect(
      scriptedReply({ reason: "pause", facts: facts.slice(0, 3) }),
    ).toContain("**Senior Engineer, Quayside Freight**[/roles/1]");
    expect(
      scriptedReply({ reason: "pause", facts: facts.slice(0, 2) }),
    ).toContain("**Name: Marisol**[/candidate/name]");
    const nothing = scriptedReply({
      reason: "pause",
      facts: facts.slice(1, 2),
    });
    expect(nothing).toContain("CAUTION: ");
    expect(nothing).not.toContain("**");
  });

  it("cuts a long fact at a whole word, so no figure is cut in half", () => {
    const long = `At Harbourline: ${"moved the berth scheduler ".repeat(6)}to 1200 berths`;
    const reply = scriptedReply({
      reason: "question-finished",
      facts: [
        { pointer: "/roles/0/proof_points/1", text: long, about: "candidate" },
      ],
    });
    const claim = /\*\*(.+)\*\*/.exec(reply)?.[1] ?? "";
    expect(claim.length).toBeLessThanOrEqual(140);
    expect(long.startsWith(claim)).toBe(true);
    expect(long[claim.length]).toBe(" ");
  });

  it("says nothing when the candidate is mid-answer or the screen changed", () => {
    expect(scriptedReply({ reason: "answer-check", facts })).toBe("NONE");
    expect(scriptedReply({ reason: "screen-change", facts })).toBe("NONE");
  });
});
