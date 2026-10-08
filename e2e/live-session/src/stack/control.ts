// The scripted runtime and its control API. Everything the model "does" lives
// here, in the setup process: the agent worker (also in this process) is handed
// `fakeRuntime`, and the specs steer it over HTTP (they run in other
// processes). Calls are recorded as METADATA ONLY: ids, counts and sizes, never
// a prompt, an answer or an image (AGENTS.md rule 8 holds for the harness too).
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type {
  AgentEvent,
  AgentRunRequest,
  AgentRuntimeAdapter,
} from "@omnitech/agent-runtime-contracts";
import {
  SCENARIO_NAMES,
  type Scenario,
  type ScenarioName,
  type Stage,
  script,
} from "./scenarios";

export type Call = {
  seq: number;
  stage: Stage;
  scenario: ScenarioName;
  taskId: string | null;
  revision: number | null;
  images: number;
  imageBytes: number;
  // First 8 hex characters of each staged image's sha-256: enough to tell that
  // two calls saw the same pixels, useless for reconstructing them.
  imageDigests: string[];
  promptLength: number;
  via: "agent-runtime" | "direct-model";
  outcome: "pending" | "held" | "completed" | "failed" | "cancelled";
};

const FAILURE_CODES = {
  provider: { code: "provider", message: "The provider failed." },
  timeout: { code: "timeout", message: "The attempt timed out." },
  "policy-refused": {
    code: "policy-refused",
    message: "The session no longer permits this request.",
  },
} as const;

export class ControlState {
  scenario: Scenario = { name: "plain-answer" };
  private queued: Scenario[] = [];
  private last: Scenario = this.scenario;
  readonly calls: Call[] = [];
  private gates = new Map<string, () => void>();
  private cancelled = new Set<string>();

  reset(): void {
    this.scenario = { name: "plain-answer" };
    this.last = this.scenario;
    this.queued = [];
    this.calls.length = 0;
    this.release();
    this.cancelled.clear();
  }

  set(scenario: Scenario, once: boolean): void {
    if (once) this.queued.push(scenario);
    else {
      this.scenario = scenario;
      this.queued = [];
    }
  }

  // The scenario for a run: a queued one-shot or the sticky default for an
  // assist call; a solve call follows the assist call it belongs to.
  pick(stage: Stage): Scenario {
    if (stage === "assist") this.last = this.queued.shift() ?? this.scenario;
    return this.last;
  }

  waiting(): number {
    return this.gates.size;
  }

  // Releases `count` held runs (all by default), oldest first.
  release(count = Number.POSITIVE_INFINITY): number {
    let released = 0;
    for (const [runId, open] of [...this.gates]) {
      if (released >= count) break;
      this.gates.delete(runId);
      open();
      released += 1;
    }
    return released;
  }

  hold(runId: string): Promise<void> {
    return new Promise((resolve) => this.gates.set(runId, resolve));
  }

  cancel(runId: string): void {
    this.cancelled.add(runId);
    const open = this.gates.get(runId);
    this.gates.delete(runId);
    open?.();
  }

  wasCancelled(runId: string): boolean {
    return this.cancelled.has(runId);
  }

  record(call: Omit<Call, "seq">): Call {
    const entry = { seq: this.calls.length + 1, ...call };
    this.calls.push(entry);
    return entry;
  }
}

const idOf = (prompt: string, label: string): string | null =>
  new RegExp(`^${label}: (\\S+)$`, "m").exec(prompt)?.[1] ?? null;
