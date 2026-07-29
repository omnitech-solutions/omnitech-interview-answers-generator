import type { PlatformDatabase } from "@omnitech/platform-storage";
import type {
  CreatePresentationInput,
  GeneratedImage,
  PresentationDocument,
  PresentationSummary,
  PresentationTheme,
  SavePresentationInput,
  Slide,
  TenantContext,
} from "../domain/index.js";
import { PresentationConflictError } from "../domain/index.js";

type SummaryRow = {
  id: string;
  title: string;
  revision: number;
  slide_count: string;
  favorite: boolean;
  updated_at: Date;
};

export class PresentationRepository {
  constructor(private readonly database: PlatformDatabase) {}

  async list(context: TenantContext): Promise<PresentationSummary[]> {
    return this.database.tenantTransaction(context.tenantId, async (client) => {
      const result = await client.query<SummaryRow>(
        `SELECT d.id, d.title, d.revision, d.updated_at,
           count(s.id)::text AS slide_count,
           exists(
             SELECT 1 FROM presentation.document_favorites f
             WHERE f.tenant_id = d.tenant_id
               AND f.document_id = d.id AND f.user_id = $2
           ) AS favorite
         FROM presentation.documents d
         LEFT JOIN presentation.slides s ON s.document_id = d.id
         WHERE d.tenant_id = $1 AND d.deleted_at IS NULL
         GROUP BY d.id
         ORDER BY d.updated_at DESC`,
        [context.tenantId, context.userId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        revision: row.revision,
        slideCount: Number(row.slide_count),
        favorite: row.favorite,
        updatedAt: row.updated_at.toISOString(),
      }));
    });
  }

  async create(
    context: TenantContext,
    input: CreatePresentationInput,
  ): Promise<string> {
    return this.database.tenantTransaction(context.tenantId, async (client) => {
      const existing = await client.query<{ subject_id: string }>(
        `SELECT subject_id FROM platform.audit_events
         WHERE tenant_id = $1 AND actor_user_id = $2
           AND action = 'presentation.created'
           AND metadata->>'idempotencyKey' = $3
         LIMIT 1`,
        [context.tenantId, context.userId, input.idempotencyKey],
      );
      if (existing.rows[0]) return existing.rows[0].subject_id;
      const document = await client.query<{ id: string }>(
        `INSERT INTO presentation.documents
           (tenant_id, owner_user_id, title)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [context.tenantId, context.userId, input.title],
      );
      const id = document.rows[0]?.id;
      if (!id) throw new Error("Presentation creation returned no identifier.");
      await client.query(
        `INSERT INTO presentation.presentations
           (document_id, tenant_id, outline, theme_id)
         VALUES ($1, $2, $3, $4)`,
        [
          id,
          context.tenantId,
          JSON.stringify(input.outline ?? []),
          input.themeId ?? null,
        ],
      );
      await client.query(
        `INSERT INTO platform.audit_events
           (tenant_id, actor_user_id, action, subject_type, subject_id, metadata)
         VALUES ($1, $2, 'presentation.created', 'presentation', $3, $4)`,
        [
          context.tenantId,
          context.userId,
          id,
          { idempotencyKey: input.idempotencyKey },
        ],
      );
      return id;
    });
  }

  async get(
    context: TenantContext,
    id: string,
  ): Promise<PresentationDocument | undefined> {
    return this.database.tenantTransaction(context.tenantId, async (client) => {
      const document = await client.query<{
        id: string;
        title: string;
        revision: number;
        updated_at: Date;
        outline: string[];
        theme_id: string | null;
        settings: Record<string, unknown>;
        favorite: boolean;
      }>(
        `SELECT d.id, d.title, d.revision, d.updated_at,
           p.outline, p.theme_id, p.settings,
           exists(
             SELECT 1 FROM presentation.document_favorites f
             WHERE f.tenant_id = d.tenant_id
               AND f.document_id = d.id AND f.user_id = $3
           ) AS favorite
         FROM presentation.documents d
         JOIN presentation.presentations p ON p.document_id = d.id
         WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`,
        [context.tenantId, id, context.userId],
      );
      const row = document.rows[0];
      if (!row) return undefined;
      const slides = await client.query<{
        id: string;
        position: number;
        source_xml: string;
        content: Record<string, unknown>;
        revision: number;
      }>(
        `SELECT id, position, source_xml, content, revision
         FROM presentation.slides
         WHERE tenant_id = $1 AND document_id = $2
         ORDER BY position`,
        [context.tenantId, id],
      );
      return {
        id: row.id,
        title: row.title,
        revision: row.revision,
        slideCount: slides.rowCount ?? slides.rows.length,
        favorite: row.favorite,
        updatedAt: row.updated_at.toISOString(),
        outline: row.outline,
        themeId: row.theme_id,
        settings: row.settings,
        slides: slides.rows.map((slide) => ({
          id: slide.id,
          position: slide.position,
          sourceXml: slide.source_xml,
          content: slide.content,
          revision: slide.revision,
        })),
      };
    });
  }

  async save(
    context: TenantContext,
    id: string,
    input: SavePresentationInput,
  ): Promise<number> {
    return this.database.tenantTransaction(context.tenantId, async (client) => {
      const result = await client.query<{ revision: number }>(
        `UPDATE presentation.documents SET
           title = COALESCE($4, title),
           revision = revision + 1,
           updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND revision = $3
         RETURNING revision`,
        [context.tenantId, id, input.expectedRevision, input.title ?? null],
      );
      const revision = result.rows[0]?.revision;
      if (!revision) throw new PresentationConflictError();
      await client.query(
        `UPDATE presentation.presentations SET
           outline = COALESCE($3, outline),
           theme_id = CASE WHEN $4 THEN $5::uuid ELSE theme_id END,
           settings = COALESCE($6, settings),
           updated_at = now()
         WHERE tenant_id = $1 AND document_id = $2`,
        [
          context.tenantId,
          id,
          input.outline ? JSON.stringify(input.outline) : null,
          Object.hasOwn(input, "themeId"),
          input.themeId ?? null,
          input.settings ? JSON.stringify(input.settings) : null,
        ],
      );
      return revision;
    });
  }

  async saveSlide(
    context: TenantContext,
    documentId: string,
    slide: Omit<Slide, "id" | "revision"> & { id?: string; revision?: number },
  ): Promise<string> {
    return this.database.tenantTransaction(context.tenantId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO presentation.slides
           (id, tenant_id, document_id, position, source_xml, content)
         VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           position = EXCLUDED.position,
           source_xml = EXCLUDED.source_xml,
           content = EXCLUDED.content,
           revision = presentation.slides.revision + 1,
           updated_at = now()
         WHERE presentation.slides.tenant_id = $2
           AND presentation.slides.document_id = $3
           AND presentation.slides.revision = $7
         RETURNING id`,
        [
          slide.id ?? null,
          context.tenantId,
          documentId,
          slide.position,
          slide.sourceXml,
          JSON.stringify(slide.content),
          slide.revision ?? 1,
        ],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new PresentationConflictError();
      return id;
    });
  }

  async listThemes(context: TenantContext): Promise<PresentationTheme[]> {
    return this.database.tenantTransaction(context.tenantId, async (client) => {
      const result = await client.query<{
        id: string;
        name: string;
        description: string;
        definition: Record<string, unknown>;
        built_in: boolean;
        favorite: boolean;
        liked: boolean;
      }>(
        `SELECT t.id, t.name, t.description, t.definition, t.built_in,
           exists(SELECT 1 FROM presentation.theme_favorites f
             WHERE f.tenant_id = $1 AND f.user_id = $2 AND f.theme_id = t.id
           ) AS favorite,
           exists(SELECT 1 FROM presentation.theme_likes l
             WHERE l.tenant_id = $1 AND l.user_id = $2 AND l.theme_id = t.id
           ) AS liked
         FROM presentation.themes t
         WHERE t.tenant_id IS NULL OR t.tenant_id = $1
         ORDER BY t.built_in DESC, t.name`,
        [context.tenantId, context.userId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        definition: row.definition,
        builtIn: row.built_in,
        favorite: row.favorite,
        liked: row.liked,
      }));
    });
  }

  async listImages(context: TenantContext): Promise<GeneratedImage[]> {
    return this.database.tenantTransaction(context.tenantId, async (client) => {
      const result = await client.query<{
        id: string;
        asset_reference: string;
        provider_id: string;
        model_id: string;
        metadata: Record<string, unknown>;
        created_at: Date;
      }>(
        `SELECT id, asset_reference, provider_id, model_id, metadata, created_at
         FROM presentation.generated_images
         WHERE tenant_id = $1 AND owner_user_id = $2
         ORDER BY created_at DESC`,
        [context.tenantId, context.userId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        assetReference: row.asset_reference,
        providerId: row.provider_id,
        modelId: row.model_id,
        metadata: row.metadata,
        createdAt: row.created_at.toISOString(),
      }));
    });
  }
}
