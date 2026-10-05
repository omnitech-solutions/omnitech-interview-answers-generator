import { randomUUID } from "node:crypto";
import {
  createPlatformDatabase,
  type PlatformDatabase,
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
