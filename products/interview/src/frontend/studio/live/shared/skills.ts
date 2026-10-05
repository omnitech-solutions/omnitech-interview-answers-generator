// The answer styles the person can choose between, straight from the contract:
// a skill added there is offered here with no second list to keep in step.
import {
  LIVE_OWNER_SKILL_LABELS,
  LIVE_OWNER_SKILLS,
  type LiveOwnerSkill,
} from "@omnitech/interview-contracts";

export type SkillOption = { id: LiveOwnerSkill; label: string };

export const SKILLS: readonly SkillOption[] = LIVE_OWNER_SKILLS.map((id) => ({
  id,
  label: LIVE_OWNER_SKILL_LABELS[id],
}));
