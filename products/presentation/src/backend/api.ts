// The presentation API: Hono wiring and transport only. Each route reads the
// member, parses its body against contracts.ts, delegates to application/ and
// answers; what a failure says is the route's row of data, not a branch.
import type { AiEngine } from "@omnitech/ai-engine";
import type { PlatformDatabase } from "@omnitech/database";
import {
  type PlatformContext,
  readBoundedJson,
} from "@omnitech/platform-contracts";
import { type Context, Hono } from "hono";
import {
  executionFor,
  generateImage,
  generateOutline,
  generateSlide,
  uploadImage,
} from "../application/generation";
import { PresentationService } from "../application/index";
import { PresentationRepository } from "../repositories/index";
import {
  bodyLimitFor,
  booleanSchema,
  createSchema,
  exportSchema,
  generationSchema,
  imageUploadSchema,
  recordingSchema,
  saveSchema,
  slideGenerationSchema,
  slideMoveSchema,
  slideSchema,
  themeImportSchema,
  themeReactionSchema,
  themeSchema,
} from "./contracts";
import {
  FAILURES,
  type Failures,
  logFailure,
  UnauthorizedError,
} from "./failures";

export interface PresentationApiOptions {
  database: PlatformDatabase;
  resolveContext(tenantSlug: string): Promise<PlatformContext | null>;
  engine?: AiEngine;
}

type Env = { Variables: { body: unknown } };
type RouteContext = Context<Env>;

