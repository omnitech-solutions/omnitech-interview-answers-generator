// SQL against the disposable database, as its owner. Reads are the whole point
// (proving a UI claim by the row the server holds), so the owner URL is used
// for SELECT; the single exception is `moveClock` (see it; it checks the role). It selects ids, statuses,
// counts and timestamps; never content columns (`content`, `result`, `ack`),
// so a failing spec cannot print what a person said or what the model wrote.
import { createPlatformDatabase } from "@omnitech/database";
import { stackConfig } from "../stack/config";

let handle: ReturnType<typeof createPlatformDatabase> | undefined;

function database() {
  // The owner bypasses row-level security by design: a test reads across the
  // whole disposable database. The app itself never runs as this role.
  handle ??= createPlatformDatabase(stackConfig().ownerUrl, {
    allowRlsBypass: true,
  });
  return handle;
}

export type SessionRow = {
  id: string;
  status: string;
  retention_mode: string;
  processing_policy: string;
  rehearsal_run_id: string | null;
  strict: boolean;
  shown_draft_count: number;
  fence: number;
  credential_revoked_at: string | null;
  credential_expires_at: string | null;
  ended_at: string | null;
  purged_at: string | null;
  purge_outcome: string | null;
  sources: unknown;
  expires_at: string;
  processed_through: number | null;
  last_heartbeat_at: string | null;
};

export type ActionRow = {
  id: string;
  task_id: string;
  task_revision: number;
  action_kind: string;
  dispatch_status: string;
  attempt: number;
  suppression_reason: string | null;
  shown: boolean;
  source_event_ids: string[] | null;
  job_created: boolean;
};

export type ObservationRow = {
  source_id: string;
  event_id: string;
  sequence: number;
  kind: string;
  screenshot_artifact_id: string | null;
};

export type JobRow = {
  id: string;
  status: string;
  session_id: string | null;
};

const rows = async <T>(sql: string, values: unknown[] = []): Promise<T[]> =>
  (await database().query<T & Record<string, unknown>>(sql, values)).rows;

