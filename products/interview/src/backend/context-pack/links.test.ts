// The links made in code between what a person prepared and what they did:
// which employer a note or a story names, which achievement's figure a note
// states, and which technologies a requirement names. No model is asked, so
// every rule here is one a person can check. Every name and figure is
// invented.
import type {
  CandidateMatrix,
  EmployerBrief,
} from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { BRIEF, HARBOURLINE, MATRIX, QUAYSIDE, TIDEWATER } from "./fixture";
import { type Links, linkSources, linksOf, roleOf } from "./links";
import { KINDS } from "./recipe";
import { briefSource, matrixSource } from "./sources";

const HARBOUR = "role:harbourline:staff-engineer";
const QUAY = "role:quayside-freight:senior-engineer";
const TIDE = "role:tidewater-labs:engineer";

const sourcesOf = (
  brief: Partial<EmployerBrief>,
  matrix: CandidateMatrix = MATRIX,
) =>
  linkSources([
    matrixSource(matrix, { id: "profile-1", revision: 3 }),
    briefSource({ ...BRIEF, ...brief }, { id: "c", revision: "r" }),
  ]);
const recordsOf = (
  brief: Partial<EmployerBrief>,
  matrix: CandidateMatrix = MATRIX,
) => sourcesOf(brief, matrix).flatMap((source) => source.records ?? []);
const linksFor = (
  text: string,
  brief: Partial<EmployerBrief>,
  matrix: CandidateMatrix = MATRIX,
): Links | undefined => {
  const record = recordsOf(brief, matrix).find((each) => each.text === text);
  if (!record) throw new Error(`no record says: ${text}`);
  return linksOf(record);
};
const note = (
  text: string,
  matrix: CandidateMatrix = MATRIX,
  more: Partial<EmployerBrief> = {},
) => linksFor(text, { prepNotes: [text], ...more }, matrix);
const idAt = (locator: string, matrix: CandidateMatrix = MATRIX) =>
  recordsOf({}, matrix).find((record) => record.locator === locator)?.id;

describe("an employer a note names", () => {
  it("is linked by its whole name, whatever the case", () => {
    expect(note("Invoices: the QUAYSIDE FREIGHT ledger review")?.roles).toEqual(
      [QUAY],
    );
    expect(note("Recent: Harbourline, then Tidewater Labs.")?.roles).toEqual([
      HARBOUR,
      TIDE,
    ]);
  });

  it("is linked by its first word when the material only ever writes that word as a name", () => {
    // "Quayside" for "Quayside Freight", "Tidewater" for "Tidewater Labs".
    expect(note("Proof: Quayside, 42000 invoices a day")?.roles).toEqual([
      QUAY,
    ]);
    expect(note("Booking flows: Tidewater's ferry crews")?.roles).toEqual([
      TIDE,
    ]);
  });

  it("is not linked by a first word the material also writes as a plain word", () => {
    const matrix = {
      ...MATRIX,
      roles: [
        { ...QUAYSIDE, company: "Relay Platform" },
        // Somebody wrote "relay" as a word: it is not a name here.
        { ...TIDEWATER, proof_points: ["Built a relay for ferry bookings"] },
      ],
    } as CandidateMatrix;
    expect(note("Proof: Relay, dock invoices", matrix)).toBeUndefined();
    expect(note("Proof: Relay Platform, dock invoices", matrix)?.roles).toEqual(
      ["role:relay-platform:senior-engineer"],
    );
  });

  it("is not linked by a first word two employers share, by one too short to be a name, or by the word in lower case", () => {
    const shared = {
      ...MATRIX,
      roles: [
        { ...QUAYSIDE, company: "Northgate Cable" },
        { ...TIDEWATER, company: "Northgate Rail" },
        { ...HARBOURLINE, company: "Arc Systems" },
      ],
    } as CandidateMatrix;
    expect(note("Proof: Northgate, the billing move", shared)).toBeUndefined();
    expect(note("Proof: Arc, the scheduler", shared)).toBeUndefined();
    expect(note("Proof: Arc Systems, the scheduler", shared)?.roles).toEqual([
      "role:arc-systems:staff-engineer",
    ]);
    expect(note("the quayside walk before the round")).toBeUndefined();
  });

  it("leaves a note that names nobody as it was", () => {
    const text = "Answer shape: context, decision, result.";
    const record = recordsOf({ prepNotes: [text] }).find(
      (each) => each.text === text,
    );
    expect(record?.fields).toEqual({
      section: "prepNotes",
      label: "prep notes",
      heading: ["Answer shape"],
    });
  });
});

