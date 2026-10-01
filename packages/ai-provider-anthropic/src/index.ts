import Anthropic from "@anthropic-ai/sdk";
import type {
  AiEvent,
  AiExecution,
  AiExecutionRequest,
  ModelProviderAdapter,
} from "@omnitech/ai-contracts";
import { parseStructuredOutput } from "@omnitech/ai-contracts";

export interface AnthropicAdapterOptions {
  id?: string;
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
  client?: Anthropic;
}

export function createAnthropicModelAdapter(
  options: AnthropicAdapterOptions,
): ModelProviderAdapter {
  const providerId = options.id ?? "anthropic";
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const toMessages = (request: AiExecutionRequest) =>
    request.task.messages
      ?.filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
      })) ?? [{ role: "user" as const, content: request.task.prompt }];

  return {
    providerId,
    modelId: options.model,
    capabilities: {
      streaming: true,
      structuredOutput: true,
      tools: true,
      vision: true,
      search: false,
    },
    async execute(request): Promise<AiExecution> {
      const create = (repair?: string) =>
        client.messages.create(
          {
            model: options.model,
            max_tokens: options.maxOutputTokens ?? 4096,
            messages: toMessages(request),
            ...(request.task.system === undefined && !repair
              ? {}
              : {
                  system: [request.task.system, repair]
                    .filter(Boolean)
                    .join("\n\n"),
                }),
          },
          request.signal === undefined ? {} : { signal: request.signal },
        );
      let response = await create();
      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      let structured: unknown;
      if (request.task.type === "structured-generation") {
        try {
          structured = parseStructuredOutput(text, request.task.schema);
        } catch (error) {
          const reason =
            error instanceof Error ? error.message : "invalid output";
          response = await create(
            `Your previous response was invalid: ${reason}. Return only a corrected JSON object.`,
          );
          const retryText = response.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("");
          structured = parseStructuredOutput(retryText, request.task.schema);
        }
      }
      return {
        executionId: crypto.randomUUID(),
        family: "direct-model",
        targetId: providerId,
        result:
          request.task.type === "structured-generation"
            ? structured
            : { text, finishReason: response.stop_reason ?? "unknown" },
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens:
            response.usage.input_tokens + response.usage.output_tokens,
        },
      };
    },
    async *stream(request: AiExecutionRequest): AsyncIterable<AiEvent> {
      const executionId = crypto.randomUUID();
      yield { type: "started", executionId };
      const stream = client.messages.stream({
        model: options.model,
        max_tokens: options.maxOutputTokens ?? 4096,
        messages: toMessages(request),
        ...(request.task.system === undefined
          ? {}
          : { system: request.task.system }),
      });
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield { type: "text-delta", text: event.delta.text };
        }
      }
      yield { type: "completed", result: { executionId } };
    },
  };
}
