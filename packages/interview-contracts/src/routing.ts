import type { LanguageSelection, RouteResult } from "./schemas.js";
import { listWorkflows } from "./workflows.js";

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
