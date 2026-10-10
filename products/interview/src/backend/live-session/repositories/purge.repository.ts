// Every statement of the Active Session purge. Raw parameterised SQL moved
// verbatim from session-purge.ts: delete chains with RETURNING, catalog reads
// and the tombstone are PostgreSQL-specific and safety-critical (the purge
// deletes user data), so none is rewritten in the builder. The caller owns the
// transaction and the app.session_purge setting; these functions make no
// decision, throw nothing and log nothing.
import type { DatabaseClient, TenantDatabase } from "@omnitech/database";
import { sql } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../../assistant-profile";
import { SESSION_SCREENSHOT_ARTIFACT_TYPE } from "../../db/live-session";
import { type OwnerScope, rowsOf } from "../scope";

type Target = { tenantId: string; ownerUserId: string; sessionId: string };
const ownOf = (t: Target) => [t.tenantId, t.ownerUserId, t.sessionId];

// Statuses of the named jobs, read in the owner scope (raw: IN-list of casts).
export async function jobStatuses(
  tx: TenantDatabase,
  scope: OwnerScope,
  ids: string[],
): Promise<string[]> {
  const rows = await rowsOf<{ status: string }>(
    tx,
    sql`SELECT status FROM ai.agent_jobs
            WHERE tenant_id = ${scope.tenantId}::uuid
              AND id IN (${sql.join(
                ids.map((id) => sql`${id}::uuid`),
                sql`, `,
              )})`,
  );
  return rows.map((row) => row.status);
}

export type LockedPurgeSession = {
  status: string;
  workspace_draft_id: string | null;
  purged_at: Date | null;
};

// The session row lock comes first, as in job creation.
export async function lockSessionForPurge(
  client: DatabaseClient,
  target: Target,
): Promise<LockedPurgeSession | undefined> {
  const locked = await client.query<LockedPurgeSession>(
    `SELECT status, workspace_draft_id, purged_at FROM interview.active_sessions
       WHERE tenant_id = $1 AND owner_user_id = $2 AND id = $3 FOR UPDATE`,
    ownOf(target),
  );
  return locked.rows[0];
}

export async function namedJobIds(
  client: DatabaseClient,
  target: Target,
): Promise<string[]> {
  const named = await client.query<{ job_id: string }>(
    `SELECT DISTINCT job_id FROM interview.session_actions
       WHERE tenant_id = $1 AND owner_user_id = $2 AND session_id = $3
         AND job_id IS NOT NULL`,
    ownOf(target),
  );
  return named.rows.map((row) => row.job_id);
}

// Returns the number of deleted observations.
export async function deleteObservations(
  client: DatabaseClient,
  target: Target,
): Promise<number> {
  const observations = await client.query<{
    screenshot_artifact_id: string | null;
  }>(
    `DELETE FROM interview.session_observations
       WHERE tenant_id = $1 AND owner_user_id = $2 AND session_id = $3
       RETURNING screenshot_artifact_id`,
    ownOf(target),
  );
  return observations.rowCount ?? 0;
}

export async function screenshotArtifactIds(
  client: DatabaseClient,
  target: Target,
): Promise<string[]> {
  const artifactRows = await client.query<{ id: string }>(
    `SELECT id FROM platform.artifacts
       WHERE tenant_id = $1 AND owner_user_id = $2 AND product_id = $4
         AND artifact_type = $5 AND metadata->>'session_id' = $3::text`,
    [
      target.tenantId,
      target.ownerUserId,
      target.sessionId,
      INTERVIEW_PRODUCT_ID,
      SESSION_SCREENSHOT_ARTIFACT_TYPE,
    ],
  );
  return artifactRows.rows.map((row) => row.id);
}

export async function deleteArtifactPayloads(
  client: DatabaseClient,
  tenantId: string,
  artifactIds: string[],
): Promise<void> {
  await client.query(
    `DELETE FROM platform.artifact_payloads
         WHERE tenant_id = $1 AND artifact_id = ANY($2::uuid[])`,
    [tenantId, artifactIds],
  );
}

export async function deleteArtifacts(
  client: DatabaseClient,
  tenantId: string,
  artifactIds: string[],
): Promise<void> {
  await client.query(
    `DELETE FROM platform.artifacts
         WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, artifactIds],
  );
}

// The hint count is finalised before the actions are deleted.
export async function finaliseShownDraftCount(
  client: DatabaseClient,
  target: Target,
): Promise<void> {
  await client.query(
    `UPDATE interview.active_sessions SET shown_draft_count = GREATEST(
         shown_draft_count,
         (SELECT count(*) FROM interview.session_actions a
          WHERE a.tenant_id = $1 AND a.owner_user_id = $2 AND a.session_id = $3 AND a.shown))
       WHERE tenant_id = $1 AND owner_user_id = $2 AND id = $3`,
    ownOf(target),
  );
}

// Returns the number of deleted actions.
export async function deleteActions(
  client: DatabaseClient,
  target: Target,
): Promise<number> {
  const actions = await client.query(
    `DELETE FROM interview.session_actions
       WHERE tenant_id = $1 AND owner_user_id = $2 AND session_id = $3`,
    ownOf(target),
  );
  return actions.rowCount ?? 0;
}

export async function countJobEvents(
  client: DatabaseClient,
  tenantId: string,
  jobIds: string[],
): Promise<number> {
  const events = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM ai.agent_job_events
         WHERE tenant_id = $1 AND job_id = ANY($2::uuid[])`,
    [tenantId, jobIds],
  );
  return Number(events.rows[0]?.n ?? 0);
}

