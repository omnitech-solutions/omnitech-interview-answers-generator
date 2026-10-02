import type { LanguageSelection, RouteResult } from "./schemas.js";
import { listWorkflows } from "./workflows.js";

const DECLARED: readonly {
  language: RouteResult["language"];
  label: string;
  pattern: RegExp;
}[] = [
  {
    language: "ruby",
    label: "Ruby",
    pattern: /\((?:rb|ruby)\)|\[Ruby\]|\bmain\.rb\b/i,
  },
  {
    language: "php",
    label: "PHP",
    pattern: /\(php\)|\[PHP\]|\bmain\.php\b/i,
  },
  {
    language: "react",
    label: "React",
    pattern: /\((?:tsx|jsx)\)|\[React\]|\bApp\.(?:tsx|jsx)\b/,
  },
  {
    language: "typescript",
    label: "TypeScript",
    pattern: /\((?:ts|js)\)|\[(?:TypeScript|JavaScript)\]|\bmain\.(?:ts|js)\b/i,
  },
];

export function routeQuestion(
  question: string,
  requestedLanguage: LanguageSelection = "auto",
): RouteResult {
  if (requestedLanguage !== "auto") {
    return {
      language: requestedLanguage,
      confidence: 1,
      reasons: ["The caller selected the language explicitly."],
    };
  }

  // [DOMAIN] A coding-test site states the language itself: its time-limit
  // marker "(rb)", a "[Ruby] Syntax Tips" heading or a file such as main.rb.
  // That beats any keyword in the prose ("render", "component").
  const declared = DECLARED.find(({ pattern }) => pattern.test(question));
  if (declared)
    return {
      language: declared.language,
      confidence: 0.95,
      reasons: [`The question declares ${declared.label}.`],
    };

  const matches = listWorkflows()
    .map((workflow) => ({
      workflow,
      count: workflow.detectionPatterns.filter((pattern) =>
        pattern.test(question),
      ).length,
    }))
    .filter(({ count }) => count > 0)
    .toSorted((left, right) => right.count - left.count);
  const best = matches[0];

  if (!best) {
    return {
      language: "typescript",
      confidence: 0.55,
      reasons: [
        "No language-specific signal was found; TypeScript is the default.",
      ],
    };
  }

  return {
    language: best.workflow.id,
    confidence: Math.min(0.95, 0.65 + best.count * 0.15),
    reasons: [`Matched ${best.count} ${best.workflow.label} signal(s).`],
  };
}
