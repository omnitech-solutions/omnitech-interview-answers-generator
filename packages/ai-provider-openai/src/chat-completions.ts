import OpenAI from "openai";
import {
  loopbackChatURL,
  readOpenAIChunks,
  requestLmStudio,
} from "@omnitech-assistant/providers";
import type { AiUsage } from "@omnitech/ai-contracts";

// The chat-completions transport behind the adapter's execute and stream: the
// OpenAI client for a keyed endpoint, or LM Studio's anonymous loopback
// endpoint with bounded retries.

export interface ChatEndpoint {
  label: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface ChatInput {
  prompt?: string;
  system?: string;
  messages?: readonly {
    role: "system" | "user" | "assistant";
    content: string;
  }[];
  responseSchema?: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
}

export interface ChatReply {
  finishReason: string;
  text: string;
  usage: AiUsage;
}

/**
 * A failed request. The message is safe to show a person: it names the model
 * and the kind of failure, never the provider's own message (which can echo
 * the prompt or credentials).
 */
export class ChatRequestError extends Error {
  constructor(
    readonly code: "cancelled" | "provider",
    message: string,
    options: { cause: unknown },
  ) {
    super(message, options);
    this.name = "ChatRequestError";
  }
}

export function createChatCompletions(endpoint: ChatEndpoint) {
  const timeoutMs = endpoint.timeoutMs ?? 120_000;
  // [SAFETY] Without a key the endpoint must be this machine's LM Studio:
  // an anonymous request never leaves the loopback interface.
  if (!endpoint.apiKey) loopbackChatURL(endpoint.baseUrl);
  const client = endpoint.apiKey
    ? new OpenAI({
        apiKey: endpoint.apiKey,
        baseURL: endpoint.baseUrl.replace(/\/$/, ""),
        timeout: timeoutMs,
        maxRetries: 2,
        logLevel: "off",
      })
    : undefined;

  function signal(input: ChatInput) {
    const timeout = AbortSignal.timeout(timeoutMs);
    return input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  }

  function body(input: ChatInput) {
    return {
      model: endpoint.model,
      messages: messages(input),
      ...(input.responseSchema === undefined
        ? {}
        : {
            response_format: {
              type: "json_schema" as const,
              json_schema: {
                name: "structured_output",
                strict: true,
                schema: input.responseSchema as Record<string, unknown>,
              },
            },
          }),
    };
  }

  function failure(error: unknown, input: ChatInput) {
    if (input.signal?.aborted)
      return new ChatRequestError(
        "cancelled",
        "The AI request was cancelled.",
        {
          cause: error,
        },
      );
    return new ChatRequestError(
      "provider",
      `${endpoint.label} (${endpoint.model}) failed: ${failureKind(error, endpoint.baseUrl, timeoutMs)}.`,
      { cause: error },
    );
  }

  // [STRATEGY] LM Studio answers 429/5xx while it loads a model: retry twice
  // with backoff, always before anything has been streamed to the caller.
  async function localRequest(
    input: ChatInput,
    stream: boolean,
    abort: AbortSignal,
  ) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await requestLmStudio(
          { baseURL: endpoint.baseUrl, timeoutMs },
          {
            ...body(input),
            stream,
            ...(stream ? { stream_options: { include_usage: true } } : {}),
          },
          abort,
        );
      } catch (error) {
        abort.throwIfAborted();
        if (
          attempt === 2 ||
          !(error instanceof Error) ||
          !/HTTP (408|409|429|5\d\d)$/.test(error.message)
        )
          throw error;
        await backoff(2000 * 2 ** attempt, abort);
      }
    }
  }

  return {
    async generate(input: ChatInput): Promise<ChatReply> {
      try {
        const abort = signal(input);
        abort.throwIfAborted();
        const result = client
          ? await client.chat.completions.create(body(input), { signal: abort })
          : ((await (
              await localRequest(input, false, abort)
            ).json()) as OpenAI.Chat.Completions.ChatCompletion);
        const choice = result.choices[0];
        if (!choice) throw new Error("Provider returned no completion");
        return {
          finishReason: choice.finish_reason,
          text: choice.message.content ?? "",
          usage: normalizeUsage(result.usage),
        };
      } catch (error) {
        throw failure(error, input);
      }
    },
    async *stream(input: ChatInput): AsyncIterable<string> {
      try {
        const abort = signal(input);
        abort.throwIfAborted();
        const source = client
          ? await client.chat.completions.create(
              { ...body(input), stream: true },
              { signal: abort },
            )
          : readOpenAIChunks(await localRequest(input, true, abort), abort);
        for await (const chunk of source) {
          abort.throwIfAborted();
          const delta = chunk.choices[0]?.delta.content;
          if (delta) yield delta;
        }
      } catch (error) {
        throw failure(error, input);
      }
    },
  };
}

// An explicit prompt is the user turn; otherwise the conversation is sent.
function messages(input: ChatInput) {
  return [
    ...(input.system === undefined
      ? []
      : [{ role: "system" as const, content: input.system }]),
    ...(input.prompt !== undefined
      ? [{ role: "user" as const, content: input.prompt }]
      : (input.messages ?? [{ role: "user" as const, content: "" }]).map(
          (message) => ({ ...message }),
        )),
  ];
}

function backoff(ms: number, abort: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      reject(abort.reason);
    };
    const timer = setTimeout(() => {
      abort.removeEventListener("abort", stop);
      resolve();
    }, ms);
    abort.addEventListener("abort", stop, { once: true });
  });
}

// What went wrong, for a technical reader: the kind of failure and where.
function failureKind(
  error: unknown,
  baseUrl: string,
  timeoutMs: number,
): string {
  // Wrapped errors (fetch, the OpenAI client) keep the cause underneath.
  const chain: Record<string, unknown>[] = [];
  for (
    let current: unknown = error;
    current && typeof current === "object" && chain.length < 5;
    current = (current as { cause?: unknown }).cause
  )
    chain.push(current as Record<string, unknown>);
  const status = chain.find((link) => typeof link["status"] === "number");
  if (status) return `HTTP ${status["status"]}`;
  if (
    chain.some((link) =>
      ["TimeoutError", "APIConnectionTimeoutError"].includes(
        String(link["name"]),
      ),
    )
  )
    return `no reply within ${Math.round(timeoutMs / 1000)} s`;
  if (
    chain.some(
      (link) =>
        link["code"] === "ECONNREFUSED" ||
        link["name"] === "APIConnectionError",
    )
  )
    return `could not connect to ${new URL(baseUrl).origin}`;
  return "unexpected error";
}

function normalizeUsage(
  usage:
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      }
    | null
    | undefined,
): AiUsage {
  return {
    ...(usage?.prompt_tokens === undefined
      ? {}
      : { inputTokens: usage.prompt_tokens }),
    ...(usage?.completion_tokens === undefined
      ? {}
      : { outputTokens: usage.completion_tokens }),
    ...(usage?.total_tokens === undefined
      ? {}
      : { totalTokens: usage.total_tokens }),
  };
}
