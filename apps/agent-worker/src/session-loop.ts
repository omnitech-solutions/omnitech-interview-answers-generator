// The Active Session loop (ADR-0011), bounded separately from the agent-job
// loop: its own try/catch, its own backoff, and its own exit. One tick claims,
// renews and processes sessions; the processor bounds failed lease renewals
// per session. The loop logs only a content-free error name, never a message,
// and closes the processor (releasing its leases) when it stops.
import { randomUUID } from "node:crypto";
import type { SessionProcessor } from "@omnitech/product-interview/session-worker";

export type SessionLoopOptions = {
  processor: Pick<SessionProcessor, "tick" | "close">;
  signal: AbortSignal;
  // Wait when a tick found nothing to do (default 250).
  pollIntervalMs?: number;
  // Backoff after a failed tick: doubles from the first value up to the cap.
  backoffMs?: number;
  maxBackoffMs?: number;
  log?: (line: string) => void;
  // Injectable for tests; resolves early when the signal aborts.
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export const sessionWorkerId = (
  env: Readonly<Record<string, string | undefined>>,
): string => `${env["AGENT_WORKER_ID"] ?? "worker"}:${randomUUID()}:session`;

const NAME = /^[A-Za-z0-9_.-]{1,64}$/;
// Only the error's name, and only when it is name-shaped; never its message.
export const errorName = (error: unknown): string =>
  error instanceof Error && NAME.test(error.name) ? error.name : "Error";

export const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });

export async function runSessionLoop(
  options: SessionLoopOptions,
): Promise<void> {
  const {
    processor,
    signal,
    pollIntervalMs = 250,
    backoffMs = 500,
    maxBackoffMs = 30_000,
    log = () => undefined,
    sleep = abortableSleep,
  } = options;
  let failures = 0;
  try {
    while (!signal.aborted) {
      try {
        const worked = await processor.tick(signal);
        failures = 0;
        if (!worked) await sleep(pollIntervalMs, signal);
      } catch (error) {
        failures += 1;
        log(
          `session loop error: ${errorName(error)} (consecutive ${failures})`,
        );
        await sleep(
          Math.min(maxBackoffMs, backoffMs * 2 ** (failures - 1)),
          signal,
        );
      }
    }
  } finally {
    // Stops claiming, aborts in-flight model calls and releases held leases.
    try {
      await processor.close();
    } catch (error) {
      log(`session loop close error: ${errorName(error)}`);
    }
  }
}
