import type {
  RehearsalFormat,
  RehearsalReveal,
} from "@omnitech/interview-contracts";

// Rehearsal is driven by this data: the screens render it as given.

export type FormatDefinition = {
  id: RehearsalFormat;
  title: string;
  description: string;
  conceptMinutes: number;
  codingMinutes: number;
};
export const FORMATS: readonly FormatDefinition[] = [
  {
    id: "full",
    title: "Full loop · 60 min",
    description: "15 min concepts, then 45 min coding",
    conceptMinutes: 15,
    codingMinutes: 45,
  },
  {
    id: "coding",
    title: "Coding · 45 min",
    description: "One problem, start to finish",
    conceptMinutes: 0,
    codingMinutes: 45,
  },
  {
    id: "concept",
    title: "Concept sprint · 15 min",
    description: "Rapid-fire explanations",
    conceptMinutes: 15,
    codingMinutes: 0,
  },
];
export const formatById = (id: RehearsalFormat) =>
  FORMATS.find((format) => format.id === id) ?? FORMATS[0]!;

// The interviewer's scorecard; each tick is worth CHECK_POINTS.
export const CHECKS = [
  "Restated the problem",
  "Asked clarifying questions",
  "Walked through an example",
  "Mentioned the brute force",
  "Explained the optimal approach",
  "Stated time and space complexity",
  "Talked while coding",
  "Tested with the examples",
  "Covered edge cases",
  "Summarised trade-offs",
] as const;

// Coding hints in the order they are offered; the last two stay locked until
// the complexity has been stated.
export const REVEALS: readonly { id: RehearsalReveal; label: string }[] = [
  { id: "clarify", label: "Clarifying questions" },
  { id: "hint1", label: "Hint" },
  { id: "pattern", label: "Pattern" },
  { id: "approach", label: "Approach" },
  { id: "edge", label: "Edge cases" },
  { id: "solution", label: "Reference solution" },
  { id: "tests", label: "Reference tests" },
];
export const LOCKED_UNTIL_COMPLEXITY: readonly RehearsalReveal[] = [
  "solution",
  "tests",
];

// Concept questions to rehearse when no brief has been built yet.
export const FALLBACK_CONCEPTS: readonly {
  id: string;
  title: string;
  followUps: readonly string[];
}[] = [
  {
    id: "react-render",
    title: "How does React decide when to re-render a component?",
    followUps: [
      "What does React.memo compare, and when does it not help?",
      "How does context affect which components re-render?",
    ],
  },
  {
    id: "optimistic-locking",
    title: "When would you choose optimistic over pessimistic locking?",
    followUps: [
      "How do you detect a conflict with a version column?",
      "What does the client do when its write is rejected?",
    ],
  },
  {
    id: "http-caching",
    title: "How does HTTP caching work between a browser and an API?",
    followUps: [
      "What is the difference between ETag and Last-Modified?",
      "When would you use no-store rather than no-cache?",
    ],
  },
];
// The interviewer's follow-ups after the coding phase.
export const CODING_FOLLOW_UPS = [
  "Why this approach rather than the brute force?",
  "What would change if the input did not fit in memory?",
  "Which test would you add first, and why?",
] as const;

export const WARN_SECONDS = { soon: 300, last: 60 } as const;

export function scoreHeadline(score: number) {
  if (score >= 75) return "Strong session";
  if (score >= 50) return "Solid, with gaps";
  return "Worth another run";
}
export const scoreTone = (score: number) =>
  score >= 75 ? "good" : score >= 50 ? "warn" : "bad";

// Where a live session is, given the seconds the clock has run.
export function phaseAt(format: FormatDefinition, elapsed: number) {
  const conceptSeconds = format.conceptMinutes * 60;
  const totalSeconds = conceptSeconds + format.codingMinutes * 60;
  const phase: "concept" | "coding" =
    elapsed < conceptSeconds ? "concept" : "coding";
  const phaseLeft =
    phase === "concept" ? conceptSeconds - elapsed : totalSeconds - elapsed;
  return {
    phase,
    conceptSeconds,
    totalSeconds,
    phaseLeft,
    sessionLeft: totalSeconds - elapsed,
    warning:
      phaseLeft <= WARN_SECONDS.last
        ? ("last" as const)
        : phaseLeft <= WARN_SECONDS.soon
          ? ("soon" as const)
          : null,
  };
}

export const clock = (seconds: number) => {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
};
