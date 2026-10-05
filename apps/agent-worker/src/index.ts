import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentJobWorkerRepository } from "@omnitech/agent-job-service";
import {
  type AgentEvent,
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

const TIMED_OUT = Symbol("timed-out");

// What a cancelled job records: a fixed event, nothing the agent produced.
const CANCELLED_EVENT: Extract<AgentEvent, { type: "failed" }> = {
  type: "failed",
  error: {
    code: "cancelled",
    message: "Agent job cancelled.",
    retryable: false,
  },
};

// [SAFETY] Yields the runtime's events until the deadline fires. A runtime
// that hangs and ignores cancel() still cannot hold the job: the pending read
// is abandoned (not awaited) so the loop is free to fail the job.
async function* untilDeadline<T>(
  source: AsyncIterable<T>,
  deadline: Promise<typeof TIMED_OUT>,
): AsyncGenerator<T | typeof TIMED_OUT> {
  const iterator = source[Symbol.asyncIterator]();
  for (;;) {
    const next = await Promise.race([iterator.next(), deadline]);
    if (next === TIMED_OUT) {
      void iterator.return?.()?.catch(() => undefined);
      yield TIMED_OUT;
      return;
    }
    if (next.done) return;
    yield next.value;
  }
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
    // A fresh claimant per attempt fences an old stream even if this loop
    // later reclaims the same job.
    const me = `${options.workerId}:${crypto.randomUUID()}`;
    let job: Awaited<ReturnType<AgentJobWorkerRepository["claim"]>>;
    try {
      job = await options.repository.claim(me, leaseMs);
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
      await options.repository.finalize(
        job.id,
        ["claimed"],
        "failed",
        {
          type: "failed",
          error: {
            code: "configuration",
            message: "The agent profile is outside its allowed bounds.",
            retryable: false,
          },
        },
        me,
      );
      continue;
    }
    const runtime = options.runtimes[job.profile.runtime];
    if (!runtime) {
      await options.repository.finalize(
        job.id,
        ["claimed"],
        "failed",
        {
          type: "failed",
          error: {
            code: "configuration",
            message: "The agent runtime is not configured.",
            retryable: false,
          },
        },
        me,
      );
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
              .renewLease(job.id, me, leaseMs)
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
    let ended = false;
    // [SAFETY] The profile's own time limit bounds the whole run, enforced here
    // once for every runtime; the heartbeat above keeps the lease meanwhile.
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
      timeoutTimer = setTimeout(() => {
        stopRuntime();
        resolve(TIMED_OUT);
      }, job.profile.timeoutMs);
    });
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
      for await (const event of untilDeadline(events, deadline)) {
        // [GUARD] A lost lease means another worker owns the job now.
        if (leaseLost) break;
        if (event === TIMED_OUT) {
          // A fixed message: nothing the agent produced is recorded.
          const failed = await options.repository.finalize(
            job.id,
            ["running"],
            "failed",
            {
              type: "failed",
              error: {
                code: "timeout",
                message: "The agent job exceeded its time limit.",
                retryable: true,
              },
            },
            me,
          );
          if (!failed)
            await options.repository.finalize(
              job.id,
              ["cancelling"],
              "cancelled",
              CANCELLED_EVENT,
              me,
            );
          ended = true;
          break;
        }
        const current = await options.repository.get(job.tenantId, job.id);
        if (current?.status === "cancelling") {
          await runtime.cancel(job.id);
          await options.repository.finalize(
            job.id,
            ["cancelling"],
            "cancelled",
            CANCELLED_EVENT,
            me,
          );
          ended = true;
          break;
        }
        if (event.type === "started") {
          await options.repository.appendEvent(job.id, event, me);
          await options.repository.setSessionId(job.id, event.sessionId, me);
        } else if (event.type === "awaiting-input") {
          await options.repository.finalize(
            job.id,
            ["running"],
            "awaiting-input",
            event,
            me,
          );
          ended = true;
          break;
        } else if (event.type === "completed") {
          const resultReference = options.storeResult
            ? await options.storeResult(job.tenantId, event.result)
            : undefined;
          // The event, status and result pointer commit together. A cancel
          // winning the row lock cannot leave a completed event behind.
          const finished = await options.repository.finalize(
            job.id,
            ["running"],
            "succeeded",
            event,
            me,
            resultReference,
          );
          if (!finished && !leaseLost) {
            await options.repository.finalize(
              job.id,
              ["cancelling"],
              "cancelled",
              CANCELLED_EVENT,
              me,
            );
          }
          ended = true;
          break;
        } else if (event.type === "failed") {
          const finished = await options.repository.finalize(
            job.id,
            ["running"],
            event.error.code === "cancelled" ? "cancelled" : "failed",
            event,
            me,
          );
          if (!finished)
            await options.repository.finalize(
              job.id,
              ["cancelling"],
              "cancelled",
              CANCELLED_EVENT,
              me,
            );
          ended = true;
          break;
        } else {
          await options.repository.appendEvent(job.id, event, me);
        }
      }
      // A cancel noticed by the heartbeat ends here, under this worker's lease.
      if (stopping && !leaseLost && !ended) {
        await options.repository.finalize(
          job.id,
          ["cancelling"],
          "cancelled",
          CANCELLED_EVENT,
          me,
        );
        ended = true;
      }
      if (!ended && !leaseLost) {
        const failed = await options.repository.finalize(
          job.id,
          ["running"],
          "failed",
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
        if (!failed)
          await options.repository.finalize(
            job.id,
            ["cancelling"],
            "cancelled",
            CANCELLED_EVENT,
            me,
          );
      }
    } catch {
      if (leaseLost) continue;
      // [SAFETY] An error here must never leave the agent running: stop it
      // first. A fenced write that throws means the job is no longer in the
      // state this worker expected; recording the outcome must never reject
      // the loop.
      stopRuntime();
      try {
        const failed = await options.repository.finalize(
          job.id,
          ["claimed", "starting", "running"],
          "failed",
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
        // A cancel that landed while the failing write was in flight: the job
        // is still this worker's, so it ends cancelled now instead of waiting
        // for its lease to run out.
        if (!failed)
          await options.repository.finalize(
            job.id,
            ["cancelling"],
            "cancelled",
            CANCELLED_EVENT,
            me,
          );
      } catch {
        // Nothing left to record: the job belongs to another worker now.
      }
    } finally {
      clearTimeout(timeoutTimer);
      clearInterval(heartbeat);
      await rm(workspace, { recursive: true, force: true });
    }
  }
}
