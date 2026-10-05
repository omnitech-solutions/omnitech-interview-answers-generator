// What a session leaves in the database, counted (never read): used to prove a
// purge removed everything the UI said it would, and that a retention mode that
// keeps data keeps all of it. Read-only SQL as the disposable database's owner,
// like helpers/sql.ts; it selects counts and ids, never content columns.
import { createPlatformDatabase } from "@omnitech/database";
import { stackConfig } from "../stack/config";

let handle: ReturnType<typeof createPlatformDatabase> | undefined;
const database = () => {
  handle ??= createPlatformDatabase(stackConfig().ownerUrl, {
    allowRlsBypass: true,
  });
  return handle;
};

const count = async (sql: string, values: unknown[]): Promise<number> =>
  Number((await database().query<{ n: string }>(sql, values)).rows[0]?.n ?? 0);

export type Footprint = {
  observations: number;
  actions: number;
  jobs: number;
  // The screenshot artifacts the session's observations point at, and how many
  // of them (and their payload rows) still exist.
  artifactIds: string[];
  artifacts: number;
  payloads: number;
};

export async function footprint(
  sessionId: string,
  knownArtifactIds?: string[],
): Promise<Footprint> {
  const artifactIds =
    knownArtifactIds ??
    (
      await database().query<{ id: string }>(
        `SELECT screenshot_artifact_id::text AS id
           FROM interview.session_observations
          WHERE session_id = $1 AND screenshot_artifact_id IS NOT NULL`,
        [sessionId],
      )
    ).rows.map((row) => row.id);
  return {
    observations: await count(
      "SELECT count(*) AS n FROM interview.session_observations WHERE session_id = $1",
      [sessionId],
    ),
    actions: await count(
      "SELECT count(*) AS n FROM interview.session_actions WHERE session_id = $1",
      [sessionId],
    ),
    jobs: await count(
      "SELECT count(*) AS n FROM ai.agent_jobs WHERE session_id = $1",
      [sessionId],
    ),
    artifactIds,
    artifacts: await count(
      "SELECT count(*) AS n FROM platform.artifacts WHERE id = ANY($1::uuid[])",
      [artifactIds],
    ),
    payloads: await count(
      "SELECT count(*) AS n FROM platform.artifact_payloads WHERE artifact_id = ANY($1::uuid[])",
      [artifactIds],
    ),
  };
}
