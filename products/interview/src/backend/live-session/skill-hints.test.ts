// The skill list and its prompt hints: every skill the owner can choose has a
// label, one distinct constant sentence that biases the answer's style, and
// reaches the assist prompt; no free text is ever interpolated.
import {
  LIVE_OWNER_SKILL_LABELS,
  LIVE_OWNER_SKILLS,
} from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { SKILL_POLICY } from "./assist-stage";

describe("owner skills", () => {
  it("offers OpenCluely's nine skills under their names", () => {
    expect(LIVE_OWNER_SKILLS.map((s) => LIVE_OWNER_SKILL_LABELS[s])).toEqual([
      "Programming",
      "Data Structures & Algorithms",
      "System Design",
      "Behavioral Interview",
      "Data Science",
      "Sales & Business",
      "Presentation Skills",
      "Negotiation",
      "DevOps & Infrastructure",
    ]);
  });
  it("gives each skill its own constant style sentence", () => {
    expect(Object.keys(SKILL_POLICY).sort()).toEqual(
      [...LIVE_OWNER_SKILLS].sort(),
    );
    const sentences = Object.values(SKILL_POLICY);
    expect(new Set(sentences).size).toBe(sentences.length);
    for (const sentence of sentences) expect(sentence).toMatch(/Style:/);
  });
});
