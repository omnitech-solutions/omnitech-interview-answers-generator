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
import { sql } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile.js";
import { SESSION_SCREENSHOT_ARTIFACT_TYPE } from "../db/live-session.js";
import { assertUuid, SessionError } from "./errors.js";
import { decodeDraftKey, type WorkspaceDraftKey } from "./mapping.js";
import { inOwnerScope, type OwnerScope, rowsOf } from "./scope.js";
import type { SessionTarget } from "./session-claim.js";
import {
  cancelSessionJobs,
  namedJobs,
  type SessionJobs,
} from "./session-jobs.js";
import { lockSession } from "./session-record.js";
import { transitionLocked } from "./status-transition.js";

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
export const PURGE_JOB_WAIT_MS = 30_000;
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
export const noSessionDraftPurger: SessionDraftPurger = {
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

export type PurgeCounts = {
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
export const SESSION_COVERED_TABLES = [
  "interview.session_actions",
  "interview.session_observations",
] as const;
export const JOB_COVERED_TABLES = [
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
      const rows = await rowsOf<{ status: string }>(
        tx,
        sql`SELECT status FROM ai.agent_jobs
            WHERE tenant_id = ${scope.tenantId}::uuid
              AND id IN (${sql.join(
                ids.map((id) => sql`${id}::uuid`),
                sql`, `,
              )})`,
      );
      return rows.filter((row) => !TERMINAL_JOB.includes(row.status)).length;
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
      const { tenantId, ownerUserId, sessionId } = target;
      const own = [tenantId, ownerUserId, sessionId];
      // The session row lock comes first, as in job creation, so no private job
      // is created or named after the purge reads the actions.
      const locked = await client.query<{
        status: string;
        workspace_draft_id: string | null;
        purged_at: Date | null;
      }>(
        `SELECT status, workspace_draft_id, purged_at FROM interview.active_sessions
       WHERE tenant_id = $1 AND owner_user_id = $2 AND id = $3 FOR UPDATE`,
        own,
      );
      const session = locked.rows[0];
      if (!session) throw new SessionError("not_found");
      if (session.purged_at !== null) return { kind: "purged" as const };
      if (session.status !== "purging")
        throw new SessionError("status_refused");

      const named = await client.query<{ job_id: string }>(
        `SELECT DISTINCT job_id FROM interview.session_actions
       WHERE tenant_id = $1 AND owner_user_id = $2 AND session_id = $3
         AND job_id IS NOT NULL`,
        own,
      );
      const jobIds = named.rows.map((row) => row.job_id);

      // Observations first, then the artifacts they linked.
      const observations = await client.query<{
        screenshot_artifact_id: string | null;
      }>(
        `DELETE FROM interview.session_observations
       WHERE tenant_id = $1 AND owner_user_id = $2 AND session_id = $3
       RETURNING screenshot_artifact_id`,
        own,
      );
      const artifactRows = await client.query<{ id: string }>(
        `SELECT id FROM platform.artifacts
       WHERE tenant_id = $1 AND owner_user_id = $2 AND product_id = $4
         AND artifact_type = $5 AND metadata->>'session_id' = $3::text`,
        [
          tenantId,
          ownerUserId,
          sessionId,
          INTERVIEW_PRODUCT_ID,
          SESSION_SCREENSHOT_ARTIFACT_TYPE,
        ],
      );
      const artifactIds = artifactRows.rows.map((row) => row.id);
      if (artifactIds.length > 0) {
        await client.query(
          `DELETE FROM platform.artifact_payloads
         WHERE tenant_id = $1 AND artifact_id = ANY($2::uuid[])`,
          [tenantId, artifactIds],
        );
        await client.query(
          `DELETE FROM platform.artifacts
         WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [tenantId, artifactIds],
        );
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
      await client.query(
        `UPDATE interview.active_sessions SET shown_draft_count = GREATEST(
         shown_draft_count,
         (SELECT count(*) FROM interview.session_actions a
          WHERE a.tenant_id = $1 AND a.owner_user_id = $2 AND a.session_id = $3 AND a.shown))
       WHERE tenant_id = $1 AND owner_user_id = $2 AND id = $3`,
        own,
      );
      const actions = await client.query(
        `DELETE FROM interview.session_actions
       WHERE tenant_id = $1 AND owner_user_id = $2 AND session_id = $3`,
        own,
      );

      // The session's jobs: collect every payload reference in this transaction,
      // then delete the job rows (events and artifacts cascade) and the payloads.
      let jobEvents = 0;
      let jobArtifacts = 0;
      let jobRows = 0;
      let payloads = 0;
      let agentSessions = 0;
      const payloadRefs = new Set<string>();
      if (jobIds.length > 0) {
        const events = await client.query<{ n: string }>(
          `SELECT count(*) AS n FROM ai.agent_job_events
         WHERE tenant_id = $1 AND job_id = ANY($2::uuid[])`,
          [tenantId, jobIds],
        );
        jobEvents = Number(events.rows[0]?.n ?? 0);
        const refs = payloadRefs;
        const artifactRefs = await client.query<{ artifact_reference: string }>(
          `SELECT artifact_reference FROM ai.agent_artifacts
         WHERE tenant_id = $1 AND job_id = ANY($2::uuid[])`,
          [tenantId, jobIds],
        );
        jobArtifacts = artifactRefs.rows.length;
        for (const row of artifactRefs.rows) refs.add(row.artifact_reference);
        const deleted = await client.query<{
          prompt_reference: string | null;
          result_reference: string | null;
          session_id: string | null;
        }>(
          `DELETE FROM ai.agent_jobs
         WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND private
         RETURNING prompt_reference, result_reference, session_id`,
          [tenantId, jobIds],
        );
        jobRows = deleted.rows.length;
        const runtimeSessions: string[] = [];
        for (const row of deleted.rows) {
          if (row.prompt_reference) refs.add(row.prompt_reference);
          if (row.result_reference) refs.add(row.result_reference);
          if (row.session_id) runtimeSessions.push(row.session_id);
        }
        if (refs.size > 0) {
          const removed = await client.query(
            `DELETE FROM ai.agent_job_payloads
           WHERE tenant_id = $1 AND reference = ANY($2::text[])`,
            [tenantId, [...refs]],
          );
          payloads = removed.rowCount ?? 0;
        }
        if (runtimeSessions.length > 0) {
          const removed = await client.query(
            `DELETE FROM ai.agent_sessions
           WHERE tenant_id = $1 AND runtime_session_id = ANY($2::text[])`,
            [tenantId, runtimeSessions],
          );
          agentSessions = removed.rowCount ?? 0;
        }
      }

      // Links, snapshot and credential are cleared (and only cleared) while the
      // session is purging.
      await client.query(
        `UPDATE interview.active_sessions SET
         interview_id = NULL, candidacy_id = NULL, profile_id = NULL,
         profile_revision = NULL, workspace_draft_id = NULL, sources = NULL,
         credential_hash = NULL, credential_expires_at = NULL,
         lease_holder_id = NULL, lease_expires_at = NULL
       WHERE tenant_id = $1 AND owner_user_id = $2 AND id = $3`,
        own,
      );

      const counts: PurgeCounts = {
        observations: observations.rowCount ?? 0,
        screenshotArtifacts: artifactIds.length,
        actions: actions.rowCount ?? 0,
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
      await client.query(
        `UPDATE interview.active_sessions SET
         status = 'ended', ended_at = COALESCE(ended_at, now()),
         purged_at = now(), purge_outcome = $4, purge_counts = $5::jsonb
       WHERE tenant_id = $1 AND owner_user_id = $2 AND id = $3`,
        [...own, outcome, JSON.stringify(counts)],
      );
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
  const { jobIds, artifactIds, payloadRefs } = held;
  const { tenantId, ownerUserId, sessionId } = target;
  const referencing = async (parent: string) =>
    (
      await client.query<{ child: string }>(
        `SELECT DISTINCT n.nspname || '.' || c.relname AS child
         FROM pg_constraint k
         JOIN pg_class c ON c.oid = k.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE k.contype = 'f' AND k.confrelid = $1::regclass`,
        [parent],
      )
    ).rows.map((row) => row.child);
  const uncovered = [
    ...(await referencing("interview.active_sessions")).filter(
      (table) => !(SESSION_COVERED_TABLES as readonly string[]).includes(table),
    ),
    ...(await referencing("ai.agent_jobs")).filter(
      (table) => !(JOB_COVERED_TABLES as readonly string[]).includes(table),
    ),
  ];
  const remaining: string[] = [];
  const count = async (label: string, text: string, values: unknown[]) => {
    const result = await client.query<{ n: string }>(text, values);
    if (Number(result.rows[0]?.n ?? 0) > 0) remaining.push(label);
  };
  const own = [tenantId, ownerUserId, sessionId];
  await count(
    "interview.session_observations",
    `SELECT count(*) AS n FROM interview.session_observations
     WHERE tenant_id = $1 AND owner_user_id = $2 AND session_id = $3`,
    own,
  );
  await count(
    "interview.session_actions",
    `SELECT count(*) AS n FROM interview.session_actions
     WHERE tenant_id = $1 AND owner_user_id = $2 AND session_id = $3`,
    own,
  );
  await count(
    "platform.artifacts",
    `SELECT count(*) AS n FROM platform.artifacts
     WHERE tenant_id = $1 AND owner_user_id = $2 AND artifact_type = $4
       AND metadata->>'session_id' = $3::text`,
    [tenantId, ownerUserId, sessionId, SESSION_SCREENSHOT_ARTIFACT_TYPE],
  );
  if (artifactIds.length > 0)
    await count(
      "platform.artifact_payloads",
      `SELECT count(*) AS n FROM platform.artifact_payloads
       WHERE tenant_id = $1 AND artifact_id = ANY($2::uuid[])`,
      [tenantId, artifactIds],
    );
  if (jobIds.length > 0) {
    const jobScope = [tenantId, jobIds];
    await count(
      "ai.agent_jobs",
      "SELECT count(*) AS n FROM ai.agent_jobs WHERE tenant_id = $1 AND id = ANY($2::uuid[])",
      jobScope,
    );
    await count(
      "ai.agent_job_events",
      "SELECT count(*) AS n FROM ai.agent_job_events WHERE tenant_id = $1 AND job_id = ANY($2::uuid[])",
      jobScope,
    );
    await count(
      "ai.agent_artifacts",
      "SELECT count(*) AS n FROM ai.agent_artifacts WHERE tenant_id = $1 AND job_id = ANY($2::uuid[])",
      jobScope,
    );
  }
  if (payloadRefs.length > 0)
    await count(
      "ai.agent_job_payloads",
      "SELECT count(*) AS n FROM ai.agent_job_payloads WHERE tenant_id = $1 AND reference = ANY($2::text[])",
      [tenantId, payloadRefs],
    );
  await count(
    "interview.active_sessions",
    `SELECT count(*) AS n FROM interview.active_sessions
     WHERE tenant_id = $1 AND owner_user_id = $2 AND id = $3
       AND (credential_hash IS NOT NULL OR sources IS NOT NULL
            OR interview_id IS NOT NULL OR candidacy_id IS NOT NULL
            OR profile_id IS NOT NULL OR workspace_draft_id IS NOT NULL)`,
    own,
  );
  return { uncovered, remaining };
}
