import { randomUUID } from "node:crypto";
import {
  createPlatformDatabase,
  type PlatformDatabase,
  withTenant,
} from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  DocumentArtifactRepository,
  MAX_DOCUMENT_ARTIFACT_BYTES,
  type ProvisionBuiltInTemplateSource,
} from "./document-artifact-repository";

let pg: DisposablePostgres;
let member: PlatformDatabase;
let repository: DocumentArtifactRepository;
let tenantId: string;
let otherTenantId: string;
let actorId: string;
let otherActorId: string;

beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await pg.owner.query(`
    GRANT USAGE ON SCHEMA platform TO fixture_member;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO fixture_member;`);
  const tenants = await pg.owner.query<{ id: string }>(
    `INSERT INTO platform.tenants (slug, name)
     VALUES ('artifact-north', 'North'), ('artifact-south', 'South') RETURNING id`,
  );
  tenantId = tenants.rows[0]!.id;
  otherTenantId = tenants.rows[1]!.id;
  const users = await pg.owner.query<{ id: string }>(
    `INSERT INTO platform.users (email, display_name)
     VALUES ('artifact-one@example.test', 'One'),
            ('artifact-two@example.test', 'Two') RETURNING id`,
  );
  actorId = users.rows[0]!.id;
  otherActorId = users.rows[1]!.id;
  member = createPlatformDatabase(pg.memberUrl);
  repository = new DocumentArtifactRepository(member);
}, 30_000);

afterAll(async () => {
  await member?.close();
  await pg?.stop();
});

it("persists file bytes and refuses another actor, tenant, or artifact type", async () => {
  const bytes = Buffer.from("private resume bytes");
  const artifactId = await repository.create({
    tenantId,
    actorId,
    artifactType: "interview.document-template-source",
    title: "resume.docx",
    bytes,
  });
  expect(
    await repository.read({
      tenantId,
      actorId,
      artifactId,
      expectedType: "interview.document-template-source",
    }),
  ).toEqual(bytes);
  expect(
    await repository.read({
      tenantId,
      actorId: otherActorId,
      artifactId,
      expectedType: "interview.document-template-source",
    }),
  ).toBeNull();
  expect(
    await repository.read({
      tenantId: otherTenantId,
      actorId,
      artifactId,
      expectedType: "interview.document-template-source",
    }),
  ).toBeNull();
  expect(
    await repository.read({
      tenantId,
      actorId,
      artifactId,
      expectedType: "interview.document-export",
    }),
  ).toBeNull();
});

it("enforces the byte limit before a metadata row is created", async () => {
  await expect(
    repository.create({
      tenantId,
      actorId,
      artifactType: "interview.document-export",
      title: "too-big.docx",
      bytes: new Uint8Array(MAX_DOCUMENT_ARTIFACT_BYTES + 1),
    }),
  ).rejects.toThrow("exceeds the 10 MiB size limit");
  const count = await pg.owner.query<{ count: string }>(
    `SELECT count(*) FROM platform.artifacts WHERE title = 'too-big.docx'`,
  );
  expect(count.rows[0]?.count).toBe("0");
});

it("enforces forced RLS and leaves document artifacts immutable", async () => {
  const artifactId = await repository.create({
    tenantId,
    actorId,
    artifactType: "interview.document-export",
    title: "export.md",
    bytes: Buffer.from("# Private"),
  });
  const visibleWithoutActor = await member.tenantTransaction(
    tenantId,
    (client) =>
      client.query(`SELECT id FROM platform.artifacts WHERE id = $1`, [
        artifactId,
      ]),
  );
  expect(visibleWithoutActor.rows).toHaveLength(0);
  const changed = await member.transaction(async (client) => {
    await client.query(
      `SELECT set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true)`,
      [tenantId, actorId],
    );
    return client.query(
      `UPDATE platform.artifacts SET title = 'changed' WHERE id = $1`,
      [artifactId],
    );
  });
  expect(changed.rowCount).toBe(0);
  await expect(
    member.transaction(async (client) => {
      await client.query(
        `SELECT set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true)`,
        [tenantId, otherActorId],
      );
      await client.query(
        `INSERT INTO platform.artifacts (id, tenant_id, owner_user_id, product_id, artifact_type, title, payload_reference)
         VALUES ($1, $2, $3, 'omnitech.interview', 'interview.document-export', 'spoof', 'none')`,
        [randomUUID(), tenantId, actorId],
      );
    }),
  ).rejects.toThrow();
});

