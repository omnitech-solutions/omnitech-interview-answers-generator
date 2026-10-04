import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentEvent,
  AgentProfile,
  AgentRunRequest,
} from "@omnitech/agent-runtime-contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCodexRuntimeAdapter } from "./index.js";

// The Codex SDK spawns the Codex CLI and reads its JSONL thread events. This
// stand-in CLI is the only fake: it answers by the scenario named in the
// prompt and echoes what it was given so tests can see what the SDK passed.
const fakeCodex = `#!${process.execPath}
const args = process.argv.slice(2);
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
  const resumeAt = args.indexOf("resume");
  const echo = JSON.stringify({
    args,
    input,
    apiKey: process.env.CODEX_API_KEY ?? null,
    mark: process.env.FAKE_CODEX_MARK ?? null,
  });
  if (input.includes("crash")) {
    process.stderr.write("model refused the sandbox");
    process.exit(2);
  }
  if (resumeAt === -1 && !input.includes("anonymous"))
    emit({ type: "thread.started", thread_id: "thread-new" });
  if (input.includes("hang")) {
    setInterval(() => undefined, 1000);
    return;
  }
  if (input.includes("turn-fails")) {
    emit({ type: "turn.failed", error: { message: "Quota exceeded" } });
    return;
  }
  if (input.includes("stream-error")) {
    emit({ type: "error", message: "Stream disconnected" });
    return;
  }
  emit({ type: "turn.started" });
  emit({ type: "item.started", item: { id: "c1", type: "command_execution", command: "ls", aggregated_output: "", status: "in_progress" } });
  emit({ type: "item.completed", item: { id: "c1", type: "command_execution", command: "ls", aggregated_output: "", exit_code: 0, status: "completed" } });
  emit({ type: "item.started", item: { id: "m1", type: "mcp_tool_call", server: "docs", tool: "search", status: "in_progress" } });
  emit({ type: "item.completed", item: { id: "m1", type: "mcp_tool_call", server: "docs", tool: "search", status: "failed" } });
  emit({ type: "item.started", item: { id: "r1", type: "reasoning", text: "thinking" } });
  emit({ type: "item.completed", item: { id: "a1", type: "agent_message", text: echo } });
  emit({ type: "turn.completed", usage: { input_tokens: 12, cached_input_tokens: 0, output_tokens: 5 } });
});
`;

const profile: AgentProfile = {
  id: "interview-coach",
  version: 1,
  runtime: "codex",
  model: "gpt-test",
  fallbackModels: [],
  effort: "medium",
  tools: [],
  sandbox: "read-only",
  approvalPolicy: "never",
  sessionPersistence: true,
  maximumTurns: 2,
  timeoutMs: 60_000,
  maximumOutputBytes: 100_000,
  additionalDirectories: [],
  webSearch: false,
};

let directory: string;
let codexPath: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "fake-codex-"));
  codexPath = join(directory, "codex");
  await writeFile(codexPath, fakeCodex);
  await chmod(codexPath, 0o755);
});
afterAll(async () => rm(directory, { recursive: true, force: true }));

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    runId: "run-1",
    profile,
    prompt: "explain closures",
    workingDirectory: directory,
    additionalDirectories: [],
    attachments: [],
    timeoutMs: 60_000,
    ...overrides,
  };
}

async function collect(source: AsyncIterable<AgentEvent>) {
  const events: AgentEvent[] = [];
  for await (const event of source) events.push(event);
  return events;
}

type Echo = {
  args: string[];
  input: string;
  apiKey: string | null;
  mark: string | null;
};

function echoOf(events: AgentEvent[]): Echo {
  const completed = events.find((event) => event.type === "completed");
  if (completed?.type !== "completed") throw new Error("no completion");
  const output = completed.result.output;
  return (typeof output === "string" ? JSON.parse(output) : output) as Echo;
}

