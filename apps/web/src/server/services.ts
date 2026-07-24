import { resolve } from "node:path";

import { createAiClientFromEnv } from "@omnitech/ai-sdk";
import { DockerCodeRunner } from "@omnitech/code-runner";
import {
  generatedAnswerSchema,
  getWorkflow,
  routeQuestion,
  type GenerateRequest,
} from "@omnitech/interview-contracts";
import { JsonAnswerRepository } from "@omnitech/interview-storage";

const dataDirectory =
  process.env["INTERVIEW_DATA_DIR"] ?? resolve(process.cwd(), ".data");

export const answerRepository = new JsonAnswerRepository(dataDirectory);
export const codeRunner = new DockerCodeRunner();

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
