// The experience matrix read the ways it is used: a role cut into the facts
// the model can quote, the roles a note leans on, the projections on offer,
// and a role's lists edited as lines.
import type { CandidateMatrix, CoachNote } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  draftOf,
  EDITABLE_FIELDS,
  factField,
  PROJECTIONS,
  roleFacts,
  rolesLeanedOn,
  withRoleDraft,
} from "./matrix-projections";

type Role = CandidateMatrix["roles"][number];
const role = (company: string, extra: Partial<Role> = {}): Role => ({
  company,
  title: "Developer",
  ...extra,
});
const matrixOf = (...roles: Role[]) =>
  ({ candidate: { name: "Sam" }, roles }) as CandidateMatrix;
const MATRIX = matrixOf(
  role("Acme Corp"),
  role("Relay Platform"),
  role("Globex"),
  role("Initech"),
  role("Hooli"),
  role("Umbrella"),
  role("Stark Industries"),
);

type Segment =
  CoachNote["sections"][number]["lines"][number]["segments"][number];
const noteWith = (...segments: Segment[]): CoachNote => ({
  id: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-10-08T17:40:00.000Z",
  title: "Consistency",
  tone: "say",
  kind: "direct-answer",
  revision: 1,
  status: "ready",
  points: [],
  links: [],
  sections: [{ kind: "say", lines: [{ segments }] }],
});
const evidence = (text: string, source?: string): Segment => ({
  text,
  role: "evidence",
  ...(source ? { source } : {}),
});

describe("rolesLeanedOn", () => {
  const leaned = (...segments: Segment[]) => [
    ...rolesLeanedOn([noteWith(...segments)], MATRIX),
  ];

  it("a role is leaned on when a piece of evidence points at it or at a fact of it", () => {
    expect(leaned(evidence("the outbox", "/roles/1/proof_points/0"))).toEqual([
      "/roles/1",
    ]);
    expect(leaned(evidence("there", "/roles/4"))).toEqual(["/roles/4"]);
  });

  it("the pointer's whole number is the role: /roles/12 is not /roles/1", () => {
    expect(leaned(evidence("there", "/roles/12/metrics/0"))).toEqual([
      "/roles/12",
    ]);
  });

  it("a pointer into the brief leans on no role", () => {
    expect(leaned(evidence("ports", "/context/employerBrief/2"))).toEqual([]);
  });

  it("a role is leaned on when the evidence is one whole word of its company's name, whatever the case and the space round it", () => {
    expect(leaned(evidence("Relay"))).toEqual(["/roles/1"]);
    expect(leaned(evidence("  PLATFORM "))).toEqual(["/roles/1"]);
    expect(leaned(evidence("stark"))).toEqual(["/roles/6"]);
    expect(leaned(evidence("Acme"))).toEqual(["/roles/0"]);
    expect(leaned(evidence("Corp"))).toEqual(["/roles/0"]);
  });

  it("part of a word names nothing, and neither does a word of under four letters", () => {
    expect(leaned(evidence("Rela"))).toEqual([]);
    expect(leaned(evidence("Industr"))).toEqual([]);
    expect([
      ...rolesLeanedOn(
        [noteWith(evidence("IBM"))],
        matrixOf(role("IBM Research")),
      ),
    ]).toEqual([]);
  });

  it("only evidence counts: a company said in passing, or a source on another kind of piece, leans on nothing", () => {
    expect(
      leaned(
        { text: "Relay", role: "spoken" },
        { text: "Stark", role: "context" },
        { text: "Hooli", role: "caution", source: "/roles/4" },
        { text: "Globex", role: "cue" },
      ),
    ).toEqual([]);
  });

  it("every role whose company carries the word is leaned on", () => {
    expect([
      ...rolesLeanedOn(
        [noteWith(evidence("Relay"))],
        matrixOf(role("Relay Platform"), role("Acme"), role("Relay Labs")),
      ),
    ]).toEqual(["/roles/0", "/roles/2"]);
  });

  it("gathers across the notes, their sections and their lines, each role once", () => {
    const first = noteWith(
      evidence("Relay"),
      evidence("x", "/roles/1/metrics/0"),
    );
    const second: CoachNote = {
      ...noteWith(),
      sections: [
        { kind: "say", lines: [{ segments: [evidence("Hooli")] }] },
        {
          kind: "anchors",
          lines: [
            { segments: [evidence("Initech")] },
            { segments: [evidence("y", "/roles/5")] },
          ],
        },
      ],
    };
    expect([...rolesLeanedOn([first, second], MATRIX)]).toEqual([
      "/roles/1",
      "/roles/4",
      "/roles/3",
      "/roles/5",
    ]);
  });

  it("is empty for no notes, for notes with no sections, and for a matrix with no roles and no pointer", () => {
    expect(rolesLeanedOn([], MATRIX).size).toBe(0);
    expect(
      rolesLeanedOn([{ ...noteWith(evidence("Relay")), sections: [] }], MATRIX)
        .size,
    ).toBe(0);
    expect(rolesLeanedOn([noteWith(evidence("Relay"))], matrixOf()).size).toBe(
      0,
    );
  });
});

