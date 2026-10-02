import { readFile } from "node:fs/promises";
import { runDrizzleMigrations } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import { afterAll, beforeAll, expect, it } from "vitest";
import { legacyMigrations } from "./legacy-migrations.js";

// The tables the domain_schema migration creates.
const domainTables = [
  "interview.briefing_links",
  "interview.candidacies",
  "interview.companies",
  "interview.interview_participants",
  "interview.interviews",
  "interview.member_people",
  "interview.people",
  "practice.exercise_attempts",
  "practice.exercises",
];

let pg: DisposablePostgres;
beforeAll(async () => {
  pg = await startDisposablePostgres();
}, 30_000);
afterAll(async () => pg?.stop());

it("migrates a fresh database (legacy SQL, then Drizzle) and re-runs as a no-op", async () => {
  for (const file of legacyMigrations())
    await pg.owner.query(await readFile(file, "utf8"));
  await runDrizzleMigrations(pg.owner);
  const applied = async () =>
    (
      await pg.owner.query(
        "SELECT name FROM drizzle.__drizzle_migrations ORDER BY id",
      )
    ).rows.map((r) => r["name"]);
  const first = await applied();
  expect(first).toEqual([
    "20261002222255_thick_doctor_octopus",
    "20261002223427_domain_schema",
    "20261002223434_force_rls",
  ]);
  const schemas = await pg.owner.query(
    "SELECT nspname FROM pg_namespace WHERE nspname = 'practice'",
  );
  expect(schemas.rows).toEqual([{ nspname: "practice" }]);
  const tables = await pg.owner.query(
    `SELECT schemaname || '.' || tablename AS name FROM pg_tables
      WHERE schemaname || '.' || tablename = ANY($1)`,
    [domainTables],
  );
  expect(tables.rows.map((r) => String(r["name"])).sort()).toEqual(
    [...domainTables].sort(),
  );
  // Legacy SQL and the Drizzle stream run again without errors or new rows.
  for (const file of legacyMigrations())
    await pg.owner.query(await readFile(file, "utf8"));
  await runDrizzleMigrations(pg.owner);
  expect(await applied()).toEqual(first);
});
