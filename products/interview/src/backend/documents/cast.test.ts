import { createAiEngine, type ModelInput } from "@omnitech/ai-engine";
import {
  type DocumentField,
  withFieldGroups,
} from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  acceptRanking,
  castFromValues,
  castRoles,
  castValues,
  decideCast,
  parsePeriod,
  planCast,
  rankingCandidates,
  revisionCast,
  roleLine,
} from "./cast";
import {
  FULLSTACK_POSTING,
  resumeRunFields,
  SYNTHETIC_MATRIX,
} from "./fixtures/resume-run";

const fields = resumeRunFields();
const company = (id: string) =>
  castRoles(SYNTHETIC_MATRIX).find((role) => role.id === id)?.company;
const companies = (ids: readonly string[] = []) => ids.map(company);
const field = (key: string): DocumentField => ({
  key,
  label: key,
  source: "candidate-profile",
  required: true,
  maxLength: null,
});

// A real engine over a scripted model: it records what it was asked and
// answers with `reply`, or fails as a provider would when `reply` throws.
function scripted(reply: (input: ModelInput) => unknown) {
  const asked: Array<{ system: string; prompt: string; schema: unknown }> = [];
  const engine = createAiEngine({
    profiles: [{ id: "document-profile", provider: "scripted" }],
    providers: {
      scripted: {
        async *stream(_scope, input) {
          const text = (role: string) =>
            input.messages
              .filter((message) => message.role === role)
              .flatMap((message) =>
                message.parts.map((part) =>
                  part.type === "text" ? part.text : "",
                ),
              )
              .join("");
          asked.push({
            system: text("system"),
            prompt: text("user"),
            schema: input.schema,
          });
          yield { type: "text", text: JSON.stringify(reply(input)) };
        },
      },
    },
  });
  return { engine, asked };
}
const asking = (candidacyValues: Record<string, string>) => ({
  tenantId: "00000000-0000-4000-8000-000000000001",
  actorId: "00000000-0000-4000-8000-000000000002",
  profileId: "document-profile",
  fields,
  matrix: SYNTHETIC_MATRIX,
  candidacyValues,
  signal: new AbortController().signal,
});
const posting = {
  company_name: "FullStack",
  role_title: "Principal Full Stack Engineer (React & AI-Driven)",
  job_description: FULLSTACK_POSTING,
};

describe("periods", () => {
  it("reads a range, a single year, an open period and month names", () => {
    expect(parsePeriod("2018–2020")).toMatchObject({
      from: "2018",
      to: "2020",
      open: false,
      fromYear: 2018,
      toYear: 2020,
    });
    expect(parsePeriod("2023")).toMatchObject({
      from: "2023",
      to: "2023",
      fromYear: 2023,
      toYear: 2023,
    });
    expect(parsePeriod("2024–Present")).toMatchObject({
      from: "2024",
      open: true,
      toYear: null,
    });
    expect(parsePeriod("July 2020 – September 2024")).toMatchObject({
      from: "July 2020",
      to: "September 2024",
      fromYear: 2020,
      toYear: 2024,
    });
    expect(parsePeriod("2019-2021")).toMatchObject({
      from: "2019",
      to: "2021",
    });
    expect(parsePeriod("")).toMatchObject({
      from: "",
      to: "",
      open: false,
      fromYear: null,
      toYear: null,
    });
  });
});

