import { cp, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPlatformDatabase, type PlatformDatabase } from "./connection";
import { migrateDatabase } from "./migrate";
import {
  createMigratingApplicationDatabase,
  type DisposablePostgres,
  startDisposablePostgres,
} from "./test-support/postgres";

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

// The interview brief's migration (stages as things, transcripts,
// employer-said entries, research documents) on a database the previous
// release left: an application with its notes, its company's research and two
// bare stages. Nothing is moved or rewritten; the new columns are empty, the
// new tables exist empty, forced, and private to their owner.
it("adds the interview brief's tables and stage columns and leaves existing applications intact", async () => {
  const brief = createPlatformDatabase(
    await createMigratingApplicationDatabase(pg, "brief_upgrade"),
  );
  try {
    await migrateDatabase(brief, await streamBefore("interview_brief_stages"));
    const one = async (sql: string, values: unknown[] = []) =>
      (await brief.query<{ id: string }>(sql, values)).rows[0]!.id;
    const tenant = await one(
      "INSERT INTO platform.tenants (slug, name) VALUES ('north', 'North') RETURNING id",
    );
    const user = await one(
      "INSERT INTO platform.users (email, display_name) VALUES ('ada@example.test', 'Ada') RETURNING id",
    );
    const other = await one(
      "INSERT INTO platform.users (email, display_name) VALUES ('bo@example.test', 'Bo') RETURNING id",
    );
    const before = await brief.tenantTransaction(tenant, async (c) => {
      const id = async (sql: string, values: unknown[]) =>
        (await c.query<{ id: string }>(sql, values)).rows[0]!.id;
      const company = await id(
        "INSERT INTO interview.companies (tenant_id, name, research) VALUES ($1, 'Larkspur', 'Sells tide forecasts.') RETURNING id",
        [tenant],
      );
      const person = await id(
        "INSERT INTO interview.people (tenant_id, full_name) VALUES ($1, 'Ada') RETURNING id",
        [tenant],
      );
      const candidacy = await id(
        `INSERT INTO interview.candidacies (tenant_id, company_id, candidate_person_id, title, notes, job_description)
         VALUES ($1, $2, $3, 'Engineer', 'Round: the head of platform.', 'Rebuild it.') RETURNING id`,
        [tenant, company, person],
      );
      const first = await id(
        `INSERT INTO interview.interviews (tenant_id, candidacy_id, ordinal, kind, label, duration_minutes)
         VALUES ($1, $2, 1, 'hiring_manager', 'Hiring manager', 60) RETURNING id`,
        [tenant, candidacy],
      );
      const second = await id(
        `INSERT INTO interview.interviews (tenant_id, candidacy_id, ordinal, kind, label)
         VALUES ($1, $2, 2, 'technical', 'Technical') RETURNING id`,
        [tenant, candidacy],
      );
      return { company, candidacy, first, second };
    });

    await migrateDatabase(brief);

    const after = await brief.tenantTransaction(tenant, async (c) => ({
      candidacy: (
        await c.query(
          "SELECT title, notes, job_description FROM interview.candidacies WHERE id = $1",
          [before.candidacy],
        )
      ).rows[0],
      company: (
        await c.query(
          "SELECT name, research FROM interview.companies WHERE id = $1",
          [before.company],
        )
      ).rows[0],
      stages: (
        await c.query(
          `SELECT id, ordinal, kind, label, duration_minutes, status, notes, outcome, next_steps
             FROM interview.interviews WHERE candidacy_id = $1 ORDER BY ordinal`,
          [before.candidacy],
        )
      ).rows,
    }));
    // What was there is exactly what is there.
    expect(after.candidacy).toEqual({
      title: "Engineer",
      notes: "Round: the head of platform.",
      job_description: "Rebuild it.",
    });
    expect(after.company).toEqual({
      name: "Larkspur",
      research: "Sells tide forecasts.",
    });
    expect(after.stages).toEqual([
      {
        id: before.first,
        ordinal: 1,
        kind: "hiring_manager",
        label: "Hiring manager",
        duration_minutes: 60,
        status: "scheduled",
        notes: null,
        outcome: null,
        next_steps: null,
      },
      {
        id: before.second,
        ordinal: 2,
        kind: "technical",
        label: "Technical",
        duration_minutes: null,
        status: "scheduled",
        notes: null,
        outcome: null,
        next_steps: null,
      },
    ]);

    // The new tables are forced, and a row is its owner's alone: written as
    // Ada, it is not there for Bo in the same tenant.
    expect(
      (
        await brief.query<{ relname: string }>(
          `SELECT relname FROM pg_class
            WHERE relname IN ('interview_transcripts', 'employer_said_entries', 'research_documents')
              AND relrowsecurity AND relforcerowsecurity ORDER BY relname`,
        )
      ).rows.map((row) => row.relname),
    ).toEqual([
      "employer_said_entries",
      "interview_transcripts",
      "research_documents",
    ]);
    const asActor = <T>(
      actor: string,
      work: (c: {
        query: (
          sql: string,
          values?: unknown[],
        ) => Promise<{ rowCount: number | null }>;
      }) => Promise<T>,
    ) =>
      brief.tenantTransaction(tenant, async (c) => {
        await c.query("SELECT set_config('app.actor_id', $1, true)", [actor]);
        return work(c);
      });
    await asActor(user, (c) =>
      c.query(
        `INSERT INTO interview.interview_transcripts
           (tenant_id, owner_user_id, interview_id, title, origin, capture_policy, content, content_sha256, chars, turns)
         VALUES ($1, $2, $3, 'Call', 'pasted', 'device-only', 'A: hello', $4, 8, 1)`,
        [tenant, user, before.first, "0".repeat(64)],
      ),
    );
    const count = (actor: string) =>
      asActor(
        actor,
        async (c) =>
          (await c.query("SELECT 1 FROM interview.interview_transcripts"))
            .rowCount,
      );
    expect(await count(user)).toBe(1);
    expect(await count(other)).toBe(0);
    await expect(
      asActor(other, (c) =>
        c.query(
          `INSERT INTO interview.employer_said_entries
             (tenant_id, owner_user_id, candidacy_id, said, content_sha256)
           VALUES ($1, $2, $3, 'planted', $4)`,
          [tenant, user, before.candidacy, "0".repeat(64)],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  } finally {
    await brief.close();
  }
});