export const db = {
  async sessions(): Promise<SessionRow[]> {
    return rows<SessionRow>(
      `SELECT id, status, retention_mode, processing_policy, rehearsal_run_id,
              strict, shown_draft_count, fence::int AS fence,
              credential_revoked_at::text, credential_expires_at::text,
              ended_at::text, purged_at::text, purge_outcome, sources,
              expires_at::text, processed_through::int AS processed_through,
              last_heartbeat_at::text
         FROM interview.active_sessions ORDER BY created_at`,
    );
  },
  async session(id: string): Promise<SessionRow | undefined> {
    return (
      await rows<SessionRow>(
        `SELECT id, status, retention_mode, processing_policy, rehearsal_run_id,
                strict, shown_draft_count, fence::int AS fence,
                credential_revoked_at::text, credential_expires_at::text,
                ended_at::text, purged_at::text, purge_outcome, sources,
              expires_at::text, processed_through::int AS processed_through,
              last_heartbeat_at::text
           FROM interview.active_sessions WHERE id = $1`,
        [id],
      )
    )[0];
  },
  async actions(sessionId: string): Promise<ActionRow[]> {
    return rows<ActionRow>(
      `SELECT id, task_id, task_revision, action_kind, dispatch_status, attempt,
              suppression_reason, shown, source_event_ids, job_created
         FROM interview.session_actions WHERE session_id = $1
        ORDER BY created_at, task_revision`,
      [sessionId],
    );
  },
  // The CLOSED category word of each draft-answer result ("other", "coding",
  // "no-question" ...), oldest first, and nothing else of the result: the one
  // way to prove "this capture was a no-question result" from the server. The
  // draft and every claim stay unread.
  async actionCategories(sessionId: string): Promise<Array<string | null>> {
    return (
      await rows<{ category: string | null }>(
        `SELECT result->>'category' AS category
           FROM interview.session_actions
          WHERE session_id = $1 AND action_kind = 'draft-answer'
          ORDER BY created_at, task_revision`,
        [sessionId],
      )
    ).map((row) => row.category);
  },
  async observations(sessionId: string): Promise<ObservationRow[]> {
    return rows<ObservationRow>(
      `SELECT source_id, event_id, sequence::int AS sequence, kind,
              screenshot_artifact_id
         FROM interview.session_observations WHERE session_id = $1
        ORDER BY sequence`,
      [sessionId],
    );
  },
  async jobs(sessionId: string): Promise<JobRow[]> {
    return rows<JobRow>(
      `SELECT id, status, session_id FROM ai.agent_jobs
        WHERE session_id = $1 ORDER BY created_at`,
      [sessionId],
    );
  },
  // The session's "Screenshots to the model" setting (D35): one closed word
  // (`always`, `text-only-when-text`, `never`), never content.
  async screenshotSend(id: string): Promise<string | undefined> {
    return (
      await rows<{ screenshot_send: string }>(
        `SELECT screenshot_send FROM interview.active_sessions WHERE id = $1`,
        [id],
      )
    )[0]?.screenshot_send;
  },
  // The candidacy a session was started for (null for a rehearsal).
  async sessionCandidacy(id: string): Promise<string | null | undefined> {
    return (
      await rows<{ candidacy_id: string | null }>(
        `SELECT candidacy_id::text FROM interview.active_sessions WHERE id = $1`,
        [id],
      )
    )[0]?.candidacy_id;
  },
  // The most recently started session, for specs that drive the UI and then
  // look for the row it created.
  async latestSession(): Promise<SessionRow | undefined> {
    return (
      await rows<SessionRow>(
        `SELECT id, status, retention_mode, processing_policy, rehearsal_run_id,
                strict, shown_draft_count, fence::int AS fence,
                credential_revoked_at::text, credential_expires_at::text,
                ended_at::text, purged_at::text, purge_outcome, sources,
              expires_at::text, processed_through::int AS processed_through,
              last_heartbeat_at::text
           FROM interview.active_sessions ORDER BY created_at DESC LIMIT 1`,
      )
    )[0];
  },
  // Column names of the session table: proves a claim such as "Studio does not
  // store the consent answer" against the schema itself.
  async sessionColumns(): Promise<string[]> {
    return (
      await rows<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'interview' AND table_name = 'active_sessions'`,
      )
    ).map((row) => row.column_name);
  },
  // The ONE write the suite makes: moves a session's clock by editing the two
  // server timestamps that time alone would change (the duration cap and the
  // credential's expiry), so a spec can see the banners that need minutes or
  // hours to pass. It never touches content, status or ownership.
  async moveClock(
    sessionId: string,
    to: { expiresInMs?: number; credentialExpiresInMs?: number },
  ): Promise<void> {
    if (to.expiresInMs !== undefined)
      // The cap is an immutable creation field (a trigger refuses edits), and
      // the start route cannot ask for a short one. In this disposable
      // database only, the trigger is switched off for this one statement, and the credential (which
      // may not outlive the cap) is pulled in with it.
      await database().transaction(async (client) => {
        // Triggers go off only for the disposable database's own owner.
        const who = await client.query<{ user: string }>(
          "SELECT current_user AS user",
        );
        if (who.rows[0]?.user !== "fixture_owner")
          throw new Error(
            "moveClock runs only as the disposable fixture_owner role",
          );
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query(
          `UPDATE interview.active_sessions
              SET expires_at = now() + ($2 || ' milliseconds')::interval,
                  credential_expires_at = LEAST(
                    credential_expires_at,
                    now() + ($2 || ' milliseconds')::interval)
            WHERE id = $1`,
          [sessionId, String(to.expiresInMs)],
        );
      });
    if (to.credentialExpiresInMs !== undefined)
      await rows(
        `UPDATE interview.active_sessions
            SET credential_expires_at = now() + ($2 || ' milliseconds')::interval
          WHERE id = $1`,
        [sessionId, String(to.credentialExpiresInMs)],
      );
  },
  async close(): Promise<void> {
    await handle?.close();
    handle = undefined;
  },
};
