// The Active Session repository: the owner-facing lifecycle (start, control,
// credential renewal and revocation, policy tightening, retention shortening,
// owner delete) and the owner-checked reads. Every call opens
// withTenant({tenantId, actorId, productId}) for the session OWNER, so forced
// row security binds it (rule:owner-checked-read-paths). Ingest, the worker's
// claim, the fenced writes and the purge are sibling modules.
import { randomUUID } from "node:crypto";
import {
  ACTIVE_SESSION_LIMITS,
  type CaptureSource,
} from "@omnitech/active-session-contracts";
import type { PlatformDatabase, TenantDatabase } from "@omnitech/database";
import {
  type LiveScreenshotSend,
  liveScreenshotSendSchema,
  liveSessionStartRequestSchema,
} from "@omnitech/interview-contracts";
import { PostgresAgentJobRepository } from "@omnitech/platform-storage";
import type { z } from "zod";
import { readCaptureRequest, submitCaptureRequest } from "./capture-request";
import { getCompanionCapability } from "./companion-capability";
import {
  type ProcessingPolicy,
  type StatusActor,
  type StatusCommand,
  tightenPolicy,
  transitionStatus,
} from "./core/index";
import { assertUuid, SessionError } from "./errors";
import {
  encodeDraftKey,
  isProcessingPolicy,
  isRetentionMode,
  policyToDb,
  type RetentionMode,
  retentionRank,
  retentionToDb,
  type WorkspaceDraftKey,
} from "./mapping";
import { storeOwnerCapture } from "./owner-capture";
import {
  insertOwnerInput,
  nextOwnerSequence,
  OWNER_STOP_BODY,
  storeOwnerInput,
} from "./owner-input";
import { lockSession, readSession } from "./repositories/session.repository";
import {
  candidacyIsOwned,
  findProfileCurrentRevision,
  hasOpenSession,
  insertSession,
  interviewBelongsToCandidacy,
  profileRevisionExists,
  readClockMs,
  replaceCredential,
  stampCredentialRevoked,
  workspaceDraftExists,
  writeProcessingPolicy,
  writeRetentionMode,
  writeScreenshotSend,
} from "./repositories/session-lifecycle.repository";
import { inOwnerScope, type OwnerScope } from "./scope";
import { getSessionChoices } from "./session-choices";
import { mintSessionCredential } from "./session-credential";
import {
  type CancellationSummary,
  cancelSessionJobs,
  type SessionJobs,
} from "./session-jobs";
import { listActionChanges, listSessions } from "./session-pages";
import {
  getOpenSession,
  getSession,
  getSessionContext,
  getSessionJob,
  listActions,
  listObservations,
  listTaskScreenshots,
  readScreenshot,
} from "./session-reads";
import { type SessionRecord, type SessionView, toView } from "./session-record";
import {
  CANCELS_JOBS,
  type ReconcileOptions,
  reconcileLocked,
  transitionLocked,
} from "./status-transition";

export type StartSessionInput = {
  processingPolicy: ProcessingPolicy;
  // The permitted capture sources, fixed at start; the companion cannot
  // broaden them (ADR-0011 Wire contract).
  captureSources: readonly CaptureSource[];
  liveAssistance?: boolean;
  // D35: what of a screenshot may reach a model; defaults to "always".
  screenshotSend?: LiveScreenshotSend;
  // Defaults to delete at end (rule:retention-modes).
  retention?: RetentionMode;
  // An opaque run id minted by the client and the strict flag, immutable once
  // set (rule:strict-rehearsal-no-assistance).
  rehearsal?: { runId: string; strict: boolean };
  interviewId?: string;
  candidacyId?: string;
  // The approved candidate-profile revision is pinned at start; with no
  // revision the profile's current one is pinned.
  profile?: { id: string; revision?: number };
  workspaceDraft?: WorkspaceDraftKey;
  durationMs?: number;
};

export type StartedSession = {
  session: SessionView;
  // The only time the plaintext credential leaves the repository.
  credential: { value: string; expiresAt: string };
};

