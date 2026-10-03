import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { DockerCodeRunner } from "@omnitech/code-runner";
import {
  type ExplanationRequest,
  type GeneratedAnswer,
  type GenerateRequest,
  generatedAnswerSchema,
  generatedExplanationSchema,
  getWorkflow,
  renderGuideMarkdown,
  routeQuestion,
} from "@omnitech/interview-contracts";
import {
  interviewLibrarySeed,
  OramaLibrarySearchIndex,
} from "@omnitech/interview-library";
import {
  JsonAnswerRepository,
  JsonExplanationRepository,
  JsonLibraryRepository,
} from "@omnitech/interview-storage";
import type { WorkspaceScope } from "./assistant/workspace.js";
import { LibraryService } from "./library-service.js";
import { generateChecked, type StructuredGenerate } from "./structured.js";

const dataDirectory =
  process.env["INTERVIEW_DATA_DIR"] ?? resolve(process.cwd(), ".data");

export const answerRepository = new JsonAnswerRepository(dataDirectory);
export const explanationRepository = new JsonExplanationRepository(
  dataDirectory,
);
export const libraryRepository = new JsonLibraryRepository(dataDirectory);
export const libraryService = new LibraryService(
  libraryRepository,
  new OramaLibrarySearchIndex(),
  join(dataDirectory, "library-index.msp"),
  interviewLibrarySeed,
);
export const codeRunner = new DockerCodeRunner();

