import type {
  AiEvent,
  AiExecution,
  AiExecutionRequest,
  ModelProviderAdapter,
} from "@omnitech/ai-contracts";
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

  return {
    providerId: options.id,
    capabilities: {
      streaming: true,
      structuredOutput: true,
      tools: false,
      vision: true,
      search: false,
    },
    async execute(request): Promise<AiExecution> {
      const result = await client.generateText({
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
      });
      return {
        executionId: crypto.randomUUID(),
        family: "direct-model",
        targetId: options.id,
        result,
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
