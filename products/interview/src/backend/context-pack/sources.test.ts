// A person's material as the sources the AI engine prepares (ADR-0038): who
// gives each record its identity, where the position is kept instead, and
// what kind each line of an employer brief and of the preferences is. Every
// name and figure here is invented.
import { createHash } from "node:crypto";
import type {
  CandidateMatrix,
  EmployerBrief,
} from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  BRIEF,
  HARBOURLINE,
  MATRIX,
  NEWER,
  PREFERENCES,
  QUAYSIDE,
  TIDEWATER,
} from "./fixture";
import { KINDS } from "./recipe";
import {
  briefSource,
  headingsOf,
  matrixSource,
  preferencesSource,
} from "./sources";

const PROFILE = { id: "profile-1", revision: 3 };
const short = (text: string) =>
  createHash("sha256").update(text).digest("hex").slice(0, 12);
const matrixOf = (roles: unknown[], rest: object = {}) =>
  ({ candidate: {}, roles, ...rest }) as CandidateMatrix;
const recordsOf = (matrix: CandidateMatrix) =>
  matrixSource(matrix, PROFILE).records ?? [];
const byLocator = (matrix: CandidateMatrix) =>
  new Map(recordsOf(matrix).map((record) => [record.locator, record]));
// What an achievement was composed from, as the record keeps it.
type Part = { section: string; locator: string; text: string };
const partsOf = (record: { fields?: Record<string, unknown> }) =>
  (record.fields?.["parts"] ?? []) as Part[];
const sectionOf = (record: { fields?: Record<string, unknown> }) =>
  (record.fields?.["of"] as { section?: string } | undefined)?.section;
const at = (matrix: CandidateMatrix, locator: string) => {
  const record = byLocator(matrix).get(locator);
  if (!record) throw new Error(`no record at ${locator}`);
  return record;
};

