import {
  LIVE_OWNER_SKILL_LABELS,
  LIVE_OWNER_SKILLS,
} from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { SKILLS } from "./skills";

describe("the answer style list", () => {
  it("is the contract's skills, in its order, with its labels", () => {
    expect(SKILLS.map((skill) => skill.id)).toEqual([...LIVE_OWNER_SKILLS]);
    for (const skill of SKILLS)
      expect(skill.label).toBe(LIVE_OWNER_SKILL_LABELS[skill.id]);
  });
});
