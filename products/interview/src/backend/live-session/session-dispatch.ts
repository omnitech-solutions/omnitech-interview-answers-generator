// The fenced dispatch skeleton every action kind shares: record the action,
// re-check the session row, make gateway calls, and publish through the fenced
// write. `beginDispatch` is the shared front (record, standing, profile) and
// the `Dispatch` it returns carries the rest (the gateway call and the
// publish), so the prose draft (dispatchTask, below) and the coding path
// (coding-path.ts) run the SAME skeleton. Prompt assembly, context selection and
// output validation live in service.ts and coding-stage.ts.
//
// Every decision rests on the session row and on validated structured fields
// (rule:structured-field-decisions): the processing policy comes from the row
// alone (rule:session-processing-policy), never from ingest or model content.
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
import type { Clock, ProcessingPolicy, Task } from "./core/index.js";
import type { AgentEscalationPort } from "./escalation.js";
import type { PublishEffect } from "./fenced-writes.js";
import { sessionGatewayContext } from "./gateway-context.js";
import type { InterviewSessionPolicy } from "./interview-policy.js";
import type { SessionStorePort } from "./processor-ports.js";
import { planAssist } from "./service.js";
import {
  keyOf,
  noteCodingTask,
  type SessionCodeRunner,
  type SessionRun,
} from "./session-run.js";
import type { LocalityDecision } from "./trace.js";
import {
  encodeWithheldReason,
  INVALID_OUTPUT_REASON,
  summarizeWithheld,
  type WithheldSummary,
} from "./withheld.js";

export type DispatchDeps = {
  store: SessionStorePort;
  gateway: AiExecutionGateway;
  policy: InterviewSessionPolicy;
  clock: Clock;
  // The host's test runner, when it configured one; its absence is an outcome
  // of the coding path (tests passed stays false), never an error.
  codeRunner?: SessionCodeRunner;
  // The host declares the runner executes on the person's own device. Without
  // it a device-only session never uses the runner.
  runnerDeviceLocal?: boolean;
  // Where an escalation job's typed profile and prompt reference come from; no
  // port, no job.
  agentEscalation?: AgentEscalationPort;
};

// Refusals that mean this holder is no longer the holder: it stops and writes
// nothing more (rule:fenced-current-publish).
const HOLDER_LOST = new Set(["fence_superseded", "lease_expired"]);

const isPolicyRefusal = (error: unknown): boolean =>
  error instanceof AiPolicyRefusedError ||
  (typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "policy-refused");

// What the skeleton needs of a stage: its action kind and its profiles.
export type DispatchStage = {
  readonly actionKind: string;
  readonly profileId: string;
  readonly deviceProfileId?: string;
};

export type DispatchPrompt = {
  system: string;
  prompt: string;
  schema: Readonly<Record<string, unknown>>;
  byteCount: number;
};

export type DispatchDetail = Record<string, string | number | boolean>;

// One recorded, standing-checked dispatch. Every method that ends the dispatch
// traces its own outcome; a caller returns when one reports it is over.
export type Dispatch = {
  readonly run: SessionRun;
  readonly task: Task;
  readonly key: string;
  readonly actionId: string;
  readonly attempt: number;
  readonly profileId: string;
  readonly processingPolicy: ProcessingPolicy;
  readonly deviceOnly: boolean;
  // Any mode but "running" means this dispatch began under a standing that is
  // gone: its result is never published (rule:pause-end-suppression).
  stopped(): boolean;
  // Records a finished-for-good dispatch without publishing: the action is
  // settled as suppressed with a code, and the key is never dispatched again.
  refuse(
    reason: string,
    traceOutcome: string,
    detail?: DispatchDetail,
    withheld?: WithheldSummary,
  ): Promise<void>;
  // A retryable failure: recorded failed, counted toward the retry bound.
  failRetryably(outcome: string): Promise<void>;
  trace(event: string, outcome: string, detail?: DispatchDetail): void;
  // Counts bytes that would have left the process (a refused oversize prompt).
  noteBytesIn(count: number): void;
  // One gateway call of a stage (a repair is a second, tagged call). Its errors
  // are classified by code only; the message is never read. When it returns
  // not-ok the dispatch is over and has traced its own outcome.
  call(
    prompt: DispatchPrompt,
    tag?: string,
  ): Promise<{ ok: true; result: unknown } | { ok: false }>;
  // Publishes through the fenced write against the processor's CURRENT task
  // state: a newer revision, a superseded source, a newer fence, or a session
  // that is no longer active suppresses the result. True when published.
  publish(
    result: Record<string, unknown>,
    options?: {
      show?: boolean;
      effect?: PublishEffect;
      detail?: DispatchDetail;
    },
  ): Promise<boolean>;
};

