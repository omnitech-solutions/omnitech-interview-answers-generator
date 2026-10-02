import type {
  FeatureFlags,
  SavedPrompt,
  Starter,
  Surface,
} from "@omnitech-assistant/react";

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
    id: "answerMarkdown",
    name: "Answer",
    icon: "description",
    description: "Explanation",
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
