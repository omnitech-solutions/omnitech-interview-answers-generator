// Fix round 1 after the independent review of dev loop #2: every probe the
// reviewer reproduced (P1-P11) is a named regression here. The matrix is
// synthetic: placeholder employers and generic technologies only.
import type { CandidateMatrix } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  type Claim,
  type ClaimRef,
  figuresOf,
  LEAVING_REASON_PLACEHOLDER,
  nonGeneralFigures,
  supportTerms,
  verifyClaims,
} from "./claims";
import { buildContextSnapshot, type ContextSnapshot } from "./context-snapshot";

const MATRIX = {
  candidate: { name: "Candidate" },
  roles: [
    {
      company: "Example Corp",
      title: "Backend engineer",
      responsibilities: [
        "Led the migration of the order service to PostgreSQL",
        "Reviewed code for the platform team",
      ],
      metrics: [
        {
          label: "order query p95 latency after the PostgreSQL migration",
          value: "40% lower",
        },
      ],
    },
    {
      company: "Sample Labs",
      title: "Frontend engineer",
      responsibilities: [
        "Built a React dashboard for the support team",
        "Handled 40 support escalations per week",
      ],
    },
  ],
} as unknown as CandidateMatrix;
const PREFERENCES = "Notice period: 4 weeks.\nSalary expectation: negotiable.";

const snap = (preferences?: string): ContextSnapshot =>
  buildContextSnapshot({
    matrix: MATRIX,
    profile: { id: "p", revision: 1, sha256: "c".repeat(64) },
    draftRevision: 5,
    ...(preferences ? { candidatePreferences: preferences } : {}),
  });
const ref = (built: ContextSnapshot, pointer: string): ClaimRef => {
  const source = built.sources.find((item) => item.pointer === pointer);
  if (!source) throw new Error(`fixture pointer missing: ${pointer}`);
  return {
    sourceId: source.id,
    revision: source.revision,
    pointer,
    quote: source.text,
  };
};
const run = (
  claims: Claim[],
  options: {
    built?: ContextSnapshot;
    category?: string;
    captured?: string[];
    draft?: string;
    star?: { element: string; text: string; claimIndexes: number[] }[];
  } = {},
) => {
  const result = verifyClaims(claims, {
    snapshot: options.built ?? snap(),
    captured: options.captured ?? [],
    category: options.category ?? "experience-story",
    draft: options.draft,
    star: options.star,
  });
  return result.ok ? [] : [...result.violations];
};
const matrixClaim = (text: string, refs: ClaimRef[]): Claim => ({
  kind: "matrix-backed",
  text,
  refs,
});
const MIGRATION = "/roles/0/responsibilities/0";
const METRIC_LABEL = "/roles/0/metrics/0/label";

describe("finding 1: the spoken draft is grounded whatever the category", () => {
  it("P1: an experience-story draft with an invented employer fact and figures is rejected", () => {
    const violations = run([], {
      captured: ["We have 2500 engineers"],
      draft: "At Example Corp I led 2500 engineers and cut costs by 70%.",
    });
    expect(violations).toContain("draft:spoken_figure");
    expect(violations).toContain("draft:personal_claim_unsourced");
  });

  it("P2: a salary question classified as other cannot speak compensation or notice figures", () => {
    expect(
      run([], {
        category: "other",
        draft: "My expected salary is 150k and my notice period is 3 months.",
      }),
    ).toEqual(["draft:preference_only_topic"]);
  });

  it("lets a draft say compensation is missing, and speak a figure a preference claim carries", () => {
    expect(
      run([], {
        category: "other",
        draft: "I will confirm my salary expectation with you after the call.",
      }),
    ).toEqual([]);
    const built = snap(PREFERENCES);
    const claim: Claim = {
      kind: "preference-backed",
      text: "Notice period is 4 weeks",
      refs: [ref(built, "/context/candidatePreferences/0")],
    };
    expect(
      run([claim], {
        built,
        category: "other",
        draft: "My notice period is 4 weeks.",
      }),
    ).toEqual([]);
    expect(
      run([claim], {
        built,
        category: "other",
        draft: "My notice period is 6 weeks.",
      }),
    ).toEqual(["draft:preference_only_topic"]);
  });

  it("allows figures a verified matrix-backed claim carries and the general allowance", () => {
    const built = snap();
    const claim = matrixClaim(
      "At Example Corp order query p95 latency after the PostgreSQL migration was 40% lower",
      [ref(built, METRIC_LABEL)],
    );
    expect(
      run([claim], {
        built,
        draft:
          "At Example Corp the order query p95 latency was 40% lower after the PostgreSQL migration. A lookup is O(log n) and an HTTP 404 is not found, in 3 steps.",
      }),
    ).toEqual([]);
    expect(
      run([claim], {
        built,
        draft: "At Example Corp latency was 40% lower and cost 70% lower.",
      }),
    ).toEqual(["draft:ungrounded_figure"]);
  });

  it("documents the general-knowledge allowance", () => {
    expect(nonGeneralFigures("O(n^2), O(2^n), 3 retries and 10 steps")).toEqual(
      [],
    );
    expect(nonGeneralFigures("HTTP 404 and TLS 1.3 on port 443")).toEqual([]);
    expect(
      nonGeneralFigures("11 engineers, 40%, 5k users and 2021, 1,200"),
    ).toEqual(["11", "40%", "5k", "2021", "1200"]);
  });
});

