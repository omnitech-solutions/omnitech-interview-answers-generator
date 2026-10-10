import { describe, expect, it } from "vitest";
import { planCast } from "./cast";
import { resumeRunFields, SYNTHETIC_MATRIX } from "./fixtures/resume-run";
import {
  evidenceOf,
  fieldHash,
  figuresOf,
  namesOf,
  normalName,
  revisionConfirmations,
  standingConfirmations,
  verifyDocumentFields,
} from "./verify";

const fields = resumeRunFields();
const cast = planCast(fields, SYNTHETIC_MATRIX);
const keys = fields.map((field) => field.key);
// Verify one field's text, with every block's employer shown as cast.
function check(
  key: string,
  text: string,
  extra: Partial<Parameters<typeof verifyDocumentFields>[0]> = {},
) {
  return verifyDocumentFields({
    fields,
    values: {
      my_company_name: "Larkspur Works",
      contract_company1: "Tidewater Learning",
      contract_company2: "Plotline",
      contract_company3: "Fleetmark",
      contract_company4: "Backerly",
      prior_my_company1: "Ostrava Insurance Tech",
      earlier_exp_from: "2014",
      [key]: text,
    },
    checkedKeys: keys,
    matrix: SYNTHETIC_MATRIX,
    cast,
    ...extra,
  }).filter((issue) => issue.key === key);
}
const missing = (key: string, text: string) =>
  check(key, text).flatMap((issue) => issue.missing ?? []);

describe("figures", () => {
  it("reads a figure with its unit or percent sign, however it is written", () => {
    const key = (text: string) => figuresOf(text).map((figure) => figure.key);
    expect(key("cut latency by 40%")).toEqual(["40%"]);
    expect(key("40 percent")).toEqual(["40%"]);
    expect(key("40 %")).toEqual(["40%"]);
    expect(key("under 45ms and 45 ms")).toEqual(["45ms", "45ms"]);
    // A time, however its unit is written.
    expect(key("from 6h to 50min")).toEqual(["6h", "50min"]);
    expect(key("from 6 hours to 50 minutes")).toEqual(["6h", "50min"]);
    expect(key("8+ years and 3 months, 2 wks")).toEqual(["8y", "3mo", "2w"]);
    expect(key("5 engineers")).toEqual(["5"]);
    expect(key("2.1M assets")).toEqual(["2100000"]);
    expect(key("2.1 million assets")).toEqual(["2100000"]);
    expect(key("2,100,000 assets")).toEqual(["2100000"]);
    expect(key("$3k saved")).toEqual(["3000"]);
    expect(key("10+ engineers")).toEqual(["10"]);
    expect(key("PHP 8.x")).toEqual(["8"]);
    expect(key("3x faster")).toEqual(["3x"]);
    expect(key("from 2018–2020")).toEqual(["2018", "2020"]);
  });

  it("does not read a number inside a name, or a way of saying always, as a figure", () => {
    expect(figuresOf("S3, OAuth2 and k8s")).toEqual([]);
    expect(figuresOf("on call 24/7 with 1:1 mentoring")).toEqual([]);
  });

  it("fails a figure that is not in the role's entry and says where it does belong", () => {
    // Tidewater's entry has "6 weeks"; "45ms" is Plotline's; "70%" is nobody's.
    expect(
      missing("contract1_bullet1", "Finished the integration in 6 weeks"),
    ).toEqual([]);
    expect(missing("contract1_bullet1", "Cut search latency to 45ms")).toEqual([
      { text: "45ms", kind: "figure", foundIn: "Plotline" },
    ]);
    expect(missing("contract1_bullet1", "Raised conversion by 70%")).toEqual([
      { text: "70%", kind: "figure" },
    ]);
    expect(missing("contract1_bullet1", "Finished in 6 months")).toEqual([
      { text: "6 months", kind: "figure" },
    ]);
    // The same number with another unit is another figure.
    expect(missing("contract2_bullet1", "Served 45 customers")).toEqual([
      { text: "45", kind: "figure" },
    ]);
    expect(missing("contract3_bullet1", "Tracked 2.1 million assets")).toEqual(
      [],
    );
    expect(missing("contract3_bullet1", "Tracked 2,100,000 assets")).toEqual(
      [],
    );
  });
});

