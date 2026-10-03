// One task revision's assistance: record the action, re-check the session row,
// make the ONE structured gateway call, validate the closed output and publish
// through the fenced write. Every decision rests on the session row and on
// validated structured fields (rule:structured-field-decisions): the processing
// policy comes from the row alone (rule:session-processing-policy), never from
// ingest or model content, and nothing here creates an agent job - the coding
// and repository-navigation path is loop 2.
//
// Locality: the gateway refuses a non-device profile for a device-only request
// at resolution and again inside the call (rule:device-only-enforced-twice).
// This module adds the processor's own re-check: the policy used is re-read
// under the fenced-write check immediately before the call, a stage with no
// device implementation is refused in device-only (rule:unlisted-stage-refused)
// and there is NEVER a fallback to another profile: a refusal is final, an
// unavailable device is a retryable outcome that tries the same profile again.
import {
  type AiExecutionGateway,
  type AiExecutionRequest,
  AiPolicyRefusedError,
} from "@omnitech/ai-contracts";
import type { Clock, Task } from "./core/index.js";
import { sessionGatewayContext } from "./gateway-context.js";
import type { InterviewSessionPolicy } from "./interview-policy.js";
import type { SessionStorePort } from "./processor-ports.js";
import { capturedFor, keyOf, type SessionRun } from "./session-run.js";
import type { LocalityDecision } from "./trace.js";

export type DispatchDeps = {
  store: SessionStorePort;
  gateway: AiExecutionGateway;
  policy: InterviewSessionPolicy;
  clock: Clock;
};

// Refusals that mean this holder is no longer the holder: it stops and writes
// nothing more (rule:fenced-current-publish).
const HOLDER_LOST = new Set(["fence_superseded", "lease_expired"]);

const isPolicyRefusal = (error: unknown): boolean =>
  error instanceof AiPolicyRefusedError ||
  (typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "policy-refused");

