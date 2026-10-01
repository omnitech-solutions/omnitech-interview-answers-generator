import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentJobRepository } from "@omnitech/agent-job-service";
import type {
  AgentRunRequest,
  AgentRuntimeAdapter,
} from "@omnitech/agent-runtime-contracts";

export interface AgentWorkerOptions {
  workerId: string;
  repository: AgentJobRepository;
  runtimes: Readonly<Record<string, AgentRuntimeAdapter>>;
  loadPrompt(reference: string): Promise<string>;
  storeResult?(tenantId: string, result: unknown): Promise<string>;
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
        ...(job.profile.outputSchema === undefined
          ? {}
          : { outputSchema: job.profile.outputSchema }),
      };
      await options.repository.transition(job.id, ["starting"], "running");
      const events =
        job.sessionId && runtime.capabilities.resume
          ? runtime.resume({
              runId: job.id,
              sessionId: job.sessionId,
              prompt: request.prompt,
              profile: job.profile,
              workingDirectory: workspace,
              ...(job.profile.outputSchema === undefined
                ? {}
                : { outputSchema: job.profile.outputSchema }),
            })
          : runtime.run(request);
      for await (const event of events) {
        const current = await options.repository.get(job.tenantId, job.id);
        if (current?.status === "cancelling") {
          await runtime.cancel(job.id);
          await options.repository.appendEvent(job.id, {
            type: "failed",
            error: {
              code: "cancelled",
              message: "Agent job cancelled.",
              retryable: false,
            },
          });
          await options.repository.transition(
            job.id,
            ["cancelling"],
            "cancelled",
          );
          break;
        }
        await options.repository.appendEvent(job.id, event);
        if (event.type === "started") {
          await options.repository.setSessionId(job.id, event.sessionId);
        } else if (event.type === "awaiting-input") {
          await options.repository.transition(
            job.id,
            ["running"],
            "awaiting-input",
          );
          break;
        } else if (event.type === "completed") {
          if (options.storeResult) {
            const resultReference = await options.storeResult(
              job.tenantId,
              event.result,
            );
            await options.repository.setResultReference(
              job.id,
              resultReference,
            );
          }
          await options.repository.transition(job.id, ["running"], "succeeded");
          break;
        } else if (event.type === "failed") {
          await options.repository.transition(
            job.id,
            ["running", "cancelling"],
            event.error.code === "cancelled" ? "cancelled" : "failed",
          );
          break;
        }
      }
    } catch {
      await options.repository.appendEvent(job.id, {
        type: "failed",
        error: {
          code: "infrastructure",
          message:
            "Agent execution failed. Check the runtime configuration and start a new job.",
          retryable: false,
        },
      });
      await options.repository.transition(
        job.id,
        ["claimed", "starting", "running", "cancelling"],
        "failed",
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}
