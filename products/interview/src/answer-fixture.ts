import {
  type AnswerGuide,
  renderGuideMarkdown,
} from "@omnitech/interview-contracts";

// Test support: every Workspace answer has a guide. A guide whose prompt is
// the given text renders Markdown that contains it, so claims and readers that
// quote the answer's prose still find it.
// No optional fields, so it is also plain JSON for tool-call inputs.
export function guideSaying(text: string) {
  return {
    version: 1 as const,
    understand: {
      prompt: text,
      examples: [] as never[],
      constraints: [] as string[],
      clarify: [] as string[],
    },
    plan: { steps: ["Solve it."], complexity: { time: "O(n)", space: "O(1)" } },
    edgeCases: [] as never[],
    explain: [{ heading: "Approach", body: "Solve it directly." }],
    talkingPoints: ["One.", "Two.", "Three."],
  } satisfies AnswerGuide;
}

// An answer's prose as the system stores it: the guide and the Markdown
// rendered from it.
export function guidedProse(text: string) {
  const guide = guideSaying(text);
  return { answerMarkdown: renderGuideMarkdown(guide), guide };
}

// An answer as a model proposes it: the system renders the Markdown.
export function withoutMarkdown<T extends { answerMarkdown: string }>(
  answer: T,
): Omit<T, "answerMarkdown"> {
  const { answerMarkdown: _rendered, ...fields } = answer;
  return fields;
}
