import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentProfile,
  AgentRuntimeAdapter,
} from "@omnitech/agent-runtime-contracts";
import type { AiExecutionGateway } from "@omnitech/ai-contracts";
import { createClaudeRuntimeAdapter } from "../packages/agent-runtime-claude/src/index.js";
import { createCodexRuntimeAdapter } from "../packages/agent-runtime-codex/src/index.js";
import { generateDocumentValues } from "../products/interview/src/backend/documents/generate.js";

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
    ? createCodexRuntimeAdapter({
        codexPathOverride: process.env["CODEX_PATH"],
      })
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
let calls = 0;
let tokens = 0;
let costUsd = 0;
let costKnown = true;
const gateway: Pick<AiExecutionGateway, "execute"> = {
  async execute(request) {
    calls++;
    const run = {
      runId: randomUUID(),
      profile,
      prompt: request.task.prompt,
      systemPrompt: request.task.system,
      workingDirectory: directory,
      additionalDirectories: [],
      attachments: [],
      outputSchema: request.task.schema,
      timeoutMs: 120_000,
    };
    for await (const event of adapter.run(run)) {
      if (event.type === "usage") {
        tokens += event.usage.totalTokens ?? 0;
        if (event.usage.costUsd === undefined) costKnown = false;
        else costUsd += event.usage.costUsd;
      }
      if (event.type === "failed") throw new Error(event.error.message);
      if (event.type === "completed")
        return {
          executionId: run.runId,
          family: "agent",
          targetId: target,
          result: event.result.output,
          usage: {},
        };
    }
    throw new Error("Provider ended without a result.");
  },
};
try {
  const groups = [4, 1, 3, 5];
  for (let trial = 1; trial <= trials; trial++) {
    for (const groupCount of [
      ...groups.slice((trial - 1) % groups.length),
      ...groups.slice(0, (trial - 1) % groups.length),
    ]) {
      calls = 0;
      tokens = 0;
      costUsd = 0;
      costKnown = true;
      const start = performance.now();
      let firstModelFieldMs: number | null = null;
      let failure: string | null = null;
      try {
        await generateDocumentValues(
          gateway,
          {
            tenantId: "benchmark",
            actorId: "benchmark",
            profileId: "benchmark",
            targetId: target,
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
