// The Active Session purge. This is the one file that sets app.session_purge
// (rule:purge-delete-setting; scripts/tenant-context-boundary.test.ts). The
// database deletes session observations, actions, the session row and session
// screenshot artifacts (with their payloads) only while the setting is on, the
// owner matches the actor and, for artifacts, the type is the session type.
//
// One idempotent purge (rule:complete-purge-except-retained-drafts):
//   1. mark the session purging (refuses ingest and dispatch, revokes the
//      credential) and request cancellation of its jobs;
//   2. wait, bounded, for the named jobs to be terminal;
//   3. in ONE transaction under the purge setting delete observations, the
//      screenshot artifacts and payloads, actions, the session's jobs with
//      their events and artifacts and every payload those jobs referenced (the
//      references are collected in the transaction that deletes the job rows),
//      unchanged session-created drafts not named by a revision or revert
//      (through SessionDraftPurger), clear the links,
//      snapshot and credential, then run the FINAL CHECK;
//   4. only a passing final check sets the tombstone (ended, purged_at,
//      purge_outcome, counts; the shown-draft count is preserved).
// A crash resumes at the next sweep; a failing final check never tombstones.
//
// The relay rows of the on-device model (ADR-0012 Locality by stage) are out of
// scope for this loop: no relay rows are created yet, so none are deleted here.
// The purge runs as the session owner whether or not the owner is still a
// tenant member, so a removed member's sessions are still purged.
import type { DatabaseClient, PlatformDatabase } from "@omnitech/database";
import { enterTenant } from "@omnitech/database";
import { PostgresAgentJobRepository } from "@omnitech/platform-storage";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import { assertUuid, SessionError } from "./errors";
import { decodeDraftKey, type WorkspaceDraftKey } from "./mapping";
import {
  clearSessionLinks,
  countJobEvents,
  deleteActions,
  deleteAgentSessions,
  deleteArtifactPayloads,
  deleteArtifacts,
  deleteJobPayloads,
  deleteObservations,
  deletePrivateJobs,
  finaliseShownDraftCount,
  jobArtifactReferences,
  jobStatuses,
  lockSessionForPurge,
  namedJobIds,
  referencingTables,
  remainingAfterPurge,
  screenshotArtifactIds,
  writeTombstone,
} from "./repositories/purge.repository";
import { lockSession } from "./repositories/session.repository";
import { inOwnerScope, type OwnerScope } from "./scope";
import type { SessionTarget } from "./session-claim";
import { cancelSessionJobs, namedJobs, type SessionJobs } from "./session-jobs";
import { transitionLocked } from "./status-transition";

// Runs `work` in an actor-scoped transaction for the session owner with the
// purge setting on. Both the actor scope and the setting are transaction-local.
export function asSessionPurge<Result>(
  database: PlatformDatabase,
  owner: { tenantId: string; ownerUserId: string },
  work: (client: DatabaseClient) => Promise<Result>,
): Promise<Result> {
  return database.transaction(async (client) => {
    await enterTenant(client, {
      tenantId: owner.tenantId,
      actorId: owner.ownerUserId,
    });
    await client.query("SELECT set_config('app.product_id', $1, true)", [
      INTERVIEW_PRODUCT_ID,
    ]);
    await client.query("SELECT set_config('app.session_purge', 'on', true)");
    return work(client);
  });
}

// The bounded wait for named jobs to become terminal; after it the job rows are
// deleted anyway and a worker write to a missing job fails closed.
const PURGE_JOB_WAIT_MS = 30_000;
const PURGE_POLL_MS = 500;

// Session-created Workspace drafts are text-keyed rows in the assistant draft
// table. Which drafts the session created (and which the owner promoted or
// exported, which stay outside the purge) is decided by the provenance mark of
// loop 2; until it exists the default purges nothing and the UI says drafts
// are not removed. A real purger runs inside the purge transaction (so it
// commits or rolls back with it) and returns how many drafts it deleted.
export interface SessionDraftPurger {
  purge(
    client: DatabaseClient,
    target: SessionTarget,
    draft: WorkspaceDraftKey | null,
  ): Promise<number>;
}
const noSessionDraftPurger: SessionDraftPurger = {
  purge: async () => 0,
};

