import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentJobWorkerRepository } from "@omnitech/agent-job-service";
import {
  type AgentRunRequest,
  type AgentRuntimeAdapter,
  validateAgentProfile,
} from "@omnitech/agent-runtime-contracts";

export interface AgentWorkerOptions {
  workerId: string;
  repository: AgentJobWorkerRepository;
  runtimes: Readonly<Record<string, AgentRuntimeAdapter>>;
  loadPrompt(reference: string): Promise<string>;
  storeResult?(tenantId: string, result: unknown): Promise<string>;
  pollIntervalMs?: number;
  leaseMs?: number;
  // How many jobs run at once. Each claims and runs one job at a time.
  concurrency?: number;
}

export async function runAgentWorker(
  options: AgentWorkerOptions,
  signal: AbortSignal,
): Promise<void> {
  const loops = Math.max(1, Math.floor(options.concurrency ?? 1));
  await Promise.all(
    Array.from({ length: loops }, async (_, index) => {
      const loopOptions = {
        ...options,
        workerId:
          loops === 1 ? options.workerId : `${options.workerId}:${index + 1}`,
      };
      while (!signal.aborted) {
        try {
          await runLoop(loopOptions, signal);
        } catch {
          // One loop's unexpected error must not tear down the shared database
          // while another loop is still running a claimed job.
          if (!signal.aborted)
            await new Promise((resolve) =>
              setTimeout(resolve, loopOptions.pollIntervalMs ?? 500),
            );
        }
      }
    }),
  );
}

