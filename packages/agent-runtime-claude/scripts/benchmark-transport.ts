import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentProfile } from "@omnitech/agent-runtime-contracts";
import { createClaudeRuntimeAdapter } from "../src/index.js";

if (process.env["BENCHMARK_LIVE"] !== "1")
  throw new Error("Set BENCHMARK_LIVE=1 for live provider calls.");
const trials = Number(process.env["TRIALS"] ?? "5");
if (!Number.isInteger(trials) || trials < 1 || trials > 10)
  throw new Error("TRIALS must be 1–10.");
const directory = await mkdtemp(join(tmpdir(), "omnitech-claude-transport-"));
const model = process.env["BENCHMARK_CLAUDE_MODEL"] ?? "sonnet";
const profile: AgentProfile = {
  id: "transport-benchmark",
  version: 1,
  runtime: "claude-code",
  model,
  fallbackModels: [],
  effort: "medium",
  tools: [],
  sandbox: "read-only",
  approvalPolicy: "never",
  sessionPersistence: true,
  maximumTurns: 1,
  maximumBudgetUsd: 0.1,
  timeoutMs: 120_000,
  maximumOutputBytes: 1000,
  additionalDirectories: [],
  webSearch: false,
};
const adapter = createClaudeRuntimeAdapter();
const prompt = "Respond with exactly OK and no other text.";
let sessionId: string | undefined;
const runId = "paired-transport-benchmark";
async function oneShot() {
  const start = performance.now();
  let firstTextMs: number | null = null;
  let costUsd: number | null = null;
  const stream = query({
    prompt,
    options: {
      cwd: directory,
      model,
      maxTurns: 1,
      permissionMode: "dontAsk",
      tools: [],
      allowedTools: [],
      includePartialMessages: true,
      maxBudgetUsd: 0.1,
    },
  });
  try {
    for await (const message of stream) {
      if (
        message.type === "stream_event" &&
        message.event.type === "content_block_delta" &&
        message.event.delta.type === "text_delta"
      )
        firstTextMs ??= Math.round(performance.now() - start);
      if (message.type === "result") {
        if (message.subtype !== "success")
          throw new Error(message.errors.join("; "));
        costUsd = message.total_cost_usd;
        break;
      }
    }
  } finally {
    stream.close();
  }
  return {
    firstTextMs,
    totalMs: Math.round(performance.now() - start),
    costUsd,
  };
}
async function pooled() {
  const start = performance.now();
  let firstTextMs: number | null = null;
  let costUsd: number | null = null;
  const request = { runId, profile, prompt, workingDirectory: directory };
  const events = sessionId
    ? adapter.resume({ ...request, sessionId })
    : adapter.run({
        ...request,
        additionalDirectories: [],
        attachments: [],
        timeoutMs: 120_000,
      });
  for await (const event of events) {
    if (event.type === "text-delta")
      firstTextMs ??= Math.round(performance.now() - start);
    if (event.type === "started") sessionId = event.sessionId;
    if (event.type === "usage") costUsd = event.usage.costUsd ?? null;
    if (event.type === "completed") sessionId = event.result.sessionId;
    if (event.type === "failed") throw new Error(event.error.message);
  }
  return {
    firstTextMs,
    totalMs: Math.round(performance.now() - start),
    costUsd,
  };
}
try {
  for (let trial = 1; trial <= trials; trial++) {
    for (const transport of trial % 2
      ? ["one-shot", "pooled"]
      : ["pooled", "one-shot"]) {
      try {
        const result =
          transport === "one-shot" ? await oneShot() : await pooled();
        console.log(
          JSON.stringify({ model, trial, transport, ...result, failure: null }),
        );
      } catch (error) {
        console.log(
          JSON.stringify({
            model,
            trial,
            transport,
            failure: error instanceof Error ? error.message : "unknown",
          }),
        );
      }
    }
  }
} finally {
  await adapter.close?.();
  await rm(directory, { recursive: true, force: true });
}
