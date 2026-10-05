import {
  type AiExecutionGateway,
  type ImageResult,
  isSafeImageModelId,
} from "@omnitech/ai-contracts";
import type { PlatformDatabase } from "@omnitech/database";
import {
  type PlatformContext,
  readBoundedJson,
} from "@omnitech/platform-contracts";
import { Hono } from "hono";
import { z } from "zod";
import { PresentationService } from "../application/index.js";
import {
  PresentationConflictError,
  PresentationNotFoundError,
  PresentationThemeNotFoundError,
} from "../domain/index.js";
import { ExportRefusedError } from "../export/index.js";
import { PresentationRepository } from "../repositories/index.js";
import { importPowerPointTheme } from "../theme-import.js";

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  outline: z.array(z.string().trim().min(1)).optional(),
  themeId: z.string().uuid().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
});

const saveSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  outline: z.array(z.string().trim().min(1)).optional(),
  themeId: z.string().uuid().nullable().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  expectedRevision: z.number().int().positive(),
});

const slideSchema = z.object({
  id: z.string().uuid().optional(),
  position: z.number().int().nonnegative(),
  sourceXml: z.string().max(500_000),
  content: z.record(z.string(), z.unknown()).default({}),
  revision: z.number().int().positive().optional(),
});

const generationSchema = z.object({
  prompt: z.string().trim().min(1).max(50_000),
  profileId: z.string().trim().min(1),
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional(),
  modelId: z
    .string()
    .trim()
    .refine(isSafeImageModelId, "Not an allowed image model id.")
    .optional(),
  width: z.number().int().positive().max(4096).optional(),
  height: z.number().int().positive().max(4096).optional(),
  slideCount: z.number().int().min(1).max(100).optional(),
  language: z.string().trim().min(1).max(40).optional(),
  layout: z.string().trim().min(1).max(40).optional(),
  textContent: z.string().trim().max(40).optional(),
  tone: z.string().trim().max(40).optional(),
  audience: z.string().trim().max(40).optional(),
  scenario: z.string().trim().max(40).optional(),
});

const slideGenerationSchema = z.object({
  prompt: z.string().trim().min(1).max(50_000),
  profileId: z.string().trim().min(1),
  position: z.number().int().nonnegative().optional(),
});

const themeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  definition: z.record(z.string(), z.unknown()),
});

const themeImportSchema = z.object({
  name: z.string().trim().min(1).max(120),
  fileBase64: z.string().min(32).max(20_000_000),
  sourceImportId: z.string().trim().min(1).max(200),
});

const booleanSchema = z.object({ enabled: z.boolean() });

const exportSchema = z.object({
  format: z.enum(["pptx", "pdf"]),
  idempotencyKey: z.string().trim().min(8).max(200),
});

