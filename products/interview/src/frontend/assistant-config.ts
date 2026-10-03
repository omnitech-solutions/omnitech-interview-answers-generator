import type {
  FeatureFlags,
  SavedPrompt,
  Starter,
  Surface,
} from "@omnitech-assistant/react";
import type { StudioAssistantView } from "./studio/context";

// What the assistant offers inside Interview Studio. Everything generic lives
// in @omnitech-assistant/react; this file only names the studio's own things.
export const assistantFeatures: FeatureFlags = {};

export const assistantStarters: readonly Starter[] = [
  {
    icon: "edit_note",
    title: "Draft an answer",
    subtitle: "From my evidence, in TypeScript",
    prompt:
      "Draft an answer to the current question using my evidence. Include a TypeScript solution and Vitest tests.",
  },
  {
    icon: "bug_report",
    title: "Find edge cases",
    subtitle: "Review what the solution misses",
    prompt: "Review the Main Solution for edge cases it misses.",
  },
  {
    icon: "science",
    title: "Write tests",
    subtitle: "Cases the current tests miss",
    prompt: "Write tests for the cases the current tests miss.",
  },
  {
    icon: "record_voice_over",
    title: "Mock interview",
    subtitle: "Ask me questions, one at a time",
    prompt: "Ask me interview questions about this solution, one at a time.",
  },
];

export const assistantPrompts: readonly SavedPrompt[] = [
  {
    title: "Review for edge cases",
    prompt:
      "Review the Main Solution for edge cases it misses, and propose fixes.",
  },
  {
    title: "Senior interviewer mode",
    prompt:
      "Act as a senior interviewer. Ask follow-up questions about my solution, one at a time.",
  },
  {
    title: "Explain in two minutes",
    prompt:
      "Explain this solution the way I would in a two-minute interview answer.",
  },
];

// The parts of the studio the user can point the assistant at with "@".
export const assistantSurfaces: readonly Surface[] = [
  { id: "question", name: "Question", icon: "quiz", description: "Text" },
  {
    id: "guide",
    name: "Guide",
    icon: "description",
    description: "Plan and explanation",
  },
  { id: "code", name: "Main Solution", icon: "code", description: "Code" },
  {
    id: "usageCode",
    name: "Usage / Output",
    icon: "terminal",
    description: "Example run",
  },
  { id: "testCode", name: "Tests", icon: "science", description: "Test cases" },
];

// The Workspace question: the assistant's subject wherever no other draft
// is open.
export const questionAssistant: StudioAssistantView = {
  sees: "your current question",
  description:
    "I can read and edit the Question, Main Solution and Tests in Interview Studio. Changes are always proposed first — nothing is applied without you.",
  starters: assistantStarters,
  prompts: assistantPrompts,
  surfaces: assistantSurfaces,
};

// A behavioural preparation pack.
export const packAssistant: StudioAssistantView = {
  sees: "this preparation pack",
  description:
    "I can read this preparation pack — the interview, your matrix roles, answers and briefing — help you rehearse, and propose sharper answers. Nothing changes without you.",
  starters: [
    {
      icon: "record_voice_over",
      title: "Rehearse with me",
      subtitle: "One question at a time, with feedback",
      prompt:
        "Run a mock version of this interview: ask me the pack's questions one at a time, wait for my answer, then give short feedback against the drafted answer.",
    },
    {
      icon: "edit_note",
      title: "Tighten my answers",
      subtitle: "Spoken in under 60 seconds",
      prompt:
        "Find the answers that run long or bury the point, and propose tighter versions that keep only what my sources support.",
    },
    {
      icon: "psychology",
      title: "What to lead with",
      subtitle: "The three things to land",
      prompt:
        "Given this interview and interviewer, what are the three things I most need to land, and which answers carry them?",
    },
    {
      icon: "verified_user",
      title: "Check the gaps",
      subtitle: "What I can't back up yet",
      prompt:
        "Go through the gaps in my answers and briefing. For each, tell me whether to drop the claim, soften it, or what evidence would back it.",
    },
  ],
  prompts: [
    {
      title: "Interviewer's follow-ups",
      prompt:
        "For my answer to the selected question, what follow-ups would this interviewer ask, and how should I answer them briefly?",
    },
    {
      title: "Make it sound like me",
      prompt:
        "Rewrite my weakest answer to sound natural when spoken, keeping its facts and three talking points.",
    },
  ],
};

// A spoken concept or system-design brief (read only).
export const conceptBriefAssistant: StudioAssistantView = {
  sees: "this brief",
  description:
    "I can read this brief and help you say it well: explain a point, answer a follow-up or quiz you.",
  starters: [
    {
      icon: "record_voice_over",
      title: "Quiz me",
      subtitle: "Follow-ups, one at a time",
      prompt:
        "Quiz me on this brief: ask one likely follow-up at a time and tell me what a strong answer includes.",
    },
    {
      icon: "quiz",
      title: "Explain it simpler",
      subtitle: "As if to a non-specialist",
      prompt: "Explain this brief's three points more simply, in my words.",
    },
  ],
  prompts: [
    {
      title: "Sharper example",
      prompt: "Suggest a sharper real-world example for this brief.",
    },
  ],
};
