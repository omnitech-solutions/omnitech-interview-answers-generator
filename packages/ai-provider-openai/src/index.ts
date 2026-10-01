import OpenAI from "openai";
import {
  createOpenAIModelPort,
  createLmStudioModelPort,
} from "@omni-assistant/providers";
import type {
  AiEvent,
  AiExecution,
  AiExecutionRequest,
  ModelProviderAdapter,
} from "@omnitech/ai-contracts";
import { parseStructuredOutput } from "./structured-output.js";
import {
  createAiClient,
  createOpenAiCompatibleProvider,
} from "@omnitech/ai-sdk";

export interface OpenAiAdapterOptions {
  id: string;
  label: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  temperature?: number;
  localStructuredMode?: "json-schema" | "json-string";
}

export function createOpenAiModelAdapter(
  options: OpenAiAdapterOptions,
): ModelProviderAdapter {
  const provider = createOpenAiCompatibleProvider({
    id: options.id,
    label: options.label,
    model: options.model,
    baseUrl: options.baseUrl ?? "https://api.openai.com/v1",
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
  });
  const client = createAiClient({
    providers: [provider],
    defaultProviderId: options.id,
  });

  const portOptions = {
    resolveProfile: () => ({
      modelId: options.model,
      ...(options.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: options.maxOutputTokens }),
      ...(options.temperature === undefined
        ? {}
        : { temperature: options.temperature }),
    }),
  };
  const structured = options.apiKey
    ? createOpenAIModelPort(
        new OpenAI({
          apiKey: options.apiKey,
          baseURL: options.baseUrl ?? "https://api.openai.com/v1",
          timeout: options.timeoutMs ?? 120_000,
          maxRetries: 0,
          logLevel: "off",
        }),
        portOptions,
      )
    : createLmStudioModelPort({
        ...portOptions,
        baseURL: options.baseUrl ?? "http://127.0.0.1:1234/v1",
        timeoutMs: options.timeoutMs ?? 120_000,
        ...(options.localStructuredMode
          ? { structuredMode: options.localStructuredMode }
          : {}),
      });
  return {
    streamStructured(request) {
      return structured.stream(
        {
          tenantId: request.context.tenantId,
          actorId: request.context.userId,
          productId: request.context.productId,
        },
        request,
        request.signal ?? new AbortController().signal,
      );
    },
    providerId: options.id,
    modelId: options.model,
    capabilities: {
      streaming: true,
      structuredOutput: true,
      tools: true,
      vision: true,
      search: false,
    },
    async execute(request): Promise<AiExecution> {
      const generate = (repair?: string) =>
        client.generateText({
          prompt: request.task.prompt,
          ...(request.task.type === "structured-generation" &&
          request.task.schema
            ? { responseSchema: request.task.schema as never }
            : {}),
          ...(request.task.system === undefined &&
          request.task.type !== "structured-generation"
            ? {}
            : {
                system: [
                  request.task.system,
                  request.task.type === "structured-generation"
                    ? "Return exactly one JSON object without Markdown."
                    : undefined,
                  repair,
                ]
                  .filter(Boolean)
                  .join("\n\n"),
              }),
          ...(request.task.messages === undefined
            ? {}
            : {
                messages: request.task.messages.map((message) => ({
                  ...message,
                })),
              }),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
      let result = await generate();
      let structured: unknown;
      if (request.task.type === "structured-generation") {
        try {
          structured = parseStructuredOutput(result.text, request.task.schema);
        } catch (error) {
          const reason =
            error instanceof Error ? error.message : "invalid output";
          result = await generate(
            `Your previous response was invalid: ${reason}. Return only a corrected JSON object.`,
          );
          structured = parseStructuredOutput(result.text, request.task.schema);
        }
      }
      return {
        executionId: crypto.randomUUID(),
        family: "direct-model",
        targetId: options.id,
        result:
          request.task.type === "structured-generation" ? structured : result,
        usage: result.usage,
      };
    },
    async *stream(request: AiExecutionRequest): AsyncIterable<AiEvent> {
      const executionId = crypto.randomUUID();
      yield { type: "started", executionId };
      for await (const event of client.streamText({
        prompt: request.task.prompt,
        ...(request.task.system === undefined
          ? {}
          : { system: request.task.system }),
        ...(request.task.messages === undefined
          ? {}
          : {
              messages: request.task.messages.map((message) => ({
                ...message,
              })),
            }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })) {
        if (event.type === "text-delta" && event.text) {
          yield { type: "text-delta", text: event.text };
        }
      }
      yield { type: "completed", result: { executionId } };
    },
  };
}

export const createOpenAiCompatibleModelAdapter = createOpenAiModelAdapter;
