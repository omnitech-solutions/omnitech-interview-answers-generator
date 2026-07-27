import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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
} from "@omnitech/interview-storage";

const dataDirectory =
  process.env["INTERVIEW_DATA_DIR"] ?? resolve(process.cwd(), ".data");

export const answerRepository = new JsonAnswerRepository(dataDirectory);
export const explanationRepository = new JsonExplanationRepository(
  dataDirectory,
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
    system: `You are an interview preparation coach for a 60-minute full-stack and DSA interview.
Write a guided answer path the candidate can actually deliver aloud. Make it
obvious where to start and what to discuss next. Use at most 650 spoken words
for a broad multi-part prompt.

Required structure:
# Short title
## Start here
## Answer plan
## Work through the questions

Start "## Start here" with “I’d start by…” and write a natural 30–45-second
opening the candidate can say verbatim. Make "## Answer plan" a numbered list of
3–5 steps. Group related questions under at most five short subheadings in
"## Work through the questions". Format every question as
"### Question N: Short question". Put its 1–3 sentence spoken answer immediately
below in a blockquote beginning "> **Answer:**". This convention is required
because Concept Lab visually distinguishes questions in blue and answers in
green. Follow only when useful with concise "**Remember:**" bullets. Add "## If
they probe" and "## Likely follow-ups" only when useful, with at most three
items each.

Do not repeat facts across sections. Do not produce an exhaustive reference
guide, state-ownership table, testing checklist, API tutorial, or implementation
walkthrough unless explicitly requested. Include one Mermaid diagram of
preferably no more than eight nodes only when sequence, data flow, lifecycle,
or architecture is materially clearer visually. Diagram syntax does not count
toward the spoken word budget.

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
