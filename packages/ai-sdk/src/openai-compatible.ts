import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, streamText } from "ai";

import { AiSdkError } from "./errors.js";
import type {
  AiGenerateInput,
  AiProvider,
  AiStreamEvent,
  OpenAiCompatibleProviderOptions,
} from "./types.js";

function toModelInput(
  input: AiGenerateInput,
  model: ReturnType<ReturnType<typeof createOpenAICompatible>>,
) {
  const prompt =
    input.prompt ??
    input.messages
      ?.map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join("\n\n") ??
    "";

  return {
    model,
    prompt,
    ...(input.system === undefined ? {} : { system: input.system }),
    ...(input.temperature === undefined
      ? {}
      : { temperature: input.temperature }),
    ...(input.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: input.maxOutputTokens }),
    ...(input.signal === undefined ? {} : { abortSignal: input.signal }),
  };
}

function normalizeUsage(usage: {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
}) {
  return {
    ...(usage.inputTokens === undefined
      ? {}
      : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined
      ? {}
      : { outputTokens: usage.outputTokens }),
    ...(usage.totalTokens === undefined
      ? {}
      : { totalTokens: usage.totalTokens }),
  };
}

export function createOpenAiCompatibleProvider(
  options: OpenAiCompatibleProviderOptions,
): AiProvider {
  const provider = createOpenAICompatible({
    name: options.id,
    baseURL: options.baseUrl.replace(/\/$/, ""),
    apiKey: options.apiKey ?? "",
    ...(options.headers === undefined ? {} : { headers: options.headers }),
  });
  const model = provider(options.model);

  return {
    summary: {
      id: options.id,
      label: options.label,
      model: options.model,
    },
    async generateText(input) {
      try {
        const timeout = AbortSignal.timeout(options.timeoutMs ?? 120_000);
        const signal = input.signal
          ? AbortSignal.any([input.signal, timeout])
          : timeout;
        const result = await generateText(
          toModelInput({ ...input, signal }, model),
        );

        return {
          finishReason: String(result.finishReason),
          providerId: options.id,
          text: result.text,
          usage: normalizeUsage(result.usage),
        };
      } catch (error) {
        if (input.signal?.aborted) {
          throw new AiSdkError(
            "aborted",
            "The AI request was cancelled.",
            error,
          );
        }
        throw new AiSdkError(
          "provider_failure",
          `AI provider "${options.id}" failed.`,
          error,
        );
      }
    },
    async *streamText(input): AsyncIterable<AiStreamEvent> {
      const timeout = AbortSignal.timeout(options.timeoutMs ?? 120_000);
      const signal = input.signal
        ? AbortSignal.any([input.signal, timeout])
        : timeout;
      const result = streamText(toModelInput({ ...input, signal }, model));

      for await (const delta of result.textStream) {
        yield { type: "text-delta", text: delta };
      }

      yield { type: "finish" };
    },
  };
}
