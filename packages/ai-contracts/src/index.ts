import type {
  ModelInfo,
  ModelInput,
  ModelPart,
} from "@omnitech-assistant/contracts";
export type AiExecutionFamily = "direct-model" | "agent-runtime";
export type AiModelKind = "language" | "embedding" | "image" | "multimodal";
export type AiTaskType =
  | "text-generation"
  | "structured-generation"
  | "streaming-chat"
  | "structured-chat"
  | "image-generation"
  | "image-editing"
  | "retrieval"
  | "agent-job";

/**
 * Where a request's session content may be processed. Absent means the host's
 * existing behaviour; `device-only` is enforced by the gateway and never falls
 * back to a remote profile (ADR-0012).
 */
export type AiProcessingPolicy = "device-only" | "permitted-remote";

export interface AiAccessContext {
  tenantId: string;
  userId: string;
  productId: string;
  permissions: readonly string[];
}

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  // Agent runtimes: model turns the run took and time spent in the API, so a
  // slow run can be read as retries or as thinking.
  turns?: number;
  apiMs?: number;
}

export interface InstructionSource {
  id: string;
  version: string;
  content: string;
}

export interface AgentAttachment {
  id: string;
  kind: "file" | "image";
  name: string;
  reference: string;
  mimeType?: string;
}

export interface InstructionBundle {
  platformRules: readonly InstructionSource[];
  productRules: readonly InstructionSource[];
  tenantRules: readonly InstructionSource[];
  taskPrompt: string;
  attachments: readonly AgentAttachment[];
  outputSchema?: Readonly<Record<string, unknown>>;
}

// An attachment list stays small: a request names a few frozen images, not a
// folder (ADR-0016). The gateway refuses a longer list before any dispatch.
export const MAX_TASK_ATTACHMENTS = 4;

// A model id is interpolated into provider URLs and request bodies, so only a
// plain catalog name passes: up to four slash-separated segments of letters,
// digits, dot, underscore and dash, each starting alphanumeric. No scheme, no
// leading slash, no "..", no query or fragment characters.
export const IMAGE_MODEL_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*){0,3}$/;
export const IMAGE_MODEL_ID_MAX_LENGTH = 100;

export function isSafeImageModelId(value: string): boolean {
  return (
    value.length <= IMAGE_MODEL_ID_MAX_LENGTH &&
    IMAGE_MODEL_ID_PATTERN.test(value) &&
    !value.includes("..")
  );
}

export interface AiTask {
  type: AiTaskType;
  prompt: string;
  system?: string;
  // Reaches agent runtimes only; a direct-model profile refuses them rather
  // than answering text-only (ADR-0016 screenshot-attachments-fail-closed).
  attachments?: readonly AgentAttachment[];
  messages?: readonly {
    role: "system" | "user" | "assistant";
    content: string;
  }[];
  schema?: Readonly<Record<string, unknown>>;
  image?: {
    modelId?: string;
    negativePrompt?: string;
    aspectRatio?: string;
    width?: number;
    height?: number;
    quality?: string;
    seed?: number;
    inputAssetReferences?: readonly string[];
  };
}

export interface AiExecutionRequest {
  context: AiAccessContext;
  task: AiTask;
  profileId?: string;
  targetId?: string;
  idempotencyKey?: string;
  processingPolicy?: AiProcessingPolicy;
  signal?: AbortSignal;
}

export interface AiResumeRequest {
  context: AiAccessContext;
  executionId: string;
  input: string;
  processingPolicy?: AiProcessingPolicy;
  signal?: AbortSignal;
}

// Which runtime and model produced a result. Display metadata read from the
// executor's own profile, never from user input or model output. Never branch
// on it (ADR-0007) and never log it with content.
export interface AiGeneratedBy {
  runtime: string;
  model: string;
}

export interface AiExecution<T = unknown> {
  executionId: string;
  family: AiExecutionFamily;
  targetId: string;
  result: T;
  usage?: AiUsage;
  generatedBy?: AiGeneratedBy;
}

export type AiEvent<T = unknown> =
  | { type: "started"; executionId: string; sessionId?: string }
  | { type: "text-delta"; text: string }
  | { type: "tool-started"; tool: string }
  | { type: "tool-finished"; tool: string; success: boolean }
  | { type: "usage"; usage: AiUsage }
  | { type: "awaiting-input"; request: unknown }
  // generatedBy: display metadata of the executor, when the family knows it.
  | { type: "completed"; result: T; generatedBy?: AiGeneratedBy }
  | { type: "failed"; error: AiFailure };

// Why a failure happened, as a closed, bounded vocabulary of fixed codes (never
// provider text, a path or content). Set by an adapter that knows the cause;
// consumers branch on it and never parse `message`.
export const AI_FAILURE_REASONS = [
  // The Claude SDK's result subtypes.
  "error_max_turns",
  "error_during_execution",
  "error_max_budget_usd",
  "error_max_structured_output_retries",
  // The runtime ended without producing a result.
  "no_result",
  // The runtime reported its turn failed.
  "turn_failed",
  "tool_refused",
  "attachment_refused",
] as const;
export type AiFailureReason = (typeof AI_FAILURE_REASONS)[number];

export interface AiFailure {
  reason?: AiFailureReason;
  code:
    | "configuration"
    | "permission"
    | "invalid-output"
    | "rate-limit"
    | "timeout"
    | "cancelled"
    | "policy-refused"
    | "provider"
    | "infrastructure";
  message: string;
  retryable: boolean;
}

