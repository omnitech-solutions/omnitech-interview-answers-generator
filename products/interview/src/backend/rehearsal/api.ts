import { randomUUID } from "node:crypto";
import {
  MAX_SESSION_HINTS,
  type PlanItemStatus,
  type RehearsalSession,
  rehearsalScore,
  rehearsalSessionInputSchema,
} from "@omnitech/interview-contracts";
import { Hono } from "hono";
import { ZodError } from "zod";
import {
  InterviewWorkspaceRepository,
  type WorkspaceDatabasePort,
  type WorkspaceScope,
  type WorkspaceTransaction,
} from "../assistant/workspace";

const prefix = "/api/interview/rehearsals";
const scoped = "tenant_id=$1 AND actor_id=$2 AND product_id=$3";
const ids = (scope: WorkspaceScope) => [
  scope.tenantId,
  scope.actorId,
  scope.productId,
];

function session(row: Record<string, unknown>): RehearsalSession {
  return {
    ...(row["value"] as Omit<RehearsalSession, "id" | "score">),
    id: String(row["id"]),
    score: Number(row["score"]),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SessionHints =
  | { refused: "rehearsal-strictness-mismatch" | "rehearsal-run-already-saved" }
  | { hints: number };

// [SAFETY] [DOMAIN] The hint count is derived here, never taken from the
// client (rule:assistance-counts-as-hints, rule:no-second-scorecard). It reads
// only this member's own Active Session rows for the run id, tombstones
// included because a purge keeps the count (rule:tombstone-keeps-hint-count);
// row security pins tenant and actor, and the query repeats both. A run id
// derives ONCE: a later save for the same run id is refused, decided under a
// per-run advisory lock so two racing saves cannot both count. A strictness
// claim that disagrees with the matching session is refused; when no session
// matches, nothing is counted and nothing is refused.
async function deriveSessionHints(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  rehearsalRunId: string,
  strict: boolean,
): Promise<SessionHints> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `rehearsal-run:${scope.tenantId}:${scope.actorId}:${rehearsalRunId}`,
  ]);
  const [saved] = await tx.query(
    `SELECT 1 AS saved FROM interview.rehearsal_sessions WHERE ${scoped} AND value->>'rehearsalRunId' = $4 LIMIT 1`,
    [...ids(scope), rehearsalRunId],
  );
  if (saved) return { refused: "rehearsal-run-already-saved" };
  // Session rows key tenant and owner by uuid; any other scope has none.
  if (!UUID.test(scope.tenantId) || !UUID.test(scope.actorId))
    return { hints: 0 };
  const sessions = await tx.query(
    `SELECT strict, shown_draft_count FROM interview.active_sessions
     WHERE tenant_id = $1::uuid AND owner_user_id = $2::uuid AND rehearsal_run_id = $3`,
    [scope.tenantId, scope.actorId, rehearsalRunId],
  );
  if (sessions.some((row) => Boolean(row["strict"]) !== strict))
    return { refused: "rehearsal-strictness-mismatch" };
  const shown = sessions
    .filter((row) => !row["strict"])
    .reduce((sum, row) => sum + Number(row["shown_draft_count"]), 0);
  return { hints: Math.min(MAX_SESSION_HINTS, Math.max(0, shown)) };
}

// The latest rehearsal, as Home's plan reports it.
export function rehearsalStatus(database: WorkspaceDatabasePort) {
  const workspace = new InterviewWorkspaceRepository(database);
  return async (scope: WorkspaceScope): Promise<PlanItemStatus> => {
    const [row] = await workspace.transaction(scope, (tx) =>
      tx.query(
        `SELECT score FROM interview.rehearsal_sessions WHERE ${scoped} ORDER BY ended_at DESC LIMIT 1`,
        ids(scope),
      ),
    );
    if (!row) return { label: "Not rehearsed yet", tone: "neutral" };
    const score = Number(row["score"]);
    return {
      label: `Last score ${score}`,
      tone: score >= 75 ? "good" : "warn",
    };
  };
}

// Finished rehearsals: saved once, listed newest first.
export function createRehearsalApi(options: {
  database: WorkspaceDatabasePort;
  resolveScope: (request: Request) => Promise<WorkspaceScope | null>;
  allowedOrigins?: readonly string[];
}) {
  const app = new Hono<{ Variables: { rehearsalScope: WorkspaceScope } }>();
  const workspace = new InterviewWorkspaceRepository(options.database);

  app.use(`${prefix}/*`, async (context, next) => {
    const scope = await options.resolveScope(context.req.raw);
    if (!scope) return context.json({ error: { code: "unauthorized" } }, 401);
    // [SAFETY] Writes come from this host's pages only, never another site.
    if (!["GET", "HEAD"].includes(context.req.method)) {
      const origin = context.req.header("origin");
      const host = context.req.header("host");
      const own = host
        ? new URL(`${new URL(context.req.url).protocol}//${host}`).origin
        : new URL(context.req.url).origin;
      if (
        context.req.header("sec-fetch-site") === "cross-site" ||
        (origin && origin !== own && !options.allowedOrigins?.includes(origin))
      )
        return context.json({ error: { code: "origin-forbidden" } }, 403);
    }
    context.set("rehearsalScope", scope);
    await next();
  });
  app.onError((error, context) => {
    if (error instanceof ZodError || error instanceof SyntaxError)
      return context.json({ error: { code: "invalid-request" } }, 400);
    throw error;
  });

  app.get(prefix, async (context) => {
    const scope = context.get("rehearsalScope");
    const rows = await workspace.transaction(scope, (tx) =>
      tx.query(
        `SELECT * FROM interview.rehearsal_sessions WHERE ${scoped} ORDER BY ended_at DESC LIMIT 20`,
        ids(scope),
      ),
    );
    return context.json({ sessions: rows.map(session) });
  });

  // [DOMAIN] The score comes from what was ticked and opened, not the client;
  // session hints (derived on the server) cost like extra reveals but are not
  // stored as reveals.
  app.post(prefix, async (context) => {
    const scope = context.get("rehearsalScope");
    const input = rehearsalSessionInputSchema.parse(await context.req.json());
    const checks = [...new Set(input.checks)];
    const reveals = [...new Set(input.reveals)];
    const saved = await workspace.transaction(scope, async (tx) => {
      const derived =
        input.rehearsalRunId === undefined
          ? undefined
          : await deriveSessionHints(
              tx,
              scope,
              input.rehearsalRunId,
              input.strict,
            );
      if (derived && "refused" in derived) return derived;
      const hints = derived?.hints;
      const value = {
        ...input,
        checks,
        reveals,
        ...(hints === undefined ? {} : { sessionHints: hints }),
      };
      const score = rehearsalScore(
        checks.length,
        reveals.length + (hints ?? 0),
      );
      const [row] = await tx.query(
        "INSERT INTO interview.rehearsal_sessions(tenant_id,actor_id,product_id,id,format,score,value,ended_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING *",
        [
          ...ids(scope),
          randomUUID(),
          input.format,
          score,
          JSON.stringify(value),
          input.endedAt,
        ],
      );
      return { row: row! };
    });
    if ("refused" in saved)
      return context.json({ error: { code: saved.refused } }, 409);
    return context.json(session(saved.row));
  });
  return app;
}