describe("proper nouns", () => {
  it("compares names without case, punctuation, a js ending or a plural", () => {
    expect(normalName("Node.js")).toBe(normalName("NodeJS"));
    expect(normalName("React.js")).toBe(normalName("react"));
    expect(normalName("APIs")).toBe(normalName("API"));
    expect(normalName("PostgreSQL")).toBe(normalName("Postgres"));
    expect(normalName("Café")).toBe("cafe");
    expect(normalName("C#")).toBe("c#");
    const evidence = evidenceOf("micro-frontends on Node.js with CI/CD");
    for (const name of ["microfrontends", "frontend", "node", "ci", "cd"])
      expect(evidence.names.has(normalName(name)), name).toBe(true);
  });

  it("finds the names a text claims, and leaves a sentence's first word alone", () => {
    const known = new Set(["laravel"]);
    expect(
      namesOf(
        "Led the GraphQL rollout on AWS for Tidewater. Built it in React.",
        {
          list: false,
          known,
        },
      ),
    ).toEqual(["GraphQL", "AWS", "Tidewater", "React"]);
    // A known name counts even as the first word.
    expect(
      namesOf("Laravel services were rebuilt", { list: false, known }),
    ).toEqual(["Laravel"]);
    // Generic engineering capitals name nothing.
    expect(
      namesOf("Owned the API and its CI pipeline, and the UI", {
        list: false,
        known,
      }),
    ).toEqual([]);
    // In a skills line an item is a claim; a phrase in sentence case is not a name.
    expect(
      namesOf("Kubernetes, Team leadership, Ruby on Rails, graphql", {
        list: true,
        known,
      }),
    ).toEqual(["Kubernetes", "Ruby", "Rails"]);
  });

  it("fails a bullet that names another employer's product, and names that employer", () => {
    // The original defect: a block for one company, bullets about another's work.
    expect(
      missing(
        "contract2_bullet1",
        "Integrated Tidewater Learning into the Compass platform using GraphQL",
      ),
    ).toEqual([
      { text: "Tidewater", kind: "name", foundIn: "Tidewater Learning" },
      { text: "Learning", kind: "name", foundIn: "Tidewater Learning" },
      { text: "Compass", kind: "name", foundIn: "Tidewater Learning" },
      { text: "GraphQL", kind: "name", foundIn: "Tidewater Learning" },
    ]);
    expect(
      check("contract2_bullet1", "Integrated Tidewater into Compass")[0],
    ).toMatchObject({
      code: "unsupported",
      against: "Plotline",
    });
    // The same text under its own employer passes.
    expect(
      check(
        "contract1_bullet1",
        "Integrated Tidewater Learning into the Compass platform using GraphQL",
      ),
    ).toEqual([]);
  });

  it("fails a technology that is another role's when it opens the sentence, and an invented one anywhere else", () => {
    expect(
      missing("contract4_bullet1", "Kafka pipelines were rebuilt"),
    ).toEqual([{ text: "Kafka", kind: "name", foundIn: "Fleetmark" }]);
    expect(
      missing("contract4_bullet1", "Rebuilt payouts on Kubernetes"),
    ).toEqual([{ text: "Kubernetes", kind: "name" }]);
    expect(
      missing(
        "contract4_bullet1",
        "Built referral payouts in Elixir and Phoenix",
      ),
    ).toEqual([]);
    // A client contract may name the consultancy it was delivered through.
    expect(
      missing("contract4_bullet1", "Delivered through Larkspur Works"),
    ).toEqual([]);
  });

  it("checks a block of several roles against all of them, and the shared skills line against the client roles", () => {
    expect(
      missing(
        "earlier_exp_bullet1",
        "Shipped provisioning in Java and Spring, then Redis sync",
      ),
    ).toEqual([]);
    expect(missing("earlier_exp_bullet1", "Shipped it on Kafka")).toEqual([
      { text: "Kafka", kind: "name", foundIn: "Fleetmark" },
    ]);
    expect(
      check("earlier_exp_bullet1", "Shipped it on Kafka")[0]?.against,
    ).toBe("3 roles");
    expect(
      missing("contracts_acquired_skills", "React, GraphQL, Kafka, Elixir"),
    ).toEqual([]);
    // Angular is the prior employer's, not a client's.
    expect(missing("contracts_acquired_skills", "React, Angular")).toEqual([
      { text: "Angular", kind: "name", foundIn: "Ostrava Insurance Tech" },
    ]);
  });

  it("checks a field with no role against the whole matrix, plus the employer applied to", () => {
    expect(
      missing(
        "summary_paragraph1",
        "Staff-level engineer across Laravel, Kafka and GraphQL, most recently at Northbeam Payments.",
      ),
    ).toEqual([]);
    expect(
      check("summary_paragraph1", "Deep Kubernetes experience")[0],
    ).toMatchObject({
      against: "your experience matrix",
      missing: [{ text: "Kubernetes", kind: "name" }],
    });
    expect(
      check(
        "summary_paragraph1",
        "Ready to join Zentrica as Principal Engineer",
        {
          allowed: ["Zentrica", "Principal Full Stack Engineer"],
        },
      ),
    ).toEqual([]);
    expect(
      check("summary_paragraph1", "Ready to join Zentrica").flatMap(
        (issue) => issue.missing ?? [],
      ),
    ).toEqual([{ text: "Zentrica", kind: "name" }]);
    expect(
      missing("architecture_skills", "Laravel, Kubernetes, Team leadership"),
    ).toEqual([{ text: "Kubernetes", kind: "name" }]);
  });
});