describe("roleFacts: a role cut into the facts the model can quote", () => {
  it("every string or number in the role is one fact at its own address, in the order written", () => {
    expect(
      roleFacts(
        role("Relay Platform", {
          period: "2021 to 2024",
          technologies: ["kafka", "postgres"],
          metrics: [
            { label: "Deploy time", value: "40 to 6 minutes" },
            { label: "Services", value: 12 },
          ],
          proof_points: ["Moved billing to the outbox"],
        }),
        3,
      ),
    ).toEqual([
      { pointer: "/roles/3/company", text: "Relay Platform" },
      { pointer: "/roles/3/title", text: "Developer" },
      { pointer: "/roles/3/period", text: "2021 to 2024" },
      { pointer: "/roles/3/technologies/0", text: "kafka" },
      { pointer: "/roles/3/technologies/1", text: "postgres" },
      { pointer: "/roles/3/metrics/0/label", text: "Deploy time" },
      { pointer: "/roles/3/metrics/0/value", text: "40 to 6 minutes" },
      { pointer: "/roles/3/metrics/1/label", text: "Services" },
      { pointer: "/roles/3/metrics/1/value", text: "12" },
      {
        pointer: "/roles/3/proof_points/0",
        text: "Moved billing to the outbox",
      },
    ]);
  });

  it("text is trimmed, and what is blank, true or false, or nothing is no fact; an item keeps its own place in the address", () => {
    expect(
      roleFacts(
        {
          ...role("  Acme  "),
          proof_points: ["  ", "Kept", ""],
          current: true,
          ended: null,
          tags: [],
          extra: { depth: { note: " deep " }, count: 0 },
        } as Role,
        0,
      ),
    ).toEqual([
      { pointer: "/roles/0/company", text: "Acme" },
      { pointer: "/roles/0/title", text: "Developer" },
      { pointer: "/roles/0/proof_points/1", text: "Kept" },
      { pointer: "/roles/0/extra/depth/note", text: "deep" },
      { pointer: "/roles/0/extra/count", text: "0" },
    ]);
  });
});

describe("factField: what a fact is, from its address", () => {
  it.each([
    ["/roles/3/proof_points/1", "proof_points"],
    ["/roles/3/metrics/0/value", "metrics"],
    ["/roles/12/company", "company"],
    ["/roles/3", ""],
    ["", ""],
  ])("%j is %j", (pointer, field) => {
    expect(factField(pointer)).toBe(field);
  });
});

describe("the projections on offer", () => {
  it("are six, ranked roles first and the server's own selection last, each named and saying how the matrix is consumed that way", () => {
    expect(PROJECTIONS.map((each) => [each.id, each.label])).toEqual([
      ["ranked", "Ranked roles"],
      ["facts", "Facts the model can quote"],
      ["stories", "Stories by need"],
      ["technology", "By technology"],
      ["industry", "By industry"],
      ["selected", "Selected for this question"],
    ]);
    for (const each of PROJECTIONS) expect(each.how.length).toBeGreaterThan(40);
    expect(new Set(PROJECTIONS.map((each) => each.how)).size).toBe(6);
  });
});

describe("a role's lists, edited as lines", () => {
  const RELAY = role("Relay Platform", {
    proof_points: ["Moved billing to the outbox", "Cut retries by 40%"],
    leadership_signals: ["Led a team of six"],
    technologies: ["kafka", "postgres"],
    metrics: [{ label: "Services", value: 12 }],
  });

  it("the fields edited are proof, leadership and stack, in that order", () => {
    expect(EDITABLE_FIELDS).toEqual([
      { key: "proof_points", label: "Proof" },
      { key: "leadership_signals", label: "Leadership" },
      { key: "technologies", label: "Stack" },
    ]);
  });

  it("a draft is each list a line to an item, and empty text for a list the role does not have", () => {
    expect(draftOf(RELAY)).toEqual({
      proof_points: "Moved billing to the outbox\nCut retries by 40%",
      leadership_signals: "Led a team of six",
      technologies: "kafka\npostgres",
    });
    expect(draftOf(role("Acme"))).toEqual({
      proof_points: "",
      leadership_signals: "",
      technologies: "",
    });
  });

  it("a draft put back is that role's three lists: a line to an item, trimmed, blank lines dropped, either line ending", () => {
    const matrix = matrixOf(role("Acme"), RELAY);
    const edited = withRoleDraft(matrix, 1, {
      proof_points:
        "  Moved billing to the outbox  \r\n\r\n\nShipped the relay\n   ",
      leadership_signals: "",
      technologies: "kafka\nrust",
    });
    expect(edited.roles[1]).toEqual({
      ...RELAY,
      proof_points: ["Moved billing to the outbox", "Shipped the relay"],
      leadership_signals: [],
      technologies: ["kafka", "rust"],
    });
  });

  it("nothing else is touched: the other roles, the role's other fields and the rest of the matrix, and the matrix given is left as it was", () => {
    const matrix = {
      ...matrixOf(role("Acme", { proof_points: ["Kept"] }), RELAY),
      story_selector: [{ need: "conflict", primary_story: "Relay" }],
    } as CandidateMatrix;
    const before = structuredClone(matrix);
    const edited = withRoleDraft(matrix, 1, draftOf(role("Other")));
    expect(edited.roles[0]).toBe(matrix.roles[0]);
    expect(edited.roles[1]).toMatchObject({
      company: "Relay Platform",
      metrics: [{ label: "Services", value: 12 }],
      proof_points: [],
    });
    expect(edited.candidate).toBe(matrix.candidate);
    expect(edited.story_selector).toBe(matrix.story_selector);
    expect(matrix).toEqual(before);
  });

  it("a draft read from a role and put straight back changes nothing of it", () => {
    const matrix = matrixOf(RELAY);
    expect(withRoleDraft(matrix, 0, draftOf(RELAY))).toEqual(matrix);
  });

  it("a place that holds no role changes no role", () => {
    const matrix = matrixOf(RELAY);
    expect(withRoleDraft(matrix, 5, draftOf(role("Other"))).roles).toEqual(
      matrix.roles,
    );
  });
});