export type RenewedCredential = { value: string; expiresAt: string };

export type ControlAction = "pause" | "resume" | "end";
const CONTROL_COMMAND: Record<ControlAction, StatusCommand> = {
  pause: "pause",
  resume: "resume",
  end: "end",
};

// The one start-body schema is the wire contract's; the repository re-checks it
// at its own boundary so a caller other than the route cannot skip it.
const startInputSchema = liveSessionStartRequestSchema;

function pgError(error: unknown): { code?: string; constraint?: string } {
  const cause =
    error && typeof error === "object" && "cause" in error
      ? error.cause
      : error;
  return (cause ?? {}) as { code?: string; constraint?: string };
}

type LinkPlan = {
  candidacyId: string | null;
  interviewId: string | null;
  profile: { id: string; revision: number } | null;
};

export type ActiveSessionRepositoryOptions = { jobs?: SessionJobs };

export class ActiveSessionRepository {
  readonly jobs: SessionJobs;

  constructor(
    private readonly database: PlatformDatabase,
    options: ActiveSessionRepositoryOptions = {},
  ) {
    this.jobs = options.jobs ?? new PostgresAgentJobRepository(database);
  }

  // [GUARD] Every link is confirmed to belong to the owner in this same
  // transaction (rule:linked-resource-authorization); the triggers and
  // composite keys of the migration repeat the check at the database.
  private async confirmLinks(
    tx: TenantDatabase,
    scope: OwnerScope,
    input: z.infer<typeof startInputSchema>,
  ): Promise<LinkPlan> {
    const refuse = () => new SessionError("link_refused");
    let candidacyId: string | null = null;
    if (input.candidacyId) {
      if (!(await candidacyIsOwned(tx, scope, input.candidacyId)))
        throw refuse();
      candidacyId = input.candidacyId;
    }
    let interviewId: string | null = null;
    if (input.interviewId) {
      // An interview is linked only through its candidacy.
      if (!candidacyId) throw refuse();
      if (
        !(await interviewBelongsToCandidacy(
          tx,
          scope,
          input.interviewId,
          candidacyId,
        ))
      )
        throw refuse();
      interviewId = input.interviewId;
    }
    let profile: LinkPlan["profile"] = null;
    if (input.profile) {
      const current = await findProfileCurrentRevision(
        tx,
        scope,
        input.profile.id,
      );
      if (current === undefined) throw refuse();
      const revision = input.profile.revision ?? current;
      if (!(await profileRevisionExists(tx, scope, input.profile.id, revision)))
        throw refuse();
      profile = { id: input.profile.id, revision };
    }
    if (input.workspaceDraft) {
      // The draft is a text key with no foreign key, so existence for this
      // owner is checked here, in the same transaction.
      if (
        !(await workspaceDraftExists(
          tx,
          scope,
          input.workspaceDraft.workspaceId,
          input.workspaceDraft.artifactId,
        ))
      )
        throw refuse();
    }
    return { candidacyId, interviewId, profile };
  }

