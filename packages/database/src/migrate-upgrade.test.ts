import { cp, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPlatformDatabase, type PlatformDatabase } from "./connection.js";
import { migrateDatabase } from "./migrate.js";
import {
  createMigratingApplicationDatabase,
  type DisposablePostgres,
  startDisposablePostgres,
} from "./test-support/postgres.js";

const stream = fileURLToPath(new URL("../drizzle", import.meta.url));

// The application owns its tables and is neither a superuser nor exempt from
// row-level security, so an upgrade runs under forced RLS exactly as `pnpm dev`
// and production run it. An empty database or a superuser cannot show that.
let pg: DisposablePostgres;
let app: PlatformDatabase;
beforeAll(async () => {
  pg = await startDisposablePostgres();
  app = createPlatformDatabase(
    await createMigratingApplicationDatabase(pg, "upgrade"),
  );
}, 60_000);
afterAll(async () => {
  await app?.close();
  await pg?.stop();
});

// Every migration before `through`, as a stream a database can be left at.
async function streamBefore(through: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "migrations-"));
  for (const name of (await readdir(stream)).sort()) {
    if (name.replace(/^\d+_/, "") === through) break;
    await mkdir(join(folder, name));
    await cp(join(stream, name), join(folder, name), { recursive: true });
  }
  return folder;
}

it("upgrades existing agent jobs, events and documents under forced row-level security", async () => {
  await migrateDatabase(
    app,
    await streamBefore("agent_job_tenant_rows_and_composite_keys"),
  );

  // Rows written by the previous release, each inside its own tenant.
  const tenant = (
    await app.query<{ id: string }>(
      "INSERT INTO platform.tenants (slug, name) VALUES ('north', 'North') RETURNING id",
    )
  ).rows[0]!.id;
  const user = (
    await app.query<{ id: string }>(
      "INSERT INTO platform.users (email, display_name) VALUES ('ada@example.test', 'Ada') RETURNING id",
    )
  ).rows[0]!.id;
  const { job, document } = await app.tenantTransaction(tenant, async (c) => {
    const jobId = (
      await c.query<{ id: string }>(
        `INSERT INTO ai.agent_jobs
           (tenant_id, user_id, product_id, status, profile_snapshot, prompt_reference)
         VALUES ($1, $2, 'omnitech.interview', 'queued', '{}', 'ref') RETURNING id`,
        [tenant, user],
      )
    ).rows[0]!.id;
    await c.query(
      `INSERT INTO ai.agent_job_events (job_id, sequence, event)
       VALUES ($1, 1, '{"type":"started"}'), ($1, 2, '{"type":"completed"}')`,
      [jobId],
    );
    await c.query(
      `INSERT INTO ai.agent_artifacts (job_id, artifact_reference, kind)
       VALUES ($1, 'artifact', 'file')`,
      [jobId],
    );
    const documentId = (
      await c.query<{ id: string }>(
        `INSERT INTO presentation.documents (tenant_id, owner_user_id, title)
         VALUES ($1, $2, 'Deck') RETURNING id`,
        [tenant, user],
      )
    ).rows[0]!.id;
    await c.query(
      `INSERT INTO presentation.slides (tenant_id, document_id, position, source_xml)
       VALUES ($1, $2, 0, '<slide/>')`,
      [tenant, documentId],
    );
    return { job: jobId, document: documentId };
  });

  await migrateDatabase(app);

  // The rows took their job's tenant, and the new keys and forced RLS hold.
  const upgraded = await app.tenantTransaction(tenant, async (c) => ({
    events: (
      await c.query<{ tenant_id: string }>(
        "SELECT tenant_id FROM ai.agent_job_events WHERE job_id = $1",
        [job],
      )
    ).rows,
    artifacts: (
      await c.query<{ tenant_id: string }>(
        "SELECT tenant_id FROM ai.agent_artifacts WHERE job_id = $1",
        [job],
      )
    ).rows,
    slides: (
      await c.query(
        "SELECT 1 FROM presentation.slides WHERE document_id = $1",
        [document],
      )
    ).rowCount,
  }));
  expect(upgraded.events.map((row) => row.tenant_id)).toEqual([tenant, tenant]);
  expect(upgraded.artifacts.map((row) => row.tenant_id)).toEqual([tenant]);
  expect(upgraded.slides).toBe(1);
  expect(
    (
      await app.query(
        `SELECT relname FROM pg_class
          WHERE relname IN ('agent_jobs', 'documents') AND NOT relforcerowsecurity`,
      )
    ).rows,
  ).toEqual([]);
});
