import {
  briefingApplySchema,
  briefingAskSchema,
  briefingCondenseSchema,
  briefingPrepareSchema,
  briefingProfileImportSchema,
  briefingProposalRequestSchema,
  briefingPutSchema,
  briefingSaveSchema,
} from "@omnitech/interview-contracts";
import { Hono } from "hono";
import { z } from "zod";
import { WorkspaceError, type WorkspaceScope } from "../assistant/workspace";
import type { BriefingDependencies } from "./contracts";
import {
  applyProposal,
  putArtifact,
  readArtifact,
  saveArtifact,
} from "./services/artifacts.service";
import {
  condenseArtifact,
  prepareArtifact,
} from "./services/preparation.service";
import * as profiles from "./services/profiles.service";
import { listArtifacts } from "./services/proposals.service";
import { askQuestion, proposeAnswers } from "./services/questions.service";

const prefix = "/api/interview/briefing";
// WorkspaceError currently carries 400 for these briefing-specific failures.
// Retain their existing responses until the shared error metadata includes them.
const briefingFailureStatuses = new Map<string, 413 | 503>([
  ["body-too-large", 413],
  ["matrix-too-large", 413],
  ["generation-failed", 503],
  ["default-profile-unavailable", 503],
]);
const errorStatus = (error: unknown) =>
  error instanceof WorkspaceError
    ? (briefingFailureStatuses.get(error.code) ?? error.statusCode)
    : error instanceof z.ZodError || error instanceof SyntaxError
      ? 400
      : 500;
// [SAFETY] Names the fields that failed and why, never their values.
const invalidRequest = (error: z.ZodError) =>
  `The request didn’t match what this server expects: ${[
    ...new Set(
      error.issues.map(
        (issue) => `${issue.path.join(".") || "(body)"}: ${issue.message}`,
      ),
    ),
  ]
    .slice(0, 6)
    .join(
      "; ",
    )}. If the app was just updated, restart the dev server and try again.`;
const knownError = (error: unknown) =>
  error instanceof WorkspaceError
    ? error.code
    : error instanceof z.ZodError
      ? "invalid-input"
      : "internal-error";
const id = z.string().trim().min(1).max(256);
const revision = z.coerce.number().int().nonnegative();
export function createBriefingApi(
  options: BriefingDependencies & {
    resolveScope: (request: Request) => Promise<WorkspaceScope | null>;
    allowedOrigins?: readonly string[];
  },
) {
  const app = new Hono<{ Variables: { briefingScope: WorkspaceScope } }>();
  app.use(`${prefix}/*`, async (context, next) => {
    const scope = await options.resolveScope(context.req.raw);
    if (!scope) return context.json({ error: { code: "unauthorized" } }, 401);
    const method = context.req.method;
    if (!["GET", "HEAD"].includes(method)) {
      const origin = context.req.header("origin");
      const site = context.req.header("sec-fetch-site");
      // Frameworks may canonicalize the URL hostname; Host retains the browser's destination.
      const requestUrl = new URL(context.req.url);
      const host = context.req.header("host");
      const requestOrigin = host
        ? new URL(`${requestUrl.protocol}//${host}`).origin
        : requestUrl.origin;
      if (
        site === "cross-site" ||
        (origin &&
          origin !== requestOrigin &&
          !options.allowedOrigins?.includes(origin))
      )
        return context.json({ error: { code: "origin-forbidden" } }, 403);
      const length = Number(context.req.header("content-length") ?? 0);
      if (length > 1_048_576)
        return context.json({ error: { code: "body-too-large" } }, 413);
    }
    context.set("briefingScope", scope);
    await next();
  });
  const withScope = (context: {
    get: (key: "briefingScope") => WorkspaceScope;
  }) => context.get("briefingScope");
  async function body(context: { req: { text: () => Promise<string> } }) {
    const raw = await context.req.text();
    if (Buffer.byteLength(raw, "utf8") > 1_048_576)
      throw new WorkspaceError("body-too-large");
    return JSON.parse(raw) as unknown;
  }
  app.onError((error, context) =>
    context.json(
      {
        error: {
          code: knownError(error),
          // A safe explanation for a technical reader, when there is one.
          ...(error instanceof WorkspaceError && error.hint
            ? { message: error.hint }
            : error instanceof z.ZodError
              ? { message: invalidRequest(error) }
              : {}),
        },
      },
      errorStatus(error) as 400,
    ),
  );
  app.get(`${prefix}/profiles`, async (context) =>
    context.json({
      profiles: await profiles.listAvailableProfiles(
        options,
        withScope(context),
      ),
    }),
  );
  app.post(`${prefix}/profiles`, async (context) => {
    const input = briefingProfileImportSchema.parse(await body(context));
    return context.json(
      await profiles.importProfile(options.database, withScope(context), input),
      201,
    );
  });
  app.get(`${prefix}/profiles/:id/revisions/:revision`, async (context) =>
    context.json(
      await profiles.getProfileRevision(
        options.database,
        withScope(context),
        id.parse(context.req.param("id")),
        revision.parse(context.req.param("revision")),
      ),
    ),
  );
  app.get(`${prefix}/artifacts`, async (context) =>
    context.json({
      artifacts: await listArtifacts(options.database, withScope(context)),
    }),
  );
  app.get(`${prefix}/artifacts/:id`, async (context) =>
    context.json(
      await readArtifact(
        options,
        withScope(context),
        id.parse(context.req.param("id")),
      ),
    ),
  );
  app.put(`${prefix}/artifacts/:id`, async (context) => {
    const scope = withScope(context);
    const artifactId = id.parse(context.req.param("id"));
    const input = briefingPutSchema.parse(await body(context));
    return context.json(await putArtifact(options, scope, artifactId, input));
  });
  app.post(`${prefix}/artifacts/:id/proposals`, async (context) => {
    const scope = withScope(context);
    const artifactId = id.parse(context.req.param("id"));
    const input = briefingProposalRequestSchema.parse(await body(context));
    return context.json(
      await proposeAnswers(options, scope, artifactId, input),
      201,
    );
  });
  app.post(`${prefix}/artifacts/:id/ask`, async (context) => {
    const scope = withScope(context);
    const artifactId = id.parse(context.req.param("id"));
    const input = briefingAskSchema.parse(await body(context));
    return context.json(await askQuestion(options, scope, artifactId, input));
  });
  app.post(`${prefix}/artifacts/:id/prepare`, async (context) => {
    const scope = withScope(context);
    const artifactId = id.parse(context.req.param("id"));
    const input = briefingPrepareSchema.parse(await body(context));
    return context.json(
      await prepareArtifact(options, scope, artifactId, input),
    );
  });
  app.post(`${prefix}/artifacts/:id/condense`, async (context) => {
    const scope = withScope(context);
    const artifactId = id.parse(context.req.param("id"));
    const input = briefingCondenseSchema.parse(await body(context));
    return context.json(
      await condenseArtifact(options, scope, artifactId, input),
    );
  });
  app.post(`${prefix}/artifacts/:id/apply`, async (context) => {
    const scope = withScope(context);
    const artifactId = id.parse(context.req.param("id"));
    const input = briefingApplySchema.parse(await body(context));
    return context.json(await applyProposal(options, scope, artifactId, input));
  });
  app.post(`${prefix}/artifacts/:id/save`, async (context) => {
    const scope = withScope(context);
    const artifactId = id.parse(context.req.param("id"));
    const input = briefingSaveSchema.parse(await body(context));
    return context.json(await saveArtifact(options, scope, artifactId, input));
  });
  return app;
}