describe("Codex agent runtime against the Codex CLI protocol", () => {
  it("streams normalized tool, text and usage events and completes the turn", async () => {
    const runtime = createCodexRuntimeAdapter({ codexPathOverride: codexPath });

    const events = await collect(
      runtime.run(request({ systemPrompt: "You are a coach." })),
    );

    expect(events.map((event) => event.type)).toEqual([
      "started",
      "tool-started",
      "tool-finished",
      "tool-started",
      "tool-finished",
      "text-delta",
      "usage",
      "completed",
    ]);
    expect(events).toContainEqual({ type: "started", sessionId: "thread-new" });
    expect(events).toContainEqual({
      type: "tool-finished",
      tool: "command",
      success: true,
    });
    expect(events).toContainEqual({
      type: "tool-finished",
      tool: "docs/search",
      success: false,
    });
    expect(events).toContainEqual({
      type: "usage",
      usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
    });
    const echo = echoOf(events);
    // The system prompt precedes the task prompt in one input.
    expect(echo.input).toBe("You are a coach.\n\nexplain closures");
    expect(echo.args).toEqual(
      expect.arrayContaining([
        "--model",
        "gpt-test",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        'web_search="disabled"',
        'approval_policy="never"',
      ]),
    );
  });

  it("parses structured output and enables live web search when the profile allows it", async () => {
    const runtime = createCodexRuntimeAdapter({ codexPathOverride: codexPath });

    const events = await collect(
      runtime.run(
        request({
          profile: { ...profile, webSearch: true },
          outputSchema: { type: "object" },
        }),
      ),
    );

    const echo = echoOf(events);
    expect(echo.input).toBe("explain closures");
    expect(echo.args).toContain("--output-schema");
    expect(echo.args).toContain('web_search="live"');
  });

  it("resumes an existing thread and reports it as the session", async () => {
    const runtime = createCodexRuntimeAdapter({ codexPathOverride: codexPath });

    const events = await collect(
      runtime.resume({
        runId: "run-2",
        sessionId: "thread-7",
        prompt: "and now in TypeScript",
        profile,
        workingDirectory: directory,
        outputSchema: { type: "object" },
      }),
    );

    const completed = events.at(-1);
    expect(completed).toMatchObject({
      type: "completed",
      result: { sessionId: "thread-7" },
    });
    const echo = echoOf(events);
    expect(echo.args.slice(echo.args.indexOf("resume"))).toEqual([
      "resume",
      "thread-7",
    ]);
    expect(echo.args).toContain("--output-schema");
  });

  it("passes the API key, base URL and configured environment to the CLI", async () => {
    const runtime = createCodexRuntimeAdapter({
      codexPathOverride: codexPath,
      apiKey: "sk-test",
      baseUrl: "https://codex.example.test/v1",
      environment: { FAKE_CODEX_MARK: "configured" },
    });

    const echo = echoOf(await collect(runtime.run(request())));

    expect(echo.apiKey).toBe("sk-test");
    expect(echo.mark).toBe("configured");
    expect(echo.args).toContain(
      'openai_base_url="https://codex.example.test/v1"',
    );
  });

  it("reports a failed turn and a stream error as provider failures", async () => {
    const runtime = createCodexRuntimeAdapter({ codexPathOverride: codexPath });

    const turn = await collect(runtime.run(request({ prompt: "turn-fails" })));
    const stream = await collect(
      runtime.run(request({ prompt: "stream-error" })),
    );

    expect(turn).toContainEqual({
      type: "failed",
      error: { code: "provider", message: "Quota exceeded", retryable: false },
    });
    expect(stream).toContainEqual({
      type: "failed",
      error: {
        code: "provider",
        message: "Stream disconnected",
        retryable: false,
      },
    });
    expect(
      turn.filter(
        (event) => event.type === "failed" || event.type === "completed",
      ),
    ).toHaveLength(1);
    expect(
      stream.filter(
        (event) => event.type === "failed" || event.type === "completed",
      ),
    ).toHaveLength(1);
  });

  it("fails a turn that never names its thread", async () => {
    const runtime = createCodexRuntimeAdapter({ codexPathOverride: codexPath });

    const events = await collect(runtime.run(request({ prompt: "anonymous" })));

    expect(events.at(-1)).toEqual({
      type: "failed",
      error: {
        code: "provider",
        message: "Codex did not return a session identifier.",
        retryable: false,
      },
    });
  });

  it("fails when the CLI exits with an error", async () => {
    const runtime = createCodexRuntimeAdapter({ codexPathOverride: codexPath });

    const events = await collect(runtime.run(request({ prompt: "crash" })));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "failed",
      error: { code: "provider", retryable: false },
    });
    expect(JSON.stringify(events[0])).toContain("exited with code 2");
  });

  it("cancels a running turn by its run id", async () => {
    const runtime = createCodexRuntimeAdapter({ codexPathOverride: codexPath });
    const events: AgentEvent[] = [];

    for await (const event of runtime.run(request({ prompt: "hang" }))) {
      events.push(event);
      if (event.type === "started") await runtime.cancel("run-1");
    }

    expect(events.at(-1)).toMatchObject({
      type: "failed",
      error: { code: "cancelled", retryable: false },
    });
    // Cancelling a finished or unknown run is a no-op.
    await expect(runtime.cancel("run-1")).resolves.toBeUndefined();
  });
});
