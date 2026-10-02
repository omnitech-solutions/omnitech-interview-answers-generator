import { randomUUID } from "node:crypto";
import {
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
} from "../assistant/workspace.js";

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

  // [DOMAIN] The score comes from what was ticked and opened, not the client.
  app.post(prefix, async (context) => {
    const scope = context.get("rehearsalScope");
    const input = rehearsalSessionInputSchema.parse(await context.req.json());
    const checks = [...new Set(input.checks)];
    const reveals = [...new Set(input.reveals)];
    const value = { ...input, checks, reveals };
    const score = rehearsalScore(checks.length, reveals.length);
    const [row] = await workspace.transaction(scope, (tx) =>
      tx.query(
        "INSERT INTO interview.rehearsal_sessions(tenant_id,actor_id,product_id,id,format,score,value,ended_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING *",
        [
          ...ids(scope),
          randomUUID(),
          input.format,
          score,
          JSON.stringify(value),
          input.endedAt,
        ],
      ),
    );
    return context.json(session(row!));
  });
  return app;
}
