// Named grounding evaluation cases (PB-0002 Evidence: "an evaluation case shows
// a reference to an existing entry that does not support the claim is
// rejected") over a SYNTHETIC matrix: placeholder employer, generic roles and
// technologies only.
import { createHash } from "node:crypto";
import type { CandidateMatrix } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  type Claim,
  type ClaimRef,
  LEAVING_REASON_PLACEHOLDER,
  verifyClaims,
} from "./claims.js";
import {
  buildContextSnapshot,
  type ContextSnapshot,
} from "./context-snapshot.js";

const PROFILE = { id: "profile-eval", revision: 4, sha256: "b".repeat(64) };
const MATRIX = {
  candidate: { name: "Candidate", headline: "Software engineer" },
  roles: [
    {
      company: "Example Corp",
      title: "Frontend engineer",
      period: "2019-2021",
      technologies: ["React"],
      responsibilities: ["Built React components for the checkout flow"],
    },
    {
      company: "Example Corp",
      title: "Backend engineer",
      period: "2021-2024",
      technologies: ["PostgreSQL", "Node"],
      responsibilities: [
        "Migrated the orders database to PostgreSQL",
        "Maintained REST services on Node",
      ],
      metrics: [{ label: "uptime", value: "99.9%" }],
    },
  ],
} as unknown as CandidateMatrix;
const PREFERENCES = "Notice period: 4 weeks.\nSalary expectation: negotiable.";

const snapshot = (candidatePreferences?: string): ContextSnapshot =>
  buildContextSnapshot({
    matrix: MATRIX,
    profile: PROFILE,
    candidatePreferences,
    draftRevision: 2,
  });

const ref = (
  built: ContextSnapshot,
  pointer: string,
  quote?: string,
): ClaimRef => {
  const source = built.sources.find((item) => item.pointer === pointer);
  if (!source) throw new Error(`fixture pointer missing: ${pointer}`);
  return {
    sourceId: source.id,
    revision: source.revision,
    pointer,
    quote: quote ?? source.text,
  };
};

const verify = (
  claims: Claim[],
  built: ContextSnapshot,
  category = "experience-story",
  captured: string[] = [],
  draft?: string,
) => verifyClaims(claims, { snapshot: built, captured, category, draft });

const violationsOf = (result: ReturnType<typeof verify>) =>
  result.ok ? [] : result.violations;