export function createPresentationApi(options: PresentationApiOptions) {
  const api = new Hono<Env>();
  const service = new PresentationService(
    new PresentationRepository(options.database),
  );

  // [GUARD] Bodies are bounded by streamed byte count, never by content-length.
  // A body that is not valid JSON reaches the handler as undefined, which its
  // schema refuses with the route's fixed 400. Scoped to this product's own
  // paths: Hono carries a sub-app's middleware into the app it is mounted on,
  // so an unscoped one would read (and lock) the body of every /api request.
  api.use("/presentation/v1/*", async (context, next) => {
    if (!["POST", "PUT", "PATCH"].includes(context.req.method)) return next();
    const body = await readBoundedJson(
      context.req.raw,
      bodyLimitFor(context.req.path),
    );
    if (!body.ok && body.reason === "too-large") {
      return context.json({ error: "The request is too large." }, 413);
    }
    context.set("body", body.ok ? body.value : undefined);
    return next();
  });

  // A failure no route handled is answered with fixed text.
  api.onError((error, context) => {
    logFailure("unhandled", error);
    return context.json({ error: "Request failed." }, 500);
  });

  // [GUARD] The member of the tenant the request names, resolved before any
  // domain work (AGENTS rule 4).
  async function member(context: RouteContext) {
    const access = await options.resolveContext(
      context.req.query("tenant") ?? "",
    );
    if (!access) throw new UnauthorizedError();
    return {
      access,
      tenant: { tenantId: access.tenant.id, userId: access.user.id },
    };
  }

  // A route: its handler, answered from its row of FAILURES when it throws.
  const route =
    (failures: Failures, run: (context: RouteContext) => Promise<Response>) =>
    async (context: RouteContext): Promise<Response> => {
      try {
        return await run(context);
      } catch (error) {
        const known = failures.known?.find(([type]) => error instanceof type);
        if (known) return context.json({ error: known[2] }, known[1]);
        if (failures.log) logFailure(failures.log, error);
        const [status, text] = failures.otherwise;
        const shown =
          failures.shows && error instanceof failures.shows
            ? (error as Error).message
            : text;
        return context.json({ error: shown }, status);
      }
    };

  // An AI route without an engine says so before it reads anything.
  const withEngine =
    (
      failures: Failures,
      run: (context: RouteContext, engine: AiEngine) => Promise<Response>,
    ) =>
    (context: RouteContext) =>
      options.engine
        ? route(failures, (inner) => run(inner, options.engine as AiEngine))(
            context,
          )
        : context.json({ error: "AI is not configured." }, 503);

  const param = (context: RouteContext, name: string) =>
    context.req.param(name) as string;

  api.get(
    "/presentation/v1/documents",
    route(FAILURES.listDocuments, async (context) => {
      const { tenant } = await member(context);
      return context.json(await service.list(tenant));
    }),
  );

  api.post(
    "/presentation/v1/documents",
    route(FAILURES.createDocument, async (context) => {
      const { tenant } = await member(context);
      const input = createSchema.parse(context.get("body"));
      const id = await service.create(tenant, {
        title: input.title,
        idempotencyKey: input.idempotencyKey,
        ...(input.outline === undefined ? {} : { outline: input.outline }),
        ...(input.themeId === undefined ? {} : { themeId: input.themeId }),
        ...(input.settings === undefined ? {} : { settings: input.settings }),
      });
      return context.json({ id }, 201);
    }),
  );

  // [SAFETY] A shared document is read by its unguessable token alone.
  api.get("/presentation/v1/shared/:token", async (context) => {
    const token = context.req.param("token");
    if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) {
      return context.json({ error: "Invalid share token." }, 400);
    }
    const document = await service.getShared(token);
    return document
      ? context.json(document)
      : context.json({ error: "Share not found or expired." }, 404);
  });

  api.get(
    "/presentation/v1/documents/:id",
    route(FAILURES.readDocument, async (context) => {
      const { tenant } = await member(context);
      const document = await service.get(tenant, param(context, "id"));
      return document
        ? context.json(document)
        : context.json({ error: "Not found" }, 404);
    }),
  );

  api.patch(
    "/presentation/v1/documents/:id",
    route(FAILURES.saveDocument, async (context) => {
      const { tenant } = await member(context);
      const input = saveSchema.parse(context.get("body"));
      const revision = await service.save(tenant, param(context, "id"), {
        expectedRevision: input.expectedRevision,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.outline === undefined ? {} : { outline: input.outline }),
        ...(input.themeId === undefined ? {} : { themeId: input.themeId }),
        ...(input.settings === undefined ? {} : { settings: input.settings }),
      });
      return context.json({ revision });
    }),
  );

  api.delete(
    "/presentation/v1/documents/:id",
    route(FAILURES.deleteDocument, async (context) => {
      const { tenant } = await member(context);
      await service.delete(tenant, param(context, "id"));
      return context.body(null, 204);
    }),
  );

  api.post(
    "/presentation/v1/documents/:id/duplicate",
    route(FAILURES.duplicateDocument, async (context) => {
      const { tenant } = await member(context);
      const id = await service.duplicate(tenant, param(context, "id"));
      return context.json({ id }, 201);
    }),
  );

  api.put(
    "/presentation/v1/documents/:id/favorite",
    route(FAILURES.favoriteDocument, async (context) => {
      const { tenant } = await member(context);
      const input = booleanSchema.parse(context.get("body"));
      await service.setFavorite(tenant, param(context, "id"), input.enabled);
      return context.body(null, 204);
    }),
  );

  api.put(
    "/presentation/v1/documents/:id/slides",
    route(FAILURES.saveSlide, async (context) => {
      const { tenant } = await member(context);
      const input = slideSchema.parse(context.get("body"));
      const saved = await service.saveSlide(tenant, param(context, "id"), {
        position: input.position,
        sourceXml: input.sourceXml,
        content: input.content,
        ...(input.id === undefined ? {} : { id: input.id }),
        ...(input.revision === undefined ? {} : { revision: input.revision }),
      });
      return context.json(saved);
    }),
  );

  api.delete(
    "/presentation/v1/documents/:id/slides/:slideId",
    route(FAILURES.deleteSlide, async (context) => {
      const { tenant } = await member(context);
      await service.deleteSlide(
        tenant,
        param(context, "id"),
        param(context, "slideId"),
      );
      return context.body(null, 204);
    }),
  );

  api.patch(
    "/presentation/v1/documents/:id/slides/:slideId",
    route(FAILURES.moveSlide, async (context) => {
      const { tenant } = await member(context);
      const input = slideMoveSchema.parse(context.get("body"));
      await service.moveSlide(
        tenant,
        param(context, "id"),
        param(context, "slideId"),
        input.position,
      );
      return context.body(null, 204);
    }),
  );

  api.get(
    "/presentation/v1/themes",
    route(FAILURES.listThemes, async (context) => {
      const { tenant } = await member(context);
      return context.json(await service.listThemes(tenant));
    }),
  );

  api.post(
    "/presentation/v1/themes",
    route(FAILURES.createTheme, async (context) => {
      const { tenant } = await member(context);
      const input = themeSchema.parse(context.get("body"));
      const id = await service.createTheme(tenant, input);
      return context.json({ id }, 201);
    }),
  );

  api.post(
    "/presentation/v1/themes/import",
    route(FAILURES.importTheme, async (context) => {
      const { tenant } = await member(context);
      const input = themeImportSchema.parse(context.get("body"));
      const imported = await service.importPowerPointTheme(tenant, {
        file: Uint8Array.from(Buffer.from(input.fileBase64, "base64")),
        name: input.name,
        sourceImportId: input.sourceImportId,
      });
      return context.json(imported, 201);
    }),
  );

  api.put(
    "/presentation/v1/themes/:id/:reaction",
    route(FAILURES.reactToTheme, async (context) => {
      const { tenant } = await member(context);
      const reaction = themeReactionSchema.parse(param(context, "reaction"));
      const input = booleanSchema.parse(context.get("body"));
      await service.setThemeReaction(
        tenant,
        param(context, "id"),
        reaction,
        input.enabled,
      );
      return context.body(null, 204);
    }),
  );

  api.get(
    "/presentation/v1/images",
    route(FAILURES.listImages, async (context) => {
      const { tenant } = await member(context);
      return context.json(await service.listImages(tenant));
    }),
  );

  api.post(
    "/presentation/v1/images",
    route(FAILURES.uploadImage, async (context) => {
      const { tenant } = await member(context);
      const input = imageUploadSchema.parse(context.get("body"));
      const id = await uploadImage(service, tenant, input);
      return context.json({ id }, 201);
    }),
  );

  api.post(
    "/presentation/v1/generate/outline",
    withEngine(FAILURES.generateOutline, async (context, engine) => {
      const { access } = await member(context);
      const input = generationSchema.parse(context.get("body"));
      const result = await generateOutline(
        engine,
        input,
        executionFor(context.req.raw, access),
      );
      return context.json({ result });
    }),
  );

  api.post(
    "/presentation/v1/documents/:id/slides/generate",
    withEngine(FAILURES.generateSlide, async (context, engine) => {
      const { access } = await member(context);
      const input = slideGenerationSchema.parse(context.get("body"));
      const result = await generateSlide(
        engine,
        input,
        executionFor(context.req.raw, access),
      );
      return context.json({ result, position: input.position ?? 0 }, 201);
    }),
  );

  api.post(
    "/presentation/v1/images/generate",
    withEngine(FAILURES.generateImage, async (context, engine) => {
      const { access, tenant } = await member(context);
      const input = generationSchema.parse(context.get("body"));
      const imageId = await generateImage(
        engine,
        service,
        tenant,
        input,
        executionFor(context.req.raw, access),
      );
      return context.json({ imageId });
    }),
  );

  api.post(
    "/presentation/v1/documents/:id/shares",
    route(FAILURES.createShare, async (context) => {
      const { access, tenant } = await member(context);
      if (!access.permissions.includes("presentation.share")) {
        return context.json({ error: "Forbidden" }, 403);
      }
      const token = await service.createShare(tenant, param(context, "id"));
      return context.json(token, 201);
    }),
  );

  api.delete(
    "/presentation/v1/shares/:id",
    route(FAILURES.revokeShare, async (context) => {
      const { tenant } = await member(context);
      await service.revokeShare(tenant, param(context, "id"));
      return context.body(null, 204);
    }),
  );

  api.post(
    "/presentation/v1/documents/:id/exports",
    route(FAILURES.exportDocument, async (context) => {
      const { tenant } = await member(context);
      const input = exportSchema.parse(context.get("body"));
      const result = await service.export(
        tenant,
        param(context, "id"),
        input.format,
        input.idempotencyKey,
      );
      return context.json({ ...result, status: "succeeded" }, 201);
    }),
  );

  api.post(
    "/presentation/v1/documents/:id/recordings",
    route(FAILURES.saveRecording, async (context) => {
      const { tenant } = await member(context);
      const input = recordingSchema.parse(context.get("body"));
      const id = await service.saveRecording(
        tenant,
        param(context, "id"),
        input.assetReference,
        input.metadata,
      );
      return context.json({ id }, 201);
    }),
  );

  api.get(
    "/presentation/v1/documents/:id/recordings",
    route(FAILURES.listRecordings, async (context) => {
      const { tenant } = await member(context);
      return context.json(
        await service.listRecordings(tenant, param(context, "id")),
      );
    }),
  );

  return api;
}