it("provisions a tenant-local built-in source once and rejects member forgery", async () => {
  const source = Buffer.from("# Built-in resume\n{{full_name}}");
  const input = {
    tenantId,
    key: "resume-default-v1",
    title: "Default resume.md",
    bytes: source,
  };
  const artifactId = await repository.provisionBuiltIn(input);
  expect(await repository.provisionBuiltIn(input)).toBe(artifactId);
  expect(
    await repository.read({
      tenantId,
      actorId: otherActorId,
      artifactId,
      expectedType: "interview.document-template-builtin",
    }),
  ).toEqual(source);
  expect(
    await repository.read({
      tenantId: otherTenantId,
      actorId,
      artifactId,
      expectedType: "interview.document-template-builtin",
    }),
  ).toBeNull();
  await expect(
    repository.provisionBuiltIn({ ...input, bytes: Buffer.from("changed") }),
  ).rejects.toThrow("different content");
  await expect(
    member.transaction(async (client) => {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [
        tenantId,
      ]);
      await client.query(
        `INSERT INTO platform.artifacts (id, tenant_id, owner_user_id, product_id, artifact_type, title, payload_reference)
         VALUES ($1, $2, NULL, 'omnitech.interview', 'interview.document-template-builtin', 'forged', 'none')`,
        [randomUUID(), tenantId],
      );
    }),
  ).rejects.toThrow();
});