describe("the experience matrix as a source", () => {
  it("is named for the profile and its revision", () => {
    expect(matrixSource(MATRIX, PROFILE)).toMatchObject({
      id: "matrix:profile-1",
      revision: "3",
      kind: "experience-matrix",
    });
  });

  it("names a role by its employer and title", () => {
    expect(at(MATRIX, "/roles/0")).toEqual({
      id: "role:harbourline:staff-engineer",
      kind: KINDS.role,
      text: "Staff Engineer, Harbourline (2022 to 2025)",
      fields: {
        company: "Harbourline",
        title: "Staff Engineer",
        technologies: ["Go", "PostgreSQL", "Kafka"],
        tags: ["platform"],
        period: "2022 to 2025",
      },
      priority: 10,
      locator: "/roles/0",
    });
    expect(at(MATRIX, "/roles/1").id).toBe(
      "role:quayside-freight:senior-engineer",
    );
    // No period: none is written into the text or the fields.
    expect(at(MATRIX, "/roles/1").text).toBe(
      "Senior Engineer, Quayside Freight",
    );
    expect(at(MATRIX, "/roles/1").fields).not.toHaveProperty("period");
  });

  it("gathers a role's tags, patterns, problem spaces, system types and industry as its tags", () => {
    const matrix = matrixOf([
      {
        company: "Harbourline",
        title: "Staff Engineer",
        tags: ["platform"],
        patterns: ["staged cutover"],
        problem_spaces: ["scheduling"],
        system_types: ["ledger"],
        industry: ["ports"],
      },
    ]);
    expect(at(matrix, "/roles/0").fields).toEqual({
      company: "Harbourline",
      title: "Staff Engineer",
      technologies: [],
      tags: ["platform", "staged cutover", "scheduling", "ledger", "ports"],
    });
  });

  // ADR-0038 scenario 1: "The original facts keep their identities; one new
  // role is added."
  it("keeps every identity when a role is inserted first, and moves only the positions", () => {
    const before = recordsOf(MATRIX);
    const after = recordsOf({ ...MATRIX, roles: [NEWER, ...MATRIX.roles] });
    const afterById = new Map(after.map((record) => [record.id, record]));

    for (const record of before) {
      const moved = afterById.get(record.id);
      expect(moved, record.id).toBeDefined();
      expect(moved?.text, record.id).toBe(record.text);
      expect(moved?.kind, record.id).toBe(record.kind);
    }
    expect(
      after
        .map((record) => record.id)
        .filter((id) => !before.some((record) => record.id === id)),
    ).toEqual([
      "role:saltmarsh-robotics:principal-engineer",
      `role:saltmarsh-robotics:principal-engineer:proof_points:${short(NEWER.proof_points[0] as string)}`,
    ]);
    // The position is the pointer, and that is what shifted.
    expect(afterById.get("role:harbourline:staff-engineer")?.locator).toBe(
      "/roles/1",
    );
    expect(
      afterById.get(
        `role:harbourline:staff-engineer:proof_points:${short(HARBOURLINE.proof_points[0] as string)}`,
      )?.locator,
    ).toBe("/roles/1/proof_points/0");
    // What is not in a role does not move.
    expect(afterById.get("candidate")?.locator).toBe("/candidate");
    expect(after.find((record) => record.kind === KINDS.story)?.locator).toBe(
      "/story_selector/0",
    );
  });

  it("tells two roles with one employer and title apart by their order among themselves", () => {
    const again = { ...HARBOURLINE, proof_points: ["Second stint: tide API"] };
    const matrix = matrixOf([HARBOURLINE, QUAYSIDE, again, again]);
    expect(at(matrix, "/roles/0").id).toBe("role:harbourline:staff-engineer");
    expect(at(matrix, "/roles/2").id).toBe("role:harbourline:staff-engineer:2");
    expect(at(matrix, "/roles/3").id).toBe("role:harbourline:staff-engineer:3");
    expect(at(matrix, "/roles/2/proof_points/0").id).toBe(
      `role:harbourline:staff-engineer:2:proof_points:${short("Second stint: tide API")}`,
    );
    // Another employer between them does not count.
    expect(at(matrix, "/roles/1").id).toBe(
      "role:quayside-freight:senior-engineer",
    );
  });

  it("slugs an employer or title of punctuation alone to a placeholder, and bounds a long one", () => {
    const matrix = matrixOf([
      { company: "***", title: "C++ / C# Lead" },
      { company: "H".repeat(80), title: "Engineer" },
    ]);
    expect(at(matrix, "/roles/0").id).toBe("role:x:c-c-lead");
    expect(at(matrix, "/roles/1").id).toBe(`role:${"h".repeat(48)}:engineer`);
  });

  it("names an achievement by its role, its section and what it says", () => {
    const said = HARBOURLINE.proof_points[0] as string;
    expect(at(MATRIX, "/roles/0/proof_points/0")).toEqual({
      id: `role:harbourline:staff-engineer:proof_points:${short(said)}`,
      kind: KINDS.achievement,
      // Who, where, when and what, in one line; the stack it was done on.
      // The metric it states the value of is written after it, because its
      // label says something the proof point does not ("p95").
      text: `At Harbourline (2022 to 2025, Staff Engineer): ${said}; p95 latency: 120ms (down). Stack: Go, PostgreSQL, Kafka.`,
      fields: {
        company: "Harbourline",
        title: "Staff Engineer",
        period: "2022 to 2025",
        // The one technology its own words name, and the role's whole stack.
        technologies: ["PostgreSQL"],
        stack: ["Go", "PostgreSQL", "Kafka"],
        themes: [],
        tags: ["platform"],
        of: {
          role: "role:harbourline:staff-engineer",
          section: "proof_points",
        },
        // The metric whose value it states is part of it, at its own place.
        parts: [
          {
            section: "proof_points",
            locator: "/roles/0/proof_points/0",
            text: said,
          },
          {
            section: "metrics",
            locator: "/roles/0/metrics/1",
            text: "p95 latency: 120ms (down)",
          },
        ],
      },
      // The newest role (10), a proof point (4), listed first (9).
      priority: 1049,
      locator: "/roles/0/proof_points/0",
    });

    // The same words under another role, or another section, are another fact.
    const same = "Kept the lights on";
    const matrix = matrixOf([
      { ...QUAYSIDE, proof_points: [same], responsibilities: [same] },
      { ...TIDEWATER, proof_points: [same] },
    ]);
    const ids = [
      "/roles/0/proof_points/0",
      "/roles/0/responsibilities/0",
      "/roles/1/proof_points/0",
    ].map((locator) => at(matrix, locator).id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual([
      `role:quayside-freight:senior-engineer:proof_points:${short(same)}`,
      `role:quayside-freight:senior-engineer:responsibilities:${short(same)}`,
      `role:tidewater-labs:engineer:proof_points:${short(same)}`,
    ]);
    // Different words, a different fact.
    expect(at(MATRIX, "/roles/0/proof_points/1").id).not.toBe(
      at(MATRIX, "/roles/0/proof_points/0").id,
    );
  });

  it("points at each fact by its position in the matrix", () => {
    expect([...byLocator(MATRIX).keys()]).toEqual([
      "/candidate",
      "/roles/0",
      "/roles/0/proof_points/0",
      "/roles/0/proof_points/1",
      "/roles/0/leadership_signals/0",
      "/roles/0/responsibilities/0",
      "/roles/0/metrics/0",
      // "/roles/0/metrics/1" is part of the proof point that states it.
      "/roles/1",
      "/roles/1/proof_points/0",
      "/roles/1/responsibilities/0",
      "/roles/1/metrics/0",
      "/roles/2",
      "/roles/2/proof_points/0",
      "/story_selector/0",
    ]);
  });

  // Every place of the matrix a role holds is in exactly one achievement:
  // composing drops nothing and says nothing twice.
  it("keeps every proof point, signal, responsibility and metric as a part of one achievement", () => {
    const parts = recordsOf(MATRIX)
      .filter((record) => record.kind === KINDS.achievement)
      .flatMap((record) => partsOf(record).map((part) => part.locator));
    expect([...parts].sort()).toEqual(
      [
        "/roles/0/proof_points/0",
        "/roles/0/proof_points/1",
        "/roles/0/leadership_signals/0",
        "/roles/0/responsibilities/0",
        "/roles/0/metrics/0",
        "/roles/0/metrics/1",
        "/roles/1/proof_points/0",
        "/roles/1/responsibilities/0",
        "/roles/1/metrics/0",
        "/roles/2/proof_points/0",
      ].sort(),
    );
    expect(new Set(parts).size).toBe(parts.length);
    // A part keeps its own words, as the matrix has them.
    expect(partsOf(at(MATRIX, "/roles/0/leadership_signals/0"))).toEqual([
      {
        section: "leadership_signals",
        locator: "/roles/0/leadership_signals/0",
        text: "Mentored four engineers through the ledger rewrite",
      },
    ]);
  });

  it("writes a metric that belongs to no statement as an achievement of its own, with its role", () => {
    expect(at(MATRIX, "/roles/0/metrics/0")).toMatchObject({
      id: `role:harbourline:staff-engineer:metrics:${short("uptime: 99.95%")}`,
      kind: KINDS.achievement,
      text: "At Harbourline (2022 to 2025, Staff Engineer): uptime: 99.95%. Stack: Go, PostgreSQL, Kafka.",
      fields: { company: "Harbourline", of: { section: "metrics" } },
    });
    // A number is written as it is; a role with no period says none.
    expect(at(MATRIX, "/roles/1/metrics/0").text).toBe(
      "At Quayside Freight (Senior Engineer): invoices per day: 42000. Stack: NestJS, TypeScript, Redis.",
    );
  });

  describe("a metric and the statement it belongs to", () => {
    const role = (more: object) =>
      matrixOf([{ company: "Harbourline", title: "Staff Engineer", ...more }]);

    it("belongs to the proof point that states its value, and is not said twice when the proof point says all of it", () => {
      const matrix = role({
        proof_points: ["Kept the scheduler up", "Cut p95 latency to 120ms"],
        metrics: [{ label: "p95 latency", value: "120ms", direction: "down" }],
      });
      const owner = at(matrix, "/roles/0/proof_points/1");
      expect(owner.text).toBe(
        "At Harbourline (Staff Engineer): Cut p95 latency to 120ms.",
      );
      // A label that says more than the proof point does is written out: a
      // claim is checked against this text, and "p95" is a figure.
      const partly = role({
        proof_points: ["Cut query latency to 120ms"],
        metrics: [{ label: "p95 latency", value: "120ms", direction: "down" }],
      });
      expect(at(partly, "/roles/0/proof_points/0").text).toBe(
        "At Harbourline (Staff Engineer): Cut query latency to 120ms; p95 latency: 120ms (down).",
      );
      expect(partsOf(owner).map((part) => part.locator)).toEqual([
        "/roles/0/proof_points/1",
        "/roles/0/metrics/0",
      ]);
      expect(byLocator(matrix).has("/roles/0/metrics/0")).toBe(false);
    });

    it("belongs to the statement that says every word of its label, and is then written after it", () => {
      const matrix = role({
        proof_points: ["Grew API usage across partner teams"],
        metrics: [
          { label: "API usage", value: "2M weekly calls", direction: "up" },
        ],
      });
      expect(at(matrix, "/roles/0/proof_points/0").text).toBe(
        "At Harbourline (Staff Engineer): Grew API usage across partner teams; API usage: 2M weekly calls (up).",
      );
    });

    it("is tried on proof points before responsibilities, and never on a leadership signal", () => {
      const matrix = role({
        responsibilities: ["Owned uptime for the scheduler"],
        leadership_signals: ["uptime champion"],
        proof_points: ["Raised uptime after the storm season"],
        metrics: [{ label: "uptime", value: "99.95%" }],
      });
      expect(
        partsOf(at(matrix, "/roles/0/proof_points/0")).map(
          (part) => part.section,
        ),
      ).toEqual(["proof_points", "metrics"]);
      const responsible = role({
        responsibilities: ["Owned uptime for the scheduler"],
        leadership_signals: ["uptime champion"],
        metrics: [{ label: "uptime", value: "99.95%" }],
      });
      expect(
        partsOf(at(responsible, "/roles/0/responsibilities/0")).length,
      ).toBe(2);
      expect(
        partsOf(at(responsible, "/roles/0/leadership_signals/0")).length,
      ).toBe(1);
    });

    it("does not take a figure inside another figure for its value", () => {
      // "6" is not stated by "65%", and "team size" is not said by "a team".
      const matrix = role({
        proof_points: ["Cut defects by 65% with a team of six"],
        metrics: [{ label: "team size", value: "6" }],
      });
      expect(at(matrix, "/roles/0/metrics/0").text).toBe(
        "At Harbourline (Staff Engineer): team size: 6.",
      );
    });
  });

  describe("an achievement's themes and technologies", () => {
    const matrix = matrixOf([
      {
        company: "Harbourline",
        title: "Staff Engineer",
        technologies: ["Go", "PostgreSQL", "Node.js", "Kafka", "Redis"],
        tags: ["safe-modernization", "ports"],
        patterns: ["staged cutover"],
        problem_spaces: ["berth scheduling"],
        system_types: ["legacy modernization"],
        industry: ["shipping"],
        proof_points: [
          "Led modernization of the legacy berth monolith",
          "Tuned the Node scheduler queue",
        ],
      },
    ]);
    const led = at(matrix, "/roles/0/proof_points/0");
    const tuned = at(matrix, "/roles/0/proof_points/1");

    it("takes a subject of the role as a theme when its own words say half of it", () => {
      // "safe-modernization": one of two words; "legacy modernization": both;
      // "berth scheduling": one of two. "staged cutover" and "ports": none.
      expect(led.fields?.["themes"]).toEqual([
        "safe-modernization",
        "berth scheduling",
        "legacy modernization",
      ]);
      // Another achievement of the same role has no part in that subject.
      expect(tuned.fields?.["themes"]).toEqual([]);
    });

    it("never takes a theme from outside the role's own subjects, and keeps them all as tags", () => {
      const subjects = [
        "safe-modernization",
        "ports",
        "staged cutover",
        "berth scheduling",
        "legacy modernization",
      ];
      for (const record of [led, tuned]) {
        for (const theme of (record.fields?.["themes"] ?? []) as string[])
          expect(subjects).toContain(theme);
        // The industry is a tag of the role, never a theme of one line.
        expect(record.fields?.["tags"]).toEqual([...subjects, "shipping"]);
      }
    });

    it("names the technologies its own words name, in any accepted form, beside the role's stack", () => {
      expect(led.fields?.["technologies"]).toEqual([]);
      // "Node" is "Node.js".
      expect(tuned.fields?.["technologies"]).toEqual(["Node.js"]);
      for (const record of [led, tuned])
        expect(record.fields?.["stack"]).toEqual([
          "Go",
          "PostgreSQL",
          "Node.js",
          "Kafka",
          "Redis",
        ]);
    });

    it("says the first three of the role's technologies, and none when the role has none", () => {
      expect(led.text.endsWith(" Stack: Go, PostgreSQL, Node.js.")).toBe(true);
      expect(
        at(
          matrixOf([
            {
              company: "Harbourline",
              title: "Engineer",
              proof_points: ["Shipped it."],
            },
          ]),
          "/roles/0/proof_points/0",
        ).text,
      ).toBe("At Harbourline (Engineer): Shipped it.");
    });
  });

  it("ranks the recent role first, then what was achieved above what was led and that above what was done, then the order listed", () => {
    const priority = (locator: string) => at(MATRIX, locator).priority;
    expect(priority("/roles/0/proof_points/0")).toBe(1049);
    expect(priority("/roles/0/proof_points/1")).toBe(1048);
    // A metric no statement states: a result with no account of how.
    expect(priority("/roles/0/metrics/0")).toBe(1039);
    expect(priority("/roles/0/leadership_signals/0")).toBe(1029);
    expect(priority("/roles/0/responsibilities/0")).toBe(1019);
    // The next role's best is below the newest role's least.
    expect(priority("/roles/1/proof_points/0")).toBe(949);
    // Past the tenth role and the tenth line, neither counts for less.
    const long = matrixOf(
      Array.from({ length: 12 }, (_, index) => ({
        company: `Employer ${index}`,
        title: "Engineer",
        proof_points: Array.from({ length: 11 }, (_, line) => `Did ${line}`),
      })),
    );
    expect(at(long, "/roles/11/proof_points/10").priority).toBe(40);
  });

  it("ranks a role by how recent it is: ten less its place, never below zero", () => {
    const matrix = matrixOf(
      Array.from({ length: 12 }, (_, index) => ({
        company: `Employer ${index}`,
        title: "Engineer",
      })),
    );
    expect(
      recordsOf(matrix)
        .filter((record) => record.kind === KINDS.role)
        .map((record) => record.priority),
    ).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0]);
  });

  it("carries the profile's exact fields, each on one line", () => {
    expect(at(MATRIX, "/candidate")).toEqual({
      id: "candidate",
      kind: KINDS.profile,
      text: "Mira Okonjo: Platform engineer",
      fields: {
        name: "Mira Okonjo",
        headline: "Platform engineer",
        location: "Lisbon",
      },
      locator: "/candidate",
    });
  });

  it("carries only the profile fields the matrix has, and no profile record without any", () => {
    const named = matrixOf([], { candidate: { name: "Mira Okonjo" } });
    expect(at(named, "/candidate")).toMatchObject({
      text: "Mira Okonjo",
      fields: { name: "Mira Okonjo" },
    });
    expect(Object.keys(at(named, "/candidate").fields ?? {})).toEqual(["name"]);
    expect(recordsOf(matrixOf([]))).toEqual([]);
  });

  it("writes a chosen story with what it is for, and its backup when there is one", () => {
    const text =
      'For "conflict with a stakeholder": The Quayside Freight invoice dispute with the finance director (or: The pilots\' rota disagreement)';
    expect(at(MATRIX, "/story_selector/0")).toEqual({
      id: `story:${short(text)}`,
      kind: KINDS.story,
      text,
      fields: { need: "conflict with a stakeholder" },
      priority: 2,
      locator: "/story_selector/0",
    });
    const alone = matrixOf([], {
      story_selector: [
        { need: "a failure", primary_story: "The lost manifest" },
      ],
    });
    expect(at(alone, "/story_selector/0").text).toBe(
      'For "a failure": The lost manifest',
    );
  });

  it("keeps the same line said twice in one section as one record, at its first place", () => {
    const twice = "Rewrote the berth scheduler in Go for the harbour pilots";
    const matrix = matrixOf([
      { ...HARBOURLINE, proof_points: [twice, "Something else", twice] },
    ]);
    const proof = recordsOf(matrix).filter(
      (record) => sectionOf(record) === "proof_points",
    );
    expect(
      proof.map((record) => [partsOf(record)[0]?.text, record.locator]),
    ).toEqual([
      [twice, "/roles/0/proof_points/0"],
      ["Something else", "/roles/0/proof_points/1"],
    ]);
    const ids = recordsOf(matrix).map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("writes every text on one line", () => {
    const matrix = matrixOf([
      {
        company: "Harbourline",
        title: "Staff Engineer",
        proof_points: ["  Cut latency\n  from 900ms\tto 120ms  "],
      },
    ]);
    expect(at(matrix, "/roles/0/proof_points/0").text).toBe(
      "At Harbourline (Staff Engineer): Cut latency from 900ms to 120ms.",
    );
  });
});

// The fixture's lines have no heading; one that has keeps it as a field.
const headed = (said: string) =>
  headingsOf(said).length > 0 ? { heading: headingsOf(said) } : {};

describe("the words a line is headed with", () => {
  it("are the words before a sentence's colon", () => {
    expect(headingsOf("NestJS: a framework, not the architecture.")).toEqual([
      "NestJS",
    ]);
    expect(headingsOf("Base salary: 140k minimum.")).toEqual(["Base salary"]);
    expect(headingsOf("Write things down")).toEqual([]);
  });

  it("are none when the colon comes after many words, as in a time of day", () => {
    expect(
      headingsOf(
        "Hiring-manager interview with the head of platform, Tue Mar 3 2026, 10:00-11:00 Atlantic: not coding.",
      ),
    ).toEqual([]);
    // Only a sentence's first colon heads it.
    expect(headingsOf("Round: Tuesday, 10:00-11:00; not coding.")).toEqual([
      "Round",
    ]);
  });

  it("are not the label of the proof a note names", () => {
    expect(
      headingsOf(
        "Data moves: backfill, parity checks. Proof: Harbourline, near-zero drift. Example: the ledger.",
      ),
    ).toEqual(["Data moves"]);
  });
});

describe("the employer brief as a source", () => {
  const source = briefSource(BRIEF, { id: "candidacy-1", revision: "r7" });
  const records = source.records ?? [];
  const inSection = (section: string) =>
    records.filter((record) => record.fields?.["section"] === section);

  it("is named for the candidacy and the revision it was given", () => {
    expect(source).toMatchObject({
      id: "brief:candidacy-1",
      revision: "r7",
      kind: "employer-brief",
    });
  });

  it("leads with the employer record and its exact fields", () => {
    expect(records[0]).toEqual({
      id: "employer",
      kind: KINDS.employer,
      text: "Principal Engineer at Larkspur Analytics",
      fields: { company: "Larkspur Analytics", role: "Principal Engineer" },
      locator: "/context/employerBrief",
    });
  });

  it.each([
    ["mustHaves", KINDS.requirement, 3, "must have requirements required"],
    ["techStack", KINDS.requirement, 2, "tech stack technologies tools"],
    ["responsibilities", KINDS.requirement, 1, "responsibilities role job"],
    ["niceToHaves", KINDS.requirement, 1, "nice to have bonus"],
    ["companyFacts", KINDS.employerFact, 2, "company business"],
    ["values", KINDS.employerFact, 2, "values culture care"],
    ["prepNotes", KINDS.prep, 3, "prep notes"],
    ["questionsToAsk", KINDS.prep, 2, "questions ask"],
  ] as const)(
    "makes each line of %s a record of kind %s",
    (section, kind, priority, label) => {
      const lines = BRIEF[section] ?? [];
      expect(lines.length).toBeGreaterThan(0);
      expect(inSection(section)).toEqual(
        lines.map((said) => ({
          id: `brief:${section}:${short(said)}`,
          kind,
          text: said,
          fields: { section, label, ...headed(said) },
          priority,
        })),
      );
    },
  );

  it("keeps what a line is headed with, and nothing for a line with no heading", () => {
    const headedBrief = briefSource(
      {
        ...BRIEF,
        prepNotes: [
          "NestJS: a delivery framework, not the architecture.",
          "Answer shape: context, decision, result. Why leaving Harbourline: broader ownership.",
          "The round is with the head of platform",
        ],
      },
      { id: "c", revision: "r" },
    ).records?.filter((record) => record.fields?.["section"] === "prepNotes");
    expect(headedBrief?.map((record) => record.fields?.["heading"])).toEqual([
      ["NestJS"],
      // A later sentence's heading counts as the first one's does.
      ["Answer shape", "Why leaving Harbourline"],
      undefined,
    ]);
  });

  it("makes the summary, the team and the interview format records only when they are given", () => {
    expect(inSection("summary")).toEqual([
      {
        id: "brief:summary",
        kind: KINDS.employerFact,
        text: "A principal engineer to rebuild the forecasting pipeline.",
        fields: { section: "summary", label: "summary role company" },
        priority: 1,
      },
    ]);
    expect(inSection("team")).toEqual([
      {
        id: "brief:team",
        kind: KINDS.employerFact,
        text: "Six engineers and one designer.",
        fields: { section: "team", label: "team people structure" },
        priority: 1,
      },
    ]);
    // The fixture gives no interview format.
    expect(inSection("interviewFormat")).toEqual([]);
    const withFormat = briefSource(
      { ...BRIEF, interviewFormat: "Two rounds, then a\npairing hour." },
      { id: "c", revision: "r" },
    ).records?.find((record) => record.id === "brief:interviewFormat");
    expect(withFormat).toEqual({
      id: "brief:interviewFormat",
      kind: KINDS.employerFact,
      text: "Two rounds, then a pairing hour.",
      fields: {
        section: "interviewFormat",
        label: "interview format process stages",
      },
      priority: 1,
    });
  });

  it("gives a bare brief the employer record alone", () => {
    const bare: EmployerBrief = {
      company: "Larkspur Analytics",
      role: "Principal Engineer",
      summary: "",
      mustHaves: [],
      niceToHaves: [],
      techStack: [],
      responsibilities: [],
      values: [],
      questionsToAsk: [],
    };
    expect(
      briefSource(bare, { id: "c", revision: "r" }).records?.map(
        (record) => record.id,
      ),
    ).toEqual(["employer"]);
  });

  it("never makes a line of the employer's a record of the candidate's", () => {
    for (const record of records)
      expect(record.kind.startsWith("candidate-"), record.id).toBe(false);
  });

  it("keeps a line said twice in one list as one record", () => {
    const doubled = briefSource(
      { ...BRIEF, techStack: ["Elixir", "PostgreSQL", "Elixir"] },
      { id: "c", revision: "r" },
    ).records?.filter((record) => record.fields?.["section"] === "techStack");
    expect(doubled?.map((record) => record.text)).toEqual([
      "Elixir",
      "PostgreSQL",
    ]);
  });
});

describe("the person's preferences as a source", () => {
  const source = preferencesSource(PREFERENCES, { id: "draft", revision: "2" });

  it("is named for where it was typed and its revision", () => {
    expect(source).toMatchObject({
      id: "preferences:draft",
      revision: "2",
      kind: "candidate-preferences",
    });
  });

  it("makes each line and each sentence one record, with the bullet stripped", () => {
    expect(source.records).toEqual(
      [
        "Base salary: 140k minimum.",
        "Notice period: four weeks.",
        "Remote first!",
        "Prefers small squads",
      ].map((text, index) => ({
        id: `preference:${short(text)}`,
        kind: KINDS.preference,
        text,
        // What a line is headed with is kept; a line with no heading has none.
        ...(headingsOf(text).length > 0
          ? { fields: { heading: headingsOf(text) } }
          : {}),
        locator: `/context/candidatePreferences/${index}`,
      })),
    );
    expect(source.records?.map((record) => record.fields?.["heading"])).toEqual(
      [["Base salary"], ["Notice period"], undefined, undefined],
    );
  });

  it("strips a dash, a star, a dot bullet and a number, and nothing inside a line", () => {
    const texts = (typed: string) =>
      preferencesSource(typed, { id: "draft", revision: "1" }).records?.map(
        (record) => record.text,
      );
    expect(texts("- one\n* two\n• three\n2) five\nsix - not a bullet")).toEqual(
      ["one", "two", "three", "five", "six - not a bullet"],
    );
    expect(texts("No bonus; four-day week?  Yes.\r\n\r\n")).toEqual([
      "No bonus;",
      "four-day week?",
      "Yes.",
    ]);
  });

  // DEFECT (sources.ts:213-214): the text is cut into sentences before the
  // bullet is stripped, and "1." ends in a full stop followed by a space, so
  // a list numbered "1. …" is cut into the number and the line. The number
  // becomes a preference of its own ("1.") that a model is given and a
  // person sees, and every later locator is one further on.
  it("strips a number written with a full stop", () => {
    expect(
      preferencesSource("1. Remote first\n2. Four weeks' notice", {
        id: "draft",
        revision: "1",
      }).records?.map((record) => record.text),
    ).toEqual(["Remote first", "Four weeks' notice"]);
  });

  it("gives no record for nothing typed, and one for the same line typed twice", () => {
    const of = (typed: string) =>
      preferencesSource(typed, { id: "draft", revision: "1" }).records;
    expect(of("")).toEqual([]);
    expect(of(" \n\n  ")).toEqual([]);
    expect(of("Remote first.\n- Remote first.")).toEqual([
      {
        id: `preference:${short("Remote first.")}`,
        kind: KINDS.preference,
        text: "Remote first.",
        locator: "/context/candidatePreferences/0",
      },
    ]);
  });
});
