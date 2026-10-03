import type { CandidateMatrix } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  CLAIM_KINDS,
  type Claim,
  type ClaimRef,
  disparagesEmployer,
  figuresOf,
  MAX_REFS_PER_CLAIM,
  MIN_SUPPORT_SHARE,
  significantWords,
  summarizeClaims,
  verifyClaims,
} from "./claims.js";
import {
  buildContextSnapshot,
  type ContextSnapshot,
} from "./context-snapshot.js";

const MATRIX = {
  candidate: { name: "Candidate" },
  roles: [
    {
      company: "Example Corp",
      title: "Engineer",
      responsibilities: [
        "Built  Streaming   pipelines for event ingestion",
        "Reduced latency by 4M+ requests and 1,200 jobs",
        "Used S3 for archival storage",
      ],
      metrics: [{ label: "errors", value: "2k" }],
    },
  ],
} as unknown as CandidateMatrix;
const snap = (
  options: Partial<Parameters<typeof buildContextSnapshot>[0]> = {},
): ContextSnapshot =>
  buildContextSnapshot({
    matrix: MATRIX,
    profile: { id: "p", revision: 1, sha256: "c".repeat(64) },
    draftRevision: 5,
    ...options,
  });
const ref = (
  built: ContextSnapshot,
  pointer: string,
  quote?: string,
): ClaimRef => {
  const source = built.sources.find((item) => item.pointer === pointer);
  if (!source) throw new Error("fixture pointer missing");
  return {
    sourceId: source.id,
    revision: source.revision,
    pointer,
    quote: quote ?? source.text,
  };
};
const run = (
  claims: Claim[],
  built = snap(),
  category = "experience-story",
  captured: string[] = [],
  draft?: string,
) => {
  const result = verifyClaims(claims, {
    snapshot: built,
    captured,
    category,
    draft,
  });
  return result.ok ? [] : result.violations;
};
const matrixClaim = (text: string, refs: ClaimRef[]): Claim => ({
  kind: "matrix-backed",
  text,
  refs,
});
const R0 = "/roles/0/responsibilities/0";