const stageOf = (prompt: string): Stage =>
  prompt.startsWith("TASK: solve_code") ? "solve" : "assist";
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// The Claude-shaped runtime the worker's session agent port drives: tool-less,
// image input on, structured output returned directly.
export function fakeRuntime(state: ControlState): AgentRuntimeAdapter {
  return {
    runtime: "claude-code",
    capabilities: {
      resume: false,
      structuredOutput: true,
      attachments: true,
      tools: false,
      imageInput: true,
      toolless: true,
    },
    run(request: AgentRunRequest) {
      return (async function* (): AsyncIterable<AgentEvent> {
        const stage = stageOf(request.prompt);
        const scenario = state.pick(stage);
        const revision = Number(idOf(request.prompt, "REVISION"));
        const images = await Promise.all(
          request.attachments.map((attachment) =>
            readFile(attachment.reference),
          ),
        );
        const call = state.record({
          stage,
          scenario: scenario.name,
          taskId: idOf(request.prompt, "TASK_ID"),
          revision: Number.isInteger(revision) ? revision : null,
          images: images.length,
          imageBytes: images.reduce((sum, bytes) => sum + bytes.length, 0),
          imageDigests: images.map((bytes) =>
            createHash("sha256").update(bytes).digest("hex").slice(0, 8),
          ),
          promptLength: request.prompt.length,
          via: "agent-runtime",
          outcome: "pending",
        });
        yield { type: "started", sessionId: "e2e-session" };
        if (scenario.hold) {
          call.outcome = "held";
          await state.hold(request.runId);
        }
        if (scenario.delayMs) await pause(scenario.delayMs);
        if (state.wasCancelled(request.runId)) {
          call.outcome = "cancelled";
          return;
        }
        const scripted = script(scenario.name, stage, call.revision ?? 1);
        if (scripted.kind === "failure") {
          call.outcome = "failed";
          const { code, message } = FAILURE_CODES[scripted.failure];
          yield {
            type: "failed",
            error: { code, message, retryable: code === "timeout" },
          };
          return;
        }
        call.outcome = "completed";
        yield {
          type: "usage",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        };
        yield {
          type: "completed",
          result: { sessionId: "e2e-session", output: scripted.output },
        };
      })();
    },
    resume: () => (async function* () {})(),
    async cancel(runId) {
      state.cancel(runId);
    },
  };
}

// ---- HTTP ---------------------------------------------------------------

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function send(
  response: ServerResponse,
  status: number,
  value: unknown,
  type = "application/json",
): void {
  response.writeHead(status, { "content-type": type });
  response.end(typeof value === "string" ? value : JSON.stringify(value));
}

