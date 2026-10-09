import Anthropic from "@anthropic-ai/sdk";
import type {
  AiEvent,
  AiExecution,
  AiExecutionRequest,
  AiFailure,
  ModelProviderAdapter,
} from "@omnitech/ai-contracts";
import { parseStructuredOutput } from "@omnitech/ai-contracts";

export interface AnthropicAdapterOptions {
  id?: string;
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
  // One bound on a request including its retries; the same 120 s the OpenAI
  // adapter uses (the SDK default is 10 minutes per attempt, three attempts).
  timeoutMs?: number;
  client?: Anthropic;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;

// Fixed texts only: provider response bodies can echo prompt content, so they
// never reach a caller or a log.
const REFUSED: AiFailure = {
  code: "policy-refused",
  message: "The model declined this request.",
  retryable: false,
};
const CANCELLED: AiFailure = {
  code: "cancelled",
  message: "The AI request was cancelled.",
  retryable: false,
};

function failureOf(
  error: unknown,
  providerId: string,
  model: string,
  callerAborted: boolean,
  timeoutMs: number,
): AiFailure {
  if (callerAborted) return CANCELLED;
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return {
      code: "timeout",
      message: `${providerId} (${model}) failed: no reply within ${Math.round(timeoutMs / 1000)} s.`,
      retryable: true,
    };
  }
  if (error instanceof Anthropic.APIUserAbortError) {
    // Aborted by the adapter's own deadline, not by the caller.
    return {
      code: "timeout",
      message: `${providerId} (${model}) failed: no reply within ${Math.round(timeoutMs / 1000)} s.`,
      retryable: true,
    };
  }
  const status = error instanceof Anthropic.APIError ? error.status : undefined;
  return {
    code: status === 429 ? "rate-limit" : "provider",
    message: `${providerId} (${model}) failed: ${
      status === undefined
        ? error instanceof Anthropic.APIConnectionError
          ? "could not connect"
          : "unexpected error"
        : `HTTP ${status}`
    }.`,
    retryable: status === 429 || (status !== undefined && status >= 500),
  };
}

// Thrown by execute() so callers keep the Error contract; carries the typed
// failure for anything that wants it.
class AnthropicRequestError extends Error {
  constructor(readonly failure: AiFailure) {
    super(failure.message);
    this.name = "AnthropicRequestError";
  }
}

export function createAnthropicModelAdapter(
  options: AnthropicAdapterOptions,
): ModelProviderAdapter {
  const providerId = options.id ?? "anthropic";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client =
    options.client ??
    new Anthropic({
      apiKey: options.apiKey,
      timeout: timeoutMs,
      maxRetries: MAX_RETRIES,
    });
  // The deadline covers retries too, and the caller's abort ends the request.
  const requestOptions = (request: AiExecutionRequest) => ({
    signal:
      request.signal === undefined
        ? AbortSignal.timeout(timeoutMs)
        : AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]),
  });
  const usageOf = (usage: { input_tokens: number; output_tokens: number }) => ({
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.input_tokens + usage.output_tokens,
  });
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
      // This adapter sends text messages only: it declares no capability it
      // does not implement.
      tools: false,
      vision: false,
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
          requestOptions(request),
        );
      const guarded = async (repair?: string) => {
        try {
          const response = await create(repair);
          if (response.stop_reason === "refusal") {
            throw new AnthropicRequestError(REFUSED);
          }
          return response;
        } catch (error) {
          if (error instanceof AnthropicRequestError) throw error;
          throw new AnthropicRequestError(
            failureOf(
              error,
              providerId,
              options.model,
              request.signal?.aborted === true,
              timeoutMs,
            ),
          );
        }
      };
      let response = await guarded();
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
          response = await guarded(
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
        usage: usageOf(response.usage),
      };
    },
    async *stream(request: AiExecutionRequest): AsyncIterable<AiEvent> {
      const executionId = crypto.randomUUID();
      yield { type: "started", executionId };
      try {
        const stream = client.messages.stream(
          {
            model: options.model,
            max_tokens: options.maxOutputTokens ?? 4096,
            messages: toMessages(request),
            ...(request.task.system === undefined
              ? {}
              : { system: request.task.system }),
          },
          requestOptions(request),
        );
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            yield { type: "text-delta", text: event.delta.text };
          }
        }
        // finalMessage() carries the usage and the stop reason the deltas lack.
        const final = await stream.finalMessage();
        yield { type: "usage", usage: usageOf(final.usage) };
        if (final.stop_reason === "refusal") {
          yield { type: "failed", error: REFUSED };
          return;
        }
        yield {
          type: "completed",
          result: {
            executionId,
            finishReason: final.stop_reason ?? "unknown",
          },
        };
      } catch (error) {
        yield {
          type: "failed",
          error: failureOf(
            error,
            providerId,
            options.model,
            request.signal?.aborted === true,
            timeoutMs,
          ),
        };
      }
    },
  };
}