  // Starts a session for the owner: links confirmed, the profile revision
  // pinned, the policy and retention recorded, one open session per owner, and
  // the credential minted. Only its hash and expiry are stored.
  async startSession(
    scope: OwnerScope,
    rawInput: StartSessionInput,
  ): Promise<StartedSession> {
    const parsed = startInputSchema.safeParse(rawInput);
    if (!parsed.success) throw new SessionError("invalid_input");
    const input = parsed.data;
    const policy = input.processingPolicy as ProcessingPolicy;
    const retention = (input.retention ?? "delete-at-end") as RetentionMode;
    const strict = input.rehearsal?.strict ?? false;
    // Live assistance is disabled in a strict rehearsal.
    const liveAssistance = strict ? false : (input.liveAssistance ?? true);
    const captureSources = [...new Set(input.captureSources)];
    const duration = Math.min(
      input.durationMs ?? ACTIVE_SESSION_LIMITS.sessionDurationCapMs,
      ACTIVE_SESSION_LIMITS.sessionDurationCapMs,
    );
    // The owner's start control is the one actor that starts capture.
    const started = transitionStatus("created", "start", "owner-control");
    if (!started.ok) throw new SessionError("status_refused");

    try {
      return await inOwnerScope(this.database, scope, async (tx) => {
        const links = await this.confirmLinks(tx, scope, input);
        if (await hasOpenSession(tx, scope))
          throw new SessionError("open_session_exists");
        const nowMs = await readClockMs(tx);
        const expiresAt = new Date(nowMs + duration);
        // The credential never outlives the session's duration cap.
        const credential = await mintSessionCredential(
          nowMs,
          expiresAt.getTime(),
        );
        const row = await insertSession(tx, scope, {
          status: started.status,
          retentionMode: retentionToDb(retention),
          processingPolicy: policyToDb(policy),
          screenshotSend: input.screenshotSend ?? "always",
          credentialHash: credential.hash,
          credentialExpiresAt: credential.expiresAt.toISOString(),
          sources: { captureSources, liveAssistance },
          rehearsalRunId: input.rehearsal?.runId ?? null,
          strict,
          interviewId: links.interviewId,
          candidacyId: links.candidacyId,
          profileId: links.profile?.id ?? null,
          profileRevision: links.profile?.revision ?? null,
          workspaceDraftId: input.workspaceDraft
            ? encodeDraftKey(input.workspaceDraft)
            : null,
          expiresAt: expiresAt.toISOString(),
          nowMs,
        });
        if (!row) throw new SessionError("invalid_input");
        return {
          session: toView(row),
          credential: {
            value: credential.plaintext,
            expiresAt: credential.expiresAt.toISOString(),
          },
        };
      });
    } catch (error) {
      if (error instanceof SessionError) throw error;
      const { code, constraint } = pgError(error);
      if (
        code === "23505" &&
        constraint === "active_sessions_one_open_per_owner"
      )
        throw new SessionError("open_session_exists");
      // A trigger refusal of a link is a refused link, never a raw error.
      if (code === "23503") throw new SessionError("link_refused");
      throw error;
    }
  }

  private async afterStatusChange(
    scope: OwnerScope,
    sessionId: string,
    cancel: boolean,
  ): Promise<CancellationSummary | null> {
    return cancel
      ? cancelSessionJobs(this.database, this.jobs, scope, sessionId)
      : null;
  }

  // Owner control and the internal actors share one path through the core's
  // status machine. The status flips first (committed), then the session's
  // in-flight jobs are cancelled (rule:pause-end-suppression).
  async controlSession(
    scope: OwnerScope,
    sessionId: string,
    action: ControlAction,
    actor: StatusActor = "owner-control",
  ): Promise<SessionView> {
    assertUuid(sessionId);
    const command = CONTROL_COMMAND[action];
    const outcome = await inOwnerScope(this.database, scope, async (tx) => {
      let row = await lockSession(tx, scope, sessionId);
      if (!row || row.purgedAt !== null) throw new SessionError("not_found");
      // A session past its cap ends, and a dead credential pauses it, before
      // the owner's command is applied; resume cannot revive a capped session.
      const reconciled = await reconcileLocked(tx, row, { contact: true });
      if (reconciled.applied !== null) {
        row = (await lockSession(tx, scope, sessionId)) as SessionRecord;
        if (reconciled.applied === "end" && action !== "end")
          return {
            refusal: "duration_cap_reached" as const,
            session: row,
            cancel: true,
          };
      }
      if (action === "resume") {
        const dead =
          row.credentialHash === null ||
          row.credentialRevokedAt !== null ||
          row.credentialExpiresAt === null ||
          row.credentialExpiresAt.getTime() <= row.nowMs;
        // Resuming with a dead credential would only pause again: the owner
        // renews first (rule:credential-lifetime-and-renewal).
        if (dead && transitionStatus(row.status, "resume", actor).ok)
          return {
            refusal: "credential_renewal_required" as const,
            session: row,
            cancel: reconciled.applied !== null,
          };
      }
      const transition = await transitionLocked(tx, row, command, actor);
      const after = await readSession(tx, scope, sessionId);
      if (!after) throw new SessionError("not_found");
      return {
        refusal: null,
        session: after,
        cancel:
          reconciled.applied !== null ||
          (CANCELS_JOBS.includes(command) && transition.to !== "active"),
      };
    });
    // Status is committed; only now are the session's jobs cancelled.
    await this.afterStatusChange(scope, sessionId, outcome.cancel);
    if (outcome.refusal) throw new SessionError(outcome.refusal);
    return toView(outcome.session);
  }