describe("matrix-backed", () => {
  it("accepts a supported claim with a quote that differs only in case and whitespace", () => {
    const built = snap();
    expect(
      run(
        [
          matrixClaim("Built streaming pipelines for event ingestion", [
            ref(built, R0, "built streaming pipelines for\n event ingestion"),
          ]),
        ],
        built,
      ),
    ).toEqual([]);
  });

  it("needs at least one ref", () => {
    expect(run([matrixClaim("Built pipelines", [])])).toEqual([
      "claims.0.refs:missing_reference",
    ]);
  });

  it("rejects an empty or whitespace-only quote", () => {
    const built = snap();
    expect(
      run([matrixClaim("Built pipelines", [ref(built, R0, "  ")])], built),
    ).toEqual(["claims.0.refs.0:quote_mismatch"]);
  });

  it("names the reference path of every bad ref", () => {
    const built = snap();
    const good = ref(built, R0);
    expect(
      run(
        [
          matrixClaim("Built streaming pipelines", [
            good,
            { ...good, sourceId: "nope" },
            { ...good, quote: "something else" },
          ]),
        ],
        built,
      ),
    ).toEqual([
      "claims.0.refs.1:unknown_reference",
      "claims.0.refs.2:quote_mismatch",
    ]);
  });

  it("treats duplicate refs as harmless", () => {
    const built = snap();
    const good = ref(built, R0);
    expect(
      run([matrixClaim("Built streaming pipelines", [good, good])], built),
    ).toEqual([]);
  });

  it("refuses a ref to an employer-context or preference source", () => {
    const built = snap({
      employer: { jobDescription: "Build streaming pipelines." },
      candidatePreferences: "Prefers remote work.",
    });
    expect(
      run(
        [
          matrixClaim("Build streaming pipelines", [
            ref(built, "/context/jobDescription/0"),
          ]),
        ],
        built,
      ),
    ).toEqual(["claims.0.refs.0:wrong_source_kind"]);
  });

  it("refuses any claim when the snapshot has no pinned profile", () => {
    const withMatrix = snap();
    const noMatrix = buildContextSnapshot({
      matrix: null,
      profile: null,
      candidatePreferences: "Prefers remote work.",
    });
    expect(
      run([matrixClaim("Built pipelines", [ref(withMatrix, R0)])], noMatrix),
    ).toEqual(["claims.0.refs.0:unknown_reference"]);
  });

  it("limits the number of refs", () => {
    const built = snap();
    const good = ref(built, R0);
    const many = Array.from({ length: MAX_REFS_PER_CLAIM + 1 }, () => good);
    expect(
      run([matrixClaim("Built streaming pipelines", many)], built),
    ).toEqual(["claims.0.refs:too_many_references"]);
  });

  it("requires every claim figure in the cited quotes and honours suffixes, commas and lower bounds", () => {
    const built = snap();
    const reduced = ref(built, "/roles/0/responsibilities/1");
    const ok = (text: string) => run([matrixClaim(text, [reduced])], built);
    expect(ok("Reduced latency by 4M+ requests")).toEqual([]);
    expect(ok("Reduced latency by 4m requests")).toEqual([]);
    expect(ok("Reduced latency across 1200 jobs")).toEqual([]);
    expect(ok("Reduced latency across 1,200 jobs")).toEqual([]);
    expect(ok("Reduced latency by 5M requests")).toEqual([
      "claims.0.refs.0:unsupported_reference",
    ]);
    // An unstated lower bound is an overclaim.
    const exact = ref(built, R0);
    expect(run([matrixClaim("Built 4M+ pipelines", [exact])], built)).toEqual([
      "claims.0.refs.0:unsupported_reference",
    ]);
  });

  it("accepts a metric figure only for a cited entry of the same role", () => {
    const built = snap();
    expect(
      run(
        [
          matrixClaim("Reduced errors to 2k", [
            ref(built, "/roles/0/metrics/0/label"),
          ]),
        ],
        built,
      ),
    ).toEqual([]);
    expect(
      run(
        [
          matrixClaim("Reduced errors to 3k", [
            ref(built, "/roles/0/metrics/0/label"),
          ]),
        ],
        built,
      ),
    ).toEqual(["claims.0.refs.0:unsupported_reference"]);
  });

  it("does not treat identifiers like S3 as figures", () => {
    const built = snap();
    expect([...figuresOf("Used S3 and ec2 on k8s")]).toEqual([]);
    expect(
      run(
        [
          matrixClaim("Used S3 for archival storage", [
            ref(built, "/roles/0/responsibilities/2"),
          ]),
        ],
        built,
      ),
    ).toEqual([]);
  });

  it("applies the documented overlap threshold", () => {
    expect(MIN_SUPPORT_SHARE).toBe(0.5);
    const built = snap();
    const quote = ref(built, R0);
    // significant: build, streaming, pipeline, ingestion (+ extras)
    expect(
      run(
        [
          matrixClaim("Built streaming pipelines with ingestion tooling", [
            quote,
          ]),
        ],
        built,
      ),
    ).toEqual([]); // 4 of 5
    expect(
      run(
        [
          matrixClaim(
            "Built streaming gateways, schedulers, kubernetes tooling",
            [quote],
          ),
        ],
        built,
      ),
    ).toEqual(["claims.0.refs.0:unsupported_reference"]); // 2 of 5
    // A claim with no significant words shows nothing to support.
    expect(run([matrixClaim("I did it", [quote])], built)).toEqual([
      "claims.0.refs.0:unsupported_reference",
    ]);
  });

  it("pools the cited quotes for the overlap and never other entries", () => {
    const built = snap();
    const claim = "Built streaming pipelines and managed archival storage";
    expect(run([matrixClaim(claim, [ref(built, R0)])], built)).toEqual([
      "claims.0.refs.0:unsupported_reference",
    ]);
    expect(
      run(
        [
          matrixClaim(claim, [
            ref(built, R0),
            ref(built, "/roles/0/responsibilities/2"),
          ]),
        ],
        built,
      ),
    ).toEqual([]);
  });
});

