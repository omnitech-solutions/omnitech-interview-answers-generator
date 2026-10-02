import type {
  BriefingContext,
  BriefingQuestion,
} from "@omnitech/interview-contracts";
import { BRIEFING_SECTION_HEADINGS } from "@omnitech/interview-contracts";
import type { IconName } from "../../icon";

// Behavioural briefings are driven by this data: the screens render it.

type Stage = BriefingContext["stage"];

export const STAGES: readonly { id: Stage; label: string; note: string }[] = [
  {
    id: "recruiter",
    label: "Recruiter screen",
    note: "A conversation, not an exam: career story, motivation, one or two leadership examples, compensation and logistics.",
  },
  {
    id: "hiring-manager",
    label: "Hiring manager",
    note: "Depth on your most relevant role and how you work day to day.",
  },
  {
    id: "behavioural",
    label: "Behavioural panel",
    note: "STAR stories, about 90 seconds each.",
  },
  {
    id: "leadership",
    label: "Final round",
    note: "Motivation, fit and your closing questions.",
  },
];

export const CATEGORY_LABELS: Record<BriefingQuestion["category"], string> = {
  background: "Background",
  motivation: "Motivation",
  leadership: "Leadership",
  delivery: "Story",
  collaboration: "Collaboration",
  logistics: "Logistics",
  "questions-to-ask": "Closing",
};

// The questions each stage nearly always asks. `{company}` is filled in.
export const SUGGESTED_QUESTIONS: Record<Stage, readonly string[]> = {
  recruiter: [
    "Tell me about yourself and your background.",
    "Why {company}?",
    "Why are you interested in this role?",
    "Tell me about your leadership and mentoring experience.",
    "Tell me about a project you’re proud of.",
    "How do you work with Product?",
    "How do you handle competing priorities?",
    "What are you looking for in your next role?",
    "What are your salary expectations?",
    "Where are you based, and when could you start?",
  ],
  "hiring-manager": [
    "Walk me through your most relevant role.",
    "Tell me about a technical decision you’d make differently now.",
    "How do you work with product managers?",
    "Tell me about a production incident you led.",
    "How do you mentor other engineers?",
  ],
  behavioural: [
    "Tell me about a disagreement with a teammate.",
    "Tell me about a time you failed.",
    "Tell me about influencing without authority.",
    "Tell me about delivering under a tight deadline.",
    "Tell me about pushing back on a manager.",
  ],
  leadership: [
    "Why should we hire you?",
    "Where do you want to be in three years?",
    "What questions do you have for us?",
  ],
};

export function suggestedFor(stage: Stage, company: string): string[] {
  return SUGGESTED_QUESTIONS[stage].map((question) =>
    question.replace("{company}", company.trim() || "this company"),
  );
}

// The prepared briefing's sections, grouped into the pack's tabs.
type Heading = (typeof BRIEFING_SECTION_HEADINGS)[number];
export type PackTab = "overview" | "answers" | "stories" | "ask" | "watch";
export const PACK_TABS: readonly {
  id: PackTab;
  label: string;
  icon: IconName;
  headings?: readonly Heading[];
}[] = [
  {
    id: "overview",
    label: "Overview",
    icon: "lightbulb",
    headings: BRIEFING_SECTION_HEADINGS.slice(0, 7),
  },
  { id: "answers", label: "Answers", icon: "record_voice_over" },
  {
    id: "stories",
    label: "Stories",
    icon: "menu_book",
    headings: ["Stories to reuse"],
  },
  {
    id: "ask",
    label: "Ask them",
    icon: "help",
    headings: ["Questions to ask"],
  },
  {
    id: "watch",
    label: "Watch-outs",
    icon: "warning",
    headings: ["Watch-outs"],
  },
];

// About 150 words a minute, spoken.
export const spokenSeconds = (markdown: string) =>
  Math.round((markdown.split(/\s+/).filter(Boolean).length / 150) * 60);

// The matrix a pack starts from when the person has not chosen a default.
export const DEFAULT_PROFILE_ID = "local-experience-matrix";