  // Owner-initiated stop (ADR-0016 follow-on): abandon the work in flight and
  // pending NOW while the session stays active. The stop is one durable
  // `owner.input` observation the holder applies in observation order (it
  // settles the then-current task revisions and aborts their dispatches), and
  // the session's jobs are cancelled once it is committed. An unreadable or
  // non-active session refuses like the other commands (status_refused).
  async stopWork(scope: OwnerScope, sessionId: string): Promise<SessionView> {
    assertUuid(sessionId);
    const outcome = await inOwnerScope(this.database, scope, async (tx) => {
      let row = await lockSession(tx, scope, sessionId);
      if (!row || row.purgedAt !== null) throw new SessionError("not_found");
      const reconciled = await reconcileLocked(tx, row, { contact: true });
      if (reconciled.applied !== null)
        row = (await lockSession(tx, scope, sessionId)) as SessionRecord;
      if (row.status !== "active")
        return {
          refused: true,
          session: row,
          cancel: reconciled.applied !== null,
        };
      const sequence = await nextOwnerSequence(tx, scope, sessionId);
      await insertOwnerInput(
        tx,
        scope,
        sessionId,
        row,
        `stop-${randomUUID()}`,
        sequence,
        OWNER_STOP_BODY,
      );
      return { refused: false, session: row, cancel: true };
    });
    // Status is committed; only now are the session's jobs cancelled.
    await this.afterStatusChange(scope, sessionId, outcome.cancel);
    if (outcome.refused) throw new SessionError("status_refused");
    return toView(outcome.session);
  }

  // The processor's time-derived standing: the duration cap ends the session,
  // an expired or revoked credential and a silent companion pause it.
  async reconcileSession(
    scope: OwnerScope,
    sessionId: string,
    options: Partial<ReconcileOptions> = {},
  ): Promise<SessionView> {
    assertUuid(sessionId);
    const result = await inOwnerScope(this.database, scope, async (tx) => {
      const row = await lockSession(tx, scope, sessionId);
      if (!row) throw new SessionError("not_found");
      const reconciled = await reconcileLocked(tx, row, {
        contact: false,
        ...options,
      });
      const after = await readSession(tx, scope, sessionId);
      return { reconciled, session: after as SessionRecord };
    });
    await this.afterStatusChange(
      scope,
      sessionId,
      result.reconciled.applied !== null,
    );
    return toView(result.session);
  }

  // Owner-initiated replacement: mints a new credential, revokes the old one
  // (it is overwritten), and never passes the duration cap.
  async renewCredential(
    scope: OwnerScope,
    sessionId: string,
  ): Promise<RenewedCredential> {
    assertUuid(sessionId);
    return inOwnerScope(this.database, scope, async (tx) => {
      const row = await lockSession(tx, scope, sessionId);
      if (!row || row.purgedAt !== null) throw new SessionError("not_found");
      if (!["created", "active", "paused"].includes(row.status))
        throw new SessionError("status_refused");
      if (row.nowMs >= row.expiresAt.getTime())
        throw new SessionError("duration_cap_reached");
      const credential = await mintSessionCredential(
        row.nowMs,
        row.expiresAt.getTime(),
      );
      await replaceCredential(
        tx,
        scope,
        sessionId,
        credential.hash,
        credential.expiresAt.toISOString(),
      );
      return {
        value: credential.plaintext,
        expiresAt: credential.expiresAt.toISOString(),
      };
    });
  }

