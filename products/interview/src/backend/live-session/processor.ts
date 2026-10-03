// The Active Session processor: ADR-0011's loop beside the agent-job loop. One
// `tick` claims sessions that need processing (acquiring a lease raises the
// session's fence), renews the leases it holds, and for each held session
// reconciles its standing, replays new observations through the neutral core,
// and starts assistance for the task revisions that need it. It also sweeps
// duration-capped and purge-due sessions.
//
// Everything per session is isolated: an error in one session is traced by its
// ids and a code and never stops the others or the loop. The processor builds
// no gateway and branches on no provider or model name; it holds no database
// handle of its own - every read and write goes through the injected ports,
// each of which opens an actor-scoped transaction for the session owner.

import { dispatchCoding } from "./coding-path.js";
import { revisionStanding } from "./core/index.js";
import { SessionError } from "./errors.js";
import type {
  SessionProcessorOptions,
  SessionProcessorPorts,
} from "./processor-ports.js";
import type { SessionTarget } from "./session-claim.js";
import { type DispatchDeps, dispatchTask } from "./session-dispatch.js";
import {
  createRun,
  nextPending,
  nextPendingCoding,
  processUtterances,
  type RunSnapshot,
  type RunTracer,
  replayObservations,
  type SessionRun,
  seedFromActions,
} from "./session-run.js";
import { type SessionTraceEvent } from "./trace.js";

export interface SessionProcessor {
  // One pass. Resolves true when it did work (the loop should not sleep),
  // false when it was idle. Never rejects for a per-session failure.
  tick(signal: AbortSignal): Promise<boolean>;
  // Resolves once every dispatch and sweep started so far has finished.
  idle(): Promise<void>;
  // Ids, revisions and counts of a held session, for tests and operators.
  snapshot(sessionId: string): RunSnapshot | undefined;
  // Stops claiming, aborts in-flight model calls, waits for them and releases
  // the leases it still holds.
  close(): Promise<void>;
}

const DEFAULTS = {
  maxSessions: 8,
  settleMs: 1_500,
  maxAttempts: 3,
  sweepEveryMs: 30_000,
  sweepBatch: 10,
  maxRenewFailures: 3,
  observationPage: 200,
} as const;

// A content-free code for any error: a SessionError carries its own fixed
// code; everything else is "unexpected_error". The message is never read.
export function errorCode(error: unknown): string {
  return error instanceof SessionError ? error.code : "unexpected_error";
}

