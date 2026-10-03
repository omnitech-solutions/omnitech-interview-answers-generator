import { pgSchema, text, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrateDatabase } from "./migrate.js";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "./test-support/postgres.js";
import { schemaDrift } from "./test-support/schema.js";

let pg: DisposablePostgres;
beforeAll(async () => {
  pg = await startDisposablePostgres();
}, 30_000);
afterAll(async () => pg?.stop());

const rows = async (sql: string) =>
  (await pg.owner.query(sql)).rows.map((row) => Object.values(row).join("."));

it("migrates a fresh database to the current schema and re-runs as a no-op", async () => {
  await migrateDatabase(pg.owner);
  const applied = () =>
    rows("SELECT name FROM drizzle.__drizzle_migrations ORDER BY id");
  const first = await applied();
  expect(first.map((name) => name.replace(/^\d+_/, ""))).toEqual([
    "initial",
    "forced_rls_and_immutability",
    "foreign_key_indexes",
  ]);

  // Every schema the app owns, plus the assistant package's own.
  expect(
    await rows(
      `SELECT nspname FROM pg_namespace
        WHERE nspname IN ('platform', 'ai', 'presentation', 'interview', 'practice', 'assistant')
        ORDER BY nspname`,
    ),
  ).toEqual([
    "ai",
    "assistant",
    "interview",
    "platform",
    "practice",
    "presentation",
  ]);

  // Interview and practice tables enforce row-level security even on their
  // owner; the assistant's tables admit the run worker.
  expect(
    await rows(
      `SELECT n.nspname || '.' || c.relname FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('interview', 'practice') AND c.relkind = 'r'
          AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`,
    ),
  ).toEqual([]);
  expect(
    await rows(
      `SELECT c.relname FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'assistant' AND c.relkind = 'r' AND c.relrowsecurity
          AND NOT EXISTS (SELECT 1 FROM pg_policies p
            WHERE p.schemaname = 'assistant' AND p.tablename = c.relname
              AND p.policyname = 'run_worker')`,
    ),
  ).toEqual([]);

  // Immutable records refuse updates and deletes.
  expect(
    await rows(
      `SELECT DISTINCT tgname FROM pg_trigger
        WHERE tgname IN ('assistant_immutable', 'assistant_effect_immutable')
        ORDER BY tgname`,
    ),
  ).toEqual(["assistant_effect_immutable", "assistant_immutable"]);

  await migrateDatabase(pg.owner);
  expect(await applied()).toEqual(first);
});

it("reports a schema file that no longer matches the migrated database", async () => {
  const users = pgSchema("platform").table("users", {
    id: uuid().primaryKey(),
    nickname: text(),
  });
  expect(await schemaDrift(pg.owner, [users])).toEqual([
    "platform.users.nickname: column missing",
  ]);
});
