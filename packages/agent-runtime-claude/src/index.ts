import {
  type Query,
  query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentEvent,
  AgentResumeRequest,
  AgentRunRequest,
  AgentRuntimeAdapter,
} from "@omnitech/agent-runtime-contracts";

export interface ClaudeRuntimeOptions {
  environment?: Readonly<Record<string, string>>;
}

// The SDK's streaming-input query owns one CLI process and can accept later
// user messages. No SDK client class exists in the installed TypeScript API.
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiting:
    | ((value: IteratorResult<SDKUserMessage>) => void)
    | undefined;
  private closed = false;
  push(text: string) {
    const message: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    };
    if (this.waiting) {
      const waiting = this.waiting;
      this.waiting = undefined;
      waiting({ value: message, done: false });
    } else this.items.push(message);
  }
  close() {
    this.closed = true;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = undefined;
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.items.length) {
        yield this.items.shift() as SDKUserMessage;
        continue;
      }
      if (this.closed) return;
      const item = await new Promise<IteratorResult<SDKUserMessage>>(
        (resolve) => {
          this.waiting = resolve;
        },
      );
      if (item.done) return;
      yield item.value;
    }
  }
}

type Turn = {
  events: AgentEvent[];
  wake: (() => void) | undefined;
  done: boolean;
  streamed: boolean;
  sessionId?: string;
};
type Session = {
  input: InputQueue;
  query: Query;
  profileKey: string;
  cwd: string;
  runId: string;
  lastUsed: number;
  sessionId?: string;
  turn: Turn | undefined;
  closed: boolean;
  cancelRequested: boolean;
};
function push(turn: Turn, event: AgentEvent) {
  turn.events.push(event);
  turn.wake?.();
  turn.wake = undefined;
}
function finish(turn: Turn) {
  turn.done = true;
  turn.wake?.();
  turn.wake = undefined;
}
function streamedText(message: SDKMessage): string | undefined {
  if (message.type !== "stream_event") return undefined;
  return message.event.type === "content_block_delta" &&
    message.event.delta.type === "text_delta"
    ? message.event.delta.text
    : undefined;
}
function profileKey(request: AgentRunRequest) {
  return JSON.stringify([
    request.profile.id,
    request.profile.version,
    request.profile.model,
    request.profile.tools,
    request.profile.approvalPolicy,
    request.profile.sandbox,
    request.outputSchema,
  ]);
}
function resumed(request: AgentResumeRequest): AgentRunRequest {
  return {
    runId: request.runId,
    profile: request.profile,
    prompt: request.prompt,
    workingDirectory: request.workingDirectory,
    additionalDirectories: [],
    attachments: [],
    timeoutMs: request.profile.timeoutMs,
    ...(request.outputSchema ? { outputSchema: request.outputSchema } : {}),
  };
}

