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
import { briefSource, matrixSource, preferencesSource } from "./sources";

const PROFILE = { id: "profile-1", revision: 3 };
const short = (text: string) =>
  createHash("sha256").update(text).digest("hex").slice(0, 12);
const matrixOf = (roles: unknown[], rest: object = {}) =>
  ({ candidate: {}, roles, ...rest }) as CandidateMatrix;
const recordsOf = (matrix: CandidateMatrix) =>
  matrixSource(matrix, PROFILE).records ?? [];
const byLocator = (matrix: CandidateMatrix) =>
  new Map(recordsOf(matrix).map((record) => [record.locator, record]));
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

  it("names evidence by its role, its section and what it says", () => {
    const said = HARBOURLINE.proof_points[0] as string;
    expect(at(MATRIX, "/roles/0/proof_points/0")).toEqual({
      id: `role:harbourline:staff-engineer:proof_points:${short(said)}`,
      kind: KINDS.evidence,
      text: said,
      fields: {
        company: "Harbourline",
        title: "Staff Engineer",
        technologies: ["Go", "PostgreSQL", "Kafka"],
        tags: ["platform"],
        section: "proof_points",
      },
      priority: 3,
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
      "/roles/0/metrics/1",
      "/roles/1",
      "/roles/1/proof_points/0",
      "/roles/1/responsibilities/0",
      "/roles/1/metrics/0",
      "/roles/2",
      "/roles/2/proof_points/0",
      "/story_selector/0",
    ]);
  });

  it("writes a metric as its label, its value and its direction", () => {
    expect(at(MATRIX, "/roles/0/metrics/0")).toMatchObject({
      id: `role:harbourline:staff-engineer:metrics:${short("uptime: 99.95%")}`,
      kind: KINDS.evidence,
      text: "uptime: 99.95%",
      fields: { section: "metrics", company: "Harbourline" },
    });
    expect(at(MATRIX, "/roles/0/metrics/1").text).toBe(
      "p95 latency: 120ms (down)",
    );
    // A number is written as it is.
    expect(at(MATRIX, "/roles/1/metrics/0").text).toBe(
      "invoices per day: 42000",
    );
  });

  it("ranks what was achieved above what was led, and that above what was merely done", () => {
    const priority = (locator: string) => at(MATRIX, locator).priority;
    expect(priority("/roles/0/proof_points/0")).toBe(3);
    expect(priority("/roles/0/metrics/0")).toBe(3);
    expect(priority("/roles/0/leadership_signals/0")).toBe(2);
    expect(priority("/roles/0/responsibilities/0")).toBe(1);
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
      (record) => record.fields?.["section"] === "proof_points",
    );
    expect(proof.map((record) => [record.text, record.locator])).toEqual([
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
      "Cut latency from 900ms to 120ms",
    );
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
          fields: { section, label },
          priority,
        })),
      );
    },
  );

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
        locator: `/context/candidatePreferences/${index}`,
      })),
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
