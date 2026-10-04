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
import { CODING_ACTION_KIND } from "./coding-stage.js";
import { revisionStanding } from "./core/index.js";
import { SessionError } from "./errors.js";
import type {
  SessionProcessorOptions,
  SessionProcessorPorts,
} from "./processor-ports.js";
import type { SessionTarget } from "./session-claim.js";
import { type DispatchDeps, dispatchTask } from "./session-dispatch.js";
import {
  allSlots,
  cancelSupersededSlots,
  createRun,
  handledThrough,
  nextPending,
  nextPendingCoding,
  occupySlot,
  processInOrder,
  type RunSnapshot,
  type RunTracer,
  releaseSlot,
  replayObservations,
  type SessionRun,
  seedFromActions,
  slotFor,
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

const slotsIdle = (run: SessionRun): boolean =>
  allSlots(run).every((slot) => slot.inflight === null);

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
    ...(ports.agentEscalation
      ? { agentEscalation: ports.agentEscalation }
      : {}),
    ...(ports.visionProfileId
      ? { visionProfileId: ports.visionProfileId }
      : {}),
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
    if (slotsIdle(run)) await drop(run, true);
  }

  // Stores how far this holder has handled the transcript (a number), so a
  // rebuilt run closes the segments this one closed. Best effort: a failed
  // write is retried by the next tick and loses nothing but precision.
  async function persistHandled(run: SessionRun): Promise<void> {
    const through = handledThrough(run);
    if (through <= run.persistedThrough) return;
    try {
      const outcome = await store.recordProcessedThrough({
        scope: run.scope,
        sessionId: run.claim.sessionId,
        holder: run.holder,
        through,
      });
      if (outcome.outcome === "recorded") run.persistedThrough = through;
    } catch (error) {
      run.trace({
        event: "session.processed_marker",
        outcome: errorCode(error),
      });
    }
  }

  // Starts one dispatch in its slot. A thrown dispatch is retried by the
  // bound, not forgotten: it counts toward the bound and settles ONLY its own
  // slot's action as failed (best effort: if the store is still down the lease
  // handover fails it as an orphan), so it never settles the other slot's.
  function startSlot(
    run: SessionRun,
    sessionId: string,
    task: { taskId: string; revision: number },
    key: string,
    actionKind: string,
    start: () => Promise<void>,
  ): boolean {
    const slot = slotFor(run, actionKind);
    occupySlot(run, slot, task.taskId, task.revision);
    const flight = start()
      .catch(async (error: unknown) => {
        run.trace({ event: "dispatch.error", outcome: errorCode(error) });
        run.failures.set(key, (run.failures.get(key) ?? 0) + 1);
        const actionId = slot.actionId;
        slot.actionId = null;
        if (actionId !== null)
          await store
            .recordFailure({
              scope: run.scope,
              sessionId,
              holder: run.holder,
              actionId,
            })
            .catch(() => undefined);
      })
      .finally(() => {
        // The dispatch has settled (or failed above): no action stays open,
        // so a later failure cannot settle one that finished.
        slot.actionId = null;
        if (slot.inflight === flight) releaseSlot(slot);
      });
    slot.inflight = flight;
    return true;
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
      if (slotsIdle(run)) await drop(run, true);
      return false;
    }
    if (run.mode !== "running") return false;

    // [SAFETY] A tighten to device-only also ends remote work already in the
    // air: every slot whose dispatch began as permitted-remote is aborted (its
    // provider attempt is cancelled and its result can never publish); the next
    // dispatch of that task runs under the device policy.
    if (view.processingPolicy === "device-only")
      for (const slot of allSlots(run))
        if (slot.inflight !== null && slot.policy === "permitted-remote")
          slot.abort?.abort();

    // Device-only means no remote job may launch: the agent worker claims any
    // queued job without a policy check, so a job queued before a tighten
    // whose cancellation failed (or was never reached) is cancelled here, and
    // retried every tick until it succeeds. Idempotent: an ended job counts.
    if (view.processingPolicy === "device-only" && !run.jobsSwept) {
      try {
        await store.cancelJobs(run.scope, sessionId);
        run.jobsSwept = true;
      } catch (error) {
        run.trace({ event: "session.cancel_jobs", outcome: errorCode(error) });
      }
    }

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
    // Spoken utterances and owner inputs (Analyze latest capture, typed
    // follow-ups) are applied in observation order, so a rebuilt run numbers
    // revisions as the live run did and an input aimed at a spoken task finds it.
    const { utterances: handled, inputs } = await processInOrder(
      run,
      policy,
      now,
      settings.settleMs,
      store,
    );

    await persistHandled(run);

    // Two slots (ADR-0016): short assistance and coding each run at most one
    // dispatch at a time, independently, so a spoken correction is answered
    // while older coding still runs. Replay keeps going while they run, so a
    // newer revision aborts the slot whose revision it passed; fenced
    // publication still refuses a stale result.
    cancelSupersededSlots(run);
    let started = false;
    // A stop that is stored but not yet applied (an earlier utterance is still
    // settling) holds dispatch, so abandoned work is not started in the gap.
    const stopHeld = run.pendingInputs.some((entry) => entry.stop === true);
    if (view.liveAssistance && !stopHeld) {
      const prose =
        run.slots.assist.inflight === null
          ? nextPending(run, policy.assist.actionKind, settings.maxAttempts)
          : null;
      const coding =
        run.slots.coding.inflight === null
          ? nextPendingCoding(run, settings.maxAttempts)
          : null;
      if (prose)
        started =
          startSlot(
            run,
            sessionId,
            prose.task,
            prose.key,
            policy.assist.actionKind,
            () => dispatchTask(run, prose.task, deps),
          ) || started;
      if (coding)
        started =
          startSlot(
            run,
            sessionId,
            coding.task,
            coding.key,
            CODING_ACTION_KIND,
            () => dispatchCoding(run, coding, deps),
          ) || started;
    }
    return replayed > 0 || handled > 0 || inputs > 0 || started;
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
          try {
            await ports.afterPurge?.(target);
          } catch (error) {
            targetTrace(target, "session.purge_staged", errorCode(error));
          }
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
        ...[...runs.values()].flatMap((run) =>
          allSlots(run).map((slot) => slot.inflight),
        ),
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
        if (!settings.sweepOnly) worked = await claimNew();
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
