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
// under the fenced-write check immediately before EVERY call and before an
// agent job is requested (stillStanding), a stage with no
// device implementation is refused in device-only (rule:unlisted-stage-refused)
// and there is NEVER a fallback to another profile: a refusal is final, an
// unavailable device is a retryable outcome that tries the same profile again.
import {
  type AgentAttachment,
  type AiExecutionGateway,
  type AiExecutionRequest,
  type AiGeneratedBy,
  AiPolicyRefusedError,
} from "@omnitech/ai-contracts";
import { ASSIST_ACTION_KIND } from "./assist-stage";
import type { Clock, ProcessingPolicy, Task } from "./core/index";
import type { AgentEscalationPort } from "./escalation";
import type { PublishEffect } from "./fenced-writes";
import { sessionGatewayContext } from "./gateway-context";
import type { InterviewSessionPolicy } from "./interview-policy";
import type { SessionStorePort } from "./processor-ports";
import {
  outcomeCounts,
  planScreenshots,
  type ScreenshotPlan,
} from "./screenshot-send";
import { planAssist } from "./service";
import {
  attachmentsFor,
  hintsFor,
  keyOf,
  noteCodingTask,
  noteRecorded,
  type SessionCodeRunner,
  type SessionRun,
  slotFor,
} from "./session-run";
import type { LocalityDecision } from "./trace";
import {
  settleWithheld,
  summarizeWithheld,
  type WithheldSummary,
} from "./withheld";

// How often the draft so far is written for the browser while it streams.
const PROGRESS_INTERVAL_MS = 600;

// The "draft" field's text from a JSON object still being written: the model
// writes {"category":...,"draft":"- ...\n- ..." ...} and the draft is complete
// once its closing quote arrives. Escapes are undone; a cut escape is dropped.
export function partialDraft(json: string): string {
  const start = json.indexOf('"draft":');
  if (start < 0) return "";
  const open = json.indexOf('"', start + 8);
  if (open < 0) return "";
  let out = "";
  for (let i = open + 1; i < json.length; i += 1) {
    const ch = json[i] as string;
    if (ch === '"') break;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = json[i + 1];
    if (next === undefined) break;
    if (next === "n") out += "\n";
    else if (next === "t") out += "\t";
    else if (next === "u") {
      const hex = json.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 4;
    } else out += next;
    i += 1;
  }
  return out;
}

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
  // The ONE pinned agent profile (ADR-0016): present when the worker's agent
  // port is on and the host pinned a configured provider. It serves screenshot
  // dispatches and, for a session that may use remote processing, the assist
  // and coding stages too (tool-less, text-only for those). A device-only
  // session never uses it: it keeps the direct device profile, and there is no
  // fallback to another provider.
  visionProfileId?: string;
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

type DispatchPrompt = {
  system: string;
  prompt: string;
  schema: Readonly<Record<string, unknown>>;
  byteCount: number;
  // Frozen images that travel with the prompt, named by provenance id only.
  // The dispatch must have begun with the same images, so its profile is the
  // vision profile; the runtime and the loader do the rest.
  attachments?: readonly AgentAttachment[];
};

// What a dispatch needs beyond its stage: the images its answer rests on.
export type DispatchOptions = {
  attachments?: readonly AgentAttachment[];
};

// What the dispatch will really send of those screenshots (D35): decided from
// the owner's stored setting at the moment the standing was read.

