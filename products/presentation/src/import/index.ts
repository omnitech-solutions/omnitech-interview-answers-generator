import type {
  DatabaseClient,
  PlatformDatabase,
} from "@omnitech/platform-storage";
import { createHash } from "node:crypto";

export interface PresentationImportOptions {
  targetTenantId: string;
  dryRun: boolean;
  resumeFrom?: string;
  batchSize: number;
  conflictPolicy: "report";
  verifyOnly: boolean;
}

export interface ImportConflict {
  entityType: string;
  sourceId: string;
  reason: string;
}

export interface PresentationImportReport {
  runId: string;
  dryRun: boolean;
  users: number;
  documents: number;
  themes: number;
  images: number;
  conflicts: ImportConflict[];
  checksums: Record<string, string>;
}

type SourceUser = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  emailVerified: Date | null;
};

export function normalizeVerifiedEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function checksum(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function importPresentationStudio(
  source: DatabaseClient,
  target: PlatformDatabase,
  options: PresentationImportOptions,
): Promise<PresentationImportReport> {
  const runId = crypto.randomUUID();
  const report: PresentationImportReport = {
    runId,
    dryRun: options.dryRun,
    users: 0,
    documents: 0,
    themes: 0,
    images: 0,
    conflicts: [],
    checksums: {},
  };
  const users = await source.query<SourceUser>(
    `SELECT id, email, name, image, "emailVerified" FROM "User" ORDER BY id`,
  );
  const userMap = new Map<string, string>();

  await target
    .transaction(async (client) => {
      if (!options.verifyOnly) {
        await client.query(
          `INSERT INTO presentation.import_runs
           (id, tenant_id, status, source_schema_version, configuration)
         VALUES ($1, $2, $3, 'presentation-ai-prisma-v1', $4)`,
          [
            runId,
            options.targetTenantId,
            options.dryRun ? "dry-run" : "running",
            options,
          ],
        );
      }

      for (const sourceUser of users.rows) {
        if (!sourceUser.email) {
          report.conflicts.push({
            entityType: "user",
            sourceId: sourceUser.id,
            reason: "Source user has no email address.",
          });
          continue;
        }
        const email = normalizeVerifiedEmail(sourceUser.email);
        const matches = await client.query<{
          id: string;
          email_verified_at: Date | null;
        }>(
          `SELECT id, email_verified_at FROM platform.users
         WHERE lower(email) = $1`,
          [email],
        );
        if (matches.rowCount && matches.rowCount > 1) {
          report.conflicts.push({
            entityType: "user",
            sourceId: sourceUser.id,
            reason: "Multiple platform users match the normalized email.",
          });
          continue;
        }
        const existing = matches.rows[0];
        if (
          existing?.email_verified_at &&
          sourceUser.emailVerified &&
          existing.email_verified_at.getTime() !==
            sourceUser.emailVerified.getTime()
        ) {
          report.conflicts.push({
            entityType: "user",
            sourceId: sourceUser.id,
            reason: "Verified identity timestamps conflict.",
          });
          continue;
        }
        let targetId = existing?.id;
        if (!targetId && !options.dryRun && !options.verifyOnly) {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO platform.users
             (email, display_name, avatar_url, email_verified_at, status)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
            [
              email,
              sourceUser.name ?? email,
              sourceUser.image,
              sourceUser.emailVerified,
              sourceUser.emailVerified ? "active" : "pending",
            ],
          );
          targetId = inserted.rows[0]?.id;
        }
        if (!targetId && options.dryRun) targetId = `dry-run:${sourceUser.id}`;
        if (!targetId) continue;
        userMap.set(sourceUser.id, targetId);
        report.users += 1;
        if (!options.dryRun && !options.verifyOnly) {
          await client.query(
            `INSERT INTO platform.tenant_memberships
             (tenant_id, user_id, role)
           VALUES ($1, $2, 'member')
           ON CONFLICT (tenant_id, user_id) DO NOTHING`,
            [options.targetTenantId, targetId],
          );
          await client.query(
            `INSERT INTO presentation.import_ledger
             (run_id, entity_type, source_id, target_id, created_by_run)
           VALUES ($1, 'user', $2, $3, $4)`,
            [runId, sourceUser.id, targetId, !existing],
          );
        }
      }

      const documents = await source.query<{
        id: string;
        title: string;
        userId: string;
        createdAt: Date;
        updatedAt: Date;
        isPublic: boolean;
        content: unknown;
        theme: string;
        imageSource: string | null;
        prompt: string | null;
        presentationStyle: string | null;
        customization: unknown;
        language: string | null;
        outline: string[];
        searchResults: unknown;
        toolCalls: unknown;
        selectedChunks: unknown;
        templateId: string | null;
      }>(
        `SELECT b.id, b.title, b."userId", b."createdAt", b."updatedAt",
         b."isPublic", p.content, p.theme, p."imageSource", p.prompt,
         p."presentationStyle", p.customization, p.language, p.outline,
         p."searchResults", p."toolCalls", p."selectedChunks", p."templateId"
       FROM "BaseDocument" b
       JOIN "Presentation" p ON p.id = b.id
       ORDER BY b.id`,
      );
      report.checksums["documents"] = checksum(documents.rows);
      for (const sourceDocument of documents.rows) {
        const ownerId = userMap.get(sourceDocument.userId);
        if (!ownerId) {
          report.conflicts.push({
            entityType: "document",
            sourceId: sourceDocument.id,
            reason: "Document owner was not imported.",
          });
          continue;
        }
        report.documents += 1;
        if (options.dryRun || options.verifyOnly) continue;
        const inserted = await client.query<{ id: string; revision: number }>(
          `INSERT INTO presentation.documents
           (tenant_id, owner_user_id, title, content, source_import_id,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, source_import_id) DO UPDATE SET
           title = EXCLUDED.title,
           content = EXCLUDED.content,
           updated_at = EXCLUDED.updated_at
         RETURNING id, revision`,
          [
            options.targetTenantId,
            ownerId,
            sourceDocument.title,
            JSON.stringify(sourceDocument.content),
            sourceDocument.id,
            sourceDocument.createdAt,
            sourceDocument.updatedAt,
          ],
        );
        const targetId = inserted.rows[0]?.id;
        if (!targetId) continue;
        await client.query(
          `INSERT INTO presentation.presentations
           (document_id, tenant_id, outline, settings, generation_state)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (document_id) DO UPDATE SET
           outline = EXCLUDED.outline,
           settings = EXCLUDED.settings,
           generation_state = EXCLUDED.generation_state,
           updated_at = now()`,
          [
            targetId,
            options.targetTenantId,
            JSON.stringify(sourceDocument.outline),
            JSON.stringify({
              theme: sourceDocument.theme,
              imageSource: sourceDocument.imageSource,
              presentationStyle: sourceDocument.presentationStyle,
              customization: sourceDocument.customization,
              language: sourceDocument.language,
              templateId: sourceDocument.templateId,
            }),
            JSON.stringify({
              prompt: sourceDocument.prompt,
              searchResults: sourceDocument.searchResults,
              toolCalls: sourceDocument.toolCalls,
              selectedChunks: sourceDocument.selectedChunks,
            }),
          ],
        );
        await client.query(
          `INSERT INTO presentation.import_ledger
           (run_id, entity_type, source_id, target_id, target_revision,
            created_by_run)
         VALUES ($1, 'document', $2, $3, $4, true)`,
          [runId, sourceDocument.id, targetId, inserted.rows[0]?.revision ?? 1],
        );
      }

      const themes = await source.query<{
        id: string;
        name: string;
        description: string | null;
        userId: string;
        isAdmin: boolean;
        themeData: unknown;
        createdAt: Date;
        updatedAt: Date;
      }>(
        `SELECT id, name, description, "userId", "isAdmin", "themeData",
         "createdAt", "updatedAt"
       FROM "CustomTheme" ORDER BY id`,
      );
      report.checksums["themes"] = checksum(themes.rows);
      for (const theme of themes.rows) {
        const ownerId = userMap.get(theme.userId);
        if (!ownerId) {
          report.conflicts.push({
            entityType: "theme",
            sourceId: theme.id,
            reason: "Theme owner was not imported.",
          });
          continue;
        }
        report.themes += 1;
        if (options.dryRun || options.verifyOnly) continue;
        await client.query(
          `INSERT INTO presentation.themes
           (tenant_id, owner_user_id, name, description, definition, built_in,
            source_import_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            options.targetTenantId,
            ownerId,
            theme.name,
            theme.description ?? "",
            JSON.stringify(theme.themeData),
            theme.isAdmin,
            theme.id,
            theme.createdAt,
            theme.updatedAt,
          ],
        );
      }

      const images = await source.query<{
        id: string;
        url: string;
        userId: string;
        prompt: string;
        createdAt: Date;
      }>(
        `SELECT id, url, "userId", prompt, "createdAt"
       FROM "GeneratedImage" ORDER BY id`,
      );
      report.checksums["images"] = checksum(images.rows);
      for (const image of images.rows) {
        const ownerId = userMap.get(image.userId);
        if (!ownerId) {
          report.conflicts.push({
            entityType: "image",
            sourceId: image.id,
            reason: "Image owner was not imported.",
          });
          continue;
        }
        report.images += 1;
        if (options.dryRun || options.verifyOnly) continue;
        await client.query(
          `INSERT INTO presentation.generated_images
           (tenant_id, owner_user_id, asset_reference, prompt_reference,
            provider_id, model_id, source_import_id, created_at)
         VALUES ($1, $2, $3, $4, 'imported', 'source', $5, $6)
         ON CONFLICT (tenant_id, source_import_id) DO NOTHING`,
          [
            options.targetTenantId,
            ownerId,
            image.url,
            `import:${image.id}`,
            image.id,
            image.createdAt,
          ],
        );
      }

      if (!options.verifyOnly) {
        await client.query(
          `UPDATE presentation.import_runs SET
           status = $2,
           report = $3,
           updated_at = now()
         WHERE id = $1`,
          [runId, options.dryRun ? "dry-run-complete" : "complete", report],
        );
      }
      if (options.dryRun) {
        throw new DryRunRollback(report);
      }
    })
    .catch((error: unknown) => {
      if (!(error instanceof DryRunRollback)) throw error;
    });

  return report;
}

class DryRunRollback extends Error {
  constructor(readonly report: PresentationImportReport) {
    super("Dry run complete.");
  }
}
