// The deterministic fake's content is independent of its response id and clock.
export function fakeCompletionContent(
  messages: Array<{ content?: unknown }> | undefined,
) {
  const prompt = messages
    ?.map((message) => String(message.content ?? ""))
    .join("\n");
  const language =
    prompt?.match(/Target language: (PHP|React|TypeScript|Ruby)/)?.[1] ??
    "TypeScript";
  const languageId = language.toLowerCase();
  const codeByLanguage: Record<string, string> = {
    php: `<?php
declare(strict_types=1);

function solve(array $values): array
{
    // Keep the baseline explicit so it remains easy to adapt in an interview.
    return $values;
}

print_r(solve([1, 2, 3]));`,
    react: `function App() {
  const items = ["Simple", "Correct", "Readable"];

  return (
    <main>
      <h1>Interview answer</h1>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </main>
  );
}`,
    ruby: `def solve(values)
  # Keep the baseline explicit so it remains easy to adapt in an interview.
  values
end

p solve([1, 2, 3])`,
    typescript: `function solve(values: number[]): number[] {
  // Keep the baseline explicit so it remains easy to adapt in an interview.
  return values;
}

console.log(solve([1, 2, 3]));`,
  };
  const content = prompt?.includes("Concept to explain:")
    ? JSON.stringify({
        title: "Interview-ready concept",
        markdown:
          "# Interview-ready concept\n\n## In one sentence\n\nExplain the core idea before the implementation detail.\n\n## Talking points\n\n- **Purpose:** connect the concept to a concrete problem.\n- **Trade-off:** state what improves and what it costs.\n\n## How it works\n\n```mermaid\nflowchart LR\n  A[Input] --> B[Decision]\n  B --> C[Outcome]\n```\n\n## Trade-offs and pitfalls\n\n- Avoid unnecessary complexity.\n\n## Interview example\n\nUse a concrete, measurable example.\n\n## Follow-up questions\n\n- What constraint changes the design?",
      })
    : JSON.stringify({
        title: `Fake ${language} Answer`,
        language: languageId,
        guide: {
          version: 1,
          understand: {
            prompt: "Return the supplied values unchanged.",
            examples: [{ input: "[1, 2, 3]", output: "[1, 2, 3]" }],
            constraints: [],
            clarify: [],
          },
          plan: {
            steps: [
              "Start with the smallest correct implementation, verify the primary example, then discuss only improvements justified by the constraints.",
            ],
            complexity: {
              time: "O(n)",
              space: "O(n)",
              note: "for the returned collection",
            },
          },
          edgeCases: [],
          explain: [
            {
              heading: "The approach",
              body: "Keep the baseline explicit so it is easy to adapt.",
            },
          ],
          talkingPoints: [
            "Start simple.",
            "Verify the primary example.",
            "Improve only for a stated constraint.",
          ],
        },
        code: codeByLanguage[languageId] ?? codeByLanguage["typescript"],
        usageCode:
          languageId === "react"
            ? "// Render <App /> in the supplied React entry point."
            : "// Print representative inputs and outputs here.",
        testCode:
          "The deterministic fake provider is intended for transport and UI tests.",
      });

  return content;
}
