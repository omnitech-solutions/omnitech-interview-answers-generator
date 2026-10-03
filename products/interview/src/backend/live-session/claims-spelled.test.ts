// Review S1 round 3: spelled-out notice period and compensation figures are
// figures in EVERY sentence of a draft, not only in a sentence carrying the
// compensation or notice-period wording; ordinary words stay unblocked.
import type { CandidateMatrix } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { type Claim, figuresOf, verifyClaims } from "./claims.js";
import { buildContextSnapshot, canonicalText } from "./context-snapshot.js";

const MATRIX = {
  candidate: { name: "Candidate" },
  roles: [
    {
      company: "Example Corp",
      title: "Backend engineer",
      responsibilities: [
        "Led the migration of the order service to PostgreSQL",
      ],
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
const run = (claims: Claim[], category: string, draft?: string) =>
  verifyClaims(claims, { snapshot: snap, captured: [], category, draft });
const codes = (result: ReturnType<typeof run>) =>
  result.ok ? [] : [...result.violations];
const GROUNDING =
  /^draft:(?:preference_only_topic|ungrounded_figure|ungrounded_logistics_figure)$/;
const blocked = (draft: string, category: string) =>
  codes(run([], category, draft)).some((code) => GROUNDING.test(code));
const preferenceRef = () => {
  const source = snap.sources.find((s) => s.text === "Notice period: 4 weeks.");
  if (!source) throw new Error("no preference source");
  return {
    sourceId: source.id,
    revision: source.revision,
    pointer: source.pointer,
    quote: source.text,
  };
};

describe("round 3: spelled figures without the topic lexicon are withheld", () => {
  const SPELLED = [
    "Notice period? Three months.",
    "I'm looking for a base salary. Around one-fifty.",
    "I'm hoping for around one hundred fifty thousand a year.",
    "I could join you in three months.",
    "My notice period is a month.",
    "My notice period is a fortnight.",
    "I can start on the first of March.",
    "My notice period is III months.",
    "My notice period is Ⅲ months.",
    "That is in the low hundreds of thousands.",
    "My bonus was tens of thousands.",
    "My salary expectation is ꜰɪꜰᴛʏ k.",
    "My salary expectation is fi̇fty k.",
    "My salary expectation is fïftý k.",
    "My salary expectation is fif·ty k.",
    "My salary expectation is twelve-thirty a day.",
    "My base salary target is one-fifty k.",
    "My salary expectation is \u{1D41F}\u{1D422}\u{1D41F}\u{1D42D}\u{1D432} k.",
  ];
  for (const category of ["other", "logistics"])
    for (const draft of SPELLED)
      it(`${category}: ${draft}`, () => {
        expect(blocked(draft, category)).toBe(true);
      });

  it("still withholds the Cyrillic homoglyph spelling by code", () => {
    expect(
      codes(run([], "other", "My salary expectation is fіfty k.")),
    ).toContain("draft:confusable_text");
  });
  it("reads spelled words as the same figures as digits", () => {
    expect(figuresOf("a hundred and fifty thousand")).toContain("150000");
    expect(figuresOf("My notice period is four weeks")).toContain("4");
    expect(figuresOf("twelve thirty").has("12")).toBe(true);
    expect(figuresOf("twelve thirty").has("30")).toBe(true);
  });
});

describe("round 3: ordinary drafts are not withheld", () => {
  const ORDINARY = [
    "Salary is one of several factors I weigh.",
    "Compensation is one part of the picture.",
    "I'd want half as much scope creep, and a couple of reviewers.",
    "I used two queues and a few workers for one service.",
    "I would like to understand the role first and discuss compensation later.",
    "I spent three months on the migration.",
  ];
  for (const category of ["other", "logistics", "experience-story"])
    for (const draft of ORDINARY)
      it(`${category}: ${draft}`, () => {
        // logistics rejects every figure, spelled or not, when digits would.
        const expected = category === "logistics" && /three months/.test(draft);
        expect(blocked(draft, category)).toBe(expected);
      });

  it("allows a spelled figure that equals the approved preference figure", () => {
    expect(blockedWithPreference("My notice period is four weeks.")).toBe(
      false,
    );
    expect(blockedWithPreference("My notice period is six weeks.")).toBe(true);
  });
});

// A preference-backed claim makes "4" an approved figure of the draft.
function blockedWithPreference(draft: string): boolean {
  const claim: Claim = {
    kind: "preference-backed",
    text: "Notice period is 4 weeks",
    refs: [preferenceRef()],
  };
  return codes(run([claim], "logistics", draft)).some((code) =>
    GROUNDING.test(code),
  );
}

describe("round 3: canonical text", () => {
  it("strips an invisible character BEFORE normalising so composition still happens", () => {
    // e + zero-width space + combining acute: only a pre-NFKC strip lets NFKC
    // compose it to a single e-acute.
    expect(canonicalText("e​́")).toBe("é");
  });
});
