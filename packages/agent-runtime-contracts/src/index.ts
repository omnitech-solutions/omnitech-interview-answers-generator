import type {
  AgentAttachment,
  AiFailure,
  AiUsage,
} from "@omnitech/ai-contracts";

export type AgentRuntimeId = "codex" | "claude-code";
export type AgentJobStatus =
  | "queued"
  | "claimed"
  | "starting"
  | "running"
  | "awaiting-input"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed-out";

export interface AgentCapabilities {
  resume: boolean;
  structuredOutput: boolean;
  attachments: boolean;
  tools: boolean;
}

export interface AgentProfile {
  id: string;
  runtime: AgentRuntimeId;
  model: string;
  fallbackModels: readonly string[];
  effort: "low" | "medium" | "high";
  tools: readonly string[];
  sandbox: "read-only" | "workspace-write";
  approvalPolicy: "never" | "on-request";
  sessionPersistence: boolean;
  maximumTurns: number;
  maximumBudgetUsd?: number;
  timeoutMs: number;
  maximumOutputBytes: number;
  additionalDirectories: readonly string[];
  webSearch: boolean;
}

export interface AgentRunRequest {
  runId: string;
  profile: AgentProfile;
  prompt: string;
  systemPrompt?: string;
  workingDirectory: string;
  additionalDirectories: readonly string[];
  attachments: readonly AgentAttachment[];
  outputSchema?: Readonly<Record<string, unknown>>;
  timeoutMs: number;
}

export interface AgentResumeRequest {
  runId: string;
  sessionId: string;
  prompt: string;
  profile: AgentProfile;
  workingDirectory: string;
}

export interface AgentResult {
  sessionId: string;
  output: unknown;
  usage?: AiUsage;
}

export type AgentEvent =
  | { type: "started"; sessionId: string }
  | { type: "text-delta"; text: string }
  | { type: "tool-started"; tool: string }
  | { type: "tool-finished"; tool: string; success: boolean }
  | { type: "usage"; usage: AiUsage }
  | { type: "awaiting-input"; request: unknown }
  | { type: "completed"; result: AgentResult }
  | { type: "failed"; error: AiFailure };

export interface AgentRuntimeAdapter {
  readonly runtime: AgentRuntimeId;
  readonly capabilities: AgentCapabilities;
  run(request: AgentRunRequest): AsyncIterable<AgentEvent>;
  resume(request: AgentResumeRequest): AsyncIterable<AgentEvent>;
  cancel(runId: string): Promise<void>;
}

export function validateAgentProfile(profile: AgentProfile): void {
  if (profile.additionalDirectories.length > 0) {
    throw new Error(
      "Additional directories require an administrator-owned isolated profile.",
    );
  }
  if (profile.timeoutMs <= 0 || profile.maximumOutputBytes <= 0) {
    throw new Error("Agent resource limits must be positive.");
  }
  if (profile.approvalPolicy === "never" && profile.sandbox !== "read-only") {
    throw new Error(
      "Non-interactive profiles cannot combine workspace writes with no approvals.",
    );
  }
}
