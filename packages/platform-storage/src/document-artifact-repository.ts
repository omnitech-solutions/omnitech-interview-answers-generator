import { randomUUID } from "node:crypto";
import {
  enterTenant,
  type PlatformDatabase,
  type TenantDatabase,
  withTenant,
} from "@omnitech/database";
import { and, eq, isNull, or, type SQL, sql } from "drizzle-orm";
import {
  assertBuiltInProvisionable,
  assertBuiltInProvisionableInTransaction,
  assertCreatable,
  BUILT_IN_TEMPLATE_TYPE,
  builtInId,
  builtInMetadata,
  type CreateDocumentArtifact,
  DOCUMENT_PRODUCT_ID,
  type ProvisionBuiltInTemplateSource,
  payloadReference,
  type ReadDocumentArtifact,
} from "./document-artifact-rules";
import { artifactPayloads, artifacts } from "./schema/platform";

export {
  type CreateDocumentArtifact,
  type DocumentArtifactType,
  MAX_DOCUMENT_ARTIFACT_BYTES,
  type ProvisionBuiltInTemplateSource,
  type ReadDocumentArtifact,
} from "./document-artifact-rules";

const differentContent = "Built-in template key already has different content.";

// Platform storage owns bytes and metadata. The caller must first resolve the
// template revision or export under Interview's actor-scoped repository; an
// arbitrary artifact ID from a request is not proof of that relationship.
// What may be stored is decided in ./document-artifact-rules; this class only
// persists, in the caller's transaction or in one of its own.
export class DocumentArtifactRepository {
  constructor(private readonly database: PlatformDatabase) {}

  /** Store bytes inside the caller's actor-scoped transaction so a failed
   * template or export link rolls back the artifact and payload together. */
  async createInTenantTransaction(
    db: TenantDatabase,
    input: CreateDocumentArtifact,
  ): Promise<string> {
    assertCreatable(input);
    const artifactId = randomUUID();
    await db.insert(artifacts).values({
      id: artifactId,
      tenantId: input.tenantId,
      ownerUserId: input.actorId,
      productId: DOCUMENT_PRODUCT_ID,
      artifactType: input.artifactType,
      title: input.title.trim(),
      metadata: input.metadata ?? {},
      payloadReference: payloadReference(artifactId),
    });
    await db.insert(artifactPayloads).values({
      tenantId: input.tenantId,
      artifactId,
      bytes: Buffer.from(input.bytes),
      byteLength: input.bytes.byteLength,
    });
    return artifactId;
  }

  // The same write in a transaction of its own, as the owning actor.
  async create(input: CreateDocumentArtifact): Promise<string> {
    assertCreatable(input);
    return withTenant(
      { tenantId: input.tenantId, actorId: input.actorId },
      (db) => this.createInTenantTransaction(db, input),
      { database: this.database },
    );
  }

  // Called only by trusted tenant catalog provisioning. No product route
  // accepts a client-provided key or invokes this method. It runs with no
  // actor, and a tenant-scoped Drizzle handle exists only for an actor
  // (withTenant), so its statements stay raw on the pg client.
  async provisionBuiltIn(
    input: ProvisionBuiltInTemplateSource,
  ): Promise<string> {
    assertBuiltInProvisionable(input);
    const artifactId = builtInId(input.tenantId, input.key);
    const bytes = Buffer.from(input.bytes);
    await this.database.transaction(async (client) => {
      await enterTenant(client, { tenantId: input.tenantId });
      // Raw: set_config of a cross-tenant setting (ADR-0023 Decision 1).
      await client.query(
        "SELECT set_config('app.document_catalog_provisioner', 'on', true)",
      );
      // Raw: no actor, so no Drizzle handle (see above).
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
          builtInMetadata(input),
          payloadReference(artifactId),
        ],
      );
      // Raw: no actor, so no Drizzle handle.
      await client.query(
        `INSERT INTO platform.artifact_payloads
           (tenant_id, artifact_id, bytes, byte_length)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, artifact_id) DO NOTHING`,
        [input.tenantId, artifactId, bytes, bytes.byteLength],
      );
      // Raw: no actor, so no Drizzle handle.
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
        throw new Error(differentContent);
    });
    return artifactId;
  }

  /** Provision a tenant catalog file in the same transaction as its template. */
  async provisionBuiltInInTenantTransaction(
    db: TenantDatabase,
    input: ProvisionBuiltInTemplateSource,
  ): Promise<string> {
    assertBuiltInProvisionableInTransaction(input);
    const artifactId = builtInId(input.tenantId, input.key);
    const bytes = Buffer.from(input.bytes);
    // Raw: set_config of a cross-tenant setting has no builder form
    // (ADR-0023 Decision 1); this file is one of its two named owners.
    await db.execute(
      sql`SELECT set_config('app.document_catalog_provisioner', 'on', true)`,
    );
    // Idempotent on the derived id: a second provisioning writes nothing and
    // the content check below decides whether it was the same source.
    await db
      .insert(artifacts)
      .values({
        id: artifactId,
        tenantId: input.tenantId,
        ownerUserId: null,
        productId: DOCUMENT_PRODUCT_ID,
        artifactType: BUILT_IN_TEMPLATE_TYPE,
        title: input.title.trim(),
        metadata: builtInMetadata(input),
        payloadReference: payloadReference(artifactId),
      })
      .onConflictDoNothing({ target: artifacts.id });
    await db
      .insert(artifactPayloads)
      .values({
        tenantId: input.tenantId,
        artifactId,
        bytes,
        byteLength: bytes.byteLength,
      })
      .onConflictDoNothing({
        target: [artifactPayloads.tenantId, artifactPayloads.artifactId],
      });
    const saved = await payloadBytes(
      db,
      input.tenantId,
      artifactId,
      and(
        eq(artifacts.artifactType, BUILT_IN_TEMPLATE_TYPE),
        isNull(artifacts.ownerUserId),
      ),
    );
    if (!saved?.equals(bytes)) throw new Error(differentContent);
    return artifactId;
  }

  // An artifact reads only as its expected type, and only for its owner or,
  // when it is a tenant's built-in template source, for any member.
  async read(input: ReadDocumentArtifact): Promise<Buffer | null> {
    return withTenant(
      { tenantId: input.tenantId, actorId: input.actorId },
      (db) =>
        payloadBytes(
          db,
          input.tenantId,
          input.artifactId,
          and(
            eq(artifacts.artifactType, input.expectedType),
            or(
              eq(artifacts.ownerUserId, input.actorId),
              and(
                isNull(artifacts.ownerUserId),
                eq(artifacts.artifactType, BUILT_IN_TEMPLATE_TYPE),
              ),
            ),
          ),
        ),
      { database: this.database },
    );
  }
}

// The bytes of one document artifact of a tenant, when `admitted` holds for
// its metadata row.
async function payloadBytes(
  db: TenantDatabase,
  tenantId: string,
  artifactId: string,
  admitted: SQL | undefined,
): Promise<Buffer | null> {
  const rows = await db
    .select({ bytes: artifactPayloads.bytes })
    .from(artifactPayloads)
    .innerJoin(
      artifacts,
      and(
        eq(artifacts.tenantId, artifactPayloads.tenantId),
        eq(artifacts.id, artifactPayloads.artifactId),
      ),
    )
    .where(
      and(
        eq(artifactPayloads.tenantId, tenantId),
        eq(artifactPayloads.artifactId, artifactId),
        eq(artifacts.productId, DOCUMENT_PRODUCT_ID),
        admitted,
      ),
    );
  return rows[0]?.bytes ?? null;
}