describe("an achievement a note states the figure of", () => {
  it("is linked when the note says the figure with one of the achievement's own words beside it", () => {
    const links = note(
      "Latency: repartition, measure. Proof: Harbourline, p95 latency 120ms, 99.95% uptime",
    );
    expect(links?.roles).toEqual([HARBOUR]);
    expect(links?.achievements).toEqual([
      // The proof point that holds the 120ms metric, and the uptime metric.
      idAt("/roles/0/proof_points/0"),
      idAt("/roles/0/metrics/0"),
    ]);
  });

  it("is not linked by the figure alone: the same number about something else", () => {
    // "120ms" is the achievement's figure, said here of a deploy.
    expect(
      note("Proof: Harbourline; a deploy takes 120ms of downtime")
        ?.achievements,
    ).toEqual([]);
    // A share of one's time is not a metric of the role.
    const matrix = {
      ...MATRIX,
      roles: [
        {
          ...HARBOURLINE,
          metrics: [{ label: "defects", value: "60%", direction: "down" }],
        },
      ],
    } as CandidateMatrix;
    expect(
      note("About me: Harbourline; 60% implementation, 40% design", matrix)
        ?.achievements,
    ).toEqual([]);
    expect(
      note("Quality: Harbourline; 60% fewer defects", matrix)?.achievements,
    ).toEqual([idAt("/roles/0/metrics/0", matrix)]);
  });

  it("is only ever an achievement of an employer the note names", () => {
    // Quayside's figure, in a note that names Harbourline alone.
    expect(
      note("Proof: Harbourline, 42000 invoices per day")?.achievements,
    ).toEqual([]);
  });

  it("is not tied by one bare digit, or by the year of the role", () => {
    const matrix = {
      ...MATRIX,
      roles: [
        {
          ...HARBOURLINE,
          metrics: [{ label: "squads", value: "6" }],
        },
      ],
    } as CandidateMatrix;
    expect(
      note("Proof: Harbourline, 6 squads, since 2022", matrix)?.achievements,
    ).toEqual([]);
  });
});

describe("a story the person chose", () => {
  it("is linked to the employers it names, primary and backup", () => {
    const matrix = {
      ...MATRIX,
      story_selector: [
        {
          need: "identity",
          primary_story: "Quayside Freight",
          backup_story: "Tidewater Labs",
        },
        { need: "a failure", primary_story: "The lost manifest" },
      ],
    } as CandidateMatrix;
    const stories = recordsOf({}, matrix).filter(
      (record) => record.kind === KINDS.story,
    );
    expect(stories.map((story) => linksOf(story)?.roles)).toEqual([
      [QUAY, TIDE],
      // A story that names no employer links nothing.
      undefined,
    ]);
  });
});

