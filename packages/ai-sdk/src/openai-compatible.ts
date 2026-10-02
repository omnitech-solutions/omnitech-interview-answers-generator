import OpenAI from "openai";
import {
  loopbackChatURL,
  readOpenAIChunks,
  requestLmStudio,
} from "@omnitech-assistant/providers";
import { AiSdkError } from "./errors.js";
import type {
  AiGenerateInput,
  AiProvider,
  AiStreamEvent,
  OpenAiCompatibleProviderOptions,
} from "./types.js";
// What went wrong, for a technical reader: the kind of failure and where, never
// the provider's own message (which can echo the prompt or credentials).
function failureKind(
  error: unknown,
  options: { baseUrl: string; timeoutMs?: number | undefined },
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
    return `no reply within ${Math.round((options.timeoutMs ?? 120_000) / 1000)} s`;
  if (
    chain.some(
      (link) =>
        link["code"] === "ECONNREFUSED" ||
        link["name"] === "APIConnectionError",
    )
  )
    return `could not connect to ${new URL(options.baseUrl).origin}`;
  return "unexpected error";
}

function messages(input: AiGenerateInput) {
  return [
    ...(input.system === undefined
      ? []
      : [{ role: "system" as const, content: input.system }]),
    ...(input.prompt !== undefined
      ? [{ role: "user" as const, content: input.prompt }]
      : (input.messages ?? [{ role: "user" as const, content: "" }])),
  ];
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
) {
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
export function createOpenAiCompatibleProvider(
  options: OpenAiCompatibleProviderOptions,
): AiProvider {
  const anonymous = !options.apiKey;
  if (anonymous) {
    loopbackChatURL(options.baseUrl);
    if (
      Object.keys(options.headers ?? {}).some((k) =>
        /^(authorization|proxy-authorization|x-api-key)$/i.test(k),
      )
    )
      throw new Error("Anonymous providers cannot contain credential headers");
  }
  const client = anonymous
    ? undefined
    : new OpenAI({
        apiKey: options.apiKey!,
        baseURL: options.baseUrl.replace(/\/$/, ""),
        timeout: options.timeoutMs ?? 120_000,
        maxRetries: 2,
        logLevel: "off",
        ...(options.headers === undefined
          ? {}
          : { defaultHeaders: options.headers }),
      });
  function signal(input: AiGenerateInput) {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 120_000);
    return input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  }
  function body(input: AiGenerateInput) {
    return {
      model: options.model,
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
      ...(input.temperature === undefined
        ? {}
        : { temperature: input.temperature }),
      ...(input.maxOutputTokens === undefined
        ? {}
        : { max_tokens: input.maxOutputTokens }),
    };
  }
  function failure(error: unknown, input: AiGenerateInput) {
    return input.signal?.aborted
      ? new AiSdkError("aborted", "The AI request was cancelled.", error)
      : (() => {
          const detail = `${options.label ?? options.id} (${options.model}) failed: ${failureKind(error, options)}.`;
          return new AiSdkError("provider_failure", detail, error, detail);
        })();
  }
  async function localRequest(
    input: AiGenerateInput,
    stream: boolean,
    abort: AbortSignal,
  ) {
    // Preserve the compatibility facade's bounded two retries before any streaming effects.
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await requestLmStudio(
          {
            baseURL: options.baseUrl,
            timeoutMs: options.timeoutMs ?? 120_000,
            ...(options.headers === undefined
              ? {}
              : { headers: options.headers }),
          },
          {
            ...body(input),
            stream,
            ...(stream ? { stream_options: { include_usage: true } } : {}),
          },
          abort,
        );
      } catch (error) {
        last = error;
        abort.throwIfAborted();
        if (
          attempt === 2 ||
          !(error instanceof Error) ||
          !/HTTP (408|409|429|5\d\d)$/.test(error.message)
        )
          throw error;
        await new Promise<void>((resolve, reject) => {
          const stop = () => {
            clearTimeout(timer);
            reject(abort.reason);
          };
          const timer = setTimeout(
            () => {
              abort.removeEventListener("abort", stop);
              resolve();
            },
            2000 * 2 ** attempt,
          );
          abort.addEventListener("abort", stop, { once: true });
        });
      }
    }
    throw last;
  }
  return {
    summary: { id: options.id, label: options.label, model: options.model },
    async generateText(input) {
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
          finishReason:
            choice.finish_reason === "length"
              ? "length"
              : choice.finish_reason === "stop"
                ? "stop"
                : choice.finish_reason,
          providerId: options.id,
          text: choice.message.content ?? "",
          usage: normalizeUsage(result.usage),
        };
      } catch (error) {
        throw failure(error, input);
      }
    },
    async *streamText(input): AsyncIterable<AiStreamEvent> {
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
          if (delta) yield { type: "text-delta", text: delta };
        }
        yield { type: "finish" };
      } catch (error) {
        throw failure(error, input);
      }
    },
  };
}