const recordingSchema = z.object({
  assetReference: z.string().trim().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

const imageUploadSchema = z.object({
  assetReference: z.string().trim().min(1).max(5_000_000),
  mimeType: z.string().trim().min(1).max(100).default("image/png"),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

// A request body is read as a stream against these bounds before any handler
// sees it. Images and theme files travel as base64 inside JSON.
const JSON_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
const IMAGE_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
const THEME_IMPORT_BODY_LIMIT_BYTES = 24 * 1024 * 1024;

function bodyLimitFor(path: string): number {
  if (path.endsWith("/themes/import")) return THEME_IMPORT_BODY_LIMIT_BYTES;
  if (path.endsWith("/images")) return IMAGE_BODY_LIMIT_BYTES;
  return JSON_BODY_LIMIT_BYTES;
}

// The only refusal whose message reaches the client: fixed text, written here.
class ImageAssetRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageAssetRefusedError";
  }
}

// [SAFETY] Failures are logged as metadata only: the route and the error's
// class, never its message, which can quote a prompt, a file or a reply.
function logFailure(route: string, error: unknown) {
  console.error(
    JSON.stringify({
      route,
      error: error instanceof Error ? error.name : "non-error",
    }),
  );
}

function validateImageAssetReference(
  value: string,
  localProvider = false,
): void {
  if (value.startsWith("data:image/")) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ImageAssetRefusedError(
      "Image assets must use an HTTP(S) URL or image data URL.",
    );
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new ImageAssetRefusedError(
      "Image assets must use an HTTP(S) URL or image data URL.",
    );
  }
  if (
    !localProvider &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    throw new ImageAssetRefusedError(
      "Image assets cannot point to loopback hosts.",
    );
  }
}

/** The request carries no tenant membership; the only cause of a 401. */
class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export interface PresentationApiOptions {
  database: PlatformDatabase;
  resolveContext(tenantSlug: string): Promise<PlatformContext | null>;
  ai?: AiExecutionGateway;
}

export function createPresentationApi(options: PresentationApiOptions) {
  const api = new Hono<{ Variables: { body: unknown } }>();
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

  async function contextFor(tenantSlug: string) {
    const context = await options.resolveContext(tenantSlug);
    if (!context) throw new UnauthorizedError();
    return {
      access: context,
      tenant: {
        tenantId: context.tenant.id,
        userId: context.user.id,
      },
    };
  }

  api.get("/presentation/v1/documents", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      return context.json(await service.list(resolved.tenant));
    } catch {
      return context.json({ error: "Unauthorized" }, 401);
    }
  });

  api.get("/presentation/v1/ai-targets", async (context) => {
    if (!options.ai)
      return context.json({ error: "AI is not configured." }, 503);
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      return context.json(
        await options.ai.listAvailableTargets({
          tenantId: resolved.access.tenant.id,
          userId: resolved.access.user.id,
          productId: "omnitech.presentation",
          permissions: resolved.access.permissions,
        }),
      );
    } catch {
      return context.json({ error: "Unauthorized" }, 401);
    }
  });

  api.post("/presentation/v1/documents", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      const input = createSchema.parse(context.get("body"));
      const id = await service.create(resolved.tenant, {
        title: input.title,
        idempotencyKey: input.idempotencyKey,
        ...(input.outline === undefined ? {} : { outline: input.outline }),
        ...(input.themeId === undefined ? {} : { themeId: input.themeId }),
        ...(input.settings === undefined ? {} : { settings: input.settings }),
      });
      return context.json({ id }, 201);
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        return context.json({ error: "Invalid presentation input." }, 400);
      }
      if (error instanceof PresentationThemeNotFoundError) {
        return context.json({ error: "Theme not found." }, 400);
      }
      if (error instanceof UnauthorizedError) {
        return context.json({ error: "Unauthorized" }, 401);
      }
      logFailure("presentation", error);
      return context.json({ error: "Request failed." }, 500);
    }
  });

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

  api.get("/presentation/v1/documents/:id", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      const document = await service.get(
        resolved.tenant,
        context.req.param("id"),
      );
      return document
        ? context.json(document)
        : context.json({ error: "Not found" }, 404);
    } catch {
      return context.json({ error: "Unauthorized" }, 401);
    }
  });

  api.patch("/presentation/v1/documents/:id", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      const input = saveSchema.parse(context.get("body"));
      const revision = await service.save(
        resolved.tenant,
        context.req.param("id"),
        {
          expectedRevision: input.expectedRevision,
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.outline === undefined ? {} : { outline: input.outline }),
          ...(input.themeId === undefined ? {} : { themeId: input.themeId }),
          ...(input.settings === undefined ? {} : { settings: input.settings }),
        },
      );
      return context.json({ revision });
    } catch (error) {
      if (error instanceof PresentationConflictError) {
        return context.json(
          { error: "The presentation changed since it was loaded." },
          409,
        );
      }
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        return context.json({ error: "Invalid presentation update." }, 400);
      }
      if (error instanceof PresentationThemeNotFoundError) {
        return context.json({ error: "Theme not found." }, 400);
      }
      if (error instanceof UnauthorizedError) {
        return context.json({ error: "Unauthorized" }, 401);
      }
      logFailure("presentation", error);
      return context.json({ error: "Request failed." }, 500);
    }
  });

  api.delete("/presentation/v1/documents/:id", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      await service.delete(resolved.tenant, context.req.param("id"));
      return context.body(null, 204);
    } catch {
      return context.json({ error: "Unauthorized" }, 401);
    }
  });

  api.post("/presentation/v1/documents/:id/duplicate", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      const id = await service.duplicate(
        resolved.tenant,
        context.req.param("id"),
      );
      return context.json({ id }, 201);
    } catch {
      return context.json({ error: "Unable to duplicate presentation." }, 400);
    }
  });

  api.put("/presentation/v1/documents/:id/favorite", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      const input = booleanSchema.parse(context.get("body"));
      await service.setFavorite(
        resolved.tenant,
        context.req.param("id"),
        input.enabled,
      );
      return context.body(null, 204);
    } catch {
      return context.json({ error: "Unable to update favorite." }, 400);
    }
  });

  api.put("/presentation/v1/documents/:id/slides", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      const input = slideSchema.parse(context.get("body"));
      const saved = await service.saveSlide(
        resolved.tenant,
        context.req.param("id"),
        {
          position: input.position,
          sourceXml: input.sourceXml,
          content: input.content,
          ...(input.id === undefined ? {} : { id: input.id }),
          ...(input.revision === undefined ? {} : { revision: input.revision }),
        },
      );
      return context.json(saved);
    } catch (error) {
      if (error instanceof PresentationConflictError) {
        return context.json(
          { error: "The presentation changed since it was loaded." },
          409,
        );
      }
      if (error instanceof z.ZodError) {
        return context.json({ error: "Invalid slide." }, 400);
      }
      return context.json({ error: "Unauthorized" }, 401);
    }
  });

  api.delete(
    "/presentation/v1/documents/:id/slides/:slideId",
    async (context) => {
      try {
        const resolved = await contextFor(context.req.query("tenant") ?? "");
        await service.deleteSlide(
          resolved.tenant,
          context.req.param("id"),
          context.req.param("slideId"),
        );
        return context.body(null, 204);
      } catch {
        return context.json({ error: "Unable to delete slide." }, 400);
      }
    },
  );

  api.patch(
    "/presentation/v1/documents/:id/slides/:slideId",
    async (context) => {
      try {
        const resolved = await contextFor(context.req.query("tenant") ?? "");
        const input = z
          .object({ position: z.number().int().nonnegative() })
          .parse(context.get("body"));
        await service.moveSlide(
          resolved.tenant,
          context.req.param("id"),
          context.req.param("slideId"),
          input.position,
        );
        return context.body(null, 204);
      } catch {
        return context.json({ error: "Unable to move slide." }, 400);
      }
    },
  );

  api.get("/presentation/v1/themes", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      return context.json(await service.listThemes(resolved.tenant));
    } catch {
      return context.json({ error: "Unauthorized" }, 401);
    }
  });

  api.post("/presentation/v1/themes", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      const input = themeSchema.parse(context.get("body"));
      const id = await service.createTheme(resolved.tenant, input);
      return context.json({ id }, 201);
    } catch {
      return context.json({ error: "Invalid theme." }, 400);
    }
  });

  api.post("/presentation/v1/themes/import", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      const input = themeImportSchema.parse(context.get("body"));
      const imported = await importPowerPointTheme(
        Uint8Array.from(Buffer.from(input.fileBase64, "base64")),
        input.name,
      );
      const id = await service.importTheme(resolved.tenant, {
        ...imported,
        sourceImportId: input.sourceImportId,
      });
      return context.json({ id, theme: imported }, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return context.json({ error: "Invalid PowerPoint theme upload." }, 400);
      }
      logFailure("theme-import", error);
      return context.json(
        { error: "The PowerPoint file could not be read as a theme." },
        400,
      );
    }
  });

  api.put("/presentation/v1/themes/:id/:reaction", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      const reaction = z
        .enum(["favorite", "like"])
        .parse(context.req.param("reaction"));
      const input = booleanSchema.parse(context.get("body"));
      await service.setThemeReaction(
        resolved.tenant,
        context.req.param("id"),
        reaction,
        input.enabled,
      );
      return context.body(null, 204);
    } catch {
      return context.json({ error: "Invalid theme reaction." }, 400);
    }
  });

  api.get("/presentation/v1/images", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      return context.json(await service.listImages(resolved.tenant));
    } catch {
      return context.json({ error: "Unauthorized" }, 401);
    }
  });

  api.post("/presentation/v1/images", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      const input = imageUploadSchema.parse(context.get("body"));
      validateImageAssetReference(input.assetReference);
      const id = await service.recordGeneratedImage(resolved.tenant, {
        assetReference: input.assetReference,
        promptReference: "upload",
        providerId: "upload",
        modelId: "user-upload",
        metadata: { ...input.metadata, mimeType: input.mimeType },
      });
      return context.json({ id }, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return context.json({ error: "Invalid image upload." }, 400);
      }
      return context.json({ error: "Unable to save image." }, 400);
    }
  });

  api.post("/presentation/v1/generate/outline", async (context) => {
    if (!options.ai) {
      return context.json({ error: "AI is not configured." }, 503);
    }
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      const input = generationSchema.parse(context.get("body"));
      const execution = await options.ai.execute({
        context: {
          tenantId: resolved.access.tenant.id,
          userId: resolved.access.user.id,
          productId: "omnitech.presentation",
          permissions: resolved.access.permissions,
        },
        profileId: input.profileId,
        task: {
          type: "structured-generation",
          prompt: [
            input.prompt,
            input.slideCount === undefined
              ? undefined
              : `Create an outline for exactly ${input.slideCount} slides.`,
            input.language === undefined
              ? undefined
              : `Write the outline in ${input.language}.`,
            input.textContent
              ? `Use ${input.textContent} text content.`
              : undefined,
            input.tone && input.tone !== "Auto"
              ? `Tone: ${input.tone}.`
              : undefined,
            input.audience && input.audience !== "Auto"
              ? `Audience: ${input.audience}.`
              : undefined,
            input.scenario && input.scenario !== "Auto"
              ? `Scenario: ${input.scenario}.`
              : undefined,
            input.layout === undefined
              ? undefined
              : `Use a ${input.layout} presentation structure.`,
          ]
            .filter(Boolean)
            .join("\n\n"),
          schema: {
            type: "object",
            required: ["title", "outline"],
            properties: {
              title: { type: "string" },
              outline: { type: "array", items: { type: "string" } },
            },
          },
        },
      });
      return context.json(execution);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return context.json({ error: "Invalid generation request." }, 400);
      }
      logFailure("generate-outline", error);
      return context.json({ error: "Generation failed." }, 502);
    }
  });

  api.post(
    "/presentation/v1/documents/:id/slides/generate",
    async (context) => {
      if (!options.ai)
        return context.json({ error: "AI is not configured." }, 503);
      try {
        const resolved = await contextFor(context.req.query("tenant") ?? "");
        const input = slideGenerationSchema.parse(context.get("body"));
        const execution = await options.ai.execute({
          context: {
            tenantId: resolved.access.tenant.id,
            userId: resolved.access.user.id,
            productId: "omnitech.presentation",
            permissions: resolved.access.permissions,
          },
          profileId: input.profileId,
          task: {
            type: "structured-generation",
            prompt: input.prompt,
            schema: {
              type: "object",
              required: ["sourceXml"],
              properties: { sourceXml: { type: "string" } },
            },
          },
        });
        return context.json(
          { ...execution, position: input.position ?? 0 },
          201,
        );
      } catch (error) {
        if (error instanceof z.ZodError) {
          return context.json(
            { error: "Invalid slide generation request." },
            400,
          );
        }
        logFailure("generate-slide", error);
        return context.json({ error: "Slide generation failed." }, 502);
      }
    },
  );

  api.post("/presentation/v1/images/generate", async (context) => {
    if (!options.ai) {
      return context.json({ error: "AI is not configured." }, 503);
    }
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      const input = generationSchema.parse(context.get("body"));
      const execution = await options.ai.execute({
        context: {
          tenantId: resolved.access.tenant.id,
          userId: resolved.access.user.id,
          productId: "omnitech.presentation",
          permissions: resolved.access.permissions,
        },
        profileId: input.profileId,
        task: {
          type: "image-generation",
          prompt: input.prompt,
          image: {
            ...(input.aspectRatio === undefined
              ? {}
              : { aspectRatio: input.aspectRatio }),
            ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
            ...(input.width === undefined ? {} : { width: input.width }),
            ...(input.height === undefined ? {} : { height: input.height }),
          },
        },
      });
      const result = execution.result as ImageResult;
      validateImageAssetReference(
        result.assetReference,
        result.providerId === "comfyui",
      );
      const imageId = await service.recordGeneratedImage(resolved.tenant, {
        assetReference: result.assetReference,
        promptReference: `generation:${execution.executionId}`,
        providerId: result.providerId,
        modelId: result.modelId,
        metadata: result.provenance,
      });
      return context.json({ ...execution, imageId });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return context.json({ error: "Invalid image request." }, 400);
      }
      logFailure("generate-image", error);
      return context.json(
        {
          error:
            error instanceof ImageAssetRefusedError
              ? error.message
              : "Image generation failed.",
        },
        502,
      );
    }
  });

  api.post("/presentation/v1/documents/:id/shares", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      if (!resolved.access.permissions.includes("presentation.share")) {
        return context.json({ error: "Forbidden" }, 403);
      }
      const token = await service.createShare(
        resolved.tenant,
        context.req.param("id"),
      );
      return context.json(token, 201);
    } catch (error) {
      if (error instanceof PresentationNotFoundError) {
        return context.json({ error: "Not found" }, 404);
      }
      return context.json({ error: "Unable to create share." }, 400);
    }
  });

  api.delete("/presentation/v1/shares/:id", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      await service.revokeShare(resolved.tenant, context.req.param("id"));
      return context.body(null, 204);
    } catch {
      return context.json({ error: "Unable to revoke share." }, 400);
    }
  });

  api.post("/presentation/v1/documents/:id/exports", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      const input = exportSchema.parse(context.get("body"));
      const result = await service.export(
        resolved.tenant,
        context.req.param("id"),
        input.format,
        input.idempotencyKey,
      );
      return context.json({ ...result, status: "succeeded" }, 201);
    } catch (error) {
      if (error instanceof PresentationNotFoundError) {
        return context.json({ error: "Not found" }, 404);
      }
      logFailure("export", error);
      return context.json(
        {
          error:
            error instanceof ExportRefusedError
              ? error.message
              : "Export failed.",
        },
        400,
      );
    }
  });

  api.post("/presentation/v1/documents/:id/recordings", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      const input = recordingSchema.parse(context.get("body"));
      const id = await service.saveRecording(
        resolved.tenant,
        context.req.param("id"),
        input.assetReference,
        input.metadata,
      );
      return context.json({ id }, 201);
    } catch (error) {
      if (error instanceof PresentationNotFoundError) {
        return context.json({ error: "Not found" }, 404);
      }
      return context.json({ error: "Invalid recording." }, 400);
    }
  });

  api.get("/presentation/v1/documents/:id/recordings", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      return context.json(
        await service.listRecordings(resolved.tenant, context.req.param("id")),
      );
    } catch {
      return context.json({ error: "Unable to load recordings." }, 400);
    }
  });

  return api;
}
