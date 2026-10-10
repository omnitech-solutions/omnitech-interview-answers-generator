import {
  type PlanItemStatus,
  rehearsalSessionInputSchema,
} from "@omnitech/interview-contracts";
import { Hono } from "hono";
import { ZodError } from "zod";
import {
  InterviewWorkspaceRepository,
  type WorkspaceDatabasePort,
  type WorkspaceScope,
} from "../assistant/workspace";
import {
  latestRehearsalStatus,
  listRehearsals,
  saveRehearsal,
} from "./services/rehearsal.service";

const prefix = "/api/interview/rehearsals";

// The latest rehearsal, as Home's plan reports it.
export function rehearsalStatus(database: WorkspaceDatabasePort) {
  const workspace = new InterviewWorkspaceRepository(database);
  return (scope: WorkspaceScope): Promise<PlanItemStatus> =>
    latestRehearsalStatus(workspace, scope);
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

  app.get(prefix, async (context) =>
    context.json({
      sessions: await listRehearsals(workspace, context.get("rehearsalScope")),
    }),
  );

  app.post(prefix, async (context) => {
    const input = rehearsalSessionInputSchema.parse(await context.req.json());
    const saved = await saveRehearsal(
      workspace,
      context.get("rehearsalScope"),
      input,
    );
    if ("refused" in saved)
      return context.json({ error: { code: saved.refused } }, 409);
    return context.json(saved.session);
  });
  return app;
}