describe("finding 2: leaving-role drafts carry no generated reason", () => {
  const leaving = (draft: string, claims: Claim[] = [], built = snap()) =>
    run(claims, { built, category: "leaving-role", draft });

  it("P3: the placeholder plus a reason sentence is rejected", () => {
    expect(
      leaving(
        `${LEAVING_REASON_PLACEHOLDER} I left because the role stopped growing and they cut my project.`,
      ),
    ).toEqual(["draft:generated_reason"]);
  });

  it("allows the placeholder alone and neutral sentences", () => {
    expect(leaving(LEAVING_REASON_PLACEHOLDER)).toEqual([]);
    expect(
      leaving(`Happy to cover what I built. ${LEAVING_REASON_PLACEHOLDER}`),
    ).toEqual([]);
  });

  it("allows a cue sentence only when a verified matrix-backed claim states it", () => {
    const built = snap();
    const claim = matrixClaim("Reviewed code for the platform team too", [
      ref(built, "/roles/0/responsibilities/1"),
    ]);
    // "too" is a lexicon cue; the claim text is the only licence for it.
    expect(
      leaving(
        `${LEAVING_REASON_PLACEHOLDER} Reviewed code for the platform team too.`,
        [claim],
        built,
      ),
    ).toEqual([]);
    expect(
      leaving(
        `${LEAVING_REASON_PLACEHOLDER} I wanted more scope.`,
        [claim],
        built,
      ),
    ).toEqual(["draft:generated_reason"]);
  });
});

describe("finding 3: STAR element text is supported by the cited claims' quotes", () => {
  it("P8: invented sentences each citing one real claim are rejected per element", () => {
    const built = snap();
    const claim = matrixClaim(
      "Led the migration of the order service to PostgreSQL",
      [ref(built, MIGRATION)],
    );
    const violations = run([claim], {
      built,
      star: [
        {
          element: "situation",
          text: "The data centre was failing in a flood.",
          claimIndexes: [0],
        },
        {
          element: "task",
          text: "I was asked to rescue the whole payments platform.",
          claimIndexes: [0],
        },
        {
          element: "action",
          text: "Led the migration of the order service to PostgreSQL.",
          claimIndexes: [0],
        },
        {
          element: "result",
          text: "Executives praised the rollout and awarded a promotion.",
          claimIndexes: [0],
        },
      ],
    });
    expect(violations).toEqual([
      "star.situation:unsupported_element",
      "star.task:unsupported_element",
      "star.result:unsupported_element",
    ]);
  });
});

