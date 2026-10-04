import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  AgentAttachmentRefusedError,
  type AgentEvent,
  type AgentResumeRequest,
  type AgentRunRequest,
  type AgentRuntimeAdapter,
  stagedImages,
  TOOL_REFUSED_FAILURE,
} from "@omnitech/agent-runtime-contracts";
import { restoreOptional, strictSchema } from "./strict-schema.js";

// Wire shape pinned against `codex app-server generate-ts` from CLI 0.160.0.
type Message = {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: { message?: string };
};
export interface CodexRuntimeOptions {
  apiKey?: string;
  baseUrl?: string;
  codexPathOverride?: string;
  environment?: Readonly<Record<string, string>>;
  spawnServer?: () => ChildProcessWithoutNullStreams;
}

class AppServerHost {
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve(value: any): void; reject(error: Error): void }
  >();
  private listeners = new Set<(message: Message) => void>();
  private starting: Promise<void> | undefined;
  constructor(private readonly options: CodexRuntimeOptions) {}

  private fail(error: Error) {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
    for (const listener of this.listeners)
      listener({ method: "host/error", params: { message: error.message } });
    this.child = undefined;
    this.starting = undefined;
  }
  private async start() {
    const child =
      this.options.spawnServer?.() ??
      spawn(this.options.codexPathOverride ?? "codex", ["app-server"], {
        stdio: "pipe",
        env: {
          ...(this.options.environment
            ? { ...this.options.environment }
            : process.env),
          ...(this.options.apiKey
            ? { OPENAI_API_KEY: this.options.apiKey }
            : {}),
          ...(this.options.baseUrl
            ? { OPENAI_BASE_URL: this.options.baseUrl }
            : {}),
        },
      });
    this.child = child;
    child.on("error", (error) => this.fail(error));
    child.on("exit", (code) =>
      this.fail(new Error(`Codex App Server exited (${code ?? "signal"}).`)),
    );
    createInterface({ input: child.stdout }).on("line", (line) => {
      let message: Message;
      try {
        message = JSON.parse(line) as Message;
      } catch {
        this.fail(new Error("Invalid Codex App Server message."));
        return;
      }
      if (message.id !== undefined && !message.method) {
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        if (message.error)
          waiter.reject(
            new Error(message.error.message ?? "Codex request failed."),
          );
        else waiter.resolve(message.result);
      } else if (message.method && message.id !== undefined) {
        // The worker has no interactive approval channel: deny, never hang.
        child.stdin.write(
          `${JSON.stringify({ id: message.id, error: { code: -32601, message: "Interactive requests unavailable." } })}\n`,
        );
        for (const listener of this.listeners)
          listener({
            method: "host/error",
            params: { message: "Unsupported Codex interaction." },
          });
      } else for (const listener of this.listeners) listener(message);
    });
    await this.call("initialize", {
      clientInfo: {
        name: "omnitech-agent-worker",
        title: "Omnitech Agent Worker",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
  }
  ready() {
    return (this.starting ??= this.start());
  }
  call(method: string, params: unknown): Promise<any> {
    const child = this.child;
    if (!child?.stdin.writable)
      return Promise.reject(new Error("Codex App Server unavailable."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(
        `${JSON.stringify({ id, method, params })}\n`,
        (error) => {
          if (error) {
            this.pending.delete(id);
            reject(error);
          }
        },
      );
    });
  }
  subscribe(listener: (message: Message) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  close() {
    this.child?.kill();
    this.child = undefined;
    this.fail(new Error("Codex App Server closed."));
  }
}

// Thread items a tool-less turn may contain; anything else (command, MCP, file
// change, web search, dynamic or sub-agent tool, image view/generation) is a
// tool by this adapter's standard and fails the turn.
const TOOLLESS_ITEMS = new Set([
  "agentMessage",
  "userMessage",
  "reasoning",
  "plan",
  "contextCompaction",
]);

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

export function createCodexRuntimeAdapter(
  options: CodexRuntimeOptions = {},
): AgentRuntimeAdapter {
  const host = new AppServerHost(options);
  const active = new Map<
    string,
    { threadId: string; turnId?: string; cancel(): void }
  >();
  const sessionOwners = new Map<string, string>();
  async function* execute(
    request: AgentRunRequest,
    resumeId?: string,
  ): AsyncIterable<AgentEvent> {
    let wake: (() => void) | undefined;
    const queue: AgentEvent[] = [];
    let done = false;
    let failure: Error | undefined;
    let threadId = resumeId;
    let turnId: string | undefined;
    let outputText = "";
    let streamed = false;
    let cancellationRequested = false;
    // Set when a tool-less turn started a tool: the turn is interrupted and
    // fails typed, whatever the provider reports afterwards.
    let toolRefused = false;
    let interruptTurn: (() => void) | undefined;
    let latestUsage:
      | { inputTokens: number; outputTokens: number; totalTokens: number }
      | undefined;
    const push = (event: AgentEvent) => {
      queue.push(event);
      wake?.();
      wake = undefined;
    };
    const onMessage = (message: Message) => {
      if (message.method === "host/error") {
        failure = new Error(message.params.message);
        done = true;
        wake?.();
        return;
      }
      const p = message.params;
      if (
        !p ||
        p.threadId !== threadId ||
        (p.turnId && turnId && p.turnId !== turnId)
      )
        return;
      // [SAFETY] A tool-less request cannot rely on disabled features alone:
      // the first non-message item aborts the turn.
      if (
        request.toolless &&
        (message.method === "item/started" ||
          message.method === "item/completed") &&
        p.item?.type !== undefined &&
        !TOOLLESS_ITEMS.has(p.item.type)
      ) {
        if (!toolRefused) {
          toolRefused = true;
          interruptTurn?.();
        }
        done = true;
        wake?.();
        return;
      }
      if (message.method === "item/agentMessage/delta") {
        streamed = true;
        outputText += p.delta;
        push({ type: "text-delta", text: p.delta });
      } else if (
        message.method === "item/started" &&
        p.item?.type === "commandExecution"
      )
        push({ type: "tool-started", tool: "command" });
      else if (
        message.method === "item/started" &&
        p.item?.type === "mcpToolCall"
      )
        push({ type: "tool-started", tool: `${p.item.server}/${p.item.tool}` });
      else if (message.method === "item/completed") {
        if (p.item?.type === "commandExecution")
          push({
            type: "tool-finished",
            tool: "command",
            success: p.item.status === "completed",
          });
        if (p.item?.type === "mcpToolCall")
          push({
            type: "tool-finished",
            tool: `${p.item.server}/${p.item.tool}`,
            success: p.item.status === "completed",
          });
        if (p.item?.type === "agentMessage") {
          if (!streamed) push({ type: "text-delta", text: p.item.text });
          outputText = p.item.text;
        }
      } else if (message.method === "thread/tokenUsage/updated") {
        const usage = p.tokenUsage?.last;
        if (usage)
          latestUsage = {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
          };
      } else if (message.method === "turn/completed") {
        if (latestUsage) push({ type: "usage", usage: latestUsage });
        if (p.turn.status !== "completed")
          failure = new Error(
            p.turn.error?.message ?? `Codex turn ${p.turn.status}.`,
          );
        done = true;
        wake?.();
      } else if (message.method === "error") {
        failure = new Error(p.error?.message ?? "Codex turn failed.");
        done = true;
        wake?.();
      }
    };
    let unsubscribe: (() => void) | undefined;
    // A request with its own environment (an ephemeral CODEX_HOME) gets its own
    // App Server process, since the environment belongs to the process; it is
    // closed when the attempt ends. Others share the worker-owned host.
    const ownHost = request.environment
      ? new AppServerHost({
          ...options,
          environment: {
            ...(options.environment ?? (process.env as Record<string, string>)),
            ...request.environment,
          },
        })
      : undefined;
    const server = ownHost ?? host;
    try {
      // [SAFETY] Attachments resolve (typed refusal, no path in the error)
      // before any provider process starts.
      const images = await stagedImages(request);
      if (
        resumeId &&
        sessionOwners.has(resumeId) &&
        sessionOwners.get(resumeId) !== request.runId
      )
        throw new Error("Codex session belongs to another run.");
      await server.ready();
      const thread = await server.call(
        resumeId ? "thread/resume" : "thread/start",
        {
          ...(resumeId ? { threadId: resumeId } : {}),
          model: request.profile.model,
          cwd: request.workingDirectory,
          sandbox: request.profile.sandbox,
          approvalPolicy: request.profile.approvalPolicy,
          ...(request.systemPrompt
            ? { baseInstructions: request.systemPrompt }
            : {}),
          // No rollout is persisted for a profile that does not keep sessions.
          ...(!resumeId && !request.profile.sessionPersistence
            ? { ephemeral: true }
            : {}),
          config: {
            web_search: request.profile.webSearch ? "live" : "disabled",
            ...(request.profile.tools.length === 0 || request.toolless
              ? {
                  features: {
                    shell_tool: false,
                    code_mode_host: false,
                    browser_use: false,
                    computer_use: false,
                  },
                }
              : {}),
          },
        },
      );
      threadId = thread.thread.id as string;
      if (!threadId) throw new Error("Codex did not return a thread ID.");
      if (
        sessionOwners.has(threadId) &&
        sessionOwners.get(threadId) !== request.runId
      )
        throw new Error("Codex returned a thread owned by another run.");
      sessionOwners.set(threadId, request.runId);
      push({ type: "started", sessionId: threadId });
      unsubscribe = server.subscribe(onMessage);
      const run: { threadId: string; turnId?: string; cancel(): void } = {
        threadId,
        cancel: () => {
          cancellationRequested = true;
          if (run.turnId)
            void server
              .call("turn/interrupt", {
                threadId: run.threadId,
                turnId: run.turnId,
              })
              .catch(() => {});
        },
      };
      interruptTurn = run.cancel;
      active.set(request.runId, run);
      const turn = await server.call("turn/start", {
        threadId,
        input: [
          { type: "text", text: request.prompt, text_elements: [] },
          // Local image items: the App Server reads the staged file itself.
          ...images.map((image) => ({ type: "localImage", path: image.path })),
        ],
        effort: request.profile.effort,
        // The server's strict mode needs every property required: see
        // strict-schema.ts (the answer is converted back below).
        ...(request.outputSchema
          ? { outputSchema: strictSchema(request.outputSchema) }
          : {}),
      });
      turnId = turn.turn.id as string;
      if (!turnId) throw new Error("Codex did not return a turn ID.");
      run.turnId = turnId;
      if (cancellationRequested || toolRefused) run.cancel();
      while (!done || queue.length) {
        if (queue.length) {
          yield queue.shift() as AgentEvent;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      if (toolRefused) {
        yield { type: "failed", error: TOOL_REFUSED_FAILURE };
        return;
      }
      if (failure) throw failure;
      yield {
        type: "completed",
        result: {
          sessionId: threadId,
          output: request.outputSchema
            ? restoreOptional(JSON.parse(outputText), request.outputSchema)
            : outputText,
        },
      };
    } catch (error) {
      if (error instanceof AgentAttachmentRefusedError) {
        yield { type: "failed", error: error.failure };
        return;
      }
      yield {
        type: "failed",
        error: {
          code: cancellationRequested ? "cancelled" : "provider",
          message: error instanceof Error ? error.message : "Codex failed.",
          retryable: false,
        },
      };
    } finally {
      unsubscribe?.();
      active.delete(request.runId);
      ownHost?.close();
    }
  }
  return {
    runtime: "codex",
    capabilities: {
      resume: true,
      structuredOutput: true,
      attachments: true,
      tools: true,
      imageInput: true,
      toolless: true,
    },
    run: (request) => execute(request),
    resume: (request) => execute(resumed(request), request.sessionId),
    async cancel(runId) {
      active.get(runId)?.cancel();
    },
    async close() {
      host.close();
    },
  };
}