export function createSessionProcessor(
  ports: SessionProcessorPorts,
  options: SessionProcessorOptions,
): SessionProcessor {
  const { claim, store, gateway, policy, clock, trace } = ports;
  const deps: DispatchDeps = {
    store,
    gateway,
    policy,
    clock,
    ...(ports.codeRunner ? { codeRunner: ports.codeRunner } : {}),
    ...(ports.runnerDeviceLocal === undefined
      ? {}
      : { runnerDeviceLocal: ports.runnerDeviceLocal }),
  };
  const settings = { ...DEFAULTS, ...options };
  const runs = new Map<string, SessionRun>();
  let firstClaim = true;
  let closed = false;
  let sweep: Promise<void> | null = null;
  let lastSweepMs = Number.NEGATIVE_INFINITY;

  const emit = (event: SessionTraceEvent) => {
    // A failing sink must never break the loop.
    try {
      trace.emit(event);
    } catch {
      // Dropped: tracing is best effort.
    }
  };
  const tracerFor =
    (claimed: {
      tenantId: string;
      sessionId: string;
      fence: number;
    }): RunTracer =>
    (partial) =>
      emit({
        sessionId: claimed.sessionId,
        tenantId: claimed.tenantId,
        fence: claimed.fence,
        localityDecision: "none",
        durationMs: 0,
        byteCounts: { input: 0, output: 0 },
        ...partial,
      });
  const targetTrace = (target: SessionTarget, event: string, outcome: string) =>
    emit({
      event,
      sessionId: target.sessionId,
      tenantId: target.tenantId,
      fence: 0,
      localityDecision: "none",
      durationMs: 0,
      byteCounts: { input: 0, output: 0 },
      outcome,
    });

  // Drops a run. A holder that was succeeded writes nothing; any other run
  // releases its lease (best effort; the lease expires on its own anyway).
  async function drop(run: SessionRun, release: boolean): Promise<void> {
    if (runs.get(run.claim.sessionId) === run) runs.delete(run.claim.sessionId);
    if (!release || run.mode === "superseded") return;
    try {
      await claim.release(run.claim);
    } catch {
      // The lease expires by itself.
    }
  }

  // Pause, end and purge: refuse new dispatch, cancel the session's in-flight
  // jobs once, and let in-flight model work finish - it cannot publish, because
  // the fenced write refuses a result for a session that is not active
  // (rule:pause-end-suppression, rule:fenced-current-publish).
  async function quiesce(run: SessionRun, status: string): Promise<void> {
    if (run.mode === "running") {
      run.mode = "quiescing";
      run.abort.abort();
      run.trace({ event: "session.quiesced", outcome: `session_${status}` });
      try {
        await store.cancelJobs(run.scope, run.claim.sessionId);
      } catch (error) {
        run.trace({ event: "session.cancel_jobs", outcome: errorCode(error) });
      }
    }
    if (run.inflight === null) await drop(run, true);
  }

  async function processRun(run: SessionRun): Promise<boolean> {
    if (run.mode === "superseded") {
      await drop(run, false);
      return false;
    }
    const sessionId = run.claim.sessionId;
    // Renew the lease each tick while healthy. A holder that finds a newer
    // fence stops this session at once and writes nothing.
    if (!run.justClaimed) {
      let renewal: Awaited<ReturnType<typeof claim.renew>>;
      try {
        renewal = await claim.renew(run.claim);
      } catch (error) {
        // A renewal that keeps failing means the lease may have lapsed: after
        // the bound the session is no longer treated as held (it stops and
        // writes nothing; the lease expires on its own).
        run.renewFailures += 1;
        if (run.renewFailures < settings.maxRenewFailures) throw error;
        run.mode = "superseded";
        run.abort.abort();
        run.trace({
          event: "session.stopped",
          outcome: "renewal_failed",
        });
        await drop(run, false);
        return true;
      }
      run.renewFailures = 0;
      if (!renewal.renewed) {
        run.mode = "superseded";
        run.abort.abort();
        run.trace({ event: "session.stopped", outcome: renewal.reason });
        await drop(run, false);
        return true;
      }
    }
    run.justClaimed = false;

    const view = await store.reconcile(run.scope, sessionId);
    if (view.purged) {
      await drop(run, false);
      return true;
    }
    if (view.status !== "active") {
      await quiesce(run, view.status);
      return true;
    }
    if (run.mode === "quiescing") {
      // Resumed after a pause: the run was stopped for good (its in-flight
      // work can never publish). Once that work has ended, drop the run and
      // release the lease so the next claim builds a fresh run, re-seeds from
      // the stored actions and answers what the pause suppressed.
      if (run.inflight === null) await drop(run, true);
      return false;
    }
    if (run.mode !== "running") return false;

    if (!run.seeded) {
      await seedFromActions(
        run,
        store,
        await store.actions(run.scope, sessionId),
      );
      run.seeded = true;
    }
    const now = clock.nowMs();
    const replayed = await replayObservations(
      run,
      store,
      now,
      settings.observationPage,
    );
    const handled = await processUtterances(
      run,
      policy,
      now,
      settings.settleMs,
    );

    // At most one model call per session at a time; replay keeps going while
    // it runs, so a newer revision makes an in-flight result stale. The prose
    // draft is always first: a coding solution is owed only when no draft is
    // pending, so coding never delays an answer.
    let started = false;
    if (view.liveAssistance && run.inflight === null) {
      const prose = nextPending(
        run,
        policy.assist.actionKind,
        settings.maxAttempts,
      );
      const coding = prose
        ? null
        : nextPendingCoding(run, settings.maxAttempts);
      const next = prose
        ? { key: prose.key, start: () => dispatchTask(run, prose.task, deps) }
        : coding
          ? { key: coding.key, start: () => dispatchCoding(run, coding, deps) }
          : null;
      if (next) {
        started = true;
        const flight = next
          .start()
          .catch((error: unknown) => {
            run.trace({ event: "dispatch.error", outcome: errorCode(error) });
            // A thrown dispatch is retried by the bound, not forgotten.
            run.failures.set(next.key, (run.failures.get(next.key) ?? 0) + 1);
          })
          .finally(() => {
            if (run.inflight === flight) run.inflight = null;
          });
        run.inflight = flight;
      }
    }
    return replayed > 0 || handled > 0 || started;
  }

  async function claimNew(): Promise<boolean> {
    const capacity = settings.maxSessions - runs.size;
    if (capacity <= 0) return false;
    const claims = await claim.claim(capacity, { includeOwnLive: firstClaim });
    firstClaim = false;
    for (const claimed of claims) {
      const previous = runs.get(claimed.sessionId);
      if (previous) {
        // A newer fence for a session this process still holds: the old run
        // is the earlier self and must not write again.
        previous.mode = "superseded";
        previous.abort.abort();
      }
      const run = createRun(claimed, settings.workerId, tracerFor(claimed));
      runs.set(claimed.sessionId, run);
      run.trace({ event: "session.claimed", outcome: "claimed" });
    }
    return claims.length > 0;
  }

  async function runSweeps(): Promise<void> {
    // Sessions past the duration cap are ended; the standing derivation does
    // it (and cancels their jobs), whether or not anything is ingesting.
    try {
      for (const target of await claim.capExpired(settings.sweepBatch)) {
        try {
          await store.reconcile(
            { tenantId: target.tenantId, actorId: target.ownerUserId },
            target.sessionId,
          );
          targetTrace(target, "session.cap_reached", "ended");
        } catch (error) {
          targetTrace(target, "session.cap_reached", errorCode(error));
        }
      }
    } catch (error) {
      emit(sweepFailure("cap", error));
    }
    // Purge on end, owner delete and retention expiry; the purge is
    // idempotent, so two sweepers racing is safe.
    try {
      for (const target of await claim.purgeCandidates(settings.sweepBatch)) {
        try {
          const result = await store.purge(target);
          emit({
            event: "session.purge",
            sessionId: target.sessionId,
            tenantId: target.tenantId,
            fence: 0,
            localityDecision: "none",
            durationMs: 0,
            byteCounts: { input: 0, output: 0 },
            outcome: result.outcome,
            ...(result.outcome === "already-purged"
              ? {}
              : { detail: { ...result.counts } }),
          });
        } catch (error) {
          targetTrace(target, "session.purge", errorCode(error));
        }
      }
    } catch (error) {
      emit(sweepFailure("purge", error));
    }
  }
  const sweepFailure = (kind: string, error: unknown): SessionTraceEvent => ({
    event: `sweep.${kind}`,
    sessionId: "none",
    tenantId: "none",
    fence: 0,
    localityDecision: "none",
    durationMs: 0,
    byteCounts: { input: 0, output: 0 },
    outcome: errorCode(error),
  });

  async function idle(): Promise<void> {
    for (;;) {
      const pending = [
        ...[...runs.values()].map((run) => run.inflight),
        sweep,
      ].filter((promise): promise is Promise<void> => promise !== null);
      if (pending.length === 0) return;
      await Promise.allSettled(pending);
    }
  }

  return {
    async tick(signal) {
      if (closed || signal.aborted) return false;
      let worked = false;
      try {
        worked = await claimNew();
      } catch (error) {
        emit(sweepFailure("claim", error));
      }
      // Every held session is processed on its own: one failure is traced by
      // id and code and never reaches another session or the loop.
      const outcomes = await Promise.allSettled(
        [...runs.values()].map(async (run) => {
          try {
            return await processRun(run);
          } catch (error) {
            run.trace({
              event: "session.error",
              outcome: errorCode(error),
            });
            if (error instanceof SessionError && error.code === "not_found")
              await drop(run, false);
            return false;
          }
        }),
      );
      for (const outcome of outcomes)
        if (outcome.status === "fulfilled" && outcome.value) worked = true;

      const now = clock.nowMs();
      if (sweep === null && now - lastSweepMs >= settings.sweepEveryMs) {
        lastSweepMs = now;
        const running = runSweeps().finally(() => {
          if (sweep === running) sweep = null;
        });
        sweep = running;
        worked = true;
      }
      return worked;
    },

    idle,

    snapshot(sessionId) {
      const run = runs.get(sessionId);
      if (!run) return undefined;
      return {
        fence: run.holder.fence,
        mode: run.mode,
        cursor: run.cursor,
        tasks: Object.values(run.tasks.tasks).map((task) => ({
          taskId: task.taskId,
          revision: task.revision,
          standing: Object.fromEntries(
            task.revisions.map((entry) => [
              entry.revision,
              revisionStanding(run.tasks, task.taskId, entry.revision),
            ]),
          ),
        })),
        deferred: Object.values(run.tasks.deferred)
          .filter((entry) => entry.status === "deferred")
          .map((entry) => entry.topic),
      };
    },

    async close() {
      closed = true;
      for (const run of runs.values()) {
        run.abort.abort();
        if (run.mode === "running") run.mode = "quiescing";
      }
      await idle();
      for (const run of [...runs.values()]) await drop(run, true);
    },
  };
}