  // Owner request: the credential stops admitting ingest at once, and a live
  // session pauses (capture visibly stops).
  async revokeCredential(scope: OwnerScope, sessionId: string): Promise<void> {
    assertUuid(sessionId);
    const paused = await inOwnerScope(this.database, scope, async (tx) => {
      const row = await lockSession(tx, scope, sessionId);
      if (!row || row.purgedAt !== null) throw new SessionError("not_found");
      await stampCredentialRevoked(tx, scope, sessionId);
      if (row.status !== "active") return false;
      await transitionLocked(tx, row, "pause", "owner-control");
      return true;
    });
    await this.afterStatusChange(scope, sessionId, paused);
  }

  // A session may tighten to device-only and never loosen; the database
  // refuses loosening too (rule:tighten-only-locality).
  async tightenProcessingPolicy(
    scope: OwnerScope,
    sessionId: string,
    requested: ProcessingPolicy,
  ): Promise<SessionView> {
    assertUuid(sessionId);
    if (!isProcessingPolicy(requested)) throw new SessionError("invalid_input");
    const tightened = await inOwnerScope(this.database, scope, async (tx) => {
      const row = await lockSession(tx, scope, sessionId);
      if (!row || row.purgedAt !== null) throw new SessionError("not_found");
      const decision = tightenPolicy(row.policy, requested);
      if (!decision.ok) throw new SessionError("loosening_refused");
      if (decision.policy !== row.policy)
        await writeProcessingPolicy(
          tx,
          scope,
          sessionId,
          policyToDb(decision.policy),
        );
      const after = await readSession(tx, scope, sessionId);
      return toView(after as SessionRecord);
    });
    // The agent worker claims any queued job without a policy check, so a
    // remote job queued before the tighten would still launch. Once the policy
    // is device-only the session's jobs are cancelled, as for a pause; running
    // it whenever the policy is device-only (not only on a change) lets a
    // retry after a failed cancellation finish the job.
    if (tightened.processingPolicy === "device-only")
      await this.afterStatusChange(scope, sessionId, true);
    return tightened;
  }

  // D35: the owner's choice of what of a screenshot may reach a model. It may
  // change either way at any time (it only ever limits what is sent), applies
  // to the next model call, and a device-only session sends nothing whatever it
  // says. Only the owner's scoped transaction can write it; the worker's claim
  // changes lease and fence columns only.
  async setScreenshotSend(
    scope: OwnerScope,
    sessionId: string,
    requested: LiveScreenshotSend,
  ): Promise<SessionView> {
    assertUuid(sessionId);
    if (!liveScreenshotSendSchema.safeParse(requested).success)
      throw new SessionError("invalid_input");
    return inOwnerScope(this.database, scope, async (tx) => {
      const row = await lockSession(tx, scope, sessionId);
      if (!row || row.purgedAt !== null) throw new SessionError("not_found");
      if (row.status === "ended" || row.status === "purging")
        throw new SessionError("status_refused");
      if (requested !== row.screenshotSend)
        await writeScreenshotSend(tx, scope, sessionId, requested);
      const after = await readSession(tx, scope, sessionId);
      return toView(after as SessionRecord);
    });
  }

  // Only the owner shortens retention, never lengthens it
  // (rule:owner-chooses-retention).
  async shortenRetention(
    scope: OwnerScope,
    sessionId: string,
    requested: RetentionMode,
  ): Promise<SessionView> {
    assertUuid(sessionId);
    if (!isRetentionMode(requested)) throw new SessionError("invalid_input");
    return inOwnerScope(this.database, scope, async (tx) => {
      const row = await lockSession(tx, scope, sessionId);
      if (!row || row.purgedAt !== null) throw new SessionError("not_found");
      if (retentionRank(requested) > retentionRank(row.retention))
        throw new SessionError("retention_lengthening_refused");
      if (requested !== row.retention)
        await writeRetentionMode(
          tx,
          scope,
          sessionId,
          retentionToDb(requested),
        );
      const after = await readSession(tx, scope, sessionId);
      return toView(after as SessionRecord);
    });
  }