describe("preference-backed", () => {
  const prefs = "Notice period: 4 weeks.\nSalary expectation: negotiable.";
  it("accepts a supported claim and rejects matrix refs", () => {
    const built = snap({ candidatePreferences: prefs });
    expect(
      run(
        [
          {
            kind: "preference-backed",
            text: "My notice period is 4 weeks",
            refs: [ref(built, "/context/candidatePreferences/0")],
          },
        ],
        built,
        "logistics",
      ),
    ).toEqual([]);
    expect(
      run(
        [
          {
            kind: "preference-backed",
            text: "Notice period is 4 weeks",
            refs: [ref(built, R0)],
          },
        ],
        built,
        "logistics",
      ),
    ).toEqual(["claims.0.refs.0:wrong_source_kind"]);
  });

  it("rejects a stale draft revision and a missing ref", () => {
    const built = snap({ candidatePreferences: prefs });
    const good = ref(built, "/context/candidatePreferences/0");
    const claim = (refs: ClaimRef[]): Claim => ({
      kind: "preference-backed",
      text: "Notice period is 4 weeks",
      refs,
    });
    expect(
      run([claim([{ ...good, revision: 4 }])], built, "logistics"),
    ).toEqual(["claims.0.refs.0:stale_revision"]);
    expect(run([claim([])], built, "logistics")).toEqual([
      "claims.0.refs:missing_reference",
    ]);
  });

  it("allows notice or compensation wording only as preference-backed", () => {
    const built = snap({ candidatePreferences: prefs });
    expect(
      run([matrixClaim("Salary was good", [ref(built, R0)])], built),
    ).toContain("claims.0:preference_only_topic");
    expect(
      run(
        [
          {
            kind: "suggested-interpretation",
            text: "The notice period matters",
            refs: [],
          },
        ],
        built,
      ),
    ).toContain("claims.0:preference_only_topic");
    expect(
      run(
        [{ kind: "not-in-matrix", text: "Salary of the role", refs: [] }],
        built,
      ),
    ).toEqual(["claims.0:preference_only_topic"]);
  });

  it("rejects any non-preference figure in logistics but allows words", () => {
    const built = snap({ candidatePreferences: prefs });
    expect(
      run(
        [
          {
            kind: "suggested-interpretation",
            text: "Remote works for me",
            refs: [],
          },
        ],
        built,
        "logistics",
      ),
    ).toEqual([]);
    expect(
      run(
        [
          {
            kind: "suggested-interpretation",
            text: "Around 3 days remote",
            refs: [],
          },
        ],
        built,
        "logistics",
      ),
    ).toEqual(["claims.0:ungrounded_logistics_figure"]);
    expect(
      run(
        [matrixClaim("Built 4M+ pipelines", [ref(built, R0)])],
        built,
        "logistics",
      ),
    ).toContain("claims.0:ungrounded_logistics_figure");
    expect(
      run(
        [{ kind: "not-in-matrix", text: "Offer of 9 days", refs: [] }],
        built,
        "logistics",
      ),
    ).toEqual(["claims.0:ungrounded_logistics_figure"]);
  });

  it("accepts a draft figure that a preference-backed claim carries", () => {
    const built = snap({ candidatePreferences: prefs });
    const claim: Claim = {
      kind: "preference-backed",
      text: "Notice period is 4 weeks",
      refs: [ref(built, "/context/candidatePreferences/0")],
    };
    expect(
      run([claim], built, "logistics", [], "My notice is 4 weeks."),
    ).toEqual([]);
    expect(
      run([claim], built, "logistics", [], "Four weeks, so 4 weeks."),
    ).toEqual(["draft:ungrounded_logistics_figure"]);
    expect(run([claim], built, "logistics", [], "Maybe 6 weeks.")).toEqual([
      "draft:ungrounded_logistics_figure",
    ]);
  });
});

describe("suggested-interpretation and general-knowledge", () => {
  const spoken = ["The role has 300 reports"];
  it("carry no refs", () => {
    const built = snap();
    for (const kind of [
      "suggested-interpretation",
      "general-knowledge",
    ] as const)
      expect(
        run(
          [
            {
              kind,
              text: "Idempotency makes retries safe",
              refs: [ref(built, R0)],
            },
          ],
          built,
        ),
      ).toEqual(["claims.0.refs:unexpected_reference"]);
  });

  it("rejects a spoken figure that no source holds, in either kind", () => {
    for (const kind of [
      "suggested-interpretation",
      "general-knowledge",
    ] as const)
      expect(
        run(
          [{ kind, text: "Managing 300 reports takes delegation", refs: [] }],
          snap(),
          "other",
          spoken,
        ),
      ).toEqual(["claims.0:spoken_figure"]);
  });

  it("refuses a figure outside the general allowance even when a snapshot source also holds it", () => {
    // Fix round 1 (D2/D3): general-knowledge cites nothing, so a headcount is
    // unsourced however many places hold it; it is not the spoken-figure
    // hazard (a source holds it), it is simply ungrounded.
    expect(
      run(
        [
          {
            kind: "general-knowledge",
            text: "Managing 300 reports takes delegation",
            refs: [],
          },
        ],
        snap({ employer: { jobDescription: "Own a group with 300 reports." } }),
        "other",
        spoken,
      ),
    ).toEqual(["claims.0:ungrounded_figure"]);
  });

  it("lets general-knowledge carry technical figures but not suggested-interpretation", () => {
    expect(
      run([
        {
          kind: "general-knowledge",
          text: "An HTTP 404 means not found",
          refs: [],
        },
      ]),
    ).toEqual([]);
    expect(
      run([
        {
          kind: "suggested-interpretation",
          text: "I enjoy 12 hour focus blocks",
          refs: [],
        },
      ]),
    ).toEqual(["claims.0:ungrounded_figure"]);
  });

  it("makes no personal claim in general-knowledge", () => {
    const make = (text: string): Claim => ({
      kind: "general-knowledge",
      text,
      refs: [],
    });
    expect(run([make("Idempotency keys let retries be safe")])).toEqual([]);
    expect(run([make("I worked at the company for years")])).toEqual([
      "claims.0:personal_claim_unsourced",
    ]);
    expect(run([make("Our team shipped it last year")])).toEqual([
      "claims.0:personal_claim_unsourced",
    ]);
    expect(run([make("Example Corp was great")])).toEqual([
      "claims.0:personal_claim_unsourced",
    ]);
    // First person alone is not enough.
    expect(run([make("I would use a queue here")])).toEqual([]);
  });
});