describe("a requirement and the technologies it names", () => {
  const brief = {
    mustHaves: [
      "Strong PostgreSQL and Go on the server; Elixir preferred",
      "Clear written communication",
    ],
    techStack: ["Elixir", "Postgres", "Phoenix LiveView dashboards"],
  };

  it("keeps the technologies it names, the person's and the employer's", () => {
    const requirement = recordsOf(brief).find((record) =>
      record.text.startsWith("Strong PostgreSQL"),
    );
    expect(requirement?.fields?.["technologies"]).toEqual([
      "Go",
      "PostgreSQL",
      "Elixir",
    ]);
    // "Postgres" is "PostgreSQL", kept once by the person's own name for it;
    // a phrase gives the words written as names.
    expect(
      recordsOf(brief).find((record) => record.text === "Postgres")?.fields?.[
        "technologies"
      ],
    ).toEqual(["PostgreSQL"]);
    expect(
      recordsOf(brief).find((record) =>
        record.text.startsWith("Phoenix LiveView"),
      )?.fields?.["technologies"],
    ).toEqual(["Phoenix", "LiveView"]);
  });

  it("is linked to the person's own technologies among them", () => {
    expect(
      linksFor(
        "Strong PostgreSQL and Go on the server; Elixir preferred",
        brief,
      ),
    ).toEqual({
      achievements: [],
      roles: [],
      technologies: ["Go", "PostgreSQL"],
      through: [],
    });
  });

  it("has no technologies and no link when it names none", () => {
    const plain = recordsOf(brief).find(
      (record) => record.text === "Clear written communication",
    );
    expect(plain?.fields).toEqual({
      section: "mustHaves",
      label: "must have requirements required",
    });
  });

  // The person's record never says "Elixir"; their own note ties it to the
  // one employer it names.
  it("is tied to an employer through a note that says the technology and names exactly one employer", () => {
    const tied = {
      ...brief,
      prepNotes: [
        "Recent work: Harbourline; a Go scheduler beside an Elixir gateway.",
      ],
    };
    expect(
      linksFor("Strong PostgreSQL and Go on the server; Elixir preferred", tied)
        ?.through,
    ).toEqual([{ technology: "Elixir", roles: [HARBOUR] }]);
    expect(linksFor("Elixir", tied)).toEqual({
      achievements: [],
      roles: [],
      technologies: [],
      through: [{ technology: "Elixir", roles: [HARBOUR] }],
    });
  });

  it("is tied to no employer by a note that names two, or by a question to ask", () => {
    const two = {
      ...brief,
      prepNotes: ["Elixir: seen at Harbourline and at Quayside Freight."],
    };
    expect(linksFor("Elixir", two)).toBeUndefined();
    const asked = {
      ...brief,
      questionsToAsk: ["How much Elixir did Harbourline's team run?"],
    };
    expect(linksFor("Elixir", asked)).toBeUndefined();
  });
});

describe("what a link is kept as", () => {
  it("is an object selection never matches on, beside the fields the record had", () => {
    const text = "Proof: Quayside, 42000 invoices a day";
    const record = recordsOf({ prepNotes: [text] }).find(
      (each) => each.text === text,
    );
    expect(record?.fields).toEqual({
      section: "prepNotes",
      label: "prep notes",
      links: {
        roles: [QUAY],
        achievements: [idAt("/roles/1/metrics/0")],
        technologies: [],
      },
    });
    // Not a string and not a list of strings: the engine reads neither.
    expect(typeof record?.fields?.["links"]).toBe("object");
    expect(Array.isArray(record?.fields?.["links"])).toBe(false);
  });

  it("changes no identity, kind, text or place, and adds no record", () => {
    const plain = [
      matrixSource(MATRIX, { id: "profile-1", revision: 3 }),
      briefSource(BRIEF, { id: "c", revision: "r" }),
    ];
    const linked = linkSources(plain);
    expect(
      linked.map(({ id, revision, kind }) => [id, revision, kind]),
    ).toEqual(plain.map(({ id, revision, kind }) => [id, revision, kind]));
    const flat = (sources: typeof plain) =>
      sources.flatMap((source) =>
        (source.records ?? []).map(({ id, kind, text, locator, priority }) => ({
          id,
          kind,
          text,
          locator,
          priority,
        })),
      );
    expect(flat(linked)).toEqual(flat(plain));
  });

  it("is nothing without a matrix: there is no role to name", () => {
    const alone = [briefSource(BRIEF, { id: "c", revision: "r" })];
    expect(linkSources(alone)).toEqual(alone);
    expect(linkSources([])).toEqual([]);
  });

  it("says which role an achievement is of, and nothing for any other record", () => {
    const records = recordsOf({});
    for (const record of records)
      expect(roleOf(record) !== undefined, record.id).toBe(
        record.kind === KINDS.achievement,
      );
    expect(
      roleOf(
        records.find(
          (record) => record.locator === "/roles/1/proof_points/0",
        ) ?? {},
      ),
    ).toBe(QUAY);
    expect(linksOf({ fields: { links: ["not", "an", "object"] } })).toBe(
      undefined,
    );
  });
});
