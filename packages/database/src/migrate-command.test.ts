import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "./test-support/postgres.js";

let pg: DisposablePostgres;
beforeAll(async () => {
  pg = await startDisposablePostgres();
}, 30_000);
afterAll(async () => pg?.stop());
afterEach(() => vi.unstubAllEnvs());

// `pnpm db:migrate` runs this module as a script: importing it runs it.
async function migrateCommand() {
  vi.resetModules();
  await import("./migrate-command.js");
}

it("migrates the database named by DATABASE_URL", async () => {
  vi.stubEnv("DATABASE_URL", pg.ownerUrl);

  await migrateCommand();

  const applied = await pg.owner.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
  );
  expect(applied.rows[0]?.count).toBeGreaterThan(0);
}, 30_000);

it("refuses to run without DATABASE_URL", async () => {
  vi.stubEnv("DATABASE_URL", "");

  await expect(migrateCommand()).rejects.toThrow(
    "DATABASE_URL is required for platform persistence.",
  );
});

it("shares one process-wide database from DATABASE_URL", async () => {
  vi.stubEnv("DATABASE_URL", pg.ownerUrl);
  vi.resetModules();
  const { getPlatformDatabase } = await import("./connection.js");

  const database = getPlatformDatabase();

  expect(getPlatformDatabase()).toBe(database);
  expect((await database.query("SELECT 1 AS one")).rows).toEqual([{ one: 1 }]);
  await database.close();
});