describe("not-in-matrix", () => {
  it("is allowed with no refs and refuses refs", () => {
    const built = snap();
    expect(
      run(
        [{ kind: "not-in-matrix", text: "You led a data migration", refs: [] }],
        built,
      ),
    ).toEqual([]);
    expect(
      run(
        [
          {
            kind: "not-in-matrix",
            text: "You led a data migration",
            refs: [ref(built, R0)],
          },
        ],
        built,
      ),
    ).toEqual(["claims.0.refs:unexpected_reference"]);
  });

  it("carries no figure, even one the interviewer said", () => {
    // Fix round 1 (D2/D3): a spoken figure in a not-in-matrix claim would
    // re-state the interviewer's unverified claim as a fact.
    expect(
      run(
        [{ kind: "not-in-matrix", text: "You managed 12 engineers", refs: [] }],
        snap(),
        "other",
        ["You managed 12 engineers, right?"],
      ),
    ).toEqual(["claims.0:ungrounded_figure"]);
    expect(
      run([
        { kind: "not-in-matrix", text: "You managed 12 engineers", refs: [] },
      ]),
    ).toEqual(["claims.0:ungrounded_figure"]);
  });
});

describe("leaving-role", () => {
  it("allows no generated suggested or general claim", () => {
    for (const kind of [
      "suggested-interpretation",
      "general-knowledge",
    ] as const)
      expect(
        run(
          [{ kind, text: "Growth opportunities were limited", refs: [] }],
          snap(),
          "leaving-role",
        ),
      ).toContain("claims.0:generated_reason");
    expect(
      run(
        [
          {
            kind: "suggested-interpretation",
            text: "Growth opportunities were limited",
            refs: [],
          },
        ],
        snap(),
        "other",
      ),
    ).toEqual([]);
  });
});

describe("disparagement", () => {
  it("flags harsh judgement of employers across every kind and the draft", () => {
    for (const text of [
      "The company culture was toxic",
      "My old boss was an idiot",
      "I hated the management",
      "They micromanaged everything",
      "The leadership was incompetent",
    ])
      expect(disparagesEmployer(text)).toBe(true);
    expect(
      run([
        {
          kind: "not-in-matrix",
          text: "The company culture was toxic",
          refs: [],
        },
      ]),
    ).toEqual(["claims.0:disparages_employer"]);
    expect(
      run([], snap(), "other", [], "Honestly the leadership was incompetent"),
    ).toEqual(["draft:disparages_employer"]);
  });

  it("leaves technical and neutral wording alone", () => {
    for (const text of [
      "A toxicity classifier flags abusive comments",
      "A terrible bug taught me to add tests",
      "The team moved to a new roadmap",
      "I wanted a larger scope",
    ])
      expect(disparagesEmployer(text)).toBe(false);
  });
});

describe("shape", () => {
  it("rejects an unknown kind by path", () => {
    expect(
      run([{ kind: "invented", text: "x", refs: [] } as unknown as Claim]),
    ).toEqual(["claims.0.kind:unknown_kind"]);
  });

  it("accepts an empty claim list and lists several violations in order without duplicates", () => {
    expect(run([])).toEqual([]);
    expect(
      run([
        matrixClaim("a", []),
        {
          kind: "general-knowledge",
          text: "I worked at the company",
          refs: [],
        },
      ]),
    ).toEqual([
      "claims.0.refs:missing_reference",
      "claims.1:personal_claim_unsourced",
    ]);
  });

  it("summarizes claims as counts per kind", () => {
    expect(summarizeClaims([])).toEqual(
      Object.fromEntries(CLAIM_KINDS.map((kind) => [kind, 0])),
    );
    expect(
      summarizeClaims([
        { kind: "matrix-backed", text: "x", refs: [] },
        { kind: "matrix-backed", text: "y", refs: [] },
        { kind: "not-in-matrix", text: "z", refs: [] },
      ]),
    ).toEqual({
      "matrix-backed": 2,
      "preference-backed": 0,
      "suggested-interpretation": 0,
      "general-knowledge": 0,
      "not-in-matrix": 1,
    });
  });

  it("derives significant words with light stemming", () => {
    expect([...significantWords("Migrated the services")].sort()).toEqual([
      "migrat",
      "servic",
    ]);
    expect(significantWords("Migration of service")).toEqual(
      significantWords("migrate service"),
    );
  });
});