type DispatchDetail = Record<string, string | number | boolean>;

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
  // D35: the images, texts and per-screenshot outcomes this dispatch sends,
  // from the owner's stored setting (a dispatch without screenshots: empty).
  readonly screenshots: ScreenshotPlan;
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
  // `cause` is a fixed typed code (never provider text) for the trace.
  failRetryably(outcome: string, cause?: string): Promise<void>;
  trace(event: string, outcome: string, detail?: DispatchDetail): void;
  // Counts bytes that would have left the process (a refused oversize prompt).
  noteBytesIn(count: number): void;
  // Re-reads the session's standing under the fenced-write check and says
  // whether the dispatch may go on. It is run before EVERY gateway call and
  // before an agent job is requested, so a pause, an end, a lost lease or a
  // tighten to device-only that came after the dispatch began is honoured.
  // False means the dispatch is over and has traced and settled itself.
  stillStanding(): Promise<boolean>;
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
  options: DispatchOptions = {},
): Promise<Dispatch | null> {
  const { store, gateway, clock } = deps;
  const imageAttachments = options.attachments ?? [];
  const sessionId = run.claim.sessionId;
  const revision = task.revision;
  const startedAt = clock.nowMs();
  const key = keyOf(run, task.taskId, revision, stage.actionKind);
  let locality: LocalityDecision = "none";
  let profileId: string | undefined;
  let bytesIn = 0;
  let bytesOut = 0;
  let generatedBy: AiGeneratedBy | undefined;

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
  // This dispatch's own slot and abort signal (a child of the run's), so a
  // newer revision of its task cancels it without touching the other slot.
  const slot = slotFor(run, stage.actionKind);
  const signal = (slot.abort ?? run.abort).signal;

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
  // An action row now remembers the segments this revision rests on.
  noteRecorded(run, task.taskId, revision);
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
  slot.actionId = actionId;
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
  const failRetryably = async (outcome: string, cause?: string) => {
    run.failures.set(key, (run.failures.get(key) ?? 0) + 1);
    const settled = await store.recordFailure({
      scope: run.scope,
      sessionId,
      holder: run.holder,
      actionId,
    });
    if (settled.outcome === "refused" && lost(settled.reason)) return;
    finish("dispatch.failed", outcome, {
      attempt,
      ...(cause === undefined ? {} : { cause }),
    });
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
  // The policy this slot's work runs under, so a later tighten to device-only
  // can abort exactly the attempts that began as permitted-remote.
  slot.policy = standing.processingPolicy;
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
  // [SAFETY] The setting is the one the server stored, read just now with the
  // standing; the page's claim is never consulted. A device-only session
  // refuses images below exactly as before, whatever the setting.
  const screenshots = planScreenshots(
    run,
    imageAttachments,
    standing.screenshotSend ?? "always",
    standing.processingPolicy,
  );
  if (imageAttachments.length > 0 && deviceOnly) {
    // [SAFETY] Screenshots fail closed (ADR-0016): a device-only session never
    // sends an image to an agent runtime, and the dispatch is refused - it is
    // never answered text-only and never falls back to another profile.
    run.settled.add(key);
    if (!stopped()) await settle("vision_device_only");
    finish("dispatch.refused", "vision-device-only");
    return null;
  }
  if (screenshots.images.length > 0) {
    // Images that really travel need the vision profile; with none the dispatch
    // is refused, never answered without them and never moved to another profile.
    if (deps.visionProfileId === undefined) {
      run.settled.add(key);
      if (!stopped()) await settle("vision_unavailable");
      finish("dispatch.refused", "vision-unavailable");
      return null;
    }
    profileId = deps.visionProfileId;
  } else
    profileId = deviceOnly
      ? stage.deviceProfileId
      : (deps.visionProfileId ?? stage.profileId);
  if (profileId === undefined) {
    run.settled.add(key);
    if (!stopped()) await settle("stage_unlisted");
    finish("dispatch.refused", "stage-unlisted");
    return null;
  }
  const chosenProfile = profileId;

  const stillStanding = async (): Promise<boolean> => {
    if (stopped()) return false;
    const current = await store.readDispatchStanding({
      scope: run.scope,
      sessionId,
      holder: run.holder,
    });
    if (current.outcome === "refused") {
      lost(current.reason);
      return false;
    }
    if (current.status !== "active") {
      await settle(`session_${current.status}`);
      finish("dispatch.suppressed", `session_${current.status}`);
      return false;
    }
    if (!current.liveAssistance) {
      run.settled.add(key);
      await settle("assistance_disabled");
      finish("dispatch.suppressed", "assistance_disabled");
      return false;
    }
    if (
      imageAttachments.length > 0 &&
      (current.screenshotSend ?? "always") !==
        (standing.screenshotSend ?? "always")
    ) {
      // [SAFETY] The owner changed what may be sent after this dispatch decided:
      // nothing goes out under the old setting. The key stays unsettled, so the
      // next tick dispatches it afresh under the setting now in force.
      await settle("setting_changed");
      finish("dispatch.suppressed", "setting_changed");
      return false;
    }
    if (current.processingPolicy !== standing.processingPolicy) {
      // [SAFETY] The session tightened after this dispatch chose its profile:
      // nothing more goes out under the old policy. The key stays unsettled,
      // so the next tick dispatches it afresh under the policy now in force
      // (its device profile, or a refusal when the stage has none).
      locality = current.processingPolicy;
      await settle("policy_changed");
      finish("dispatch.suppressed", "policy_changed");
      return false;
    }
    return true;
  };

  // Runs a structured request through the gateway's stream, recording the
  // draft's text so far on the action as it grows, and resolves like
  // execute() once the result arrives. A refusal or failure throws the same
  // way execute() does (the policy error is the gateway's own).
  async function streamed(
    request: AiExecutionRequest,
  ): Promise<{ result: unknown; generatedBy?: AiGeneratedBy }> {
    let text = "";
    let lastWrite = 0;
    let lastDraft = "";
    const write = async (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastWrite < PROGRESS_INTERVAL_MS) return;
      const draft = partialDraft(text);
      if (draft === lastDraft || draft === "") return;
      lastWrite = now;
      lastDraft = draft;
      await store
        .recordProgress({
          scope: run.scope,
          sessionId,
          holder: run.holder,
          actionId,
          progress: { draft },
        })
        .catch(() => undefined);
    };
    for await (const event of gateway.stream(request)) {
      if (stopped()) break;
      if (event.type === "text-delta") {
        text += event.text;
        await write(false);
      } else if (event.type === "completed") {
        // The executor's display metadata rides the completed event (the
        // agent port and a model adapter set it); it is kept for the publish
        // exactly as execute() keeps it.
        return {
          result: event.result,
          ...(event.generatedBy ? { generatedBy: event.generatedBy } : {}),
        };
      } else if (event.type === "failed") {
        throw Object.assign(new Error(event.error.message), {
          ...event.error,
        });
      }
    }
    throw new Error("The stream ended without a result.");
  }
  return {
    run,
    task,
    key,
    actionId,
    attempt,
    profileId: chosenProfile,
    processingPolicy: standing.processingPolicy,
    deviceOnly,
    screenshots,
    stopped,
    trace: finish,
    noteBytesIn(count) {
      bytesIn += count;
    },
    stillStanding,
    failRetryably,
    async refuse(reason, traceOutcome, detail, withheld) {
      run.settled.add(key);
      // A withheld draft carries its content-free summary on the reason.
      if (!stopped()) await settleWithheld(settle, reason, withheld);
      finish("dispatch.suppressed", traceOutcome, detail);
    },
    async call(prompt, tag = "") {
      // [SAFETY] The standing is re-read before every call, never reused from
      // the start of the dispatch: a repair is a second call.
      if (!(await stillStanding())) return { ok: false };
      bytesIn += prompt.byteCount;
      const sent = prompt.attachments ?? [];
      // [SAFETY] Images only ever ride a dispatch that began with them (and so
      // with the vision profile).
      if (sent.length > 0 && screenshots.images.length === 0) {
        run.settled.add(key);
        await settle("vision_unavailable");
        finish("dispatch.refused", "vision-unavailable");
        return { ok: false };
      }
      const request: AiExecutionRequest = {
        context: sessionGatewayContext(run.scope),
        profileId: chosenProfile,
        task: {
          type: "structured-generation",
          system: prompt.system,
          prompt: prompt.prompt,
          schema: prompt.schema,
          ...(sent.length > 0 ? { attachments: sent } : {}),
        },
        processingPolicy: standing.processingPolicy,
        idempotencyKey: `${sessionId}:${task.taskId}:${revision}:${stage.actionKind}:${attempt}${tag}`,
        signal,
      };
      try {
        // The answer draft is streamed so the person reads it as it is written
        // (recordProgress, about twice a second); other stages wait for the
        // whole result.
        const execution =
          stage.actionKind === ASSIST_ACTION_KIND
            ? await streamed(request)
            : await gateway.execute(request);
        const result: unknown = execution.result;
        bytesOut += Buffer.byteLength(
          typeof result === "string" ? result : (JSON.stringify(result) ?? ""),
        );
        if (stopped()) return { ok: false };
        // Display metadata only: remembered for the publish, never branched on.
        generatedBy = execution.generatedBy;
        return { ok: true, result };
      } catch (error) {
        if (stopped()) return { ok: false };
        if (isPolicyRefusal(error)) {
          // The refusal may be the session flipping to device-only before the
          // processor's tighten-abort fired: re-read the standing, and if the
          // policy changed this is retryable under the device profile, never a
          // final refusal of the task.
          const now = await store
            .readDispatchStanding({
              scope: run.scope,
              sessionId,
              holder: run.holder,
            })
            .catch(() => null);
          if (now === null) {
            await failRetryably("unavailable");
            return { ok: false };
          }
          if (now.outcome === "refused") {
            lost(now.reason);
            return { ok: false };
          }
          if (now.processingPolicy !== standing.processingPolicy) {
            locality = now.processingPolicy;
            await settle("policy_changed");
            finish("dispatch.suppressed", "policy_changed");
            return { ok: false };
          }
          // A real denial on an unchanged session: non-retryable.
          run.settled.add(key);
          // A refusal of a request that carried images (the runtime cannot
          // see them, or an attachment was refused) says so.
          await settle(sent.length > 0 ? "vision_refused" : "policy_refused");
          finish(
            "dispatch.refused",
            sent.length > 0 ? "vision-refused" : "policy-refused",
          );
          return { ok: false };
        }
        // The agent port's retryable "session not active" (a pause or end
        // seen after a capacity wait or a screenshot read): suppressed like a
        // pause, unsettled, so it is answered once the session is active.
        if (
          (error as { sessionCode?: unknown } | null)?.sessionCode ===
          "session-not-active"
        ) {
          await settle("session_not_active");
          finish("dispatch.suppressed", "session_not_active");
          return { ok: false };
        }
        // Unavailable (a failed standing or screenshot read, or cancelled):
        // retried against the same profile, with no fallback to another.
        const typed = error as {
          sessionCode?: unknown;
          reason?: unknown;
        } | null;
        const code =
          typeof typed?.sessionCode === "string"
            ? typed.sessionCode
            : "untyped";
        await failRetryably(
          signal.aborted ? "cancelled" : "unavailable",
          typeof typed?.reason === "string" ? `${code}:${typed.reason}` : code,
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
          // The executor that generated the answer, from its own profile.
          result:
            generatedBy === undefined ? result : { ...result, generatedBy },
          show: options.show ?? true,
          ...(options.effect ? { effect: options.effect } : {}),
        });
      } catch (error) {
        // An effect that threw rolled the whole publish back and left the
        // action in flight; it is failed here so the bounded retry may record
        // it again. Without an effect, a throw is a database error and
        // propagates: the processor settles the action as failed from
        // `run.openActionId`, so it is retried within the bound.
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
  // The screenshots this revision rests on, if any (ADR-0016): the dispatch
  // begins with them so it is bound to the vision profile or refused.
  const attachments = attachmentsFor(run, task);
  const hints = hintsFor(run, task);
  const d = await beginDispatch(run, task, deps, stage, { attachments });
  if (d === null) return;
  // D35: what of those screenshots this call carries, by the owner's stored
  // setting: images (renamed screenshot-1..K), texts, withheld notes, outcomes.
  const { images, texts, withheldNoText, outcomes } = d.screenshots;

  // The pinned context is read once per run through the store port; a failed
  // read is a retryable outcome (the stage never answers from a stale or
  // unverified context), an oversize prompt is a settled refusal.
  const plan = await planAssist(run, task, {
    store,
    stage,
    deviceOnly: d.deviceOnly,
    imageCount: images.length,
    screenshotText: texts,
    withheldNoText,
    hints,
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
  const called = await d.call({
    ...plan.prompt,
    ...(images.length > 0 ? { attachments: images } : {}),
  });
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

  // The owner's language hint wins over the model's choice for the coding
  // brief (both are within the coding path's supported set).
  const draft =
    hints.language && checked.draft.codingBrief
      ? {
          ...checked.draft,
          codingBrief: {
            ...checked.draft.codingBrief,
            language: hints.language,
          },
        }
      : checked.draft;
  // What of each screenshot left the device, recorded with the result at the
  // moment of publish (the call is over): ordinals and closed words only.
  const published = await d.publish(
    {
      ...plan.resultFor(draft, {
        profileId: d.profileId,
        processingPolicy: d.processingPolicy,
      }),
      ...(outcomes.length > 0 ? { screenshotsSent: outcomes } : {}),
    },
    { detail: { ...plan.detailFor(draft), ...outcomeCounts(outcomes) } },
  );
  if (published) noteCodingTask(run, task, draft);
}