export type PurgeOptions = {
  jobs?: SessionJobs;
  drafts?: SessionDraftPurger;
  // "owner-delete" is the owner's own delete; a sweep is the purge actor.
  trigger?: "sweep" | "owner-delete";
  waitMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

type PurgeCounts = {
  observations: number;
  screenshotArtifacts: number;
  actions: number;
  jobs: number;
  jobEvents: number;
  jobArtifacts: number;
  jobPayloads: number;
  agentSessions: number;
  drafts: number;
};

export type PurgeResult =
  | { outcome: "complete" | "partial"; counts: PurgeCounts }
  | { outcome: "already-purged" };

const TERMINAL_JOB = ["succeeded", "failed", "cancelled", "timed-out"];

// Tables that reference a session (or a job) and that the purge deletes from.
// The final check compares the Postgres catalog against these lists: a table
// that references a session or a job and is not listed fails the check.
const SESSION_COVERED_TABLES = [
  "interview.session_actions",
  "interview.session_observations",
] as const;
const JOB_COVERED_TABLES = [
  "ai.agent_artifacts",
  "ai.agent_job_events",
] as const;

const sleepFor = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitForTerminalJobs(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
  options: Required<Pick<PurgeOptions, "waitMs" | "pollMs" | "sleep">>,
): Promise<boolean> {
  const named = await namedJobs(database, scope, sessionId);
  const ids = named.filter((job) => job.created).map((job) => job.jobId);
  if (ids.length === 0) return true;
  let waited = 0;
  for (;;) {
    const pending = await inOwnerScope(database, scope, async (tx) => {
      const statuses = await jobStatuses(tx, scope, ids);
      return statuses.filter((status) => !TERMINAL_JOB.includes(status)).length;
    });
    if (pending === 0) return true;
    if (waited >= options.waitMs) return false;
    await options.sleep(options.pollMs);
    waited += options.pollMs;
  }
}

type FinalCheck = { uncovered: string[]; remaining: string[] };

export async function purgeSession(
  database: PlatformDatabase,
  target: SessionTarget,
  options: PurgeOptions = {},
): Promise<PurgeResult> {
  assertUuid(target.sessionId);
  const scope: OwnerScope = {
    tenantId: target.tenantId,
    actorId: target.ownerUserId,
  };
  const jobs = options.jobs ?? new PostgresAgentJobRepository(database);
  const drafts = options.drafts ?? noSessionDraftPurger;

  // 1. Mark purging first: from the committed flip, ingest, dispatch and every
  // new action are refused (rule:no-content-after-purging).
  const marked = await inOwnerScope(database, scope, async (tx) => {
    const row = await lockSession(tx, scope, target.sessionId);
    if (!row) throw new SessionError("not_found");
    if (row.purgedAt !== null) return "purged" as const;
    if (row.status !== "purging")
      await transitionLocked(
        tx,
        row,
        "begin-purge",
        options.trigger === "owner-delete" ? "owner-control" : "purge",
      );
    return "purging" as const;
  });
  if (marked === "purged") return { outcome: "already-purged" };
  await cancelSessionJobs(database, jobs, scope, target.sessionId);

  // 2. A bounded wait for the named jobs to be terminal.
  const settled = await waitForTerminalJobs(database, scope, target.sessionId, {
    waitMs: options.waitMs ?? PURGE_JOB_WAIT_MS,
    pollMs: options.pollMs ?? PURGE_POLL_MS,
    sleep: options.sleep ?? sleepFor,
  });

  // 3-4. The deletion, the final check and the tombstone.
  const result = await asSessionPurge(
    database,
    {
      tenantId: target.tenantId,
      ownerUserId: target.ownerUserId,
    },
    async (client) => {
      const { tenantId } = target;
      // The session row lock comes first, as in job creation, so no private job
      // is created or named after the purge reads the actions.
      const session = await lockSessionForPurge(client, target);
      if (!session) throw new SessionError("not_found");
      if (session.purged_at !== null) return { kind: "purged" as const };
      if (session.status !== "purging")
        throw new SessionError("status_refused");

      const jobIds = await namedJobIds(client, target);

      // Observations first, then the artifacts they linked.
      const observationCount = await deleteObservations(client, target);
      const artifactIds = await screenshotArtifactIds(client, target);
      if (artifactIds.length > 0) {
        await deleteArtifactPayloads(client, tenantId, artifactIds);
        await deleteArtifacts(client, tenantId, artifactIds);
      }

      // Session-created drafts go BEFORE the actions: the purger decides which
      // drafts are still untouched by comparing each draft's revision with the
      // revision the session's own results recorded.
      const draftCount = await drafts.purge(
        client,
        target,
        decodeDraftKey(session.workspace_draft_id),
      );

      // The hint count is finalised before the actions are deleted.
      await finaliseShownDraftCount(client, target);
      const actionCount = await deleteActions(client, target);

      // The session's jobs: collect every payload reference in this transaction,
      // then delete the job rows (events and artifacts cascade) and the payloads.
      let jobEvents = 0;
      let jobArtifacts = 0;
      let jobRows = 0;
      let payloads = 0;
      let agentSessions = 0;
      const payloadRefs = new Set<string>();
      if (jobIds.length > 0) {
        jobEvents = await countJobEvents(client, tenantId, jobIds);
        const refs = payloadRefs;
        const artifactRefs = await jobArtifactReferences(
          client,
          tenantId,
          jobIds,
        );
        jobArtifacts = artifactRefs.length;
        for (const reference of artifactRefs) refs.add(reference);
        const deleted = await deletePrivateJobs(client, tenantId, jobIds);
        jobRows = deleted.length;
        const runtimeSessions: string[] = [];
        for (const row of deleted) {
          if (row.prompt_reference) refs.add(row.prompt_reference);
          if (row.result_reference) refs.add(row.result_reference);
          if (row.session_id) runtimeSessions.push(row.session_id);
        }
        if (refs.size > 0)
          payloads = await deleteJobPayloads(client, tenantId, [...refs]);
        if (runtimeSessions.length > 0)
          agentSessions = await deleteAgentSessions(
            client,
            tenantId,
            runtimeSessions,
          );
      }

      // Links, snapshot and credential are cleared (and only cleared) while the
      // session is purging.
      await clearSessionLinks(client, target);

      const counts: PurgeCounts = {
        observations: observationCount,
        screenshotArtifacts: artifactIds.length,
        actions: actionCount,
        jobs: jobRows,
        jobEvents,
        jobArtifacts,
        jobPayloads: payloads,
        agentSessions,
        drafts: draftCount,
      };
      const check = await finalCheck(client, target, {
        jobIds,
        artifactIds,
        payloadRefs: [...payloadRefs],
      });
      // A failing check throws inside the transaction, so every delete rolls back
      // with it: no half-purged state a retry could not cancel jobs for, and no
      // tombstone. The session stays purging, refusing ingest and dispatch.
      if (check.uncovered.length > 0 || check.remaining.length > 0)
        throw new SessionError("purge_incomplete", [
          ...check.uncovered,
          ...check.remaining,
        ]);

      // Only a passing final check sets the tombstone.
      const outcome: "complete" | "partial" = settled ? "complete" : "partial";
      await writeTombstone(client, target, outcome, counts);
      return { kind: "done" as const, outcome, counts };
    },
  );

  if (result.kind === "purged") return { outcome: "already-purged" };
  return { outcome: result.outcome, counts: result.counts };
}

// [SAFETY] The FINAL CHECK. It enumerates, from the Postgres catalog, every
// table that references interview.active_sessions and every table that
// references ai.agent_jobs, and fails if one is not covered by the purge; then
// it counts what the session, its artifacts and its jobs still hold. A passing
// check is the only road to the tombstone.
async function finalCheck(
  client: DatabaseClient,
  target: SessionTarget,
  held: { jobIds: string[]; artifactIds: string[]; payloadRefs: string[] },
): Promise<FinalCheck> {
  const referencing = (parent: string) => referencingTables(client, parent);
  const uncovered = [
    ...(await referencing("interview.active_sessions")).filter(
      (table) => !(SESSION_COVERED_TABLES as readonly string[]).includes(table),
    ),
    ...(await referencing("ai.agent_jobs")).filter(
      (table) => !(JOB_COVERED_TABLES as readonly string[]).includes(table),
    ),
  ];
  const remaining = await remainingAfterPurge(client, target, held);
  return { uncovered, remaining };
}
