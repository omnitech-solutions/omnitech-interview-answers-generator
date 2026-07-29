import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentEvent,
  AgentRunRequest,
  AgentRuntimeAdapter,
  AgentResumeRequest,
} from "@omnitech/agent-runtime-contracts";

export interface ClaudeRuntimeOptions {
  environment?: Readonly<Record<string, string>>;
}

function assistantText(message: SDKMessage): string[] {
  if (message.type !== "assistant") return [];
  return message.message.content.flatMap((block) =>
    block.type === "text" ? [block.text] : [],
  );
}

export function createClaudeRuntimeAdapter(
  runtimeOptions: ClaudeRuntimeOptions = {},
): AgentRuntimeAdapter {
  const controllers = new Map<string, AbortController>();

  const execute = async function* (
    request: AgentRunRequest,
    resume?: string,
  ): AsyncIterable<AgentEvent> {
    const controller = new AbortController();
    controllers.set(request.runId, controller);
    let sessionId = resume;
    try {
      const stream = query({
        prompt: request.prompt,
        options: {
          abortController: controller,
          cwd: request.workingDirectory,
          model: request.profile.model,
          maxTurns: request.profile.maximumTurns,
          permissionMode:
            request.profile.approvalPolicy === "never" ? "dontAsk" : "default",
          tools: [...request.profile.tools],
          allowedTools: [...request.profile.tools],
          additionalDirectories: [...request.additionalDirectories],
          includePartialMessages: true,
          ...(request.profile.fallbackModels.length === 0
            ? {}
            : { fallbackModel: request.profile.fallbackModels.join(",") }),
          ...(request.profile.maximumBudgetUsd === undefined
            ? {}
            : { maxBudgetUsd: request.profile.maximumBudgetUsd }),
          ...(request.systemPrompt === undefined
            ? {}
            : { systemPrompt: request.systemPrompt }),
          ...(resume === undefined ? {} : { resume }),
          ...(request.outputSchema === undefined
            ? {}
            : {
                outputFormat: {
                  type: "json_schema",
                  schema: request.outputSchema,
                },
              }),
          ...(runtimeOptions.environment === undefined
            ? {}
            : { env: { ...runtimeOptions.environment } }),
        },
      });
      for await (const message of stream) {
        sessionId = message.session_id;
        for (const text of assistantText(message)) {
          yield { type: "text-delta", text };
        }
        if (message.type === "result") {
          if (message.subtype === "success") {
            yield {
              type: "usage",
              usage: {
                inputTokens: message.usage.input_tokens,
                outputTokens: message.usage.output_tokens,
                totalTokens:
                  message.usage.input_tokens + message.usage.output_tokens,
                costUsd: message.total_cost_usd,
              },
            };
            yield {
              type: "completed",
              result: {
                sessionId: message.session_id,
                output: message.structured_output ?? message.result,
              },
            };
          } else {
            yield {
              type: "failed",
              error: {
                code: "provider",
                message: message.errors.join("; "),
                retryable: false,
              },
            };
          }
        } else if (sessionId && message.type === "system") {
          yield { type: "started", sessionId };
        }
      }
    } catch (error) {
      yield {
        type: "failed",
        error: {
          code: controller.signal.aborted ? "cancelled" : "provider",
          message: error instanceof Error ? error.message : "Claude failed.",
          retryable: false,
        },
      };
    } finally {
      controllers.delete(request.runId);
    }
  };

  return {
    runtime: "claude-code",
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
        },
        request.sessionId,
      ),
    async cancel(runId) {
      controllers.get(runId)?.abort();
    },
  };
}
