// Review round 5 follow-up: gaps in the figure word classes, a claim text that
// escaped the allowlist, a mislabelled category, a fragment quote, and
// ordinary candidate wording that must still publish.
import type { CandidateMatrix } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { type Claim, verifyClaims } from "./claims.js";
import { buildContextSnapshot } from "./context-snapshot.js";

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
    "Notice period: 4 weeks, or 2 weeks if bought out.\nSalary expectation: negotiable.",
});
const line = snap.sources.find((s) => s.text.startsWith("Notice period"));
if (!line) throw new Error("no preference source");
const ref = (quote: string) => ({
  sourceId: line.id,
  revision: line.revision,
  pointer: line.pointer,
  quote,
});
const backed = (text: string, quote = line.text): Claim => ({
  kind: "preference-backed",
  text,
  refs: [ref(quote)],
});
const verdict = (draft: string, claims: Claim[], category = "logistics") => {
  const result = verifyClaims(claims, {
    snapshot: snap,
    captured: [],
    category,
    draft,
  });
  return result.ok ? [] : result.violations;
};
const withheld = (violations: readonly string[]) =>
  violations.some((v) =>
    /ungrounded_logistics_figure|preference_only_topic/.test(v),
  );

const GAPS = [
  "I'm looking for something in the low fifties.",
  "Somewhere in the mid-fifties.",
  "I'd want a double-digit raise.",
  "I could start in Sept.",
  "I could start early Jan.",
  "Mid-Feb works for me.",
  "I could start in the fall.",
  "I could start today.",
  "I could start this weekend.",
  "I could start Wed.",
  "After Christmas works for me.",
  "I can start immediately.",
  "twentyweeks notice.",
  "thirtydays notice.",
  "I want fiftyk.",
  "I want half a mil.",
  "I could join in one and a half.",
  "eıght weeks will do.",
];

describe("logistics allowlist, review round 5 gaps", () => {
  for (const draft of GAPS)
    it(`withholds: ${draft}`, () => {
      expect(withheld(verdict(draft, []))).toBe(true);
    });

  it("withholds a repeated or scaled approved span", () => {
    const claim = backed(
      "Notice period is 4 weeks",
      "Notice period: 4 weeks, or 2 weeks if bought out.",
    );
    for (const draft of [
      "Notice period: 4 weeks, or 2 weeks if bought out, and 4 weeks, or 2 weeks if bought out.",
      "Twice 4 weeks, or 2 weeks if bought out.",
    ])
      expect(withheld(verdict(draft, [claim]))).toBe(true);
  });

  it("does not approve a fragment of a longer preference line", () => {
    const claim = backed("Notice period is 2 weeks", "2 weeks");
    expect(withheld(verdict("My notice period is 2 weeks.", [claim]))).toBe(
      true,
    );
  });

  it("applies the allowlist to a preference-backed claim's own text", () => {
    for (const text of [
      "Notice period is 4 weeks from March",
      "Notice period is 4 weeks, Monday",
    ]) {
      const result = verdict(
        "Give the notice period from your stated preference.",
        [backed(text)],
      );
      expect(result).toContain("claims.0:ungrounded_logistics_figure");
    }
  });

  it("applies it to availability and pay sentences whatever the category says", () => {
    for (const category of ["background", "other"])
      for (const draft of [
        "I could start in March.",
        "My salary expectation is in the low fifties.",
        "I can start next Monday.",
      ])
        expect(withheld(verdict(draft, [], category))).toBe(true);
  });

  const ORDINARY = [
    "I'd rather not name a figure until I understand the scope.",
    "Let me figure out my notice period with my manager and come back to you.",
    "I'd like to understand the day-to-day of the role before we talk numbers.",
    "On the first point, I'd rather discuss compensation once I know the scope.",
    "By the second interview I should have a clearer view of my availability.",
    "From first principles, I'd weigh the whole package.",
    "I'm based in DC and open to relocating.",
    "My CV covers my availability.",
    "Annual leave matters to me too.",
    "I'm o.k. with that.",
    "Give me a mo to check.",
  ];
  for (const draft of ORDINARY)
    it(`still publishes: ${draft}`, () => {
      expect(verdict(draft, [])).toEqual([]);
    });
});