describe("the cast, decided in code", () => {
  it("puts the open role in the current block, the consultancy's clients in the contract blocks, the next employer in the prior block and the rest in earlier experience", () => {
    const cast = planCast(fields, SYNTHETIC_MATRIX);
    expect(companies(cast.slots["current"])).toEqual(["Northbeam Payments"]);
    expect(cast.consultancy).toBe("Larkspur Works");
    expect(companies(cast.slots["prior-1"])).toEqual([
      "Ostrava Insurance Tech",
    ]);
    expect(companies(cast.slots["earlier"])).toEqual([
      "Meridian Hours",
      "Quillon Networks",
      "Harrow & Finch",
    ]);
    expect(cast.unplaced).toEqual([]);
  });

  it("uses every role at most once", () => {
    const cast = planCast(fields, SYNTHETIC_MATRIX);
    // The consultancy block lists the client roles written under it; every
    // other block holds roles of its own.
    const held = Object.entries(cast.slots)
      .filter(([block]) => block !== "consultancy")
      .flatMap(([, ids]) => ids);
    expect(new Set(held).size).toBe(held.length);
    expect(held).not.toContain(cast.leftOut[0]);
    expect([...held, ...cast.leftOut].sort()).toEqual(
      castRoles(SYNTHETIC_MATRIX)
        .map((role) => role.id)
        .sort(),
    );
  });

  it("with more clients than contract blocks keeps four and leaves the fifth out, never as a prior employer", () => {
    expect(
      rankingCandidates(fields, SYNTHETIC_MATRIX).map((role) => role.company),
    ).toEqual([
      "Tidewater Learning",
      "Plotline",
      "Fleetmark",
      "Backerly",
      "Signalpath",
    ]);
    // No ranking: the four most recent, and it says so.
    const recent = planCast(fields, SYNTHETIC_MATRIX);
    expect(recent.ranking).toBe("recency");
    expect(
      [1, 2, 3, 4].map((slot) =>
        company(recent.slots[`contract-${slot}`]?.[0] ?? ""),
      ),
    ).toEqual(["Tidewater Learning", "Plotline", "Fleetmark", "Backerly"]);
    expect(companies(recent.leftOut)).toEqual(["Signalpath"]);
    expect(companies(recent.slots["prior-1"])).toEqual([
      "Ostrava Insurance Tech",
    ]);
    expect(companies(recent.slots["earlier"])).not.toContain("Signalpath");
    // Ranked by relevance: most relevant first, the least relevant left out.
    const ranked = planCast(fields, SYNTHETIC_MATRIX, {
      order: ["/roles/5", "/roles/1", "/roles/2", "/roles/3", "/roles/4"],
      by: "model",
    });
    expect(ranked.ranking).toBe("model");
    expect(
      [1, 2, 3, 4].map((slot) =>
        company(ranked.slots[`contract-${slot}`]?.[0] ?? ""),
      ),
    ).toEqual(["Signalpath", "Tidewater Learning", "Plotline", "Fleetmark"]);
    expect(companies(ranked.leftOut)).toEqual(["Backerly"]);
    expect(companies(ranked.slots["consultancy"])).toEqual([
      "Signalpath",
      "Tidewater Learning",
      "Plotline",
      "Fleetmark",
    ]);
    expect(companies(ranked.slots["prior-1"])).toEqual([
      "Ostrava Insurance Tech",
    ]);
  });

  it("needs no ranking when the clients fit the blocks", () => {
    const four = {
      ...SYNTHETIC_MATRIX,
      contracting_companies: [
        {
          ...SYNTHETIC_MATRIX.contracting_companies[0],
          clients: SYNTHETIC_MATRIX.contracting_companies[0]?.clients.slice(
            0,
            4,
          ),
        },
      ],
      roles: SYNTHETIC_MATRIX.roles.filter(
        (role) => role.company !== "Signalpath",
      ),
    };
    expect(rankingCandidates(fields, four)).toEqual([]);
    const cast = planCast(fields, four);
    expect(cast.ranking).toBe("none");
    expect(cast.leftOut).toEqual([]);
  });

  it("with no consultancy at all leaves that block and its contracts empty and treats every role as an employer", () => {
    const { contracting_companies: _none, ...rest } = SYNTHETIC_MATRIX;
    const plain = {
      ...rest,
      roles: rest.roles.map(({ engaged_through: _through, ...role }) => role),
    };
    const cast = planCast(fields, plain);
    expect(cast.consultancy).toBeNull();
    expect(cast.slots["consultancy"]).toBeUndefined();
    expect(cast.slots["contract-1"]).toBeUndefined();
    expect(cast.ranking).toBe("none");
    const roles = new Map(
      castRoles(plain).map((role) => [role.id, role.company]),
    );
    expect(roles.get(cast.slots["prior-1"]?.[0] ?? "")).toBe(
      "Tidewater Learning",
    );
    // The blocks with no role are filled with nothing, by the server.
    const values = castValues(fields, cast, plain);
    expect(values["my_company_name"]).toBe("");
    expect(values["contract_company2"]).toBe("");
    expect(values["contract2_bullet1"]).toBe("");
    expect(values["contracts_acquired_skills"]).toBe("");
    expect(values["prior_my_company1"]).toBe("Tidewater Learning");
    expect(Object.hasOwn(values, "prior_my_company1_bullet1")).toBe(false);
  });

  it("places a role with no dates last and leaves its dates blank", () => {
    const cast = planCast(fields, SYNTHETIC_MATRIX);
    expect(companies(cast.slots["earlier"]).at(-1)).toBe("Harrow & Finch");
    const undated = {
      candidate: { name: "Rowan" },
      roles: [
        { company: "Dateless Co", title: "Engineer" },
        { company: "Dated Co", title: "Lead", period: "2019–2021" },
      ],
    };
    const short = withFieldGroups([
      field("prior_my_company1"),
      field("prior_my_company1_from"),
      field("prior_my_company1_to"),
      field("prior_my_company2"),
      field("prior_my_company2_from"),
      field("prior_my_company2_to"),
    ]);
    const values = castValues(short, planCast(short, undated), undated);
    expect(values).toEqual({
      prior_my_company1: "Dated Co",
      prior_my_company1_from: "2019",
      prior_my_company1_to: "2021",
      prior_my_company2: "Dateless Co",
      prior_my_company2_from: "",
      prior_my_company2_to: "",
    });
  });

  it("fills each block's employer, title and dates from the cast, and the consultancy's from the matrix", () => {
    const cast = planCast(fields, SYNTHETIC_MATRIX);
    expect(castValues(fields, cast, SYNTHETIC_MATRIX)).toEqual({
      current_company: "Northbeam Payments",
      current_role: "Senior Software Developer / Architect",
      current_from: "2024",
      my_company_name: "Larkspur Works",
      my_company_role: "Lead Full Stack Developer / Architect / Contractor",
      my_company_from: "July 2020",
      my_company_to: "September 2024",
      contract_company1: "Tidewater Learning",
      contract_role1: "Lead Software Developer / Architect",
      contract_company2: "Plotline",
      contract_role2: "Senior Software Developer / Architect",
      contract_company3: "Fleetmark",
      contract_role3: "Senior Software Developer / Architect",
      contract_company4: "Backerly",
      contract_role4: "Senior Software Developer / Architect",
      prior_my_company1: "Ostrava Insurance Tech",
      prior_my_company1_role: "Lead Senior Software Developer / Architect",
      prior_my_company1_from: "2018",
      prior_my_company1_to: "2020",
      // Earlier experience spans its roles.
      earlier_exp_from: "2014",
      earlier_exp_to: "2018",
    });
  });

  it("ranks generic experience blocks by relevance and shows them most recent first", () => {
    const generic = withFieldGroups(
      [1, 2].flatMap((slot) => [
        field(`experience_${slot}_company`),
        field(`experience_${slot}_role`),
        field(`experience_${slot}_dates`),
        field(`experience_${slot}_bullet_1`),
      ]),
    );
    expect(rankingCandidates(generic, SYNTHETIC_MATRIX)).toHaveLength(10);
    const cast = planCast(generic, SYNTHETIC_MATRIX, {
      order: ["/roles/6", "/roles/1"],
      by: "model",
    });
    expect(companies(cast.slots["experience-1"])).toEqual([
      "Tidewater Learning",
    ]);
    expect(companies(cast.slots["experience-2"])).toEqual([
      "Ostrava Insurance Tech",
    ]);
    expect(castValues(generic, cast, SYNTHETIC_MATRIX)).toMatchObject({
      experience_1_dates: "2023",
      experience_2_dates: "2018 – 2020",
    });
    expect(cast.unplaced).toHaveLength(8);
  });

  it("reads the cast an older document implies from the employers it shows, using none twice", () => {
    const cast = castFromValues(
      fields,
      {
        current_company: "Northbeam Payments",
        contract_company1: "Signalpath",
        contract_company2: "Ostrava Insurance Tech",
        contract_company4: "Signalpath",
        my_company_name: "",
        prior_my_company1: "Somebody Else Ltd",
      },
      SYNTHETIC_MATRIX,
    );
    expect(companies(cast.slots["contract-1"])).toEqual(["Signalpath"]);
    expect(companies(cast.slots["contract-2"])).toEqual([
      "Ostrava Insurance Tech",
    ]);
    expect(cast.slots["contract-4"]).toBeUndefined();
    expect(cast.slots["prior-1"]).toBeUndefined();
    expect(cast.consultancy).toBeNull();
  });

  it("keeps a cast in a revision's provenance and reads nothing from one that has none", () => {
    const cast = planCast(fields, SYNTHETIC_MATRIX);
    expect(revisionCast({ cast: JSON.parse(JSON.stringify(cast)) })).toEqual(
      cast,
    );
    expect(revisionCast({ kind: "generated" })).toBeNull();
    expect(revisionCast({ cast: { version: 2 } })).toBeNull();
    expect(revisionCast(null)).toBeNull();
  });
});