/**
 * A request was refused by its processing policy. Names ids only (profile id,
 * policy), never content, and is never retryable: the caller must change the
 * policy or the profile, not try again.
 */
export class AiPolicyRefusedError extends Error {
  readonly code = "policy-refused";
  readonly retryable = false;
  constructor(
    readonly profileId: string | undefined,
    readonly policy: AiProcessingPolicy,
  ) {
    super(
      `Refused by processing policy ${policy}${
        profileId === undefined ? "" : ` for AI profile ${profileId}`
      }.`,
    );
    this.name = "AiPolicyRefusedError";
  }

  toFailure(): AiFailure {
    return { code: "policy-refused", message: this.message, retryable: false };
  }
}

export interface ModelCapabilities {
  streaming: boolean;
  structuredOutput: boolean;
  tools: boolean;
  vision: boolean;
  search: boolean;
}

export interface ImageCapabilities {
  generation: boolean;
  editing: boolean;
  aspectRatios: readonly string[];
}

export interface AiTargetSummary {
  id: string;
  label: string;
  modelId?: string;
  family: AiExecutionFamily;
  kind: AiModelKind;
  capabilities: readonly string[];
  // How a model picker presents this target.
  listing?: ModelInfo;
}

// Narrows a target listing to one task; catalog targets list only then.
export interface AiTargetFilter {
  taskType?: AiTaskType;
  processingPolicy?: AiProcessingPolicy;
}

export interface AiStructuredChatRequest extends ModelInput {
  context: AiAccessContext;
  processingPolicy?: AiProcessingPolicy;
  signal?: AbortSignal;
}

export interface ModelProviderAdapter {
  readonly providerId: string;
  streamStructured?(request: AiStructuredChatRequest): AsyncIterable<ModelPart>;
  readonly modelId?: string;
  readonly capabilities: ModelCapabilities;
  // A catalog target (one endpoint, many models): the models it offers now.
  listModels?(context: AiAccessContext): Promise<readonly ModelInfo[]>;
  execute(request: AiExecutionRequest): Promise<AiExecution>;
  stream(request: AiExecutionRequest): AsyncIterable<AiEvent>;
}

export interface ImageResult {
  assetReference: string;
  mimeType: string;
  width?: number;
  height?: number;
  providerId: string;
  modelId: string;
  revisedPrompt?: string;
  provenance: Readonly<Record<string, unknown>>;
}

export interface ImageProviderAdapter {
  readonly providerId: string;
  readonly capabilities: ImageCapabilities;
  generate(request: AiExecutionRequest): Promise<ImageResult>;
  edit?(request: AiExecutionRequest): Promise<ImageResult>;
}

export interface AiExecutionGateway {
  streamStructured(request: AiStructuredChatRequest): AsyncIterable<ModelPart>;
  execute<T = unknown>(request: AiExecutionRequest): Promise<AiExecution<T>>;
  stream<T = unknown>(request: AiExecutionRequest): AsyncIterable<AiEvent<T>>;
  // [SAFETY] A cancellation runs inside the caller's tenant: an execution id
  // alone never reaches across tenants.
  cancel(context: AiAccessContext, executionId: string): Promise<void>;
  resume<T = unknown>(request: AiResumeRequest): AsyncIterable<AiEvent<T>>;
  listAvailableTargets(
    context: AiAccessContext,
    filter?: AiTargetFilter,
  ): Promise<AiTargetSummary[]>;
}

/**
 * A stream that refuses on first read: for a port that never serves streams.
 * It rejects lazily, as a throw-only async generator would, so a caller that
 * never iterates never sees the refusal.
 */
export function refusedStream(message: string): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.reject(new Error(message)),
    }),
  };
}

/** Validate the portable JSON-schema subset used at the provider boundary. */
export function validateStructuredOutput(
  value: unknown,
  schema: Readonly<Record<string, unknown>>,
  path = "$",
): string | undefined {
  const type = schema["type"];
  if (type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return `${path} must be an object`;
    }
    const record = value as Record<string, unknown>;
    const required = Array.isArray(schema["required"])
      ? schema["required"]
      : [];
    for (const key of required) {
      if (typeof key === "string" && !(key in record)) {
        return `${path}.${key} is required`;
      }
    }
    const properties =
      typeof schema["properties"] === "object" && schema["properties"] !== null
        ? (schema["properties"] as Record<string, unknown>)
        : {};
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in record && typeof childSchema === "object" && childSchema) {
        const error = validateStructuredOutput(
          record[key],
          childSchema as Readonly<Record<string, unknown>>,
          `${path}.${key}`,
        );
        if (error) return error;
      }
    }
  } else if (type === "array") {
    if (!Array.isArray(value)) return `${path} must be an array`;
    if (typeof schema["items"] === "object" && schema["items"] !== null) {
      for (const [index, item] of value.entries()) {
        const error = validateStructuredOutput(
          item,
          schema["items"] as Readonly<Record<string, unknown>>,
          `${path}[${index}]`,
        );
        if (error) return error;
      }
    }
  } else if (
    (type === "string" && typeof value !== "string") ||
    (type === "number" && typeof value !== "number") ||
    (type === "boolean" && typeof value !== "boolean")
  ) {
    return `${path} must be a ${type}`;
  }
  return undefined;
}

export function parseStructuredOutput(
  text: string,
  schema?: Readonly<Record<string, unknown>>,
): unknown {
  const value = JSON.parse(text) as unknown;
  if (schema) {
    const error = validateStructuredOutput(value, schema);
    if (error) throw new Error(`Structured output validation failed: ${error}`);
  }
  return value;
}
