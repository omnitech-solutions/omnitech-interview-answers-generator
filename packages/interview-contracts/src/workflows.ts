import type { Language } from "./schemas.js";

export interface AnswerWorkflowDefinition {
  codeFence: string;
  detectionPatterns: RegExp[];
  id: Language;
  label: string;
  systemPrompt: string;
}

const sharedContract = `
You are producing an interview-ready answer for a live screen-sharing session.

Apply these rules:
- Start with the simplest correct solution. Add an abstraction only when a
  current requirement justifies it.
- Clarify only ambiguity that materially changes correctness; otherwise state a
  narrow assumption and continue.
- Give complete, runnable code rather than pseudocode.
- Use domain names and keep the main flow visible from top to bottom.
- Comment decisions, invariants, non-obvious language behavior, and important
  edge cases. Never narrate obvious syntax.
- Include representative tests, a short dry run, and honest time/space
  complexity.
- Mention a brute-force baseline when it helps explain the optimized solution,
  but do not force two implementations when the straightforward solution is
  already optimal.
- Discuss production hardening separately so it does not obscure the interview
  solution.

Return a JSON object with exactly:
{
  "title": "short descriptive title",
  "language": "php | react | typescript | ruby",
  "answerMarkdown": "the explanation in Markdown",
  "code": "the complete primary solution",
  "testCode": "complete focused tests or an executable example"
}
`;

const workflows: Record<Language, AnswerWorkflowDefinition> = {
  php: {
    id: "php",
    label: "PHP",
    codeFence: "php",
    detectionPatterns: [
      /<\?php/i,
      /\b(array_map|foreach|namespace|composer)\b/i,
    ],
    systemPrompt: `${sharedContract}
Use PHP 8.2+ with strict types when a full file is appropriate. Prefer arrays
and associative arrays for ordinary interview collections. Use SplQueue or
SplPriorityQueue only when their behavior fits. Be explicit about PHP key
coercion, loose comparison, empty values, and stable output ordering where they
matter. Prefer functions for algorithm questions; introduce value objects,
services, or orchestration only for a real boundary or lifecycle.`,
  },
  react: {
    id: "react",
    label: "React",
    codeFence: "tsx",
    detectionPatterns: [
      /\b(React|JSX|TSX|component|hook|useState|useEffect|render)\b/i,
      /<\/?[A-Z][A-Za-z0-9.]*/,
    ],
    systemPrompt: `${sharedContract}
Use React function components and TypeScript. If the problem is pure DSA, solve
it as plain TypeScript with no React. Give each state value one clear owner and
derive cheap values during render. Prefer native semantic controls and accessible
names. Use typed config-driven rendering for genuinely repeated UI with a stable
shape, but keep unique JSX explicit. Handle only reachable loading, empty, error,
success, and submission states. Avoid effects, memoization, reducers, context,
state libraries, and generic component factories unless the problem pays for
them. Name the primary previewable component App. Tests should use realistic
user-visible behavior and accessible queries.`,
  },
  typescript: {
    id: "typescript",
    label: "TypeScript",
    codeFence: "typescript",
    detectionPatterns: [
      /\b(interface|type\s+\w+\s*=|Record<|Map<|Set<)\b/,
      /:\s*(string|number|boolean)\b/,
    ],
    systemPrompt: `${sharedContract}
Use modern TypeScript with strict, explicit boundary types. Prefer a function
and built-in arrays, Map, Set, and queues before classes or framework patterns.
Do not use unsafe casts to silence design problems. Call out JavaScript runtime
semantics when they affect correctness.`,
  },
  ruby: {
    id: "ruby",
    label: "Ruby",
    codeFence: "ruby",
    detectionPatterns: [/\b(def|end|each_with_object|attr_reader|RSpec)\b/],
    systemPrompt: `${sharedContract}
Use modern Ruby with small methods and standard collections. Prefer Hash
defaults, Enumerable, and an explicit queue index where they make the algorithm
clear. Avoid metaprogramming, Rails abstractions, and clever chained expressions
that are harder to explain than a loop. Include Minitest or focused executable
examples unless the question specifies RSpec.`,
  },
};

export function getWorkflow(language: Language): AnswerWorkflowDefinition {
  return workflows[language];
}

export function listWorkflows(): AnswerWorkflowDefinition[] {
  return Object.values(workflows);
}
