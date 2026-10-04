import { Codex, type ThreadEvent, type ThreadOptions } from "@openai/codex-sdk";
import type {
  AgentEvent,
  AgentRunRequest,
  AgentRuntimeAdapter,
  AgentResumeRequest,
} from "@omnitech/agent-runtime-contracts";

export interface CodexRuntimeOptions {
  apiKey?: string;
  baseUrl?: string;
  codexPathOverride?: string;
  environment?: Readonly<Record<string, string>>;
}

function inputFor(request: AgentRunRequest): string {
  return [request.systemPrompt, request.prompt].filter(Boolean).join("\n\n");
}

function toEvent(event: ThreadEvent): AgentEvent | undefined {
  if (event.type === "thread.started") {
    return { type: "started", sessionId: event.thread_id };
  }
  if (event.type === "item.started") {
    if (event.item.type === "command_execution") {
      return { type: "tool-started", tool: "command" };
    }
    if (event.item.type === "mcp_tool_call") {
      return {
        type: "tool-started",
        tool: `${event.item.server}/${event.item.tool}`,
      };
    }
  }
  if (event.type === "item.completed") {
    if (event.item.type === "agent_message") {
      return { type: "text-delta", text: event.item.text };
    }
    if (event.item.type === "command_execution") {
      return {
        type: "tool-finished",
        tool: "command",
        success: event.item.status === "completed",
      };
    }
    if (event.item.type === "mcp_tool_call") {
      return {
        type: "tool-finished",
        tool: `${event.item.server}/${event.item.tool}`,
        success: event.item.status === "completed",
      };
    }
  }
  if (event.type === "turn.completed") {
    return {
      type: "usage",
      usage: {
        inputTokens: event.usage.input_tokens,
        outputTokens: event.usage.output_tokens,
        totalTokens: event.usage.input_tokens + event.usage.output_tokens,
      },
    };
  }
  if (event.type === "turn.failed" || event.type === "error") {
    return {
      type: "failed",
      error: {
        code: "provider",
        message: event.type === "error" ? event.message : event.error.message,
        retryable: false,
      },
    };
  }
  return undefined;
}

export function createCodexRuntimeAdapter(
  options: CodexRuntimeOptions = {},
): AgentRuntimeAdapter {
  const controllers = new Map<string, AbortController>();
  const codex = new Codex({
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.codexPathOverride === undefined
      ? {}
      : { codexPathOverride: options.codexPathOverride }),
    ...(options.environment === undefined
      ? {}
      : { env: { ...options.environment } }),
  });

  const execute = async function* (
    request: AgentRunRequest,
    sessionId?: string,
  ): AsyncIterable<AgentEvent> {
    const controller = new AbortController();
    controllers.set(request.runId, controller);
    let resolvedSessionId = sessionId;
    let finalText = "";
    try {
      const threadOptions: ThreadOptions = {
        model: request.profile.model,
        sandboxMode: request.profile.sandbox,
        workingDirectory: request.workingDirectory,
        modelReasoningEffort: request.profile.effort,
        networkAccessEnabled: request.profile.webSearch,
        webSearchMode: request.profile.webSearch ? "live" : "disabled",
        approvalPolicy: request.profile.approvalPolicy,
        additionalDirectories: Array.from(request.additionalDirectories),
        // The worker runs each job in a fresh, isolated temporary directory,
        // never a repository, so Codex's trusted-repository check cannot pass.
        skipGitRepoCheck: true,
      };
      const thread = sessionId
        ? codex.resumeThread(sessionId, threadOptions)
        : codex.startThread(threadOptions);
      const streamed = await thread.runStreamed(inputFor(request), {
        signal: controller.signal,
        ...(request.outputSchema === undefined
          ? {}
          : { outputSchema: request.outputSchema }),
      });
      for await (const event of streamed.events) {
        if (event.type === "thread.started")
          resolvedSessionId = event.thread_id;
        if (
          event.type === "item.completed" &&
          event.item.type === "agent_message"
        ) {
          finalText = event.item.text;
        }
        const normalized = toEvent(event);
        if (normalized) {
          yield normalized;
          if (normalized.type === "failed") return;
        }
      }
      if (!resolvedSessionId) {
        throw new Error("Codex did not return a session identifier.");
      }
      let output: unknown = finalText;
      if (request.outputSchema) output = JSON.parse(finalText);
      yield {
        type: "completed",
        result: { sessionId: resolvedSessionId, output },
      };
    } catch (error) {
      yield {
        type: "failed",
        error: {
          code: controller.signal.aborted ? "cancelled" : "provider",
          message: error instanceof Error ? error.message : "Codex failed.",
          retryable: false,
        },
      };
    } finally {
      controllers.delete(request.runId);
    }
  };

  return {
    runtime: "codex",
    capabilities: {
      resume: true,
      structuredOutput: true,
      attachments: true,
      tools: true,
    },
    run: (request) => execute(request),
    resume: (request: AgentResumeRequest) =>
      execute(
        {
          runId: request.runId,
          profile: request.profile,
          prompt: request.prompt,
          workingDirectory: request.workingDirectory,
          additionalDirectories: [],
          attachments: [],
          timeoutMs: request.profile.timeoutMs,
          ...(request.outputSchema === undefined
            ? {}
            : { outputSchema: request.outputSchema }),
        },
        request.sessionId,
      ),
    async cancel(runId) {
      controllers.get(runId)?.abort();
    },
  };
}
