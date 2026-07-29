import type { AgentJobRepository } from "@omnitech/agent-job-service";
import type {
  AgentRunRequest,
  AgentRuntimeAdapter,
} from "@omnitech/agent-runtime-contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface AgentWorkerOptions {
  workerId: string;
  repository: AgentJobRepository;
  runtimes: Readonly<Record<string, AgentRuntimeAdapter>>;
  loadPrompt(reference: string): Promise<string>;
  pollIntervalMs?: number;
  leaseMs?: number;
}

export async function runAgentWorker(
  options: AgentWorkerOptions,
  signal: AbortSignal,
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  while (!signal.aborted) {
    const job = await options.repository.claim(
      options.workerId,
      options.leaseMs ?? 30_000,
    );
    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      continue;
    }
    const runtime = options.runtimes[job.profile.runtime];
    if (!runtime) {
      await options.repository.transition(job.id, ["claimed"], "failed");
      continue;
    }
    const workspace = await mkdtemp(join(tmpdir(), "omnitech-agent-"));
    try {
      await options.repository.transition(job.id, ["claimed"], "starting");
      const request: AgentRunRequest = {
        runId: job.id,
        profile: job.profile,
        prompt: await options.loadPrompt(job.promptReference),
        workingDirectory: workspace,
        additionalDirectories: [],
        attachments: [],
        timeoutMs: job.profile.timeoutMs,
      };
      await options.repository.transition(job.id, ["starting"], "running");
      for await (const event of runtime.run(request)) {
        await options.repository.appendEvent(job.id, event);
        if (event.type === "completed") {
          await options.repository.transition(job.id, ["running"], "succeeded");
        } else if (event.type === "failed") {
          await options.repository.transition(
            job.id,
            ["running", "cancelling"],
            event.error.code === "cancelled" ? "cancelled" : "failed",
          );
        }
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}