export async function beginDispatch(
  run: SessionRun,
  task: Task,
  deps: DispatchDeps,
  stage: DispatchStage,
): Promise<Dispatch | null> {
  const { store, gateway, clock } = deps;
  const sessionId = run.claim.sessionId;
  const revision = task.revision;
  const startedAt = clock.nowMs();
  const key = keyOf(run, task.taskId, revision, stage.actionKind);
  let locality: LocalityDecision = "none";
  let profileId: string | undefined;
  let bytesIn = 0;
  let bytesOut = 0;

  const finish = (event: string, outcome: string, detail?: DispatchDetail) =>
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
  const stopped = () => run.mode !== "running";

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
    return null;
  }
  if (recorded.outcome === "duplicate") {
    run.settled.add(key);
    finish("dispatch.duplicate", "duplicate", { existing: recorded.existing });
    return null;
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
    return null;
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

  // A retryable failure: recorded failed, so a retry is deduplicated only
  // against succeeded or in-flight work, and counted toward the retry bound.
  const failRetryably = async (outcome: string) => {
    run.failures.set(key, (run.failures.get(key) ?? 0) + 1);
    const settled = await store.recordFailure({
      scope: run.scope,
      sessionId,
      holder: run.holder,
      actionId,
    });
    if (settled.outcome === "refused" && lost(settled.reason)) return;
    finish("dispatch.failed", outcome, { attempt });
  };

  // 2. Re-check the session row immediately before dispatch, under the fenced
  // write check. The policy used below is THIS read, never an earlier one.
  const standing = await store.readDispatchStanding({
    scope: run.scope,
    sessionId,
    holder: run.holder,
  });
  if (standing.outcome === "refused") {
    lost(standing.reason);
    return null;
  }
  locality = standing.processingPolicy;
  if (standing.status !== "active") {
    if (!stopped()) await settle(`session_${standing.status}`);
    finish("dispatch.suppressed", `session_${standing.status}`);
    return null;
  }
  if (!standing.liveAssistance) {
    run.settled.add(key);
    if (!stopped()) await settle("assistance_disabled");
    finish("dispatch.suppressed", "assistance_disabled");
    return null;
  }

  // 3. The stage's profile for this session's policy. A device-only session
  // uses the device profile alone; a stage without one is refused
  // (rule:unlisted-stage-refused), and there is never a fallback.
  const deviceOnly = standing.processingPolicy === "device-only";
  profileId = deviceOnly ? stage.deviceProfileId : stage.profileId;
  if (profileId === undefined) {
    run.settled.add(key);
    if (!stopped()) await settle("stage_unlisted");
    finish("dispatch.refused", "stage-unlisted");
    return null;
  }
  const chosenProfile = profileId;

  return {
    run,
    task,
    key,
    actionId,
    attempt,
    profileId: chosenProfile,
    processingPolicy: standing.processingPolicy,
    deviceOnly,
    stopped,
    trace: finish,
    noteBytesIn(count) {
      bytesIn += count;
    },
    failRetryably,
    async refuse(reason, traceOutcome, detail, withheld) {
      run.settled.add(key);
      // A withheld draft carries its content-free summary on the reason.
      if (!stopped())
        await settle(
          withheld && reason === INVALID_OUTPUT_REASON
            ? encodeWithheldReason(withheld)
            : reason,
        );
      finish("dispatch.suppressed", traceOutcome, detail);
    },
    async call(prompt, tag = "") {
      bytesIn += prompt.byteCount;
      const request: AiExecutionRequest = {
        context: sessionGatewayContext(run.scope),
        profileId: chosenProfile,
        task: {
          type: "structured-generation",
          system: prompt.system,
          prompt: prompt.prompt,
          schema: prompt.schema,
        },
        processingPolicy: standing.processingPolicy,
        idempotencyKey: `${sessionId}:${task.taskId}:${revision}:${stage.actionKind}:${attempt}${tag}`,
        signal: run.abort.signal,
      };
      try {
        const execution = await gateway.execute(request);
        const result: unknown = execution.result;
        bytesOut += Buffer.byteLength(
          typeof result === "string" ? result : (JSON.stringify(result) ?? ""),
        );
        if (stopped()) return { ok: false };
        return { ok: true, result };
      } catch (error) {
        if (stopped()) return { ok: false };
        if (isPolicyRefusal(error)) {
          // Non-retryable: change the policy or the profile, never try again.
          run.settled.add(key);
          await settle("policy_refused");
          finish("dispatch.refused", "policy-refused");
          return { ok: false };
        }
        // Unavailable (or cancelled): retried against the same profile, with
        // no fallback to another.
        await failRetryably(
          run.abort.signal.aborted ? "cancelled" : "unavailable",
        );
        return { ok: false };
      }
    },
    async publish(result, options = {}) {
      let published: Awaited<ReturnType<SessionStorePort["publishResult"]>>;
      try {
        published = await store.publishResult({
          scope: run.scope,
          sessionId,
          holder: run.holder,
          actionId,
          tasks: run.tasks,
          result,
          show: options.show ?? true,
          ...(options.effect ? { effect: options.effect } : {}),
        });
      } catch (error) {
        // An effect that threw rolled the whole publish back and left the
        // action in flight; it is failed here so the bounded retry may record
        // it again. Without an effect, a throw is a database error and
        // propagates as it always did.
        if (!options.effect) throw error;
        await failRetryably("publish_failed");
        return false;
      }
      if (published.outcome === "published") {
        run.settled.add(key);
        finish("dispatch.published", "published", options.detail);
        return true;
      }
      if (lost(published.reason)) return false;
      if (
        published.reason === "revision_stale" ||
        published.reason === "source_superseded"
      )
        run.settled.add(key);
      finish("dispatch.suppressed", published.reason);
      return false;
    },
  };
}

