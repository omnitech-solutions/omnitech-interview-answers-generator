import type { Language } from "./schemas";

export interface AnswerWorkflowDefinition {
  codeFence: string;
  detectionPatterns: RegExp[];
  id: Language;
  label: string;
  systemPrompt: string;
}

// The code-quality rules: how the solution, usage and tests are written. They
// are shared by the web answer prompt and the live coding stage, so both
// produce the same kind of code; the JSON reply shape stays with each caller.
const codeRules = `
- Start with the simplest correct scalable solution. Prefer O(n) or O(n log n);
  accept O(n²) only when the constraints justify it.
- Simplicity is a requirement: choose the smallest design that satisfies the
  checklist. Do not add speculative abstractions, architecture, dependencies,
  or generic boilerplate. Reuse the prompt's domain vocabulary and discuss only
  relevant trade-offs.
- Clarify only ambiguity that materially changes correctness; otherwise state a
  narrow assumption in a code comment and continue.
- Give complete, runnable code rather than pseudocode.
- Use domain names and keep the main flow visible from top to bottom.
- Put a three-line PROBLEM / STRATEGY / COMPLEXITY header at the top of the
  primary solution using the target language's comment syntax.
- Put the exact required entry-point function or component above all helper
  methods/functions. Helpers follow the entry point so the main story is
  immediately visible.
- Use labelled comments for non-trivial decisions: [COMMENT] for concise intent,
  [GUARD] for early returns, [DOMAIN] for business rules/invariants, [STRATEGY]
  for algorithm/data-structure choices, and [SAFETY] for boundary protection or
  language traps. Comments explain decisions only and must never include example
  inputs, outputs, or I/O traces. Never narrate trivial syntax.
- Preserve the exact required entry-point name and signature.
- Keep the primary solution, executable usage, and focused tests separate.
- Make usageCode print representative input/output without redefining the
  solution. Include up to five meaningful cases: typical, empty or single,
  duplicates or all-identical, negative or zero, and no-answer/sentinel,
  replacing irrelevant categories with problem-specific boundaries.
- Make testCode execute the primary solution and cover the normal path,
  boundaries, and one failure-prone invariant. Use the language's normal test
  style when available.
- usageCode and testCode each run in the same file as the primary solution,
  appended after it: refer to its functions, classes and components directly
  and never import or require them from another module.
`;

const contractIntro = `
You are producing an interview-ready answer for a live screen-sharing session.

The question is often pasted from a coding-test site or read by OCR from a
screenshot. Before answering, recover the intended problem silently:
- Ignore editor and site chrome: file names (main.rb), line numbers, starter
  stubs (def solu … end), "Syntax Tips", hello-world samples and console help.
- Repair evident OCR errors from the surrounding meaning and the examples:
  index typos (numbers[4] or numbers[1 + 1] meaning numbers[i], numbers[i + 1]),
  mismatched brackets, "o" for 0, "S" for ≤, "10°" for 10⁹, "41" for "4]",
  and missing comparison symbols that the examples make clear.
- Keep the required entry point named by the stub (for example solution) and
  take the expected outputs from the examples; when the prose and an example
  disagree, the example wins.
- Restate the cleaned problem in guide.understand.prompt and give the examples
  with their exact, repaired inputs and outputs.

Apply these rules:
- Run the contract, edge-case, algorithm, and domain-naming analysis silently.
- Extract essential requirements, constraints, required entry point/signature,
  observable behavior, and failure boundaries before coding. Treat them as a
  completion checklist and make each one visible in the answer.
`;

const guideRules = `
- Write the explanation as a structured guide that walks the candidate through
  Understand, Plan, Code, Test and Explain. The system renders the answer's
  Markdown (## Question, ## Approach, ## Complexity, ## Edge cases, ## Talking
  points) from it, so do not write answerMarkdown yourself. Keep every item
  short enough to say aloud. Bold key domain terms, invariants, trade-offs and
  complexity notation inside guide text with **double asterisks**; the
  Workspace and the rendered Markdown both show them.
- In the guide, restate the problem in one or two sentences, give one to three
  input → output examples, list the constraints, and list two to five
  clarifying questions worth asking before coding. Give the approach as two to
  six steps and the time and space complexity in Big-O. List the edge cases and
  name, for each, the exact title of the test in testCode that covers it.
  Explain the solution in three to five short spoken sections (the problem,
  the approach, the trade-offs) and give exactly three talking points.
`;

