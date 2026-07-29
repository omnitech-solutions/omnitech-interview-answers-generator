export type AiExecutionFamily = "direct-model" | "workflow" | "agent-runtime";
export type AiModelKind = "language" | "embedding" | "image" | "multimodal";
export type AiTaskType =
  | "text-generation"
  | "structured-generation"
  | "streaming-chat"
  | "image-generation"
  | "image-editing"
  | "retrieval"
  | "agent-job";

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
  workflowInstructions: readonly InstructionSource[];
  taskPrompt: string;
  attachments: readonly AgentAttachment[];
  outputSchema?: Readonly<Record<string, unknown>>;
}

export interface AiTask {
  type: AiTaskType;
  prompt: string;
  system?: string;
  messages?: readonly {
    role: "system" | "user" | "assistant";
    content: string;
  }[];
  schema?: Readonly<Record<string, unknown>>;
  image?: {
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
  signal?: AbortSignal;
}

export interface AiResumeRequest {
  context: AiAccessContext;
  executionId: string;
  input: string;
  signal?: AbortSignal;
}

export interface AiExecution<T = unknown> {
  executionId: string;
  family: AiExecutionFamily;
  targetId: string;
  result: T;
  usage?: AiUsage;
}

export type AiEvent<T = unknown> =
  | { type: "started"; executionId: string; sessionId?: string }
  | { type: "text-delta"; text: string }
  | { type: "tool-started"; tool: string }
  | { type: "tool-finished"; tool: string; success: boolean }
  | { type: "usage"; usage: AiUsage }
  | { type: "awaiting-input"; request: unknown }
  | { type: "completed"; result: T }
  | { type: "failed"; error: AiFailure };

export interface AiFailure {
  code:
    | "configuration"
    | "permission"
    | "invalid-output"
    | "rate-limit"
    | "timeout"
    | "cancelled"
    | "provider"
    | "infrastructure";
  message: string;
  retryable: boolean;
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
  family: AiExecutionFamily;
  kind: AiModelKind;
  capabilities: readonly string[];
}

export interface ModelProviderAdapter {
  readonly providerId: string;
  readonly capabilities: ModelCapabilities;
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

export interface WorkflowEngine {
  readonly engine: "direct" | "langchain" | "langgraph";
  execute(request: AiExecutionRequest): Promise<AiExecution>;
  stream(request: AiExecutionRequest): AsyncIterable<AiEvent>;
}

export interface AiExecutionGateway {
  execute<T = unknown>(request: AiExecutionRequest): Promise<AiExecution<T>>;
  stream<T = unknown>(request: AiExecutionRequest): AsyncIterable<AiEvent<T>>;
  cancel(executionId: string): Promise<void>;
  resume<T = unknown>(request: AiResumeRequest): AsyncIterable<AiEvent<T>>;
  listAvailableTargets(context: AiAccessContext): Promise<AiTargetSummary[]>;
}