// The fixture page that plays "the problem on screen". It carries no secret and
// no private text; the harness captures it as the owner's screen.
export const PROBLEM_TITLE = "E2E Problem on screen";
const problemPage = (cutOff: boolean) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${PROBLEM_TITLE}</title>
<style>body{font:20px system-ui;margin:48px;max-width:760px;background:#fff;color:#111}</style>
</head><body>
<h1>Sliding Window Rate Limiter</h1>
<p>Design a rate limiter that allows at most N requests per client in any
sliding window of W seconds.</p>
${cutOff ? "<p>Constraints and examples are below the fold</p>" : "<p>Example: N = 3, W = 10. Requests at t = 1, 2, 3 pass; a request at t = 4 is refused.</p><p>Constraints: 1 &lt;= N &lt;= 1000, 1 &lt;= W &lt;= 3600.</p>"}
</body></html>`;

export async function startControlServer(
  state: ControlState,
  port: number,
): Promise<Server> {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    try {
      if (request.method === "GET" && url.pathname === "/health")
        return send(response, 200, { ok: true });
      if (request.method === "GET" && url.pathname === "/problem")
        return send(
          response,
          200,
          problemPage(url.searchParams.get("variant") === "cutoff"),
          "text/html; charset=utf-8",
        );
      if (request.method === "GET" && url.pathname === "/calls")
        return send(response, 200, { calls: state.calls });
      if (request.method === "GET" && url.pathname === "/gate")
        return send(response, 200, { waiting: state.waiting() });
      if (request.method === "POST" && url.pathname === "/reset") {
        state.reset();
        return send(response, 200, { ok: true });
      }
      if (request.method === "POST" && url.pathname === "/scenario") {
        const input = (await body(request)) as {
          name?: string;
          delayMs?: number;
          hold?: boolean;
          once?: boolean;
        };
        const name = SCENARIO_NAMES.find((known) => known === input.name);
        if (!name)
          return send(response, 400, {
            error: `unknown scenario; known: ${SCENARIO_NAMES.join(", ")}`,
          });
        state.set(
          {
            name,
            ...(input.delayMs ? { delayMs: input.delayMs } : {}),
            ...(input.hold ? { hold: true } : {}),
          },
          input.once === true,
        );
        return send(response, 200, { ok: true });
      }
      if (request.method === "POST" && url.pathname === "/gate/release") {
        const input = (await body(request)) as { count?: number };
        return send(response, 200, { released: state.release(input.count) });
      }
      // The device-only path: an OpenAI-compatible endpoint the worker's direct
      // model adapter calls (AI_BASE_URL points here).
      if (request.method === "GET" && url.pathname === "/v1/models")
        return send(response, 200, {
          object: "list",
          data: [{ id: "e2e-model", object: "model" }],
        });
      if (
        request.method === "POST" &&
        url.pathname === "/v1/chat/completions"
      ) {
        const input = (await body(request)) as {
          messages?: Array<{ content?: unknown }>;
          stream?: boolean;
        };
        const prompt = (input.messages ?? [])
          .map((message) => String(message.content ?? ""))
          .join("\n");
        const stage = stageOf(prompt.slice(prompt.indexOf("TASK:")));
        const scenario = state.pick(stage);
        const revision = Number(idOf(prompt, "REVISION"));
        const call = state.record({
          stage,
          scenario: scenario.name,
          taskId: idOf(prompt, "TASK_ID"),
          revision: Number.isInteger(revision) ? revision : null,
          images: 0,
          imageBytes: 0,
          imageDigests: [],
          promptLength: prompt.length,
          via: "direct-model",
          outcome: "pending",
        });
        if (scenario.hold) {
          call.outcome = "held";
          await state.hold(`direct-${call.seq}`);
        }
        if (scenario.delayMs) await pause(scenario.delayMs);
        const scripted = script(scenario.name, stage, call.revision ?? 1);
        if (scripted.kind === "failure") {
          call.outcome = "failed";
          return send(response, 500, { error: { message: "scripted" } });
        }
        call.outcome = "completed";
        const content = JSON.stringify(scripted.output);
        const usage = {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        };
        // The answer draft is streamed (the worker reads the draft as it is
        // written): a `stream: true` request gets the same JSON object as
        // OpenAI-style SSE chunks, in a few pieces, then the usage and [DONE].
        if (input.stream === true) {
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
          });
          const chunk = (delta: Record<string, unknown>) =>
            `data: ${JSON.stringify({
              id: "chatcmpl-e2e",
              object: "chat.completion.chunk",
              model: "e2e-model",
              ...delta,
            })}\n\n`;
          const pieces = Math.max(
            1,
            Math.min(4, Math.ceil(content.length / 40)),
          );
          const size = Math.ceil(content.length / pieces);
          for (let at = 0; at < content.length; at += size)
            response.write(
              chunk({
                choices: [
                  {
                    index: 0,
                    delta: { content: content.slice(at, at + size) },
                    finish_reason: null,
                  },
                ],
              }),
            );
          response.write(
            chunk({
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              usage,
            }),
          );
          response.end("data: [DONE]\n\n");
          return;
        }
        return send(response, 200, {
          id: "chatcmpl-e2e",
          object: "chat.completion",
          model: "e2e-model",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content },
            },
          ],
          usage,
        });
      }
      return send(response, 404, { error: "not found" });
    } catch {
      return send(response, 500, { error: "control error" });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

// What specs use from their own process.
export class Control {
  constructor(private readonly base: string) {}

  private async post(path: string, value: unknown = {}): Promise<unknown> {
    const response = await fetch(`${this.base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    if (!response.ok)
      throw new Error(`control ${path} failed: ${response.status}`);
    return response.json();
  }

  scenario(
    name: ScenarioName,
    options: { delayMs?: number; hold?: boolean; once?: boolean } = {},
  ): Promise<unknown> {
    return this.post("/scenario", { name, ...options });
  }

  reset(): Promise<unknown> {
    return this.post("/reset");
  }

  release(count?: number): Promise<{ released: number }> {
    return this.post("/gate/release", { count }) as Promise<{
      released: number;
    }>;
  }

  async waiting(): Promise<number> {
    const response = await fetch(`${this.base}/gate`);
    return ((await response.json()) as { waiting: number }).waiting;
  }

  async calls(): Promise<Call[]> {
    const response = await fetch(`${this.base}/calls`);
    return ((await response.json()) as { calls: Call[] }).calls;
  }
}