export async function dispatchTask(
  run: SessionRun,
  task: Task,
  deps: DispatchDeps,
): Promise<void> {
  const { store, gateway, policy, clock } = deps;
  const stage = policy.assist;
  const sessionId = run.claim.sessionId;
  const revision = task.revision;
  const startedAt = clock.nowMs();
  const key = keyOf(run, task.taskId, revision, stage.actionKind);
  let locality: LocalityDecision = "none";
  let profileId: string | undefined;
  let bytesIn = 0;
  let bytesOut = 0;

  const finish = (
    event: string,
    outcome: string,
    detail?: Record<string, string | number | boolean>,
  ) =>
    run.trace({
      event,
      outcome,
      taskId: task.taskId,
      revision,
      ...(profileId === undefined ? {} : { profileId }),
      localityDecision: locality,
      durationMs: clock.nowMs() - startedAt,
      byteCounts: { input: bytesIn, output: bytesOut },
      ...(detail ? { detail } : {}),
    });
  // A write that comes back refused because this holder was succeeded stops
  // the run; nothing else is written from it.
  const lost = (reason: string): boolean => {
    if (!HOLDER_LOST.has(reason) && reason !== "session_not_found")
      return false;
    run.mode = "superseded";
    run.abort.abort();
    finish("dispatch.stopped", reason);
    return true;
  };
  const stopped = () => run.mode === "superseded";

  // 1. Record the action (the core decides: status, revision, dedup by
  // session, task, revision and action kind). Nothing is called yet.
  const recorded = await store.recordAction({
    scope: run.scope,
    sessionId,
    holder: run.holder,
    tasks: run.tasks,
    taskId: task.taskId,
    revision,
    actionKind: stage.actionKind,
  });
  if (recorded.outcome === "refused") {
    if (!lost(recorded.reason)) {
      run.settled.add(key);
      finish("dispatch.refused", recorded.reason);
    }
    return;
  }
  if (recorded.outcome === "duplicate") {
    run.settled.add(key);
    finish("dispatch.duplicate", "duplicate", { existing: recorded.existing });
    return;
  }
  if (recorded.outcome === "suppressed") {
    // A stale revision or source will not become current again; a paused or
    // ended session is handled by the session's own standing.
    if (
      recorded.reason === "revision_stale" ||
      recorded.reason === "source_superseded"
    )
      run.settled.add(key);
    finish("dispatch.suppressed", recorded.reason);
    return;
  }
  const actionId = recorded.actionId;
  const attempt = recorded.attempt;
  const settle = (reason: string) =>
    store.abandonAction({
      scope: run.scope,
      sessionId,
      holder: run.holder,
      actionId,
      reason,
    });

  // 2. Re-check the session row immediately before dispatch, under the fenced
  // write check. The policy used below is THIS read, never an earlier one.
  const standing = await store.readDispatchStanding({
    scope: run.scope,
    sessionId,
    holder: run.holder,
  });
  if (standing.outcome === "refused") {
    lost(standing.reason);
    return;
  }
  locality = standing.processingPolicy;
  if (standing.status !== "active") {
    if (!stopped()) await settle(`session_${standing.status}`);
    finish("dispatch.suppressed", `session_${standing.status}`);
    return;
  }
  if (!standing.liveAssistance) {
    run.settled.add(key);
    if (!stopped()) await settle("assistance_disabled");
    finish("dispatch.suppressed", "assistance_disabled");
    return;
  }

  // 3. The stage's profile for this session's policy. A device-only session
  // uses the device profile alone; a stage without one is refused.
  const deviceOnly = standing.processingPolicy === "device-only";
  profileId = deviceOnly ? stage.deviceProfileId : stage.profileId;
  if (profileId === undefined) {
    run.settled.add(key);
    if (!stopped()) await settle("stage_unlisted");
    finish("dispatch.refused", "stage-unlisted");
    return;
  }
  const prepared = stage.prepare({
    taskId: task.taskId,
    revision,
    captured: capturedFor(run, task),
  });
  bytesIn = prepared.byteCount;
  const request: AiExecutionRequest = {
    context: sessionGatewayContext(run.scope),
    profileId,
    task: {
      type: "structured-generation",
      system: prepared.system,
      prompt: prepared.prompt,
      schema: prepared.schema,
    },
    processingPolicy: standing.processingPolicy,
    idempotencyKey: `${sessionId}:${task.taskId}:${revision}:${stage.actionKind}:${attempt}`,
    signal: run.abort.signal,
  };

  // 4. The one gateway call. Its errors are classified by code only; the
  // message is never read or kept, so content cannot ride out in a trace.
  let result: unknown;
  try {
    const execution = await gateway.execute(request);
    result = execution.result;
    bytesOut = Buffer.byteLength(
      typeof result === "string" ? result : (JSON.stringify(result) ?? ""),
    );
  } catch (error) {
    if (stopped()) return;
    if (isPolicyRefusal(error)) {
      // Non-retryable: change the policy or the profile, never try again.
      run.settled.add(key);
      await settle("policy_refused");
      finish("dispatch.refused", "policy-refused");
      return;
    }
    // Unavailable (or cancelled): recorded failed, so a retry is deduplicated
    // only against succeeded or in-flight work. Same profile, no fallback.
    run.failures.set(key, (run.failures.get(key) ?? 0) + 1);
    const settled = await store.recordFailure({
      scope: run.scope,
      sessionId,
      holder: run.holder,
      actionId,
    });
    if (settled.outcome === "refused" && lost(settled.reason)) return;
    finish(
      "dispatch.failed",
      run.abort.signal.aborted ? "cancelled" : "unavailable",
      { attempt },
    );
    return;
  }
  if (stopped()) return;

  // 5. Validate against the closed schema. A violation records a suppression by
  // ids and publishes nothing; the violation paths go to the trace, no values.
  const checked = stage.validate(result);
  if (!checked.ok) {
    run.settled.add(key);
    await settle("invalid_output");
    finish("dispatch.suppressed", "invalid-output", {
      violationCount: checked.violations.length,
      firstViolation: checked.violations[0] ?? "$",
    });
    return;
  }

  // 6. Publish through the fenced write against the processor's CURRENT task
  // state: a newer revision, a superseded source, a newer fence, or a session
  // that is no longer active suppresses the result and nothing is published.
  const published = await store.publishResult({
    scope: run.scope,
    sessionId,
    holder: run.holder,
    actionId,
    tasks: run.tasks,
    result: {
      version: 1,
      stage: stage.actionKind,
      draft: checked.draft.draft,
      sections: checked.draft.sections,
      meta: { profileId, processingPolicy: standing.processingPolicy },
    },
    show: true,
  });
  if (published.outcome === "published") {
    run.settled.add(key);
    finish("dispatch.published", "published");
    return;
  }
  if (lost(published.reason)) return;
  if (
    published.reason === "revision_stale" ||
    published.reason === "source_superseded"
  )
    run.settled.add(key);
  finish("dispatch.suppressed", published.reason);
}
