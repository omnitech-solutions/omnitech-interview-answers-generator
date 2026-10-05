// Review S1 round 5: a logistics draft publishes a figure, unit or date only
// when it is a verbatim span of the approved preference; nothing else
// figure-like survives, whatever its spelling.
import type { CandidateMatrix } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { type Claim, verifyClaims } from "./claims";
import { buildContextSnapshot } from "./context-snapshot";
import { hasUnapprovedLogisticsFigure } from "./logistics-figures";

const MATRIX = {
  candidate: { name: "Candidate" },
  roles: [
    {
      company: "Example Corp",
      title: "Backend engineer",
      responsibilities: ["Led the migration of the order service"],
      metrics: [],
    },
  ],
} as unknown as CandidateMatrix;
const snap = buildContextSnapshot({
  matrix: MATRIX,
  profile: { id: "p", revision: 1, sha256: "c".repeat(64) },
  draftRevision: 5,
  candidatePreferences:
    "Notice period: 4 weeks.\nSalary expectation: negotiable.",
});
const source = snap.sources.find((s) => s.text === "Notice period: 4 weeks.");
if (!source) throw new Error("no preference source");
const preference: Claim = {
  kind: "preference-backed",
  text: "Notice period is 4 weeks",
  refs: [
    {
      sourceId: source.id,
      revision: source.revision,
      pointer: source.pointer,
      quote: source.text,
    },
  ],
};
const verdict = (draft: string, withPreference: boolean) => {
  const result = verifyClaims(withPreference ? [preference] : [], {
    snapshot: snap,
    captured: [],
    category: "logistics",
    draft,
  });
  return result.ok ? [] : result.violations;
};

const FIGURES = [
  "I could join you in three to four months.",
  "I could join you in 3 to 4 months.",
  "My notice period is four months.",
  "I can start the first week of March.",
  "I can start the 1st week of March.",
  "I could join you in three or so months.",
  "My notice period is V weeks.",
  "I am looking for six figures.",
  "I am looking for a six-figure salary.",
  "I could start on the twentieth.",
  "I could start on the 3rd.",
  "I could start on the first.",
  "My notice is a fortnight.",
  "I could start in March.",
  "I could start next Monday.",
  "Available from VIII weeks out.",
  "I want 90k.",
  "I want $90,000.",
  "My notice is 4–6 weeks.",
  "Around one-fifty.",
  "Two to three.",
  "I could start in May 2027.",
  "I could start in may.",
  "threemonths is my notice.",
  "Around ᴛʜʀᴇᴇ months.",
];

describe("logistics drafts: nothing figure-like beyond the approved preference", () => {
  for (const draft of FIGURES)
    for (const withPreference of [true, false])
      it(`withheld (${withPreference ? "4-week preference" : "no preference"}): ${draft}`, () => {
        expect(verdict(draft, withPreference)).toContain(
          "draft:ungrounded_logistics_figure",
        );
      });

  it("publishes the approved preference verbatim", () => {
    expect(verdict("My notice period is 4 weeks.", true)).toEqual([]);
    expect(verdict("Notice period: 4 weeks.", true)).toEqual([]);
  });

  it("withholds the approved figure plus a second one, or spelled differently", () => {
    expect(verdict("4 weeks, maybe four months.", true)).toContain(
      "draft:ungrounded_logistics_figure",
    );
    expect(verdict("My notice period is four weeks.", true)).toContain(
      "draft:ungrounded_logistics_figure",
    );
    expect(verdict("My notice period is 14 weeks.", true)).toContain(
      "draft:ungrounded_logistics_figure",
    );
  });

  it("withholds the preference figure when no preference-backed claim verified", () => {
    expect(verdict("My notice period is 4 weeks.", false)).toContain(
      "draft:ungrounded_logistics_figure",
    );
  });

  const ORDINARY = [
    "I would like to understand the role first and discuss compensation later.",
    "Salary is one of several factors I weigh.",
    "I may be able to be flexible; let us talk through what is missing.",
    "I'd rather confirm my notice period and availability with you directly.",
    "Compensation is one part of the picture, and I am happy to discuss it.",
  ];
  for (const draft of ORDINARY)
    it(`still publishes without a figure: ${draft}`, () => {
      expect(verdict(draft, false)).toEqual([]);
    });

  it("treats a figure-bearing claim that is not preference-backed as a violation", () => {
    const result = verifyClaims(
      [{ kind: "not-in-matrix", text: "About three months", refs: [] }],
      { snapshot: snap, captured: [], category: "logistics" },
    );
    expect(result.ok).toBe(false);
    expect(hasUnapprovedLogisticsFigure("About three months", [])).toBe(true);
  });
});