function normalizeCommentedConceptExample(markdown: string): string {
  const fencedCode = /```([a-z][\w+-]*)\n([\s\S]+?)\n```/i;
  const match = fencedCode.exec(markdown);
  if (!match) {
    throw new TypeError(
      "The generated explanation is missing the required code example.",
    );
  }
  const comment = match[1]?.toLowerCase() === "ruby" ? "#" : "//";
  const source = match[2] ?? "";
  const requiredHeaders = [
    {
      pattern: /(?:\/\/|#)[ \t]*PROBLEM:/i,
      value: `${comment} PROBLEM: Ground the interview question in code.`,
    },
    {
      pattern: /(?:\/\/|#)[ \t]*STRATEGY:/i,
      value: `${comment} STRATEGY: Isolate the mechanism being discussed.`,
    },
    {
      pattern: /(?:\/\/|#)[ \t]*COMPLEXITY:/i,
      value: `${comment} COMPLEXITY: Use the bounds stated in the answer.`,
    },
  ];
  const sourceLines = source.split("\n");
  const headers = requiredHeaders.map(
    ({ pattern, value }) =>
      sourceLines.find((line) => pattern.test(line))?.trim() ?? value,
  );
  const remaining = sourceLines.filter(
    (line) => !requiredHeaders.some(({ pattern }) => pattern.test(line)),
  );
  if (
    !/(?:\/\/|#|<!--)[^\n]*\[(?:COMMENT|GUARD|DOMAIN|STRATEGY|SAFETY)\]/.test(
      remaining.join("\n"),
    )
  ) {
    remaining.unshift(
      `${comment} [DOMAIN] Keep the example focused on the interview decision.`,
    );
  }

  const normalizedBlock = `\`\`\`${match[1]}\n${[...headers, ...remaining].join("\n")}\n\`\`\``;
  return `${markdown.slice(0, match.index)}${normalizedBlock}${markdown.slice(
    match.index + match[0].length,
  )}`;
}

export const conceptExplanationSystemPrompt = `Act as a senior technical
interviewer, interview coach, and personal cheatsheet writer. Produce the
concise answer an interviewer wants to hear: technically precise, point-form,
easy to say aloud, and usable without rewriting.

First classify each supplied question as a mechanism, comparison/trade-off,
practical API, DSA pattern, system-design/troubleshooting, or
experience/behavioural question. Preserve its scope. Never invent subquestions
to make one simple prompt look comprehensive.

Use this outer Markdown shape:
# Short title
## Questions
### Question #1: Concise question
- **Answer:** The answer first.
- **Mechanics:** Only the mechanics needed to prove understanding.
- **Distinction:** The key comparison, invariant, or misconception.
#### Example
Exactly one valid syntax-highlighted code example with labeled comments.
#### Talking points
- Exactly 3 short details the candidate can say if probed.

Every supplied question must be one Question section and one Collapse,
including a single question. Use 2–4 answer bullets with domain-specific
labels; the labels above are defaults, not mandatory filler. Keep answer
bullets under 70 spoken words for a simple question and 110 for a genuinely
multi-part question. Always include exactly 3 short Talking points.

Always provide exactly one valid 7–14-line fenced code block. Use the requested
language, React/TypeScript for frontend concepts, and TypeScript when otherwise
ambiguous. Use a focused implementation, configuration, contract, decision
function, or typed evidence object that directly grounds the answer. Begin with
the language-appropriate PROBLEM, STRATEGY, and COMPLEXITY comment header; use
N/A only when complexity genuinely does not apply. Label non-trivial decisions
with [COMMENT], [GUARD], [DOMAIN], [STRATEGY], or [SAFETY]. Never narrate
trivial assignments, loop increments, setters, or JSX. Never put example
inputs, outputs, or I/O traces in source comments. Keep the required entry
point above helpers. For an experience question, represent an evidence-backed
mini-STAR without inventing candidate evidence.

Bold only key domain terms, decisions, invariants, and complexity. Put API
names, identifiers, values, and complexity notation in inline code. Declare
the language on every code block. Do not add "Key point", an answer plan,
invented questions, links, generic coaching, or repetitive prose.

React calibration: distinguish render triggers from work during or after a
render. State that state updates, parent renders, and consumed context can
schedule rendering; refs, \`useMemo\`, \`useCallback\`, and \`useEffect\` do
not independently do so. Distinguish render, reconciliation, and DOM commit.
Mention \`Object.is\` and shallow per-prop comparison only when equality or
memoization is relevant; React does not generally deep-compare. Never call a
state setter unconditionally during render.

Web calibration: distinguish browser behavior from HTTP behavior, client
caches from shared caches, and state the security boundary for CORS, cookies,
storage, and authentication.

Backend calibration: lead with the contract, source of truth, consistency
boundary, and failure/retry behavior. DSA calibration: lead with the
pattern-recognition clue and invariant, state assumptions before complexity,
and prioritize working code before optional optimization.

Never invent candidate experience. For personal examples, use only evidence in
the supplied experience matrix and name the company, system, technology, and
metric when available. If evidence is absent, say what is missing.`;

const experienceMatrixPath =
  process.env["INTERVIEW_EXPERIENCE_MATRIX_PATH"] ??
  "/Users/desoleary/dev/omnitech-solutions/docx-generator-studio/server/data/profiles/my-experience-matrix.json";

export async function generateExplanation(
  input: ExplanationRequest,
  generate: StructuredGenerate,
  scope: WorkspaceScope,
) {
  const experienceMatrix = await readFile(experienceMatrixPath, "utf8").catch(
    () => "",
  );
  const explanation = await generateChecked(
    generate,
    {
      system: conceptExplanationSystemPrompt,
      prompt: [
        `Concept to explain:\n${input.topic}`,
        input.context ? `Additional context:\n${input.context}` : "",
        experienceMatrix
          ? `Candidate experience matrix (authoritative evidence):\n${experienceMatrix}`
          : "Candidate experience matrix is unavailable.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
    generatedExplanationSchema,
    scope,
  );
  return {
    ...explanation,
    markdown: normalizeCommentedConceptExample(explanation.markdown),
  };
}

// What a model returns: the guide, never the Markdown rendered from it.
const modelAnswerSchema = generatedAnswerSchema.omit({ answerMarkdown: true });

export async function generateInterviewAnswer(
  input: GenerateRequest,
  generate: StructuredGenerate,
  scope: WorkspaceScope,
): Promise<GeneratedAnswer> {
  const routing = routeQuestion(input.question, input.language);
  const workflow = getWorkflow(routing.language);
  const answer = await generateChecked(
    generate,
    {
      system: workflow.systemPrompt,
      prompt: [
        `Target language: ${workflow.label}`,
        "",
        "Interview question:",
        input.question,
      ].join("\n"),
    },
    modelAnswerSchema,
    scope,
  );

  // Routing is authoritative. This prevents a model typo from switching the
  // execution language after the user has made an explicit selection.
  // The guide renders the Markdown that every other reader of the answer uses.
  return {
    ...answer,
    answerMarkdown: renderGuideMarkdown(answer.guide),
    language: routing.language,
  };
}