export function createClaudeRuntimeAdapter(
  options: ClaudeRuntimeOptions = {},
): AgentRuntimeAdapter {
  const sessions = new Map<string, Session>();
  const active = new Map<string, Session>();
  const MAX_IDLE_MS = 5 * 60_000;
  const MAX_SESSIONS = 4;
  function close(session: Session) {
    if (session.closed) return;
    session.closed = true;
    session.input.close();
    session.query.close();
    if (session.sessionId) sessions.delete(session.sessionId);
  }
  function prune() {
    for (const session of sessions.values())
      if (!session.turn && Date.now() - session.lastUsed > MAX_IDLE_MS)
        close(session);
    if (sessions.size < MAX_SESSIONS) return;
    const oldest = [...sessions.values()]
      .filter((s) => !s.turn)
      .sort((a, b) => a.lastUsed - b.lastUsed)[0];
    if (oldest) close(oldest);
  }
  function pump(session: Session) {
    void (async () => {
      try {
        for await (const message of session.query) {
          const turn = session.turn;
          if (!turn || turn.done) continue;
          if (message.session_id) {
            session.sessionId = message.session_id;
            turn.sessionId = message.session_id;
          }
          const delta = streamedText(message);
          if (delta) {
            turn.streamed = true;
            push(turn, { type: "text-delta", text: delta });
          }
          if (message.type === "assistant" && !turn.streamed)
            for (const block of message.message.content)
              if (block.type === "text")
                push(turn, { type: "text-delta", text: block.text });
          if (message.type === "system" && session.sessionId)
            push(turn, { type: "started", sessionId: session.sessionId });
          if (message.type === "result") {
            if (message.subtype === "success") {
              push(turn, {
                type: "usage",
                usage: {
                  inputTokens: message.usage.input_tokens,
                  outputTokens: message.usage.output_tokens,
                  totalTokens:
                    message.usage.input_tokens + message.usage.output_tokens,
                  costUsd: message.total_cost_usd,
                },
              });
              push(turn, {
                type: "completed",
                result: {
                  sessionId: message.session_id,
                  output: message.structured_output ?? message.result,
                },
              });
            } else
              push(turn, {
                type: "failed",
                error: {
                  code: session.cancelRequested ? "cancelled" : "provider",
                  message: message.errors.join("; "),
                  retryable: false,
                },
              });
            finish(turn);
            session.lastUsed = Date.now();
            if (session.sessionId && !session.closed)
              sessions.set(session.sessionId, session);
          }
        }
        if (session.turn && !session.turn.done) {
          push(session.turn, {
            type: "failed",
            error: {
              code: session.cancelRequested ? "cancelled" : "provider",
              message: "Claude ended without a result.",
              retryable: false,
            },
          });
          finish(session.turn);
          session.turn = undefined;
        }
      } catch (error) {
        if (session.turn && !session.turn.done) {
          push(session.turn, {
            type: "failed",
            error: {
              code: session.cancelRequested ? "cancelled" : "provider",
              message:
                error instanceof Error ? error.message : "Claude failed.",
              retryable: false,
            },
          });
          finish(session.turn);
          session.turn = undefined;
        }
      } finally {
        close(session);
      }
    })();
  }
  async function* execute(
    request: AgentRunRequest,
    resumeId?: string,
  ): AsyncIterable<AgentEvent> {
    prune();
    let session = resumeId ? sessions.get(resumeId) : undefined;
    const key = profileKey(request);
    if (
      session &&
      (session.runId !== request.runId || session.profileKey !== key)
    ) {
      yield {
        type: "failed",
        error: {
          code: "provider",
          message: "Claude session binding changed.",
          retryable: false,
        },
      };
      return;
    }
    if (session?.turn) {
      yield {
        type: "failed",
        error: {
          code: "provider",
          message: "Claude session is already running.",
          retryable: false,
        },
      };
      return;
    }
    // A resumed job receives a fresh isolated workspace. Rejoin the provider
    // session in a new SDK query rather than carrying the old cwd across jobs.
    if (session && session.cwd !== request.workingDirectory) {
      close(session);
      session = undefined;
    }
    if (!session) {
      const input = new InputQueue();
      const controller = new AbortController();
      const stream = query({
        prompt: input,
        options: {
          abortController: controller,
          cwd: request.workingDirectory,
          model: request.profile.model,
          maxTurns: request.profile.maximumTurns,
          permissionMode:
            request.profile.approvalPolicy === "never" ? "dontAsk" : "default",
          tools: [...request.profile.tools],
          allowedTools: [...request.profile.tools],
          settingSources: [],
          strictMcpConfig: true,
          mcpServers: {},
          plugins: [],
          additionalDirectories: [...request.additionalDirectories],
          includePartialMessages: true,
          ...(request.profile.fallbackModels.length
            ? { fallbackModel: request.profile.fallbackModels.join(",") }
            : {}),
          ...(request.profile.maximumBudgetUsd === undefined
            ? {}
            : { maxBudgetUsd: request.profile.maximumBudgetUsd }),
          ...(request.systemPrompt === undefined
            ? {}
            : { systemPrompt: request.systemPrompt }),
          ...(resumeId ? { resume: resumeId } : {}),
          ...(request.outputSchema
            ? {
                outputFormat: {
                  type: "json_schema" as const,
                  schema: request.outputSchema,
                },
              }
            : {}),
          ...(options.environment ? { env: { ...options.environment } } : {}),
        },
      });
      session = {
        input,
        query: stream,
        profileKey: key,
        cwd: request.workingDirectory,
        runId: request.runId,
        lastUsed: Date.now(),
        closed: false,
        cancelRequested: false,
        turn: undefined,
      };
      pump(session);
    }
    const turn: Turn = {
      events: [],
      done: false,
      streamed: false,
      wake: undefined,
    };
    session.cancelRequested = false;
    session.turn = turn;
    active.set(request.runId, session);
    session.input.push(request.prompt);
    try {
      while (!turn.done || turn.events.length) {
        if (turn.events.length) {
          yield turn.events.shift() as AgentEvent;
          continue;
        }
        await new Promise<void>((resolve) => {
          turn.wake = resolve;
        });
      }
    } finally {
      active.delete(request.runId);
      if (session.turn === turn) session.turn = undefined;
      if (!request.profile.sessionPersistence || request.profile.tools.length)
        close(session);
    }
  }
  return {
    runtime: "claude-code",
    capabilities: {
      resume: true,
      structuredOutput: true,
      attachments: true,
      tools: true,
    },
    run: (request) => execute(request),
    resume: (request) => execute(resumed(request), request.sessionId),
    async cancel(runId) {
      const session = active.get(runId);
      if (!session) return;
      session.cancelRequested = true;
      try {
        await session.query.interrupt();
      } catch {
        close(session);
      }
    },
    async close() {
      for (const session of [...sessions.values(), ...active.values()])
        close(session);
    },
  };
}