// One task revision's prose assistance: the ONE structured gateway call,
// validated against the closed output and published through the fenced write.
// A coding category is only RECORDED here (result.category, result.codingBrief)
// and remembered on the run; the solution is a separate action kind that never
// delays this draft.
export async function dispatchTask(
  run: SessionRun,
  task: Task,
  deps: DispatchDeps,
): Promise<void> {
  const { store, policy } = deps;
  const stage = policy.assist;
  const d = await beginDispatch(run, task, deps, stage);
  if (d === null) return;

  // The pinned context is read once per run through the store port; a failed
  // read is a retryable outcome (the stage never answers from a stale or
  // unverified context), an oversize prompt is a settled refusal.
  const plan = await planAssist(run, task, {
    store,
    stage,
    deviceOnly: d.deviceOnly,
  });
  if (d.stopped()) return;
  if (plan.outcome === "context_unavailable") {
    await d.failRetryably("context_unavailable");
    return;
  }
  if (plan.outcome === "prompt_too_large") {
    d.noteBytesIn(plan.byteCount);
    await d.refuse("prompt_too_large", "prompt_too_large");
    return;
  }

  // The one gateway call.
  const called = await d.call(plan.prompt);
  if (!called.ok) return;

  // Validate against the closed schema. A violation records a suppression by
  // ids and publishes nothing; the violation paths go to the trace, no values.
  const checked = plan.validate(called.result);
  if (!checked.ok) {
    await d.refuse(
      "invalid_output",
      "invalid-output",
      {
        violationCount: checked.violations.length,
        firstViolation: checked.violations[0] ?? "$",
      },
      summarizeWithheld(checked.violations),
    );
    return;
  }

  const published = await d.publish(
    plan.resultFor(checked.draft, {
      profileId: d.profileId,
      processingPolicy: d.processingPolicy,
    }),
    { detail: plan.detailFor(checked.draft) },
  );
  if (published) noteCodingTask(run, task, checked.draft);
}
