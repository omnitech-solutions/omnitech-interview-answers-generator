// The session assistance service (plan #2 D4): everything between "a task
// revision needs an answer" and "a validated, publishable result" that is not
// the fenced record/standing/publish skeleton of session-dispatch.ts. It owns
//   - the pinned context (loaded once per run through the store port, bounded
//     and cached on the run: a new fence builds a new run and reloads, and the
//     pinned profile revision cannot change inside a session);
//   - prompt assembly and the device window (the stage refuses, never
//     truncates, an oversize prompt);
//   - validation of the closed output and per-claim verification;
//   - the shape of the published result and its id-and-count-only trace detail.
//
// Nothing here calls a model or writes: the dispatcher does both, so the
// fenced skeleton reads top to bottom. A coding category is only RECORDED here
// (result.category and result.codingBrief); the coding path is a separate
// action kind built on that result.
import type {
  LiveOwnerLanguage,
  LiveOwnerSkill,
} from "@omnitech/interview-contracts";
import type { AssistDraft, AssistPrompt, AssistStage } from "./assist-stage";
import { type AssistValidation } from "./assist-stage";
import { summarizeClaims } from "./claims";
import type { Task } from "./core/index";
import type { SessionStorePort } from "./processor-ports";
import type { ScreenshotText } from "./screenshot-text";
import type { SessionContext } from "./session-context";
import { capturedFor, roleNotesFor, type SessionRun } from "./session-run";

export type AssistPlan =
  | {
      outcome: "ready";
      prompt: AssistPrompt;
      // Validates the model's raw output against the closed schema and the
      // snapshot this plan was built from.
      validate(raw: unknown): AssistValidation;
      // The result the fenced publish stores for a validated draft.
      resultFor(
        draft: AssistDraft,
        meta: { profileId: string; processingPolicy: string },
      ): Record<string, unknown>;
      // Counts and codes only; never a claim, quote or any other text.
      detailFor(draft: AssistDraft): Record<string, string | number>;
    }
  // The pinned context could not be read or re-verified: a retryable failure.
  | { outcome: "context_unavailable" }
  // The prompt cannot fit its window even with no source: a settled refusal.
  | { outcome: "prompt_too_large"; byteCount: number };

// Loads the run's context once; a failed load is not cached, so the retry
// (bounded by the processor) reads it again.
async function contextOf(
  run: SessionRun,
  store: SessionStorePort,
): Promise<SessionContext | null> {
  if (run.context) return run.context;
  try {
    run.context = await store.loadContext(run.scope, run.claim.sessionId);
    return run.context;
  } catch {
    // [SAFETY] The error is never read: only that it failed is recorded.
    return null;
  }
}

// The restatement and constraints of every coding brief this task has had, in
// any revision (a typed follow-up is a later revision of the same task).
function exerciseFor(run: SessionRun, task: Task): string[] {
  const texts: string[] = [];
  for (const candidate of run.coding.values())
    if (candidate.taskId === task.taskId)
      texts.push(candidate.brief.restatement, ...candidate.brief.constraints);
  return texts;
}

export async function planAssist(
  run: SessionRun,
  task: Task,
  input: {
    store: SessionStorePort;
    stage: AssistStage;
    deviceOnly: boolean;
    // How many screenshots travel with the call (0: none).
    imageCount?: number;
    // The text read from those screenshots on the device (screenshotTextFor).
    screenshotText?: readonly ScreenshotText[];
    // Screenshots whose image the owner's setting withheld and with no text.
    withheldNoText?: readonly string[];
    // The owner's closed hints for this task (hintsFor).
    hints?: { skill?: LiveOwnerSkill; language?: LiveOwnerLanguage };
  },
): Promise<AssistPlan> {
  const { store, stage, deviceOnly } = input;
  const context = await contextOf(run, store);
  if (!context) return { outcome: "context_unavailable" };

  const captured = capturedFor(run, task);
  const roleNotes = roleNotesFor(run, task);
  // An open coding task carries its exercise (the brief read from the screen)
  // as provenance for the figures of its follow-ups.
  const exercise = exerciseFor(run, task);
  // [SAFETY] The texts the call carries are sized against the room the prompt
  // really has: while it is too large the newest text is dropped (never cut).
  // Its image still travels when it was sent; a text that stood alone is
  // reported as withheld, so the model never answers from a part it lacks.
  const texts = deviceOnly ? [] : [...(input.screenshotText ?? [])];
  const withheld = deviceOnly ? [] : [...(input.withheldNoText ?? [])];
  let prepared: ReturnType<typeof stage.prepare>;
  for (;;) {
    prepared = stage.prepare({
      taskId: task.taskId,
      revision: task.revision,
      captured,
      ...(roleNotes.length > 0 ? { roleNotes } : {}),
      context,
      deviceOnly,
      imageCount: input.imageCount ?? 0,
      // [SAFETY] Text read from a screenshot travels beside its image, or alone
      // when the owner's setting withheld the image (D35); a device-only
      // session sends neither to an agent.
      ...(texts.length > 0 ? { screenshotText: texts } : {}),
      ...(withheld.length > 0 ? { withheldNoText: withheld } : {}),
      ...(input.hints?.skill ? { skill: input.hints.skill } : {}),
      ...(input.hints?.language ? { language: input.hints.language } : {}),
    });
    const dropped = prepared.ok ? undefined : texts.pop();
    if (prepared.ok || dropped === undefined) break;
    if (dropped.image === null) withheld.push(dropped.label);
  }
  if (!prepared.ok)
    return { outcome: "prompt_too_large", byteCount: prepared.byteCount };
  const screenBased =
    (input.imageCount ?? 0) > 0 || texts.length > 0 || withheld.length > 0;

  const { snapshot } = context;
  const pinned = snapshot.profile
    ? {
        profileId: snapshot.profile.id,
        revision: snapshot.profile.revision,
        sha256: snapshot.profile.sha256,
      }
    : null;
  return {
    outcome: "ready",
    prompt: prepared.prompt,
    validate: (raw) =>
      stage.validate(raw, {
        snapshot,
        captured: captured.map((line) => line.text),
        screenBased,
        ...(exercise.length > 0 ? { exercise } : {}),
      }),
    resultFor: (draft, meta) => ({
      version: 1,
      stage: stage.actionKind,
      category: draft.category,
      draft: draft.draft,
      // The display list, derived from the claims (readers of the earlier
      // result shape keep working).
      sections: draft.sections,
      claims: draft.claims,
      star: draft.star,
      logistics: draft.logistics,
      codingBrief: draft.codingBrief,
      // Display metadata: what the model could not see (never a claim).
      ...(draft.missingContext ? { missingContext: draft.missingContext } : {}),
      // The experience revision every matrix-backed claim was verified
      // against, and the context revisions the answer rests on.
      pinned,
      contextRevisions: {
        profile: snapshot.profile?.revision ?? null,
        draft: snapshot.draftRevision,
      },
      meta: {
        ...meta,
        category: draft.category,
        claimCounts: summarizeClaims(draft.claims),
      },
    }),
    detailFor: (draft) => {
      const counts = summarizeClaims(draft.claims);
      return {
        category: draft.category,
        claims: draft.claims.length,
        matrixBacked: counts["matrix-backed"],
        preferenceBacked: counts["preference-backed"],
        suggestedInterpretation: counts["suggested-interpretation"],
        generalKnowledge: counts["general-knowledge"],
        notInMatrix: counts["not-in-matrix"],
        profileRevision: snapshot.profile?.revision ?? 0,
        draftRevision: snapshot.draftRevision ?? 0,
      };
    },
  };
}