async function runLoop(
  options: AgentWorkerOptions,
  signal: AbortSignal,
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const leaseMs = options.leaseMs ?? 30_000;
  while (!signal.aborted) {
    let job: Awaited<ReturnType<AgentJobWorkerRepository["claim"]>>;
    try {
      job = await options.repository.claim(options.workerId, leaseMs);
    } catch {
      // A transient claim failure belongs to this loop, not its siblings.
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      continue;
    }
    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      continue;
    }
    // [GUARD] The stored snapshot is re-checked before anything runs: a job
    // whose profile is out of bounds fails with a normalized error instead.
    try {
      validateAgentProfile(job.profile);
    } catch {
      await options.repository.appendEvent(job.id, {
        type: "failed",
        error: {
          code: "configuration",
          message: "The agent profile is outside its allowed bounds.",
          retryable: false,
        },
      });
      await options.repository.transition(job.id, ["claimed"], "failed");
      continue;
    }
    const runtime = options.runtimes[job.profile.runtime];
    if (!runtime) {
      await options.repository.appendEvent(job.id, {
        type: "failed",
        error: {
          code: "configuration",
          message: "The agent runtime is not configured.",
          retryable: false,
        },
      });
      await options.repository.transition(job.id, ["claimed"], "failed");
      continue;
    }
    const workspace = await mkdtemp(join(tmpdir(), "omnitech-agent-"));
    // [SAFETY] While this loop runs the job, keep its lease: with other loops
    // claiming, an expired lease would hand a running job to someone else.
    // The same tick notices a lost lease (stop, write nothing) and a cancel
    // request, so a quiet agent is stopped within one tick rather than at its
    // next event.
    let leaseLost = false;
    let stopping = false;
    let lastRenewed = Date.now();
    let failedRenewals = 0;
    let renewing = false;
    const stopRuntime = () => {
      if (stopping) return;
      stopping = true;
      void runtime.cancel(job.id).catch(() => undefined);
    };
    const heartbeat = setInterval(
      () =>
        void (async () => {
          if (renewing || leaseLost) return;
          renewing = true;
          try {
            const renewed = await options.repository
              .renewLease(job.id, options.workerId, leaseMs)
              .catch(() => undefined);
            if (renewed) {
              lastRenewed = Date.now();
              failedRenewals = 0;
            } else failedRenewals += 1;
            // No successful renewal for a whole lease means another worker may
            // own the job by now, however the renewal failed.
            if (
              renewed === false ||
              failedRenewals >= 2 ||
              Date.now() - lastRenewed >= leaseMs
            ) {
              leaseLost = true;
              stopRuntime();
              return;
            }
            const current = await options.repository
              .get(job.tenantId, job.id)
              .catch(() => undefined);
            if (current?.status === "cancelling") stopRuntime();
          } finally {
            renewing = false;
          }
        })(),
      Math.max(250, Math.floor(leaseMs / 3)),
    );
    const me = options.workerId;
    let ended = false;
    try {
      await options.repository.transition(job.id, ["claimed"], "starting", me);
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
      await options.repository.transition(job.id, ["starting"], "running", me);
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
        // [GUARD] A lost lease means another worker owns the job now.
        if (leaseLost) break;
        const current = await options.repository.get(job.tenantId, job.id);
        if (current?.status === "cancelling") {
          await runtime.cancel(job.id);
          await options.repository.appendEvent(
            job.id,
            {
              type: "failed",
              error: {
                code: "cancelled",
                message: "Agent job cancelled.",
                retryable: false,
              },
            },
            me,
          );
          await options.repository.transition(
            job.id,
            ["cancelling"],
            "cancelled",
            me,
          );
          ended = true;
          break;
        }
        await options.repository.appendEvent(job.id, event, me);
        if (event.type === "started") {
          await options.repository.setSessionId(job.id, event.sessionId, me);
        } else if (event.type === "awaiting-input") {
          await options.repository.transition(
            job.id,
            ["running"],
            "awaiting-input",
            me,
          );
          ended = true;
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
              me,
            );
          }
          // A cancel that raced the completion still ends terminal.
          const finished = await options.repository.transition(
            job.id,
            ["running"],
            "succeeded",
            me,
          );
          if (!finished && !leaseLost) {
            await options.repository.appendEvent(
              job.id,
              {
                type: "failed",
                error: {
                  code: "cancelled",
                  message: "Agent job cancelled.",
                  retryable: false,
                },
              },
              me,
            );
            await options.repository.transition(
              job.id,
              ["cancelling"],
              "cancelled",
              me,
            );
          }
          ended = true;
          break;
        } else if (event.type === "failed") {
          await options.repository.transition(
            job.id,
            ["running", "cancelling"],
            event.error.code === "cancelled" ? "cancelled" : "failed",
            me,
          );
          ended = true;
          break;
        }
      }
      // A cancel noticed by the heartbeat ends here, under this worker's lease.
      if (stopping && !leaseLost && !ended) {
        await options.repository.appendEvent(
          job.id,
          {
            type: "failed",
            error: {
              code: "cancelled",
              message: "Agent job cancelled.",
              retryable: false,
            },
          },
          me,
        );
        await options.repository.transition(
          job.id,
          ["cancelling"],
          "cancelled",
          me,
        );
        ended = true;
      }
      if (!ended && !leaseLost) {
        await options.repository.appendEvent(
          job.id,
          {
            type: "failed",
            error: {
              code: "infrastructure",
              message: "The agent ended without a result.",
              retryable: false,
            },
          },
          me,
        );
        await options.repository.transition(job.id, ["running"], "failed", me);
      }
    } catch {
      if (leaseLost) continue;
      // A fenced write that throws means the job is no longer this worker's;
      // recording the failure must never reject the loop.
      try {
        await options.repository.appendEvent(
          job.id,
          {
            type: "failed",
            error: {
              code: "infrastructure",
              message:
                "Agent execution failed. Check the runtime configuration and start a new job.",
              retryable: false,
            },
          },
          me,
        );
        await options.repository.transition(
          job.id,
          ["claimed", "starting", "running", "cancelling"],
          "failed",
          me,
        );
      } catch {
        // Nothing left to record: the job belongs to another worker now.
      }
    } finally {
      clearInterval(heartbeat);
      await rm(workspace, { recursive: true, force: true });
    }
  }
}
