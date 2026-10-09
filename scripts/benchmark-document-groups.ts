import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAiEngine } from "@omnitech/ai-engine";
import {
  type AgentProfile,
  type AgentRuntimeAdapter,
  createAgentModelPort,
} from "@omnitech/ai-engine/providers/agents";
import { createClaudeRuntimeAdapter } from "@omnitech/ai-engine/providers/agents/claude-sdk";
import { createCodexRuntimeAdapter } from "@omnitech/ai-engine/providers/agents/codex-app-server";
import { createMemoryTrace } from "@omnitech/ai-engine/trace";
import { generateDocumentValues } from "../products/interview/src/backend/documents/generate";

if (process.env["BENCHMARK_LIVE"] !== "1")
  throw new Error(
    "Set BENCHMARK_LIVE=1 to authorize bounded live model calls.",
  );
const trials = Number(process.env["TRIALS"] ?? "1");
if (!Number.isInteger(trials) || trials < 1 || trials > 10)
  throw new Error("TRIALS must be 1–10.");
const target = process.env["TARGET"] ?? "codex";
if (target !== "codex" && target !== "claude-code")
  throw new Error("TARGET must be codex or claude-code.");
const adapter: AgentRuntimeAdapter =
  target === "codex"
    ? createCodexRuntimeAdapter(
        process.env["CODEX_PATH"]
          ? { codexPathOverride: process.env["CODEX_PATH"] }
          : {},
      )
    : createClaudeRuntimeAdapter();
const directory = await mkdtemp(join(tmpdir(), "omnitech-document-benchmark-"));
const model =
  target === "codex"
    ? (process.env["BENCHMARK_CODEX_MODEL"] ?? "gpt-6-luna")
    : (process.env["BENCHMARK_CLAUDE_MODEL"] ?? "sonnet");
const profile: AgentProfile = {
  id: "document-benchmark",
  version: 1,
  runtime: target,
  model,
  fallbackModels: [],
  effort: "medium",
  tools: [],
  sandbox: "read-only",
  approvalPolicy: "never",
  sessionPersistence: false,
  maximumTurns: 1,
  maximumBudgetUsd: 0.25,
  timeoutMs: 120_000,
  maximumOutputBytes: 20_000,
  additionalDirectories: [],
  webSearch: false,
};
const sections = ["Experience", "Projects", "Skills"];
const fields = Array.from({ length: 15 }, (_, index) => ({
  key: `field_${index + 1}`,
  label: `${sections[Math.floor(index / 5)]} point ${(index % 5) + 1}`,
  section: sections[Math.floor(index / 5)],
  source: "candidate-profile" as const,
  required: false,
  maxLength: 180,
}));
const candidateProfile = {
  name: "Ada Example",
  roles: [
    {
      title: "Backend Engineer",
      company: "Northstar",
      years: "2021-2024",
      work: [
        "Built TypeScript services",
        "Added PostgreSQL row policies",
        "Reduced queue retries",
      ],
    },
    {
      title: "Software Engineer",
      company: "Fieldworks",
      years: "2018-2021",
      work: ["Maintained React dashboard", "Wrote integration tests"],
    },
  ],
  projects: [
    "Document editor with immutable revisions",
    "Tenant aware interview assistant",
  ],
  skills: ["TypeScript", "PostgreSQL", "React", "Vitest"],
};
// The runtime under test, as the engine's one profile. Every call the engine
// makes (a repair turn included) leaves a record without content, which is
// where the call, token and cost counts are read from.
const trace = createMemoryTrace();
const engine = createAiEngine({
  profiles: [{ id: "benchmark", provider: "agent", kind: "agent" }],
  providers: {
    agent: createAgentModelPort({
      runtime: adapter,
      profiles: { benchmark: profile },
      toolless: true,
      workspace: async () => ({ path: directory, release: async () => {} }),
    }),
  },
  trace: { sink: trace, capture: "metadata" },
});
try {
  const groups = [4, 1, 3, 5];
  for (let trial = 1; trial <= trials; trial++) {
    for (const groupCount of [
      ...groups.slice((trial - 1) % groups.length),
      ...groups.slice(0, (trial - 1) % groups.length),
    ]) {
      const recordedBefore = trace.records.length;
      const start = performance.now();
      let firstModelFieldMs: number | null = null;
      let failure: string | null = null;
      try {
        await generateDocumentValues(
          engine,
          {
            tenantId: "benchmark",
            actorId: "benchmark",
            profileId: "benchmark",
            templateId: "synthetic-resume",
            templateRevision: 1,
            candidateProfileRevisionId: "synthetic-profile-1",
            fields,
            instructions:
              "Write short evidence-based resume points. Empty string for unsupported facts.",
            candidateProfile,
            candidacyValues: { role_title: "Backend Engineer" },
            interviewValues: {},
            missingProfileKeys: [],
            generation: {
              maxCalls: groupCount,
              fieldsPerCall: 15 / groupCount,
              attempts: 1,
            },
          },
          {
            onBatch: () => {
              firstModelFieldMs ??= performance.now() - start;
            },
          },
        );
      } catch (error) {
        failure = error instanceof Error ? error.message : "unknown";
      }
      await engine.traceSettled();
      const records = trace.records.slice(recordedBefore);
      const calls = records.length;
      let tokens = 0;
      let costUsd = 0;
      let costKnown = true;
      for (const { usage } of records) {
        if (usage.status !== "unavailable") tokens += usage.totalTokens ?? 0;
        if (usage.cost.status === "actual") costUsd += usage.cost.amount;
        else costKnown = false;
      }
      // The benchmark log contains metrics only, never profile or model text.
      console.log(
        JSON.stringify({
          target,
          model,
          groupCount,
          trial,
          firstModelFieldMs:
            firstModelFieldMs === null ? null : Math.round(firstModelFieldMs),
          totalMs: Math.round(performance.now() - start),
          calls,
          tokens,
          costUsd: costKnown ? Number(costUsd.toFixed(6)) : null,
          failure,
        }),
      );
    }
  }
} finally {
  await adapter.close?.();
  await rm(directory, { recursive: true, force: true });
}
