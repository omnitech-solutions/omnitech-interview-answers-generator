import { createHash, randomUUID } from "node:crypto";
import {
  type PlatformDatabase,
  type TenantDatabase,
  enterTenant,
} from "@omnitech/database";
import { sql } from "drizzle-orm";

export const MAX_DOCUMENT_ARTIFACT_BYTES = 10 * 1024 * 1024;

export type DocumentArtifactType =
  | "interview.document-template-source"
  | "interview.document-export";

export interface CreateDocumentArtifact {
  tenantId: string;
  actorId: string;
  artifactType: DocumentArtifactType;
  title: string;
  bytes: Uint8Array;
  metadata?: Record<string, unknown>;
}

export interface ReadDocumentArtifact {
  tenantId: string;
  actorId: string;
  artifactId: string;
  expectedType: DocumentArtifactType | "interview.document-template-builtin";
}

export interface ProvisionBuiltInTemplateSource {
  tenantId: string;
  key: string;
  title: string;
  bytes: Uint8Array;
  metadata?: Record<string, unknown>;
}

function builtInId(tenantId: string, key: string): string {
  const digest = createHash("sha256")
    .update(`omnitech.interview/document-template-builtin/${tenantId}/${key}`)
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

// Platform storage owns bytes and metadata. The caller must first resolve the
// template revision or export under Interview's actor-scoped repository; an
// arbitrary artifact ID from a request is not proof of that relationship.
export class DocumentArtifactRepository {
  constructor(private readonly database: PlatformDatabase) {}

  private validate(input: CreateDocumentArtifact): void {
    if (
      input.artifactType !== "interview.document-template-source" &&
      input.artifactType !== "interview.document-export"
    )
      throw new Error("Unsupported document artifact type.");
    if (input.bytes.byteLength > MAX_DOCUMENT_ARTIFACT_BYTES)
      throw new Error("Document artifact exceeds the 10 MiB size limit.");
    if (input.bytes.byteLength === 0)
      throw new Error("Document artifact cannot be empty.");
    if (!input.title.trim())
      throw new Error("Document artifact needs a title.");
  }

  /** Store bytes inside the caller's actor-scoped transaction so a failed
   * template or export link rolls back the artifact and payload together. */
  async createInTenantTransaction(
    db: TenantDatabase,
    input: CreateDocumentArtifact,
  ): Promise<string> {
    this.validate(input);
    const artifactId = randomUUID();
    await db.execute(sql`INSERT INTO platform.artifacts
      (id, tenant_id, owner_user_id, product_id, artifact_type, title, metadata, payload_reference)
      VALUES (${artifactId}::uuid, ${input.tenantId}::uuid, ${input.actorId}::uuid,
        'omnitech.interview', ${input.artifactType}, ${input.title.trim()},
        ${JSON.stringify(input.metadata ?? {})}::jsonb, ${`platform.artifact_payloads/${artifactId}`})`);
    await db.execute(sql`INSERT INTO platform.artifact_payloads
      (tenant_id, artifact_id, bytes, byte_length)
      VALUES (${input.tenantId}::uuid, ${artifactId}::uuid,
        ${Buffer.from(input.bytes)}, ${input.bytes.byteLength})`);
    return artifactId;
  }

  async create(input: CreateDocumentArtifact): Promise<string> {
    this.validate(input);
    const artifactId = randomUUID();
    await this.database.transaction(async (client) => {
      await enterTenant(client, {
        tenantId: input.tenantId,
        actorId: input.actorId,
      });
      await client.query(
        `INSERT INTO platform.artifacts
           (id, tenant_id, owner_user_id, product_id, artifact_type,
            title, metadata, payload_reference)
         VALUES ($1, $2, $3, 'omnitech.interview', $4, $5, $6, $7)`,
        [
          artifactId,
          input.tenantId,
          input.actorId,
          input.artifactType,
          input.title.trim(),
          input.metadata ?? {},
          `platform.artifact_payloads/${artifactId}`,
        ],
      );
      await client.query(
        `INSERT INTO platform.artifact_payloads
           (tenant_id, artifact_id, bytes, byte_length)
         VALUES ($1, $2, $3, $4)`,
        [
          input.tenantId,
          artifactId,
          Buffer.from(input.bytes),
          input.bytes.byteLength,
        ],
      );
    });
    return artifactId;
  }

  // Called only by trusted tenant catalog provisioning. No product route
  // accepts a client-provided key or invokes this method.
  async provisionBuiltIn(
    input: ProvisionBuiltInTemplateSource,
  ): Promise<string> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.key))
      throw new Error("Built-in template key is invalid.");
    if (!input.title.trim())
      throw new Error("Built-in template needs a title.");
    if (
      input.bytes.byteLength === 0 ||
      input.bytes.byteLength > MAX_DOCUMENT_ARTIFACT_BYTES
    )
      throw new Error("Built-in template source size is invalid.");

    const artifactId = builtInId(input.tenantId, input.key);
    const bytes = Buffer.from(input.bytes);
    await this.database.transaction(async (client) => {
      await enterTenant(client, { tenantId: input.tenantId });
      await client.query(
        "SELECT set_config('app.document_catalog_provisioner', 'on', true)",
      );
      await client.query(
        `INSERT INTO platform.artifacts
           (id, tenant_id, owner_user_id, product_id, artifact_type,
            title, metadata, payload_reference)
         VALUES ($1, $2, NULL, 'omnitech.interview',
                 'interview.document-template-builtin', $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [
          artifactId,
          input.tenantId,
          input.title.trim(),
          { ...input.metadata, builtInKey: input.key },
          `platform.artifact_payloads/${artifactId}`,
        ],
      );
      await client.query(
        `INSERT INTO platform.artifact_payloads
           (tenant_id, artifact_id, bytes, byte_length)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, artifact_id) DO NOTHING`,
        [input.tenantId, artifactId, bytes, bytes.byteLength],
      );
      const saved = await client.query<{ bytes: Buffer }>(
        `SELECT p.bytes FROM platform.artifact_payloads p
          JOIN platform.artifacts a ON a.tenant_id = p.tenant_id AND a.id = p.artifact_id
         WHERE p.tenant_id = $1 AND p.artifact_id = $2
           AND a.product_id = 'omnitech.interview'
           AND a.artifact_type = 'interview.document-template-builtin'
           AND a.owner_user_id IS NULL`,
        [input.tenantId, artifactId],
      );
      if (!saved.rows[0]?.bytes.equals(bytes))
        throw new Error("Built-in template key already has different content.");
    });
    return artifactId;
  }

  /** Provision a tenant catalog file in the same transaction as its template. */
  async provisionBuiltInInTenantTransaction(
    db: TenantDatabase,
    input: ProvisionBuiltInTemplateSource,
  ): Promise<string> {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.key) ||
      !input.title.trim() ||
      input.bytes.byteLength === 0 ||
      input.bytes.byteLength > MAX_DOCUMENT_ARTIFACT_BYTES
    )
      throw new Error("Built-in template source is invalid.");
    const artifactId = builtInId(input.tenantId, input.key);
    await db.execute(
      sql`SELECT set_config('app.document_catalog_provisioner', 'on', true)`,
    );
    await db.execute(sql`INSERT INTO platform.artifacts
      (id, tenant_id, owner_user_id, product_id, artifact_type, title, metadata, payload_reference)
      VALUES (${artifactId}::uuid, ${input.tenantId}::uuid, NULL, 'omnitech.interview',
        'interview.document-template-builtin', ${input.title.trim()},
        ${JSON.stringify({ ...input.metadata, builtInKey: input.key })}::jsonb,
        ${`platform.artifact_payloads/${artifactId}`})
      ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`INSERT INTO platform.artifact_payloads
      (tenant_id, artifact_id, bytes, byte_length)
      VALUES (${input.tenantId}::uuid, ${artifactId}::uuid,
        ${Buffer.from(input.bytes)}, ${input.bytes.byteLength})
      ON CONFLICT (tenant_id, artifact_id) DO NOTHING`);
    const saved =
      await db.execute(sql`SELECT p.bytes FROM platform.artifact_payloads p
      JOIN platform.artifacts a ON a.tenant_id=p.tenant_id AND a.id=p.artifact_id
      WHERE p.tenant_id=${input.tenantId}::uuid AND p.artifact_id=${artifactId}::uuid
        AND a.product_id='omnitech.interview'
        AND a.artifact_type='interview.document-template-builtin'
        AND a.owner_user_id IS NULL`);
    const bytes = saved.rows[0]?.["bytes"];
    if (!Buffer.isBuffer(bytes) || !bytes.equals(Buffer.from(input.bytes)))
      throw new Error("Built-in template key already has different content.");
    return artifactId;
  }

  async read(input: ReadDocumentArtifact): Promise<Buffer | null> {
    return this.database.transaction(async (client) => {
      await enterTenant(client, {
        tenantId: input.tenantId,
        actorId: input.actorId,
      });
      const result = await client.query<{ bytes: Buffer }>(
        `SELECT p.bytes
           FROM platform.artifact_payloads p
           JOIN platform.artifacts a
             ON a.tenant_id = p.tenant_id AND a.id = p.artifact_id
          WHERE p.tenant_id = $1 AND p.artifact_id = $2
            AND a.product_id = 'omnitech.interview'
            AND a.artifact_type = $3
            AND (a.owner_user_id = $4 OR
                 (a.owner_user_id IS NULL AND
                  a.artifact_type = 'interview.document-template-builtin'))`,
        [input.tenantId, input.artifactId, input.expectedType, input.actorId],
      );
      return result.rows[0]?.bytes ?? null;
    });
  }
}
