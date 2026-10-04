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

const fakeServer = `#!${process.execPath}
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
let threadCount = 0;
let turnCount = 0;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialized") return;
  const { id, method, params } = message;
  if (method === "initialize") return send({ id, result: { userAgent: "fake" } });
  if (method === "thread/start" || method === "thread/resume") {
    const threadId = params.threadId ?? "thread-" + ++threadCount;
    return send({ id, result: { thread: { id: threadId } } });
  }
  if (method === "turn/interrupt") {
    send({ id, result: {} });
    send({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } } });
    return;
  }
  if (method === "turn/start") {
    const turnId = "turn-" + ++turnCount;
    const prompt = params.input[0].text;
    if (prompt === "crash") return process.exit(2);
    send({ id, result: { turn: { id: turnId } } });
    if (prompt === "hang") return;
    if (prompt === "fail") {
      send({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "failed", error: { message: "Quota exceeded" } } } });
      return;
    }
    send({ method: "item/started", params: { threadId: params.threadId, turnId, item: { type: "commandExecution" } } });
    send({ method: "item/completed", params: { threadId: params.threadId, turnId, item: { type: "commandExecution", status: "completed" } } });
    send({ method: "item/agentMessage/delta", params: { threadId: params.threadId, turnId, delta: params.outputSchema ? '{"ok":true}' : "hello" } });
    send({ method: "thread/tokenUsage/updated", params: { threadId: params.threadId, turnId, tokenUsage: { last: { inputTokens: 12, outputTokens: 5, totalTokens: 17 } } } });
    send({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
  }
});
`;
const profile: AgentProfile = {
  id: "test",
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
  timeoutMs: 1000,
  maximumOutputBytes: 10000,
  additionalDirectories: [],
  webSearch: false,
};
let directory: string;
let codexPath: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "fake-app-server-"));
  codexPath = join(directory, "codex");
  await writeFile(codexPath, fakeServer);
  await chmod(codexPath, 0o755);
});
afterAll(async () => rm(directory, { recursive: true, force: true }));
function request(prompt = "hello"): AgentRunRequest {
  return {
    runId: prompt,
    profile,
    prompt,
    workingDirectory: directory,
    additionalDirectories: [],
    attachments: [],
    timeoutMs: 1000,
  };
}
async function collect(source: AsyncIterable<AgentEvent>) {
  const events: AgentEvent[] = [];
  for await (const event of source) events.push(event);
  return events;
}
describe("Codex App Server runtime", () => {
  it("streams a turn and reuses one host for a resumed thread", async () => {
    const adapter = createCodexRuntimeAdapter({
      codexPathOverride: codexPath,
    });
    const first = await collect(adapter.run(request()));
    expect(first.map((event) => event.type)).toEqual([
      "started",
      "tool-started",
      "tool-finished",
      "text-delta",
      "usage",
      "completed",
    ]);
    expect(first.at(-1)).toMatchObject({
      type: "completed",
      result: { sessionId: "thread-1", output: "hello" },
    });
    const second = await collect(
      adapter.resume({
        runId: "hello",
        sessionId: "thread-1",
        prompt: "again",
        profile,
        workingDirectory: directory,
        outputSchema: { type: "object" },
      }),
    );
    expect(second.at(-1)).toMatchObject({
      type: "completed",
      result: { sessionId: "thread-1", output: { ok: true } },
    });
  });
  it("reports a failed turn", async () => {
    const events = await collect(
      createCodexRuntimeAdapter({
        codexPathOverride: codexPath,
      }).run(request("fail")),
    );
    expect(events.at(-1)).toMatchObject({
      type: "failed",
      error: { message: "Quota exceeded" },
    });
  });
  it("refuses to resume another run's live thread", async () => {
    const adapter = createCodexRuntimeAdapter({
      codexPathOverride: codexPath,
    });
    await collect(adapter.run(request("first")));
    const events = await collect(
      adapter.resume({
        runId: "another-job",
        sessionId: "thread-1",
        prompt: "second",
        profile,
        workingDirectory: directory,
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "failed",
      error: { message: "Codex session belongs to another run." },
    });
    await adapter.close?.();
  });
  it("fails a turn when the owned server dies", async () => {
    const events = await collect(
      createCodexRuntimeAdapter({
        codexPathOverride: codexPath,
      }).run(request("crash")),
    );
    expect(events.at(-1)).toMatchObject({
      type: "failed",
      error: { code: "provider" },
    });
  });
  it("interrupts an active turn", async () => {
    const adapter = createCodexRuntimeAdapter({
      codexPathOverride: codexPath,
    });
    const events: AgentEvent[] = [];
    for await (const event of adapter.run(request("hang"))) {
      events.push(event);
      if (event.type === "started")
        setTimeout(() => void adapter.cancel("hang"), 20);
    }
    expect(events.at(-1)).toMatchObject({
      type: "failed",
      error: { code: "cancelled", message: "Codex turn interrupted." },
    });
  });
});