describe("grounding evaluation", () => {
  it("eval: a reference to an EXISTING entry that does not support the claim is rejected", () => {
    const built = snapshot();
    // The snapshot DOES hold PostgreSQL entries elsewhere; verification must
    // judge the cited entry only and never rescue the claim from another one.
    expect(
      built.sources.some((source) => source.text.includes("PostgreSQL")),
    ).toBe(true);
    const claim: Claim = {
      kind: "matrix-backed",
      text: "Led the PostgreSQL migration of the payments platform",
      refs: [
        ref(
          built,
          "/roles/0/responsibilities/0",
          "React components for the checkout flow",
        ),
      ],
    };
    const result = verify([claim], built);
    expect(result).toEqual({
      ok: false,
      violations: ["claims.0.refs.0:unsupported_reference"],
    });
    // Control: the same claim citing the entry that really says it passes.
    expect(
      verify(
        [
          {
            ...claim,
            text: "Led the PostgreSQL migration of the orders database",
            refs: [ref(built, "/roles/1/responsibilities/0")],
          },
        ],
        built,
      ),
    ).toEqual({ ok: true });
  });

  it("eval: an existing entry with a genuine quote but a figure it does not contain is rejected", () => {
    const built = snapshot();
    const result = verify(
      [
        {
          kind: "matrix-backed",
          text: "Migrated 40 orders databases to PostgreSQL",
          refs: [ref(built, "/roles/1/responsibilities/0")],
        },
      ],
      built,
    );
    expect(violationsOf(result)).toEqual([
      "claims.0.refs.0:unsupported_reference",
    ]);
  });

  it("eval: a fabricated quote is rejected, even when it is real text of a different entry", () => {
    const built = snapshot();
    const fabricated = verify(
      [
        {
          kind: "matrix-backed",
          text: "Led a team of forty engineers",
          refs: [
            ref(
              built,
              "/roles/0/responsibilities/0",
              "Led a team of forty engineers",
            ),
          ],
        },
      ],
      built,
    );
    expect(violationsOf(fabricated)).toEqual([
      "claims.0.refs.0:quote_mismatch",
    ]);
    const borrowed = verify(
      [
        {
          kind: "matrix-backed",
          text: "Migrated the orders database to PostgreSQL",
          refs: [
            ref(
              built,
              "/roles/0/responsibilities/0",
              "Migrated the orders database to PostgreSQL",
            ),
          ],
        },
      ],
      built,
    );
    expect(violationsOf(borrowed)).toEqual(["claims.0.refs.0:quote_mismatch"]);
  });

  it("eval: a pointer from a stale revision is rejected", () => {
    const built = snapshot();
    const good = ref(built, "/roles/1/responsibilities/0");
    const staleRevision = verify(
      [
        {
          kind: "matrix-backed",
          text: "Migrated the orders database to PostgreSQL",
          refs: [{ ...good, revision: PROFILE.revision - 1 }],
        },
      ],
      built,
    );
    expect(violationsOf(staleRevision)).toEqual([
      "claims.0.refs.0:stale_revision",
    ]);
    // An entry that existed only in an older revision has no id here at all.
    const gone = verify(
      [
        {
          kind: "matrix-backed",
          text: "Migrated the orders database to PostgreSQL",
          refs: [
            {
              sourceId: createHash("sha256")
                .update("profile-eval:/roles/9/responsibilities/0")
                .digest("hex"),
              revision: PROFILE.revision - 1,
              pointer: "/roles/9/responsibilities/0",
              quote: "Migrated the orders database to PostgreSQL",
            },
          ],
        },
      ],
      built,
    );
    expect(violationsOf(gone)).toEqual(["claims.0.refs.0:unknown_reference"]);
    const wrongPointer = verify(
      [
        {
          kind: "matrix-backed",
          text: "Migrated the orders database to PostgreSQL",
          refs: [{ ...good, pointer: "/roles/0/responsibilities/0" }],
        },
      ],
      built,
    );
    expect(violationsOf(wrongPointer)).toEqual([
      "claims.0.refs.0:pointer_mismatch",
    ]);
  });

  it("eval: hazard 7a - an affirmation the matrix lacks is accepted only when labelled not-in-matrix", () => {
    const built = snapshot();
    const affirmation = "You led a Kubernetes migration";
    expect(
      verify([{ kind: "not-in-matrix", text: affirmation, refs: [] }], built),
    ).toEqual({ ok: true });
    expect(
      violationsOf(
        verify([{ kind: "matrix-backed", text: affirmation, refs: [] }], built),
      ),
    ).toEqual(["claims.0.refs:missing_reference"]);
    expect(
      violationsOf(
        verify(
          [
            {
              kind: "matrix-backed",
              text: affirmation,
              refs: [ref(built, "/roles/0/technologies/0")],
            },
          ],
          built,
        ),
      ),
    ).toEqual(["claims.0.refs.0:unsupported_reference"]);
  });

  it("eval: hazard 7b - a spoken figure absent from the sources is rejected, a matrix figure accepted", () => {
    const built = snapshot();
    const spoken = ["We have 2500 engineers across the company"];
    expect(
      violationsOf(
        verify(
          [
            {
              kind: "general-knowledge",
              text: "At 2500 engineers, ownership boundaries matter",
              refs: [],
            },
          ],
          built,
          "technical-concept",
          spoken,
        ),
      ),
    ).toEqual(["claims.0:spoken_figure"]);
    expect(
      verify(
        [
          {
            kind: "matrix-backed",
            text: "Maintained 99.9% uptime",
            refs: [ref(built, "/roles/1/metrics/0/label")],
          },
        ],
        built,
        "experience-story",
        ["How did you keep 99.9% uptime?"],
      ),
    ).toEqual({ ok: true });
  });

  it("eval: hazard 7c - employer and dates only through refs, a generated reason and disparagement are rejected", () => {
    const built = snapshot();
    expect(
      verify(
        [
          {
            kind: "matrix-backed",
            text: "Worked at Example Corp from 2021 to 2024",
            refs: [
              ref(built, "/roles/1/company"),
              ref(built, "/roles/1/period"),
            ],
          },
        ],
        built,
        "leaving-role",
      ),
    ).toEqual({ ok: true });
    expect(
      violationsOf(
        verify(
          [
            {
              kind: "general-knowledge",
              text: "I worked at Example Corp from 2021 to 2024",
              refs: [],
            },
          ],
          built,
          "leaving-role",
        ),
      ),
    ).toContain("claims.0:generated_reason");
    expect(
      violationsOf(
        verify(
          [
            {
              kind: "suggested-interpretation",
              text: "I left because the scope was too small",
              refs: [],
            },
          ],
          built,
          "leaving-role",
        ),
      ),
    ).toEqual(["claims.0:generated_reason"]);
    expect(
      verify(
        [
          {
            kind: "suggested-interpretation",
            text: LEAVING_REASON_PLACEHOLDER,
            refs: [],
          },
        ],
        built,
        "leaving-role",
      ),
    ).toEqual({ ok: true });
    expect(
      violationsOf(
        verify(
          [
            {
              kind: "not-in-matrix",
              text: "My manager was incompetent",
              refs: [],
            },
          ],
          built,
          "leaving-role",
        ),
      ),
    ).toEqual(["claims.0:disparages_employer"]);
    expect(
      violationsOf(
        verify([], built, "leaving-role", [], "My last company was toxic"),
      ),
    ).toEqual(["draft:disparages_employer"]);
  });

  it("eval: hazard 7d - notice period and compensation only preference-backed, never generated", () => {
    const built = snapshot(PREFERENCES);
    expect(
      verify(
        [
          {
            kind: "preference-backed",
            text: "My notice period is 4 weeks",
            refs: [ref(built, "/context/candidatePreferences/0")],
          },
        ],
        built,
        "logistics",
        [],
        "My notice period is 4 weeks.",
      ),
    ).toEqual({ ok: true });
    // A generated number is rejected twice over: wrong kind and a figure in
    // logistics that no preference carries.
    expect(
      violationsOf(
        verify(
          [
            {
              kind: "general-knowledge",
              text: "My notice period is 6 weeks",
              refs: [],
            },
          ],
          built,
          "logistics",
        ),
      ),
    ).toEqual([
      "claims.0:preference_only_topic",
      "claims.0:ungrounded_logistics_figure",
    ]);
    // A preference-backed claim whose figure the cited preference lacks.
    expect(
      violationsOf(
        verify(
          [
            {
              kind: "preference-backed",
              text: "My notice period is 6 weeks",
              refs: [ref(built, "/context/candidatePreferences/0")],
            },
          ],
          built,
          "logistics",
        ),
      ),
    ).toEqual(["claims.0.refs.0:unsupported_reference"]);
    // No preferences on file: the claim cannot be made at all.
    const none = snapshot();
    expect(none.preferences).toEqual({
      noticePeriod: false,
      compensation: false,
      other: false,
    });
    const impossible = verify(
      [
        {
          kind: "preference-backed",
          text: "My notice period is 4 weeks",
          refs: [
            {
              sourceId: createHash("sha256")
                .update("candidatePreferences:Notice period: 4 weeks.")
                .digest("hex"),
              revision: 2,
              pointer: "/context/candidatePreferences/0",
              quote: "Notice period: 4 weeks.",
            },
          ],
        },
      ],
      none,
      "logistics",
    );
    expect(violationsOf(impossible)).toEqual([
      "claims.0.refs.0:unknown_reference",
    ]);
    // A draft figure with no preference-backed claim behind it.
    expect(
      violationsOf(
        verify([], built, "logistics", [], "I would want 150 a year"),
      ),
    ).toEqual(["draft:ungrounded_logistics_figure"]);
  });

  it("eval: violation strings never contain claim or quote text", () => {
    const built = snapshot(PREFERENCES);
    const marker = "zyxwvutsr";
    const claims: Claim[] = [
      {
        kind: "matrix-backed",
        text: `Led the ${marker} migration with 77 people`,
        refs: [
          ref(built, "/roles/0/responsibilities/0", `fabricated ${marker}`),
          {
            sourceId: `${marker}-id`,
            revision: 1,
            pointer: `/${marker}`,
            quote: marker,
          },
        ],
      },
      {
        kind: "general-knowledge",
        text: `I worked at ${marker} in 2012, my manager was incompetent, notice 9 weeks`,
        refs: [],
      },
      { kind: "preference-backed", text: `salary ${marker} 5`, refs: [] },
    ];
    const result = verify(
      claims,
      built,
      "logistics",
      [`spoken ${marker} 77`],
      marker,
    );
    expect(result.ok).toBe(false);
    const violations = violationsOf(result);
    expect(violations.length).toBeGreaterThan(3);
    for (const violation of violations) {
      expect(violation).toMatch(
        /^(?:claims\.\d+(?:\.refs(?:\.\d+)?|\.kind)?|draft):[a-z_]+$/,
      );
      expect(violation).not.toContain(marker);
      expect(violation).not.toMatch(/77|2012|manager|salary/);
    }
  });
});
