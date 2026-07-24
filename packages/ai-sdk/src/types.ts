import type { ZodType } from "zod";

export type AiRole = "system" | "user" | "assistant";

export interface AiMessage {
  content: string;
  role: AiRole;
}

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AiProviderSummary {
  id: string;
  label: string;
  model: string;
}

export interface AiGenerateInput {
  maxOutputTokens?: number;
  messages?: AiMessage[];
  prompt?: string;
  providerId?: string;
  signal?: AbortSignal;
  system?: string;
  temperature?: number;
}

export interface AiTextResult {
  finishReason: string;
  providerId: string;
  text: string;
  usage: AiUsage;
}

export interface AiObjectInput<T> extends AiGenerateInput {
  schema: ZodType<T>;
}

export interface AiObjectResult<T> extends AiTextResult {
  object: T;
}

export interface AiStreamEvent {
  type: "text-delta" | "finish";
  text?: string;
}

export interface AiProvider {
  readonly summary: AiProviderSummary;
  generateText(input: AiGenerateInput): Promise<AiTextResult>;
  streamText?(input: AiGenerateInput): AsyncIterable<AiStreamEvent>;
}

export interface AiClient {
  generateObject<T>(input: AiObjectInput<T>): Promise<AiObjectResult<T>>;
  generateText(input: AiGenerateInput): Promise<AiTextResult>;
  getDefaultProviderId(): string;
  listProviders(): AiProviderSummary[];
  streamText(input: AiGenerateInput): AsyncIterable<AiStreamEvent>;
}

export interface CreateAiClientOptions {
  defaultProviderId?: string;
  providers: AiProvider[];
}

export interface OpenAiCompatibleProviderOptions {
  apiKey?: string;
  baseUrl: string;
  headers?: Record<string, string>;
  id: string;
  label: string;
  model: string;
  timeoutMs?: number;
}

export interface AiEnvironment {
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  AI_PROVIDER_ID?: string;
  AI_PROVIDER_LABEL?: string;
  AI_TIMEOUT_MS?: string;
}