describe("the ranking call", () => {
  it("accepts only an order of the roles it was asked about, each once", () => {
    const candidates = rankingCandidates(fields, SYNTHETIC_MATRIX);
    expect(
      acceptRanking({ order: ["/roles/5", "/roles/1"] }, candidates),
    ).toEqual(["/roles/5", "/roles/1"]);
    // An unknown role, a role that is not a candidate, a repeat, no order.
    expect(acceptRanking({ order: ["/roles/99"] }, candidates)).toBeNull();
    expect(acceptRanking({ order: ["/roles/6"] }, candidates)).toBeNull();
    expect(
      acceptRanking({ order: ["/roles/1", "/roles/1"] }, candidates),
    ).toBeNull();
    expect(acceptRanking({ order: [] }, candidates)).toBeNull();
    expect(acceptRanking("roles", candidates)).toBeNull();
  });

  it("asks the model only to order the clients, with a line each and the posting, and uses its valid answer", async () => {
    const { engine, asked } = scripted(() => ({
      order: ["/roles/5", "/roles/1", "/roles/2", "/roles/3", "/roles/4"],
    }));
    const kept: string[][] = [];
    const cast = await decideCast(engine, asking(posting), (order) => {
      kept.push(order);
    });
    expect(asked).toHaveLength(1);
    const prompt = JSON.parse(asked[0]?.prompt ?? "{}") as {
      posting: { jobDescription: string };
      roles: Array<{ id: string; summary: string }>;
    };
    expect(prompt.posting.jobDescription).toBe(FULLSTACK_POSTING);
    expect(prompt.roles.map((role) => role.id)).toEqual([
      "/roles/1",
      "/roles/2",
      "/roles/3",
      "/roles/4",
      "/roles/5",
    ]);
    // A line per role: never its detail (no proof point, no metric).
    expect(prompt.roles[0]?.summary).toBe(
      "Tidewater Learning — Lead Software Developer / Architect (2023); Ruby on Rails, React, GraphQL, PostgreSQL",
    );
    expect(asked[0]?.prompt).not.toContain("Compass");
    expect(asked[0]?.system).toContain("untrusted");
    expect(cast.ranking).toBe("model");
    expect(companies(cast.leftOut)).toEqual(["Backerly"]);
    expect(kept).toEqual([
      ["/roles/5", "/roles/1", "/roles/2", "/roles/3", "/roles/4"],
    ]);
  });

  it("refuses an answer that names an unknown role or one twice, and falls back to recency", async () => {
    for (const order of [
      ["/roles/5", "/roles/42"],
      ["/roles/5", "/roles/5"],
      ["/roles/0"],
    ]) {
      const { engine } = scripted(() => ({ order }));
      const kept: string[][] = [];
      const cast = await decideCast(engine, asking(posting), (answer) => {
        kept.push(answer);
      });
      expect(cast.ranking).toBe("refused");
      expect(companies(cast.leftOut)).toEqual(["Signalpath"]);
      expect(kept).toEqual([]);
    }
  });

  it("falls back to recency when the call fails, and makes no call without a posting or when code decides", async () => {
    const failing = scripted(() => {
      throw new Error("provider down");
    });
    const failed = await decideCast(failing.engine, asking(posting));
    expect(failed.ranking).toBe("unavailable");
    expect(companies(failed.leftOut)).toEqual(["Signalpath"]);

    const silent = scripted(() => ({ order: [] }));
    const general = await decideCast(silent.engine, asking({}));
    expect(general.ranking).toBe("recency");
    const fits = await decideCast(silent.engine, {
      ...asking(posting),
      matrix: {
        ...SYNTHETIC_MATRIX,
        roles: SYNTHETIC_MATRIX.roles.filter(
          (role) => role.company !== "Signalpath",
        ),
        contracting_companies: [
          {
            ...SYNTHETIC_MATRIX.contracting_companies[0],
            clients: [
              "Tidewater Learning",
              "Plotline",
              "Fleetmark",
              "Backerly",
            ],
          },
        ],
      },
    });
    expect(fits.ranking).toBe("none");
    expect(silent.asked).toHaveLength(0);
  });

  it("replays a ranking kept by an earlier try without asking again", async () => {
    const { engine, asked } = scripted(() => ({ order: ["/roles/1"] }));
    const cast = await decideCast(engine, {
      ...asking(posting),
      kept: ["/roles/5", "/roles/4", "/roles/3", "/roles/2", "/roles/1"],
    });
    expect(asked).toHaveLength(0);
    expect(cast.ranking).toBe("model");
    expect(companies(cast.leftOut)).toEqual(["Tidewater Learning"]);
  });

  it("describes a role in one line", () => {
    const [first] = castRoles(SYNTHETIC_MATRIX);
    expect(first && roleLine(first)).toBe(
      "Northbeam Payments — Senior Software Developer / Architect (2024–Present); Laravel, Vue.js, OpenAPI, MySQL",
    );
  });
});
