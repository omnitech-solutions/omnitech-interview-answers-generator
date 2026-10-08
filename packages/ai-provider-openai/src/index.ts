import type {
  AiEvent,
  AiExecution,
  AiExecutionRequest,
  ModelProviderAdapter,
} from "@omnitech/ai-contracts";
import {
  createLmStudioModelPort,
  createOpenAIModelPort,
} from "@omnitech-assistant/providers";
import OpenAI from "openai";
import { createChatCompletions } from "./chat-completions";
import { parseStructuredOutput } from "./structured-output";

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
  const chat = createChatCompletions({
    label: options.label,
    model: options.model,
    baseUrl: options.baseUrl ?? "https://api.openai.com/v1",
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
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
        chat.generate({
          prompt: request.task.prompt,
          ...(request.task.type === "structured-generation" &&
          request.task.schema
            ? { responseSchema: request.task.schema }
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
            : { messages: request.task.messages }),
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
          request.task.type === "structured-generation"
            ? structured
            : { text: result.text, finishReason: result.finishReason },
        usage: result.usage,
      };
    },
    async *stream(request: AiExecutionRequest): AsyncIterable<AiEvent> {
      const executionId = crypto.randomUUID();
      yield { type: "started", executionId };
      // A structured task streams the same JSON object execute() would return:
      // the schema rides the request and the completed event carries the
      // parsed object (or the raw text when it is not valid JSON for the
      // schema, so the caller's own validation reports it). A plain stream
      // completes with its id alone, as before.
      const structured =
        request.task.type === "structured-generation"
          ? { schema: request.task.schema }
          : null;
      let text = "";
      for await (const delta of chat.stream({
        prompt: request.task.prompt,
        ...(structured?.schema ? { responseSchema: structured.schema } : {}),
        ...(request.task.system === undefined && structured === null
          ? {}
          : {
              system: [
                request.task.system,
                structured
                  ? "Return exactly one JSON object without Markdown."
                  : undefined,
              ]
                .filter(Boolean)
                .join("\n\n"),
            }),
        ...(request.task.messages === undefined
          ? {}
          : { messages: request.task.messages }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })) {
        text += delta;
        yield { type: "text-delta", text: delta };
      }
      if (structured === null) {
        yield { type: "completed", result: { executionId } };
        return;
      }
      let result: unknown;
      try {
        result = parseStructuredOutput(text, structured.schema);
      } catch {
        result = text;
      }
      yield { type: "completed", result };
    },
  };
}

export {
  createOpenAiCatalogAdapter,
  type OpenAiCatalogAdapterOptions,
} from "./catalog";