const replyShape = `
Return a JSON object with exactly:
{
  "title": "short descriptive title",
  "language": "php | react | typescript | ruby",
  "guide": {
    "version": 1,
    "understand": {
      "prompt": "the problem restated in one or two sentences",
      "examples": [{ "input": "call or input", "output": "result", "note": "optional" }],
      "constraints": ["constraint"],
      "clarify": ["question to ask before coding"]
    },
    "plan": {
      "steps": ["approach step"],
      "complexity": { "time": "O(n)", "space": "O(1)", "note": "optional" }
    },
    "edgeCases": [{ "name": "edge case", "test": "exact test title in testCode" }],
    "explain": [{ "heading": "The problem", "body": "one or two spoken sentences" }],
    "talkingPoints": ["point", "point", "point"]
  },
  "code": "complete primary solution only",
  "usageCode": "executable representative usage that prints normal output",
  "testCode": "complete focused executable tests only"
}
`;

const sharedContract = `${contractIntro}${codeRules}${guideRules}${replyShape}`;

// Per-language rules appended after the shared contract.
const languageRules: Record<Language, string> = {
  php: `Use PHP 8.2+ with strict types when a full file is appropriate. Prefer arrays
and associative arrays for ordinary interview collections. Use SplQueue or
SplPriorityQueue only when their behavior fits. Be explicit about PHP key
coercion, loose comparison, empty values, and stable output ordering where they
matter. Prefer readable foreach loops and one function for ordinary algorithms.
Introduce focused helpers or domain classes only for demonstrated state,
invariants, reuse, or workflow boundaries. usageCode and testCode must omit a
second <?php tag because all three fields execute as one PHP file. Write Pest
tests using test()/it() and expect(); do not use PHPUnit-style classes.`,
  react: `Use React function components and TypeScript. If the problem is pure DSA, solve
it as plain TypeScript with no React. Give each state value one clear owner and
derive cheap values during render. Prefer native semantic controls and accessible
names. Use typed config-driven rendering for genuinely repeated UI with a stable
shape, but keep unique JSX explicit. Handle only reachable loading, empty, error,
success, and submission states. Avoid effects, memoization, reducers, context,
state libraries, and generic component factories unless the problem pays for
them. Name the primary previewable component App. Tests should use realistic
user-visible behavior, React Testing Library, userEvent, accessible role/name
queries, and Vitest. usageCode should show the render/interaction contract
without duplicating App.`,
  typescript: `Use modern TypeScript with strict, explicit boundary types. Prefer a function
and built-in arrays, Map, Set, and queues for simple problems. Model 1–3 real
domain concepts with focused types or classes when they own current state,
invariants, or algorithm steps; keep the exported entry point as a thin,
top-to-bottom orchestrator. Use readonly where it improves clarity. Do not use
unsafe casts or external libraries. Call out undefined and JavaScript runtime
semantics when they affect correctness. usageCode must print representative
results for exactly five cases, matching the TypeScript source prompt. Prefer
Vitest tests using describe, it/test, and expect.`,
  ruby: `Use modern Ruby with small methods and standard collections. Prefer Hash
defaults, Enumerable, and an explicit queue index where they make the algorithm
clear. Model meaningful domain concepts with focused classes when they own
algorithm state or boundary rules, place them below the exact entry-point method,
and keep the entry point as readable orchestration. Use fetch deliberately:
Ruby negative array indexes wrap and must be guarded when out-of-bounds should
mean missing. Avoid metaprogramming, Rails abstractions, external gems, and
clever chained expressions that are harder to explain than a loop. usageCode
must print representative results for exactly five cases, matching the Ruby
source prompt. Use RSpec with descriptive examples and expectations.`,
};

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
${languageRules.php}`,
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
${languageRules.react}`,
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
${languageRules.typescript}`,
  },
  ruby: {
    id: "ruby",
    label: "Ruby",
    codeFence: "ruby",
    detectionPatterns: [/\b(def|end|each_with_object|attr_reader|RSpec)\b/],
    systemPrompt: `${sharedContract}
${languageRules.ruby}`,
  },
};

export function getWorkflow(language: Language): AnswerWorkflowDefinition {
  return workflows[language];
}

export function listWorkflows(): AnswerWorkflowDefinition[] {
  return Object.values(workflows);
}

// The code-quality contract for one language: the shared code, comment, usage
// and test rules plus that language's rules, without the web answer's JSON
// reply shape. The live coding stage appends it to its constant policy.
export function codeQualityRules(language: Language): string {
  return `${codeRules}\n${languageRules[language]}`;
}