  // Owner delete: begins the purge (the session becomes purging, refusing
  // ingest and dispatch, with its credential revoked and its jobs cancelled).
  // The worker's purge sweep completes the deletion (session-purge.ts).
  async deleteSession(
    scope: OwnerScope,
    sessionId: string,
  ): Promise<SessionView> {
    assertUuid(sessionId);
    const after = await inOwnerScope(this.database, scope, async (tx) => {
      const row = await lockSession(tx, scope, sessionId);
      if (!row) throw new SessionError("not_found");
      // A purged session is already a tombstone: nothing is left to delete.
      if (row.purgedAt === null)
        await transitionLocked(tx, row, "begin-purge", "owner-control");
      return (await readSession(tx, scope, sessionId)) as SessionRecord;
    });
    if (after.purgedAt === null)
      await this.afterStatusChange(scope, sessionId, true);
    return toView(after);
  }

  getSession(scope: OwnerScope, sessionId: string) {
    return getSession(this.database, scope, sessionId);
  }
  getOpenSession(scope: OwnerScope) {
    return getOpenSession(this.database, scope);
  }
  listObservations(
    scope: OwnerScope,
    sessionId: string,
    options?: {
      afterSequence?: number;
      limit?: number;
      excludeOwnerInput?: boolean;
    },
  ) {
    return listObservations(this.database, scope, sessionId, options);
  }
  // The owner's own request for assistance (ADR-0016): stored DB-side only.
  submitOwnerInput(scope: OwnerScope, sessionId: string, input: unknown) {
    return storeOwnerInput(this.database, scope, sessionId, input);
  }
  // The owner's browser capture, analysed on press (owner-capture.ts).
  submitOwnerCapture(
    scope: OwnerScope,
    sessionId: string,
    fields: unknown,
    images: readonly Uint8Array[],
  ) {
    return storeOwnerCapture(this.database, scope, sessionId, fields, images);
  }
  // The owner's one-shot "capture now" for the native companion
  // (capture-request.ts): one pending request per session.
  submitCaptureRequest(scope: OwnerScope, sessionId: string, input: unknown) {
    return submitCaptureRequest(this.database, scope, sessionId, input);
  }
  getCaptureRequest(scope: OwnerScope, sessionId: string, requestId: string) {
    return readCaptureRequest(this.database, scope, sessionId, requestId);
  }
  listActions(
    scope: OwnerScope,
    sessionId: string,
    options?: { limit?: number },
  ) {
    return listActions(this.database, scope, sessionId, options);
  }
  listActionChanges(
    scope: OwnerScope,
    sessionId: string,
    options?: { limit?: number; cursor?: string },
  ) {
    return listActionChanges(this.database, scope, sessionId, options);
  }
  listSessions(
    scope: OwnerScope,
    options?: { limit?: number; cursor?: string },
  ) {
    return listSessions(this.database, scope, options);
  }
  getCompanionCapability(scope: OwnerScope) {
    return getCompanionCapability(this.database, scope);
  }
  getSessionChoices(scope: OwnerScope) {
    return getSessionChoices(this.database, scope);
  }
  listTaskScreenshots(scope: OwnerScope, sessionId: string, taskId: string) {
    return listTaskScreenshots(this.database, scope, sessionId, taskId);
  }
  readScreenshot(scope: OwnerScope, sessionId: string, artifactId: string) {
    return readScreenshot(this.database, scope, sessionId, artifactId);
  }
  getSessionContext(scope: OwnerScope, sessionId: string) {
    return getSessionContext(this.database, scope, sessionId);
  }
  getSessionJob(scope: OwnerScope, sessionId: string, jobId: string) {
    return getSessionJob(this.database, this.jobs, scope, sessionId, jobId);
  }
}