it("detects a deliberately loosened document policy and restores it on rollback", async () => {
  const artifactId = await repository.create({
    tenantId,
    actorId,
    artifactType: "interview.document-export",
    title: "negative-control.md",
    bytes: Buffer.from("private"),
  });
  const rollback = new Error("rollback negative control");
  await expect(
    pg.owner.transaction(async (client) => {
      await client.query(
        `ALTER POLICY document_artifacts_select ON platform.artifacts USING (true)`,
      );
      await client.query("SET LOCAL ROLE fixture_member");
      await client.query(
        `SELECT set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true)`,
        [tenantId, otherActorId],
      );
      const wronglyVisible = await client.query<{ id: string }>(
        `SELECT id FROM platform.artifacts WHERE id = $1`,
        [artifactId],
      );
      expect(wronglyVisible.rows).toHaveLength(1);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  const policy = await pg.owner.query<{ qual: string }>(
    `SELECT qual FROM pg_policies
     WHERE schemaname = 'platform' AND tablename = 'artifacts'
       AND policyname = 'document_artifacts_select'`,
  );
  expect(policy.rows[0]?.qual).toContain("app.actor_id");
  expect(
    await repository.read({
      tenantId,
      actorId: otherActorId,
      artifactId,
      expectedType: "interview.document-export",
    }),
  ).toBeNull();
});

// Characterisation of the stored rows and of the two methods that write
// inside a caller's transaction: what the product's document repository
// relies on when it links a template or an export to its file.
const storedRows = (artifactId: string) =>
  pg.owner.query<{
    owner_user_id: string | null;
    product_id: string;
    artifact_type: string;
    title: string;
    metadata: unknown;
    payload_reference: string;
    byte_length: number;
    bytes: Buffer;
  }>(
    `SELECT a.owner_user_id, a.product_id, a.artifact_type, a.title, a.metadata,
            a.payload_reference, p.byte_length, p.bytes
       FROM platform.artifacts a
       JOIN platform.artifact_payloads p
         ON p.tenant_id = a.tenant_id AND p.artifact_id = a.id
      WHERE a.id = $1`,
    [artifactId],
  );

it("stores one metadata row and one payload row, with the title trimmed", async () => {
  const bytes = Buffer.from([0, 255, 1, 254]);
  const artifactId = await repository.create({
    tenantId,
    actorId,
    artifactType: "interview.document-export",
    title: "  shaped.docx  ",
    bytes,
    metadata: { format: "docx", pages: 2 },
  });
  expect((await storedRows(artifactId)).rows).toEqual([
    {
      owner_user_id: actorId,
      product_id: "omnitech.interview",
      artifact_type: "interview.document-export",
      title: "shaped.docx",
      metadata: { format: "docx", pages: 2 },
      payload_reference: `platform.artifact_payloads/${artifactId}`,
      byte_length: 4,
      bytes,
    },
  ]);
  const bare = await repository.create({
    tenantId,
    actorId,
    artifactType: "interview.document-template-source",
    title: "bare.md",
    bytes,
  });
  expect((await storedRows(bare)).rows[0]?.metadata).toEqual({});
});

it("refuses an artifact that breaks a storage rule, each with its own message", async () => {
  const valid = {
    tenantId,
    actorId,
    artifactType: "interview.document-export" as const,
    title: "rules.md",
    bytes: Buffer.from("x"),
  };
  await expect(
    repository.create({ ...valid, artifactType: "interview.other" as never }),
  ).rejects.toThrow("Unsupported document artifact type.");
  await expect(
    repository.create({ ...valid, bytes: new Uint8Array() }),
  ).rejects.toThrow("Document artifact cannot be empty.");
  await expect(repository.create({ ...valid, title: "   " })).rejects.toThrow(
    "Document artifact needs a title.",
  );
  await expect(
    repository.provisionBuiltIn({ ...valid, key: "Not_A_Key" }),
  ).rejects.toThrow("Built-in template key is invalid.");
  await expect(
    repository.provisionBuiltIn({ ...valid, key: "a-key", title: " " }),
  ).rejects.toThrow("Built-in template needs a title.");
  await expect(
    repository.provisionBuiltIn({
      ...valid,
      key: "a-key",
      bytes: new Uint8Array(),
    }),
  ).rejects.toThrow("Built-in template source size is invalid.");
  const count = await pg.owner.query<{ count: string }>(
    `SELECT count(*) FROM platform.artifacts WHERE title = 'rules.md'`,
  );
  expect(count.rows[0]?.count).toBe("0");
});

it("writes inside the caller's transaction, and rolls back with it", async () => {
  const input = {
    tenantId,
    actorId,
    artifactType: "interview.document-template-source" as const,
    title: " linked.docx ",
    bytes: Buffer.from("linked bytes"),
    metadata: { source: "upload" },
  };
  const scope = { tenantId, actorId };
  const kept = await withTenant(
    scope,
    (db) => repository.createInTenantTransaction(db, input),
    { database: member },
  );
  expect((await storedRows(kept)).rows).toEqual([
    {
      owner_user_id: actorId,
      product_id: "omnitech.interview",
      artifact_type: "interview.document-template-source",
      title: "linked.docx",
      metadata: { source: "upload" },
      payload_reference: `platform.artifact_payloads/${kept}`,
      byte_length: 12,
      bytes: input.bytes,
    },
  ]);
  expect(
    await repository.read({
      ...scope,
      artifactId: kept,
      expectedType: "interview.document-template-source",
    }),
  ).toEqual(input.bytes);

  let lost = "";
  const failure = new Error("the link failed");
  await expect(
    withTenant(
      scope,
      async (db) => {
        lost = await repository.createInTenantTransaction(db, input);
        throw failure;
      },
      { database: member },
    ),
  ).rejects.toBe(failure);
  expect((await storedRows(lost)).rows).toEqual([]);

  // An actor cannot store an artifact in a transaction scoped to another.
  await expect(
    withTenant(
      { tenantId, actorId: otherActorId },
      (db) => repository.createInTenantTransaction(db, input),
      { database: member },
    ),
  ).rejects.toThrow();
  await expect(
    withTenant(
      scope,
      (db) =>
        repository.createInTenantTransaction(db, {
          ...input,
          bytes: new Uint8Array(MAX_DOCUMENT_ARTIFACT_BYTES + 1),
        }),
      { database: member },
    ),
  ).rejects.toThrow("exceeds the 10 MiB size limit");
});

it("provisions a built-in source once inside the caller's transaction", async () => {
  const source = Buffer.from("# Built-in cover letter");
  const input = {
    tenantId,
    key: "cover-letter-default-v1",
    title: " Default cover letter.md ",
    bytes: source,
    metadata: { format: "md" },
  };
  const scope = { tenantId, actorId };
  const provision = (
    as: { tenantId: string; actorId: string },
    value: ProvisionBuiltInTemplateSource,
  ) =>
    withTenant(
      as,
      (db) => repository.provisionBuiltInInTenantTransaction(db, value),
      { database: member },
    );

  const artifactId = await provision(scope, input);
  // The id is derived from the tenant and the key, so any member's repeat,
  // and the standalone path, name the same row and write nothing more.
  expect(await provision({ tenantId, actorId: otherActorId }, input)).toBe(
    artifactId,
  );
  expect(await repository.provisionBuiltIn(input)).toBe(artifactId);
  expect((await storedRows(artifactId)).rows).toEqual([
    {
      owner_user_id: null,
      product_id: "omnitech.interview",
      artifact_type: "interview.document-template-builtin",
      title: "Default cover letter.md",
      metadata: { format: "md", builtInKey: "cover-letter-default-v1" },
      payload_reference: `platform.artifact_payloads/${artifactId}`,
      byte_length: source.byteLength,
      bytes: source,
    },
  ]);
  // The same key in another tenant is another row.
  const elsewhere = await provision(
    { tenantId: otherTenantId, actorId },
    { ...input, tenantId: otherTenantId },
  );
  expect(elsewhere).not.toBe(artifactId);

  await expect(
    provision(scope, { ...input, bytes: Buffer.from("changed") }),
  ).rejects.toThrow("Built-in template key already has different content.");
  expect((await storedRows(artifactId)).rows[0]?.bytes).toEqual(source);
  for (const invalid of [
    { ...input, key: "Not_A_Key" },
    { ...input, title: "  " },
    { ...input, bytes: Buffer.alloc(0) },
    { ...input, bytes: new Uint8Array(MAX_DOCUMENT_ARTIFACT_BYTES + 1) },
  ])
    await expect(provision(scope, invalid)).rejects.toThrow(
      "Built-in template source is invalid.",
    );
});
