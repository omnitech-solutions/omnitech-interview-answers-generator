import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createAiClientFromEnv } from "@omnitech/ai-sdk";
import { DockerCodeRunner } from "@omnitech/code-runner";
import {
  generatedAnswerSchema,
  generatedExplanationSchema,
  getWorkflow,
  routeQuestion,
  type GenerateRequest,
  type ExplanationRequest,
} from "@omnitech/interview-contracts";
import {
  JsonAnswerRepository,
  JsonExplanationRepository,
  JsonLibraryRepository,
} from "@omnitech/interview-storage";
import {
  interviewLibrarySeed,
  OramaLibrarySearchIndex,
} from "@omnitech/interview-library";
import { LibraryService } from "./library-service";

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

const experienceMatrixPath =
  process.env["INTERVIEW_EXPERIENCE_MATRIX_PATH"] ??
  "/Users/desoleary/dev/omnitech-solutions/docx-generator-studio/server/data/profiles/my-experience-matrix.json";

export async function generateExplanation(input: ExplanationRequest) {
  const client = createAiClientFromEnv();
  const experienceMatrix = await readFile(experienceMatrixPath, "utf8").catch(
    () => "",
  );
  const result = await client.generateObject({
    ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
    schema: generatedExplanationSchema,
    system: `Act as a senior technical interviewer, interview coach, and
personal cheatsheet writer. Produce the concise answer an interviewer wants to
hear: direct, technically precise, easy to scan, and usable without rewriting.

Every supplied question must be its own Collapse section, including a
single-question prompt. Use exactly this Markdown shape:
# Short title
## Questions
### Question #1: Concise question
- **Direct answer:** The answer first.
- **How it works:** The minimum mechanics needed to prove understanding.
- **Interviewer distinction:** The key comparison, invariant, or misconception.
#### Code example
One focused 6–12-line fenced block for programming, framework, or API questions.
Show only 2–4 representative behaviors. Comment every demonstrated behavior
with what triggers, does not trigger, or merely runs after work. Prefer a small
valid snippet over full scaffolding; never call a React state setter
unconditionally during render.
#### Talking points
- Exactly 3 short points the candidate can use if the interviewer probes.

For non-code questions, use "#### Example" with 2–3 concrete bullets instead
of a code block. Repeat the Question section only for distinct questions
actually supplied by the user. Keep each question's three answer bullets under
90 spoken words. Concept Lab renders each Question section as one Collapse with
a blue header; its answer, example, and talking points stay together inside.

Do not add "Key point", an answer plan, invented questions, generic advice, or
repetitive prose. Inline API names must use backticks and every code block must
declare the correct language.

Choose details by asking, "Would a senior interviewer expect this distinction?"
For React rendering questions, distinguish state, parent rendering, context,
refs, effects, memoization, reconciliation, and DOM commits when relevant.
Choose only the 2–4 most illustrative React APIs for the code block; cover
remaining distinctions in Talking points. Place setters inside an event handler
or effect and explain that refs, memo hooks, and effect hooks do not
independently schedule rendering.
State explicitly that React uses identity/value checks such as \`Object.is\`
and shallow per-prop comparison where applicable; it does not generally perform
deep comparison. Do not repeat facts across sections or turn the answer into an
exhaustive reference guide.

Never invent candidate experience. When the topic asks for a personal example,
use only evidence present in the supplied experience matrix and name the
company, system, technology, and metric when available. If evidence is absent,
say what evidence is missing.`,
    prompt: [
      `Concept to explain:\n${input.topic}`,
      input.context ? `Additional context:\n${input.context}` : "",
      experienceMatrix
        ? `Candidate experience matrix (authoritative evidence):\n${experienceMatrix}`
        : "Candidate experience matrix is unavailable.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    temperature: 0.2,
    maxOutputTokens: 2_200,
  });
  return result.object;
}

export async function generateInterviewAnswer(input: GenerateRequest) {
  const routing = routeQuestion(input.question, input.language);
  const workflow = getWorkflow(routing.language);
  const client = createAiClientFromEnv();
  const result = await client.generateObject({
    ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
    schema: generatedAnswerSchema,
    system: workflow.systemPrompt,
    prompt: [
      `Target language: ${workflow.label}`,
      "",
      "Interview question:",
      input.question,
    ].join("\n"),
    temperature: 0.2,
    maxOutputTokens: 8_000,
  });

  // Routing is authoritative. This prevents a model typo from switching the
  // execution language after the user has made an explicit selection.
  return { ...result.object, language: routing.language };
}