export async function jobArtifactReferences(
  client: DatabaseClient,
  tenantId: string,
  jobIds: string[],
): Promise<string[]> {
  const artifactRefs = await client.query<{ artifact_reference: string }>(
    `SELECT artifact_reference FROM ai.agent_artifacts
         WHERE tenant_id = $1 AND job_id = ANY($2::uuid[])`,
    [tenantId, jobIds],
  );
  return artifactRefs.rows.map((row) => row.artifact_reference);
}

export type DeletedJob = {
  prompt_reference: string | null;
  result_reference: string | null;
  session_id: string | null;
};

export async function deletePrivateJobs(
  client: DatabaseClient,
  tenantId: string,
  jobIds: string[],
): Promise<DeletedJob[]> {
  const deleted = await client.query<DeletedJob>(
    `DELETE FROM ai.agent_jobs
         WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND private
         RETURNING prompt_reference, result_reference, session_id`,
    [tenantId, jobIds],
  );
  return deleted.rows;
}

export async function deleteJobPayloads(
  client: DatabaseClient,
  tenantId: string,
  references: string[],
): Promise<number> {
  const removed = await client.query(
    `DELETE FROM ai.agent_job_payloads
           WHERE tenant_id = $1 AND reference = ANY($2::text[])`,
    [tenantId, references],
  );
  return removed.rowCount ?? 0;
}

export async function deleteAgentSessions(
  client: DatabaseClient,
  tenantId: string,
  runtimeSessionIds: string[],
): Promise<number> {
  const removed = await client.query(
    `DELETE FROM ai.agent_sessions
           WHERE tenant_id = $1 AND runtime_session_id = ANY($2::text[])`,
    [tenantId, runtimeSessionIds],
  );
  return removed.rowCount ?? 0;
}

// Links, snapshot and credential are cleared (and only cleared) while the
// session is purging.
export async function clearSessionLinks(
  client: DatabaseClient,
  target: Target,
): Promise<void> {
  await client.query(
    `UPDATE interview.active_sessions SET
         interview_id = NULL, candidacy_id = NULL, profile_id = NULL,
         profile_revision = NULL, workspace_draft_id = NULL, sources = NULL,
         credential_hash = NULL, credential_expires_at = NULL,
         lease_holder_id = NULL, lease_expires_at = NULL,
         capture_request = NULL
       WHERE tenant_id = $1 AND owner_user_id = $2 AND id = $3`,
    ownOf(target),
  );
}

// Only a passing final check sets the tombstone.
export async function writeTombstone(
  client: DatabaseClient,
  target: Target,
  outcome: "complete" | "partial",
  counts: unknown,
): Promise<void> {
  await client.query(
    `UPDATE interview.active_sessions SET
         status = 'ended', ended_at = COALESCE(ended_at, now()),
         purged_at = now(), purge_outcome = $4, purge_counts = $5::jsonb
       WHERE tenant_id = $1 AND owner_user_id = $2 AND id = $3`,
    [...ownOf(target), outcome, JSON.stringify(counts)],
  );
}

// The tables whose foreign keys reference `parent`, from the Postgres catalog.
export async function referencingTables(
  client: DatabaseClient,
  parent: string,
): Promise<string[]> {
  return (
    await client.query<{ child: string }>(
      `SELECT DISTINCT n.nspname || '.' || c.relname AS child
         FROM pg_constraint k
         JOIN pg_class c ON c.oid = k.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE k.contype = 'f' AND k.confrelid = $1::regclass`,
      [parent],
    )
  ).rows.map((row) => row.child);
}

// What the session, its artifacts and its jobs still hold after the deletes:
// the labels of every table that still has a row (empty when the purge is whole).
export async function remainingAfterPurge(
  client: DatabaseClient,
  target: Target,
  held: { jobIds: string[]; artifactIds: string[]; payloadRefs: string[] },
): Promise<string[]> {
  const { jobIds, artifactIds, payloadRefs } = held;
  const { tenantId, ownerUserId, sessionId } = target;
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
  // The pending capture request lives on the session row and must be cleared.
  await count(
    "interview.active_sessions.capture_request",
    `SELECT count(*) AS n FROM interview.active_sessions
     WHERE tenant_id = $1 AND owner_user_id = $2 AND id = $3
       AND capture_request IS NOT NULL`,
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
  return remaining;
}
