// BACKEND-ONLY: this package uses node:fs (attachment path checks), so it is
// imported by workers, runtimes and server code and never by a frontend or
// browser bundle. Types that a client needs belong in a separate contracts
// package, not here.
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
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
  // Forwards staged image attachments to the model; true only where an
  // adapter fixture test proves it (ADR-0016).
  // Absent means false (fail closed).
  imageInput?: boolean;
  // Can run a request that must use no tools: tools are disabled, or any tool
  // use is detected and failed (ADR-0016 worker-local-tool-less-inference).
  toolless?: boolean;
}

export interface AgentProfile {
  id: string;
  // Bumped whenever a profile's bounds change, so each job's recorded
  // profile snapshot says which revision of the profile it ran under.
  version: number;
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
  outputSchema?: Readonly<Record<string, unknown>>;
}

export interface AgentRunRequest {
  runId: string;
  profile: AgentProfile;
  prompt: string;
  systemPrompt?: string;
  workingDirectory: string;
  additionalDirectories: readonly string[];
  attachments: readonly AgentAttachment[];
  // Attachment references must resolve inside this private staging directory;
  // a request with attachments and no root is refused.
  attachmentRoot?: string;
  // No tool may run: the adapter disables tools and fails the attempt on any
  // tool-started event. Always set for Active Session actions.
  toolless?: boolean;
  // Per-attempt environment (an ephemeral provider home), merged over the
  // adapter's own.
  environment?: Readonly<Record<string, string>>;
  outputSchema?: Readonly<Record<string, unknown>>;
  timeoutMs: number;
}

export interface AgentResumeRequest {
  runId: string;
  sessionId: string;
  prompt: string;
  profile: AgentProfile;
  workingDirectory: string;
  outputSchema?: Readonly<Record<string, unknown>>;
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
  close?(): Promise<void>;
}

export function validateAgentProfile(profile: AgentProfile): void {
  if (!Number.isInteger(profile.version) || profile.version < 1) {
    throw new Error("Agent profiles need a positive integer version.");
  }
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

// The typed refusal an adapter turns into a failed event; never carries a
// path, an attachment name or provider text.
export const TOOL_REFUSED_FAILURE: AiFailure = {
  code: "policy-refused",
  message: "A tool-less request attempted to use a tool.",
  retryable: false,
};

export const ATTACHMENT_REFUSED_FAILURE: AiFailure = {
  code: "policy-refused",
  message: "An attachment was refused.",
  retryable: false,
};

export class AgentAttachmentRefusedError extends Error {
  readonly failure = ATTACHMENT_REFUSED_FAILURE;
  constructor() {
    super(ATTACHMENT_REFUSED_FAILURE.message);
    this.name = "AgentAttachmentRefusedError";
  }
}

export const AGENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export interface StagedImage {
  path: string;
  mimeType: string;
}

// [SAFETY] Resolves a request's attachments to staged image files. Everything
// else is refused with one typed error: a non-image kind, an unsupported type,
// a reference that is relative, a symlink, outside the staging root (after
// resolving links), not a regular file, or over the byte bound. Attachments
// without a staging root are refused, never ignored.
export async function stagedImages(
  request: Pick<AgentRunRequest, "attachments" | "attachmentRoot">,
): Promise<StagedImage[]> {
  if (request.attachments.length === 0) return [];
  if (request.attachmentRoot === undefined)
    throw new AgentAttachmentRefusedError();
  let root: string;
  try {
    root = await realpath(request.attachmentRoot);
  } catch {
    throw new AgentAttachmentRefusedError();
  }
  const staged: StagedImage[] = [];
  for (const attachment of request.attachments) {
    if (
      attachment.kind !== "image" ||
      attachment.mimeType === undefined ||
      !IMAGE_TYPES.has(attachment.mimeType) ||
      !isAbsolute(attachment.reference)
    )
      throw new AgentAttachmentRefusedError();
    try {
      const link = await lstat(attachment.reference);
      const real = await realpath(attachment.reference);
      const inside = relative(root, real);
      if (
        link.isSymbolicLink() ||
        !link.isFile() ||
        link.size > AGENT_IMAGE_MAX_BYTES ||
        inside === "" ||
        inside.startsWith("..") ||
        isAbsolute(inside)
      )
        throw new AgentAttachmentRefusedError();
      staged.push({ path: real, mimeType: attachment.mimeType });
    } catch {
      throw new AgentAttachmentRefusedError();
    }
  }
  return staged;
}
