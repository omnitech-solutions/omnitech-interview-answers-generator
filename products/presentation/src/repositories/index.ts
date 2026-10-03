import { createHash, randomBytes } from "node:crypto";
import { enterTenant, type PlatformDatabase } from "@omnitech/database";
import type {
  CreatePresentationInput,
  GeneratedImage,
  PresentationDocument,
  PresentationRecording,
  PresentationShare,
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

function escapeSourceText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

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
           (document_id, tenant_id, outline, theme_id, settings)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          id,
          context.tenantId,
          JSON.stringify(input.outline ?? []),
          input.themeId ?? null,
          JSON.stringify(input.settings ?? {}),
        ],
      );
      const slideOutline = input.outline?.length
        ? input.outline
        : ["New slide"];
      for (const [position, heading] of slideOutline.entries()) {
        await client.query(
          `INSERT INTO presentation.slides
             (tenant_id, document_id, position, source_xml, content)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            context.tenantId,
            id,
            position,
            `<SECTION layout="vertical"><H1>${escapeSourceText(heading)}</H1><P>Add your content</P></SECTION>`,
            {},
          ],
        );
      }
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

  async getShared(token: string): Promise<PresentationDocument | undefined> {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    return this.database.transaction(async (client) => {
      // The visitor has no tenant: the token hash alone may read its share
      // (the share_token_lookup policy), which names the tenant to scope to.
      await client.query(
        "SELECT set_config('app.share_token_hash', $1, true)",
        [tokenHash],
      );
      const share = await client.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM presentation.shares
         WHERE token_hash = $1 AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > now())`,
        [tokenHash],
      );
      const tenantId = share.rows[0]?.tenant_id;
      if (!tenantId) return undefined;
      await enterTenant(client, { tenantId });

      // Everything else is read under that tenant's ordinary policies.
      const document = await client.query<{
        id: string;
        title: string;
        revision: number;
        updated_at: Date;
        outline: string[];
        theme_id: string | null;
        settings: Record<string, unknown>;
      }>(
        `SELECT d.id, d.title, d.revision, d.updated_at, p.outline,
           p.theme_id, p.settings
         FROM presentation.shares s
         JOIN presentation.documents d ON d.id = s.document_id
         JOIN presentation.presentations p ON p.document_id = d.id
         WHERE s.token_hash = $1 AND d.tenant_id = $2
           AND d.deleted_at IS NULL`,
        [tokenHash, tenantId],
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
        [tenantId, row.id],
      );
      return {
        id: row.id,
        title: row.title,
        revision: row.revision,
        slideCount: slides.rowCount ?? slides.rows.length,
        favorite: false,
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
  ): Promise<{ id: string; revision: number }> {
    return this.database.tenantTransaction(context.tenantId, async (client) => {
      const result = await client.query<{ id: string; revision: number }>(
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
         RETURNING id, revision`,
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
      const saved = result.rows[0];
      if (!saved?.id) throw new PresentationConflictError();
      return saved;
    });
  }

  async deleteSlide(
    context: TenantContext,
    documentId: string,
    slideId: string,
  ): Promise<void> {
    return this.database.tenantTransaction(context.tenantId, async (client) => {
      const deleted = await client.query(
        `DELETE FROM presentation.slides
         WHERE tenant_id = $1 AND document_id = $2 AND id = $3`,
        [context.tenantId, documentId, slideId],
      );
      if (!deleted.rowCount) throw new Error("Slide not found.");
      await client.query(
        `WITH ordered AS (
           SELECT id, row_number() OVER (ORDER BY position, id) - 1 AS next_position
           FROM presentation.slides
           WHERE tenant_id = $1 AND document_id = $2
         )
         UPDATE presentation.slides AS slides
         SET position = ordered.next_position, updated_at = now()
         FROM ordered
         WHERE slides.id = ordered.id`,
        [context.tenantId, documentId],
      );
      await client.query(
        `UPDATE presentation.documents
         SET revision = revision + 1, updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [context.tenantId, documentId],
      );
    });
  }

  async moveSlide(
    context: TenantContext,
    documentId: string,
    slideId: string,
    position: number,
  ): Promise<void> {
    await this.database.tenantTransaction(context.tenantId, async (client) => {
      await client.query(
        `SELECT id FROM presentation.documents
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [context.tenantId, documentId],
      );
      const current = await client.query<{ id: string; position: number }>(
        `SELECT id, position FROM presentation.slides
         WHERE tenant_id = $1 AND document_id = $2 ORDER BY position FOR UPDATE`,
        [context.tenantId, documentId],
      );
      const index = current.rows.findIndex((slide) => slide.id === slideId);
      if (index < 0) throw new Error("Slide not found.");
      if (position < 0 || position >= current.rows.length) {
        throw new Error("Slide position is out of range.");
      }
      const ordered = current.rows.map((slide) => slide.id);
      ordered.splice(index, 1);
      ordered.splice(position, 0, slideId);
      // Vacate every original position before assigning the new order so the
      // immediate (document_id, position) uniqueness constraint always holds.
      const offset =
        Math.max(...current.rows.map((slide) => slide.position)) + 1;
      await client.query(
        `UPDATE presentation.slides SET position = position + $3
         WHERE tenant_id = $1 AND document_id = $2`,
        [context.tenantId, documentId, offset],
      );
      for (const [nextPosition, id] of ordered.entries()) {
        await client.query(
          `UPDATE presentation.slides SET position = $4, updated_at = now()
           WHERE tenant_id = $1 AND document_id = $2 AND id = $3`,
          [context.tenantId, documentId, id, nextPosition],
        );
      }
      await client.query(
        `UPDATE presentation.documents
         SET revision = revision + 1, updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [context.tenantId, documentId],
      );
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

  async recordGeneratedImage(
    context: TenantContext,
    input: {
      assetReference: string;
      promptReference: string;
      providerId: string;
      modelId: string;
      metadata: Readonly<Record<string, unknown>>;
    },
  ): Promise<string> {
    return this.database.tenantTransaction(context.tenantId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO presentation.generated_images
           (tenant_id, owner_user_id, asset_reference, prompt_reference,
            provider_id, model_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          context.tenantId,
          context.userId,
          input.assetReference,
          input.promptReference,
          input.providerId,
          input.modelId,
          input.metadata,
        ],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error("Generated image persistence failed.");
      return id;
    });
  }

  async softDelete(context: TenantContext, id: string): Promise<void> {
    await this.database.tenantTransaction(context.tenantId, async (client) => {
      await client.query(
        `UPDATE presentation.documents
         SET deleted_at = now(), updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [context.tenantId, id],
      );
    });
  }

  async duplicate(context: TenantContext, id: string): Promise<string> {
    return this.database.tenantTransaction(context.tenantId, async (client) => {
      const source = await client.query<{
        title: string;
        content: Record<string, unknown>;
        outline: string[];
        theme_id: string | null;
        settings: Record<string, unknown>;
        generation_state: Record<string, unknown>;
      }>(
        `SELECT d.title, d.content, p.outline, p.theme_id, p.settings,
           p.generation_state
         FROM presentation.documents d
         JOIN presentation.presentations p ON p.document_id = d.id
         WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`,
        [context.tenantId, id],
      );
      const row = source.rows[0];
      if (!row) throw new Error("Presentation not found.");
      const document = await client.query<{ id: string }>(
        `INSERT INTO presentation.documents
           (tenant_id, owner_user_id, title, content)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [context.tenantId, context.userId, `${row.title} copy`, row.content],
      );
      const duplicateId = document.rows[0]?.id;
      if (!duplicateId) throw new Error("Presentation duplication failed.");
      await client.query(
        `INSERT INTO presentation.presentations
           (document_id, tenant_id, outline, theme_id, settings,
            generation_state)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          duplicateId,
          context.tenantId,
          JSON.stringify(row.outline),
          row.theme_id,
          row.settings,
          row.generation_state,
        ],
      );
      await client.query(
        `INSERT INTO presentation.slides
           (tenant_id, document_id, position, source_xml, content)
         SELECT tenant_id, $3, position, source_xml, content
         FROM presentation.slides
         WHERE tenant_id = $1 AND document_id = $2`,
        [context.tenantId, id, duplicateId],
      );
      return duplicateId;
    });
  }

  async setFavorite(
    context: TenantContext,
    documentId: string,
    favorite: boolean,
  ): Promise<void> {
    await this.database.tenantTransaction(context.tenantId, async (client) => {
      if (favorite) {
        await client.query(
          `INSERT INTO presentation.document_favorites
             (tenant_id, user_id, document_id)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [context.tenantId, context.userId, documentId],
        );
      } else {
        await client.query(
          `DELETE FROM presentation.document_favorites
           WHERE tenant_id = $1 AND user_id = $2 AND document_id = $3`,
          [context.tenantId, context.userId, documentId],
        );
      }
    });
  }

  async createTheme(
    context: TenantContext,
    input: {
      name: string;
      description: string;
      definition: Readonly<Record<string, unknown>>;
      sourceImportId?: string;
    },
  ): Promise<string> {
    return this.database.tenantTransaction(context.tenantId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO presentation.themes
           (tenant_id, owner_user_id, name, description, definition, source_import_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, source_import_id)
         WHERE source_import_id IS NOT NULL
         DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           definition = EXCLUDED.definition,
           updated_at = now()
         RETURNING id`,
        [
          context.tenantId,
          context.userId,
          input.name,
          input.description,
          input.definition,
          input.sourceImportId ?? null,
        ],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error("Theme creation failed.");
      return id;
    });
  }

  async setThemeReaction(
    context: TenantContext,
    themeId: string,
    reaction: "favorite" | "like",
    enabled: boolean,
  ): Promise<void> {
    await this.database.tenantTransaction(context.tenantId, async (client) => {
      const table =
        reaction === "favorite"
          ? "presentation.theme_favorites"
          : "presentation.theme_likes";
      if (enabled) {
        await client.query(
          `INSERT INTO ${table} (tenant_id, user_id, theme_id)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [context.tenantId, context.userId, themeId],
        );
      } else {
        await client.query(
          `DELETE FROM ${table}
           WHERE tenant_id = $1 AND user_id = $2 AND theme_id = $3`,
          [context.tenantId, context.userId, themeId],
        );
      }
    });
  }

  async createShare(
    context: TenantContext,
    documentId: string,
  ): Promise<PresentationShare> {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    return this.database.tenantTransaction(context.tenantId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO presentation.shares
           (tenant_id, document_id, token_hash, created_by)
         SELECT $1, d.id, $3, $4 FROM presentation.documents d
         WHERE d.tenant_id = $1 AND d.id = $2
         RETURNING id`,
        [context.tenantId, documentId, tokenHash, context.userId],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error("Share creation failed.");
      return { id, token };
    });
  }

  async revokeShare(context: TenantContext, shareId: string): Promise<void> {
    await this.database.tenantTransaction(context.tenantId, async (client) => {
      await client.query(
        `UPDATE presentation.shares SET revoked_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [context.tenantId, shareId],
      );
    });
  }

  async requestExport(
    context: TenantContext,
    documentId: string,
    format: "pptx" | "pdf",
    idempotencyKey: string,
  ): Promise<string> {
    return this.database.tenantTransaction(context.tenantId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO presentation.exports
           (tenant_id, document_id, requested_by, format, status,
            idempotency_key)
         SELECT $1, d.id, $3, $4, 'queued', $5 FROM presentation.documents d
         WHERE d.tenant_id = $1 AND d.id = $2
         ON CONFLICT (tenant_id, idempotency_key) DO UPDATE SET
           updated_at = presentation.exports.updated_at
         RETURNING id`,
        [context.tenantId, documentId, context.userId, format, idempotencyKey],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error("Export request failed.");
      return id;
    });
  }

  async completeExport(
    context: TenantContext,
    exportId: string,
    assetReference: string,
  ): Promise<void> {
    await this.database.tenantTransaction(context.tenantId, async (client) => {
      await client.query(
        `UPDATE presentation.exports
         SET status = 'succeeded', asset_reference = $3, updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [context.tenantId, exportId, assetReference],
      );
    });
  }

  async saveRecording(
    context: TenantContext,
    documentId: string,
    assetReference: string,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<string> {
    return this.database.tenantTransaction(context.tenantId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO presentation.recordings
           (tenant_id, document_id, owner_user_id, asset_reference, metadata)
         SELECT $1, d.id, $3, $4, $5 FROM presentation.documents d
         WHERE d.tenant_id = $1 AND d.id = $2
         RETURNING id`,
        [
          context.tenantId,
          documentId,
          context.userId,
          assetReference,
          metadata,
        ],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error("Recording persistence failed.");
      return id;
    });
  }

  async listRecordings(
    context: TenantContext,
    documentId: string,
  ): Promise<PresentationRecording[]> {
    return this.database.tenantTransaction(context.tenantId, async (client) => {
      const result = await client.query<{
        id: string;
        asset_reference: string;
        metadata: Record<string, unknown>;
        created_at: Date;
      }>(
        `SELECT id, asset_reference, metadata, created_at
         FROM presentation.recordings
         WHERE tenant_id = $1 AND document_id = $2 AND owner_user_id = $3
         ORDER BY created_at DESC`,
        [context.tenantId, documentId, context.userId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        assetReference: row.asset_reference,
        metadata: row.metadata,
        createdAt: row.created_at.toISOString(),
      }));
    });
  }
}