describe("what is and is not checked", () => {
  it("checks only the prose fields it is given, never an empty one, never one of a block that does not apply", () => {
    const text = "Rebuilt everything on Kubernetes";
    expect(check("contract2_bullet1", text, { checkedKeys: [] })).toEqual([]);
    expect(check("contract2_bullet1", "   ")).toEqual([]);
    // The block's employer is empty: the block does not apply.
    expect(
      verifyDocumentFields({
        fields,
        values: { contract_company2: "", contract2_bullet1: text },
        checkedKeys: keys,
        matrix: SYNTHETIC_MATRIX,
        cast,
      }),
    ).toEqual([]);
  });

  it("clears a field the person confirmed, until its text changes", () => {
    const text = "Rebuilt payouts on Kubernetes";
    const confirmed = { contract4_bullet1: fieldHash(text) };
    expect(check("contract4_bullet1", text, { confirmed })).toEqual([]);
    expect(
      check("contract4_bullet1", `${text} and Kafka`, { confirmed }).flatMap(
        (issue) => issue.missing ?? [],
      ),
    ).toEqual([
      { text: "Kubernetes", kind: "name" },
      { text: "Kafka", kind: "name", foundIn: "Fleetmark" },
    ]);
    expect(
      standingConfirmations(
        { a: fieldHash("kept"), b: fieldHash("old"), c: fieldHash("") },
        { a: "kept", b: "new", c: "" },
      ),
    ).toEqual({ a: fieldHash("kept") });
    expect(
      revisionConfirmations({ confirmedFields: { a: "h", b: 3 } }),
    ).toEqual({ a: "h" });
    expect(revisionConfirmations({ confirmedFields: ["a"] })).toEqual({});
    expect(revisionConfirmations(null)).toEqual({});
  });

  it("checks a block whose role is unknown against the whole matrix", () => {
    const issues = verifyDocumentFields({
      fields,
      values: {
        contract_company2: "Somebody Else Ltd",
        contract2_bullet1: "Used Kafka and Kubernetes",
      },
      checkedKeys: ["contract2_bullet1"],
      matrix: SYNTHETIC_MATRIX,
      cast: null,
    });
    expect(issues).toEqual([
      {
        key: "contract2_bullet1",
        code: "unsupported",
        against: "your experience matrix",
        missing: [{ text: "Kubernetes", kind: "name" }],
      },
    ]);
  });
});

describe("what the matrix says about a role outside its entry", () => {
  const matrix = {
    ...SYNTHETIC_MATRIX,
    leadership_signals: [
      {
        signal: "mentorship",
        evidence: [
          "Mentored 6 engineers at Northbeam, 2 promoted",
          "Ran 12 design reviews at Plotline",
        ],
      },
    ],
  };
  const under = (key: string, text: string) =>
    verifyDocumentFields({
      fields,
      values: { contract_company2: "Plotline", [key]: text },
      checkedKeys: [key],
      matrix,
      cast,
    }).flatMap((issue) => issue.missing ?? []);

  it("counts a line that names the employer as that role's evidence, and nobody else's", () => {
    expect(
      under(
        "current_experience_bullet1",
        "Mentored 6 engineers, with 2 promoted",
      ),
    ).toEqual([]);
    expect(under("contract2_bullet1", "Ran 12 design reviews")).toEqual([]);
    // Northbeam's mentoring is not Plotline's.
    expect(under("contract2_bullet1", "Mentored 6 engineers")).toEqual([
      { text: "6", kind: "figure", foundIn: "Northbeam Payments" },
    ]);
  });
});
