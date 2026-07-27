import { createInterviewApiClient } from "@omnitech/interview-api-client";
import {
  createPlaygroundControlClient,
  type PlaygroundControlClient,
} from "@omnitech/interview-playground-control";

import { readConfig } from "./config.js";
import type { InterviewAnswersClient } from "./public-types.js";

export interface CreateConfiguredClientOptions {
  token?: string;
  url?: string;
}

export async function createConfiguredClient(
  options: CreateConfiguredClientOptions = {},
): Promise<InterviewAnswersClient> {
  const config = await readConfig();
  const token =
    options.token ?? process.env["INTERVIEW_API_TOKEN"] ?? config.token;
  const client = createInterviewApiClient({
    baseUrl:
      options.url ??
      process.env["INTERVIEW_API_URL"] ??
      config.url ??
      "http://127.0.0.1:3000",
    ...(token === undefined ? {} : { token }),
  });

  return {
    deleteAnswer: (id) => client.deleteAnswer(id),
    explain: (input) => client.explain(input),
    generate: (input) =>
      client.generate({
        ...input,
        language: input.language ?? "auto",
      }),
    getAnswer: (id) => client.getAnswer(id),
    health: () => client.health(),
    listAnswers: () => client.listAnswers(),
    listExplanations: () => client.listExplanations(),
    route: (input) =>
      client.route({
        ...input,
        language: input.language ?? "auto",
      }),
    run: (input) =>
      client.run({
        ...input,
        stdin: input.stdin ?? "",
      }),
    saveAnswer: (input) => {
      const { id, notes, ...answer } = input;
      return client.saveAnswer({
        ...answer,
        ...(id === undefined ? {} : { id }),
        notes: notes ?? "",
      });
    },
    saveExplanation: (input) => client.saveExplanation(input),
  };
}

export async function createConfiguredPlaygroundControlClient(
  options: CreateConfiguredClientOptions = {},
): Promise<PlaygroundControlClient> {
  const config = await readConfig();
  const token =
    options.token ?? process.env["INTERVIEW_API_TOKEN"] ?? config.token;

  return createPlaygroundControlClient({
    baseUrl:
      options.url ??
      process.env["INTERVIEW_API_URL"] ??
      config.url ??
      "http://127.0.0.1:3000",
    ...(token === undefined ? {} : { token }),
  });
}

export { configPath, readConfig, writeConfig } from "./config.js";
export type {
  GeneratedInterviewAnswer,
  GeneratedInterviewExplanation,
  InterviewAnswersClient,
  InterviewLanguage,
  InterviewLanguageSelection,
  InterviewRouteResult,
  InterviewRunResult,
  SavedInterviewAnswer,
  SavedInterviewExplanation,
} from "./public-types.js";
export {
  createPlaygroundControlClient,
  parsePlaygroundPatch,
  PlaygroundControlError,
} from "@omnitech/interview-playground-control";
export type {
  PlaygroundAnswer,
  PlaygroundAnswerLanguage,
  PlaygroundControlClient,
  PlaygroundControlClientOptions,
  PlaygroundLanguage,
  PlaygroundPanel,
  PlaygroundPatch,
  PlaygroundSnapshot,
  PlaygroundValue,
} from "@omnitech/interview-playground-control";
