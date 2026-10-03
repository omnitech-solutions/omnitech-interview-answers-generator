import { z } from "zod";

// The structured answer behind the Workspace stages. answerMarkdown is
// rendered from it for every view that shows the answer as Markdown.
const line = (max: number) => z.string().trim().min(1).max(max);

export const answerGuideSchema = z.object({
  version: z.literal(1),
  understand: z.object({
    prompt: line(2_000),
    examples: z
      .array(
        z.object({
          input: line(2_000),
          output: line(2_000),
          note: line(500).optional(),
        }),
      )
      .max(3),
    constraints: z.array(line(500)).max(8),
    clarify: z.array(line(500)).max(6),
  }),
  plan: z.object({
    steps: z.array(line(1_000)).min(1).max(8),
    complexity: z.object({
      time: line(200),
      space: line(200),
      note: line(500).optional(),
    }),
  }),
  // test: the name of the test in testCode that covers this case.
  edgeCases: z
    .array(z.object({ name: line(300), test: line(300).optional() }))
    .max(10),
  explain: z
    .array(z.object({ heading: line(120), body: line(2_000) }))
    .min(1)
    .max(6),
  // An array of exactly three (not a tuple): JSON Schema consumers in strict
  // mode need minItems/maxItems.
  talkingPoints: z.array(line(500)).length(3),
});

export const stageIdSchema = z.enum([
  "understand",
  "plan",
  "code",
  "test",
  "explain",
]);
// Where the person is in a question; saved on the draft, not the answer.
export const stageProgressSchema = z.strictObject({
  stage: stageIdSchema,
  clarified: z.array(z.number().int().min(0).max(20)).max(20),
});

export type AnswerGuide = z.infer<typeof answerGuideSchema>;
export type StageId = z.infer<typeof stageIdSchema>;
export type StageProgress = z.infer<typeof stageProgressSchema>;

const code = (text: string) => `\`${text.replaceAll("`", "ˋ")}\``;

// The five required answer headings, written from the guide.
export function renderGuideMarkdown(guide: AnswerGuide): string {
  const { understand, plan } = guide;
  const question = [
    `- **Goal:** ${understand.prompt}`,
    ...(understand.examples.length
      ? [
          "- **Examples:**",
          ...understand.examples.map(
            (example) =>
              `  - ${code(example.input)} → ${code(example.output)}${example.note ? ` — ${example.note}` : ""}`,
          ),
        ]
      : []),
    ...(understand.constraints.length
      ? [
          "- **Constraints:**",
          ...understand.constraints.map((item) => `  - ${item}`),
        ]
      : []),
  ];
  const complexity = [
    `- **Time:** ${code(plan.complexity.time)}`,
    `- **Space:** ${code(plan.complexity.space)}`,
    ...(plan.complexity.note ? [`- ${plan.complexity.note}`] : []),
  ];
  const edges = guide.edgeCases.length
    ? guide.edgeCases.map(
        (edge) =>
          `- **${edge.name}**${edge.test ? ` — covered by ${code(edge.test)}` : ""}`,
      )
    : ["- None beyond the examples."];
  return [
    "## Question",
    "",
    ...question,
    "",
    "## Approach",
    "",
    ...plan.steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Complexity",
    "",
    ...complexity,
    "",
    "## Edge cases",
    "",
    ...edges,
    "",
    "## Talking points",
    "",
    ...guide.talkingPoints.map((point) => `- ${point}`),
  ].join("\n");
}

// The guide as plain text: what reviewers diff and what claims quote.
export function guideText(guide: AnswerGuide): string {
  return [
    `Prompt: ${guide.understand.prompt}`,
    ...guide.understand.examples.map(
      (example) => `Example: ${example.input} → ${example.output}`,
    ),
    ...guide.understand.constraints.map((item) => `Constraint: ${item}`),
    ...guide.understand.clarify.map((item) => `Ask: ${item}`),
    ...guide.plan.steps.map((step, index) => `Step ${index + 1}: ${step}`),
    `Time: ${guide.plan.complexity.time}`,
    `Space: ${guide.plan.complexity.space}`,
    ...guide.edgeCases.map(
      (edge) => `Edge case: ${edge.name}${edge.test ? ` (${edge.test})` : ""}`,
    ),
    ...guide.explain.map((section) => `${section.heading}: ${section.body}`),
    ...guide.talkingPoints.map((point) => `Talking point: ${point}`),
  ].join("\n");
}

// Where in the person's editors something happened.
export const editorLocationSchema = z.object({
  editor: z.enum(["solution", "tests"]),
  line: z.number().int().positive(),
});
// One test from a structured test report: where it failed, or else where it
// is declared.
export const testResultSchema = z.object({
  name: z.string(),
  status: z.enum(["passed", "failed", "skipped"]),
  durationMs: z.number().nonnegative().optional(),
  message: z.string().optional(),
  location: editorLocationSchema.optional(),
});
// A syntax problem at a position in the checked editor.
export const diagnosticSchema = z.object({
  line: z.number().int().positive(),
  column: z.number().int().positive().optional(),
  message: z.string(),
});
export type EditorLocation = z.infer<typeof editorLocationSchema>;
export type TestResult = z.infer<typeof testResultSchema>;
export type Diagnostic = z.infer<typeof diagnosticSchema>;
