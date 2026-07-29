import type { AiExecutionGateway } from "@omnitech/ai-contracts";
import type { PlatformContext } from "@omnitech/platform-contracts";
import type { PlatformDatabase } from "@omnitech/platform-storage";
import { Hono } from "hono";
import { z } from "zod";
import { PresentationService } from "../application/index.js";
import { PresentationConflictError } from "../domain/index.js";
import { PresentationRepository } from "../repositories/index.js";

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  outline: z.array(z.string().trim().min(1)).optional(),
  themeId: z.string().uuid().optional(),
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
});

const themeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  definition: z.record(z.string(), z.unknown()),
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

export interface PresentationApiOptions {
  database: PlatformDatabase;
  resolveContext(tenantSlug: string): Promise<PlatformContext | null>;
  ai?: AiExecutionGateway;
}

export function createPresentationApi(options: PresentationApiOptions) {
  const api = new Hono();
  const service = new PresentationService(
    new PresentationRepository(options.database),
  );

  async function contextFor(tenantSlug: string) {
    const context = await options.resolveContext(tenantSlug);
    if (!context) throw new Error("Unauthorized");
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

  api.post("/presentation/v1/documents", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      const input = createSchema.parse(await context.req.json());
      const id = await service.create(resolved.tenant, {
        title: input.title,
        idempotencyKey: input.idempotencyKey,
        ...(input.outline === undefined ? {} : { outline: input.outline }),
        ...(input.themeId === undefined ? {} : { themeId: input.themeId }),
      });
      return context.json({ id }, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return context.json({ error: "Invalid presentation input." }, 400);
      }
      return context.json({ error: "Unauthorized" }, 401);
    }
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
      const input = saveSchema.parse(await context.req.json());
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
        return context.json({ error: error.message }, 409);
      }
      if (error instanceof z.ZodError) {
        return context.json({ error: "Invalid presentation update." }, 400);
      }
      return context.json({ error: "Unauthorized" }, 401);
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
      const input = booleanSchema.parse(await context.req.json());
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
      const input = slideSchema.parse(await context.req.json());
      const id = await service.saveSlide(
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
      return context.json({ id });
    } catch (error) {
      if (error instanceof PresentationConflictError) {
        return context.json({ error: error.message }, 409);
      }
      if (error instanceof z.ZodError) {
        return context.json({ error: "Invalid slide." }, 400);
      }
      return context.json({ error: "Unauthorized" }, 401);
    }
  });

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
      const input = themeSchema.parse(await context.req.json());
      const id = await service.createTheme(resolved.tenant, input);
      return context.json({ id }, 201);
    } catch {
      return context.json({ error: "Invalid theme." }, 400);
    }
  });

  api.put("/presentation/v1/themes/:id/:reaction", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      const reaction = z
        .enum(["favorite", "like"])
        .parse(context.req.param("reaction"));
      const input = booleanSchema.parse(await context.req.json());
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

  api.post("/presentation/v1/generate/outline", async (context) => {
    if (!options.ai) {
      return context.json({ error: "AI is not configured." }, 503);
    }
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      const input = generationSchema.parse(await context.req.json());
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
      return context.json(
        {
          error: error instanceof Error ? error.message : "Generation failed.",
        },
        502,
      );
    }
  });

  api.post("/presentation/v1/images/generate", async (context) => {
    if (!options.ai) {
      return context.json({ error: "AI is not configured." }, 503);
    }
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      const input = generationSchema.parse(await context.req.json());
      const execution = await options.ai.execute({
        context: {
          tenantId: resolved.access.tenant.id,
          userId: resolved.access.user.id,
          productId: "omnitech.presentation",
          permissions: resolved.access.permissions,
        },
        profileId: input.profileId,
        task: { type: "image-generation", prompt: input.prompt },
      });
      return context.json(execution);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return context.json({ error: "Invalid image request." }, 400);
      }
      return context.json(
        {
          error:
            error instanceof Error ? error.message : "Image generation failed.",
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
      return context.json({ token }, 201);
    } catch {
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
      const input = exportSchema.parse(await context.req.json());
      const id = await service.requestExport(
        resolved.tenant,
        context.req.param("id"),
        input.format,
        input.idempotencyKey,
      );
      return context.json({ id, status: "queued" }, 202);
    } catch {
      return context.json({ error: "Invalid export request." }, 400);
    }
  });

  api.post("/presentation/v1/documents/:id/recordings", async (context) => {
    try {
      const resolved = await contextFor(context.req.query("tenant") ?? "");
      const input = recordingSchema.parse(await context.req.json());
      const id = await service.saveRecording(
        resolved.tenant,
        context.req.param("id"),
        input.assetReference,
        input.metadata,
      );
      return context.json({ id }, 201);
    } catch {
      return context.json({ error: "Invalid recording." }, 400);
    }
  });

  return api;
}
