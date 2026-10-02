import { AiSdkError } from "./errors.js";
import type { ZodType } from "zod";
import type {
  AiClient,
  AiGenerateInput,
  AiMessage,
  AiObjectInput,
  AiProvider,
  AiUsage,
  CreateAiClientOptions,
} from "./types.js";

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start < 0 || end < start) {
    throw new AiSdkError(
      "invalid_output",
      "The model did not return a JSON object.",
    );
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (error) {
    throw new AiSdkError(
      "invalid_output",
      "The model returned invalid JSON.",
      error,
    );
  }
}

type ObjectCheck<T> = { ok: true; value: T } | { ok: false; issues: string[] };

// Validates a model reply, describing each failure by field path and the
// expectation only, never the generated content.
function checkObject<T>(schema: ZodType<T>, text: string): ObjectCheck<T> {
  let candidate: unknown;
  try {
    candidate = extractJson(text);
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : "Not a JSON object."],
    };
  }
  const parsed = schema.safeParse(candidate);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues.map(
    (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
  );
  return { ok: false, issues: [...new Set(issues)].slice(0, 8) };
}

function addUsage(first: AiUsage, second: AiUsage): AiUsage {
  const sum = (a?: number, b?: number) =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  const usage: AiUsage = {};
  for (const key of ["inputTokens", "outputTokens", "totalTokens"] as const) {
    const total = sum(first[key], second[key]);
    if (total !== undefined) usage[key] = total;
  }
  return usage;
}

export function createAiClient(options: CreateAiClientOptions): AiClient {
  if (options.providers.length === 0) {
    throw new AiSdkError(
      "configuration",
      "At least one AI provider is required.",
    );
  }

  const providers = new Map<string, AiProvider>(
    options.providers.map((provider) => [provider.summary.id, provider]),
  );
  const defaultProviderId =
    options.defaultProviderId ?? options.providers[0]?.summary.id;

  if (!defaultProviderId || !providers.has(defaultProviderId)) {
    throw new AiSdkError(
      "configuration",
      `Default provider "${defaultProviderId ?? ""}" is not configured.`,
    );
  }
  const resolvedDefaultProviderId = defaultProviderId;

  function resolveProvider(providerId?: string): AiProvider {
    const selectedId = providerId ?? resolvedDefaultProviderId;
    const provider = providers.get(selectedId);

    if (!provider) {
      throw new AiSdkError(
        "unknown_provider",
        `AI provider "${selectedId}" is not configured.`,
      );
    }

    return provider;
  }

  return {
    listProviders: () =>
      [...providers.values()].map((provider) => provider.summary),
    getDefaultProviderId: () => resolvedDefaultProviderId,
    generateText: (input) =>
      resolveProvider(input.providerId).generateText(input),
    async generateObject<T>(input: AiObjectInput<T>) {
      const provider = resolveProvider(input.providerId);
      const { prompt, messages, schema, ...request } = input;
      const system = [
        input.system,
        "Return exactly one JSON object. Do not wrap it in Markdown.",
      ]
        .filter(Boolean)
        .join("\n\n");
      const conversation: AiMessage[] = [
        ...(messages ?? []),
        ...(prompt === undefined
          ? []
          : [{ role: "user" as const, content: prompt }]),
      ];
      const first = await provider.generateText({
        ...request,
        system,
        messages: conversation,
      });
      const firstCheck = checkObject(schema, first.text);
      if (firstCheck.ok) return { ...first, object: firstCheck.value };

      // [STRATEGY] One correction turn: the model sees its own reply and
      // exactly which fields failed, and returns the whole object again.
      // The schema stays authoritative; nothing is rewritten on its behalf.
      const second = await provider.generateText({
        ...request,
        system,
        messages: [
          ...conversation,
          { role: "assistant", content: first.text },
          {
            role: "user",
            content: [
              "That JSON does not match the required format:",
              ...firstCheck.issues.map((issue) => `- ${issue}`),
              "Return the complete corrected JSON object only.",
            ].join("\n"),
          },
        ],
      });
      const secondCheck = checkObject(schema, second.text);
      if (secondCheck.ok)
        return {
          ...second,
          object: secondCheck.value,
          usage: addUsage(first.usage, second.usage),
        };
      const detail = `${provider.summary.label} (${provider.summary.model}) returned a reply that did not match the required format, even after one correction: ${secondCheck.issues.join("; ")}`;
      throw new AiSdkError("invalid_output", detail, undefined, detail);
    },
    streamText(input: AiGenerateInput) {
      const provider = resolveProvider(input.providerId);
      if (!provider.streamText) {
        throw new AiSdkError(
          "configuration",
          `AI provider "${provider.summary.id}" does not support streaming.`,
        );
      }
      return provider.streamText(input);
    },
  };
}
