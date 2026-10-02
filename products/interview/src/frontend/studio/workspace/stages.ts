import type { StageId } from "@omnitech/interview-contracts";

// The Workspace's interview flow. Labels and coaching hints are the only copy
// the stepper needs; each stage's content comes from the answer's guide.
export const STAGES: readonly { id: StageId; label: string; hint: string }[] = [
  {
    id: "understand",
    label: "Understand",
    hint: "Restate it, ask, agree on examples",
  },
  { id: "plan", label: "Plan", hint: "Say the approach before typing" },
  { id: "code", label: "Code", hint: "Narrate while you type" },
  { id: "test", label: "Test", hint: "Run, then map edge cases to tests" },
  { id: "explain", label: "Explain", hint: "Wrap up in two minutes" },
];

export const stageIndex = (id: StageId) =>
  STAGES.findIndex((stage) => stage.id === id);

// File names shown on the code tabs, by language.
export const FILE_NAMES = {
  typescript: {
    solution: "solution.ts",
    usage: "usage.ts",
    tests: "solution.test.ts",
  },
  react: { solution: "App.tsx", usage: "usage.tsx", tests: "App.test.tsx" },
  php: {
    solution: "Solution.php",
    usage: "usage.php",
    tests: "SolutionTest.php",
  },
  ruby: {
    solution: "solution.rb",
    usage: "usage.rb",
    tests: "solution_spec.rb",
  },
} as const;

export const LANGUAGE_LABELS = {
  typescript: "TypeScript",
  react: "React",
  php: "PHP",
  ruby: "Ruby",
} as const;