describe("finding 4: an appended fabrication does not ride on a real paraphrase", () => {
  it("P4: appended clause fails; faithful paraphrase passes", () => {
    const built = snap();
    const quote = ref(built, MIGRATION);
    expect(
      run(
        [
          matrixClaim(
            "Led the migration of the order service to PostgreSQL and received the company excellence award",
            [quote],
          ),
        ],
        { built },
      ),
    ).toEqual(["claims.0.refs.0:unsupported_reference"]);
    expect(
      run([matrixClaim("Migrated the order service to PostgreSQL", [quote])], {
        built,
      }),
    ).toEqual([]);
  });

  it("treats three-letter capitals and short high-risk words as significant", () => {
    expect([...supportTerms("CEO of the AWS team using SQL")].sort()).toEqual(
      ["aws", "ceo", "sql", "team", "using"].sort(),
    );
    const built = snap();
    expect(
      run(
        [
          matrixClaim(
            "Led the migration of the order service to PostgreSQL as CTO",
            [ref(built, MIGRATION)],
          ),
        ],
        { built },
      ),
    ).toEqual(["claims.0.refs.0:unsupported_reference"]);
  });
});

describe("finding 5: one matrix-backed claim comes from one role and its employer", () => {
  it("P11: pooling a role-0 metric with a role-1 company is rejected", () => {
    const built = snap();
    expect(
      run(
        [
          matrixClaim(
            "At Sample Labs I cut order query p95 latency by 40% after the PostgreSQL migration",
            [ref(built, METRIC_LABEL), ref(built, "/roles/1/company")],
          ),
        ],
        { built },
      ),
    ).toEqual(["claims.0.refs:cross_role_references"]);
  });

  it("rejects an employer the cited role does not name, accepts the cited role's own", () => {
    const built = snap();
    const label = ref(built, METRIC_LABEL);
    expect(
      run(
        [
          matrixClaim(
            "At Sample Labs order query p95 latency fell after the PostgreSQL migration",
            [label],
          ),
        ],
        { built },
      ),
    ).toEqual(["claims.0.refs.0:unsupported_reference"]);
    expect(
      run(
        [
          matrixClaim(
            "At Example Corp order query p95 latency fell after the PostgreSQL migration",
            [label],
          ),
        ],
        { built },
      ),
    ).toEqual([]);
  });
});

describe("finding 6: the rule code follows D2/D3", () => {
  it("P5: not-in-matrix carries no figure, even one the interviewer said", () => {
    expect(
      run(
        [
          {
            kind: "not-in-matrix",
            text: "You managed 2500 engineers",
            refs: [],
          },
        ],
        {
          category: "other",
          captured: ["Tell me about when you managed 2500 engineers"],
        },
      ),
    ).toEqual(["claims.0:ungrounded_figure"]);
  });

  it("P9: a suggested interpretation carries no figure beyond the allowance", () => {
    expect(
      run(
        [
          {
            kind: "suggested-interpretation",
            text: "I want to keep migrating 12 services a year",
            refs: [],
          },
        ],
        { category: "motivation" },
      ),
    ).toEqual(["claims.0:ungrounded_figure"]);
    expect(
      run(
        [
          {
            kind: "suggested-interpretation",
            text: "I like 3 small steps",
            refs: [],
          },
        ],
        { category: "motivation" },
      ),
    ).toEqual([]);
  });

  it("keeps the percent sign significant", () => {
    expect([...figuresOf("up 40% and 40")]).toEqual(["40%", "40"]);
    const built = snap();
    const label = ref(built, METRIC_LABEL);
    const percent = (text: string) =>
      run([matrixClaim(text, [label])], { built });
    // The cited role's metric value is "40% lower": a bare 40 and "40%" are
    // both supported by it, "41%" is not.
    expect(
      percent("Order query latency fell 40% after the PostgreSQL migration"),
    ).toEqual([]);
    expect(
      percent("Order query latency fell 40 after the PostgreSQL migration"),
    ).toEqual([]);
    expect(
      percent("Order query latency fell 41% after the PostgreSQL migration"),
    ).toEqual(["claims.0.refs.0:unsupported_reference"]);
    // A bare number in the quote never supports a percent claim.
    const bare = ref(built, "/roles/1/responsibilities/1");
    expect(
      run(
        [matrixClaim("Handled 40% of support escalations per week", [bare])],
        {
          built,
        },
      ),
    ).toEqual(["claims.0.refs.0:unsupported_reference"]);
    expect(
      run([matrixClaim("Handled 40 support escalations per week", [bare])], {
        built,
      }),
    ).toEqual([]);
  });
});
