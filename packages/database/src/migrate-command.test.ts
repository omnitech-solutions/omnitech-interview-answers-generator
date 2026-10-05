import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { createPlatformDatabase } from "./connection";
import {
  createMigratingApplicationDatabase,
  type DisposablePostgres,
  startDisposablePostgres,
} from "./test-support/postgres";

// `pnpm db:migrate` runs as the application role, never the superuser.
let pg: DisposablePostgres;
let appUrl: string;
beforeAll(async () => {
  pg = await startDisposablePostgres();
  appUrl = await createMigratingApplicationDatabase(pg, "command");
}, 30_000);
afterAll(async () => pg?.stop());
afterEach(() => vi.unstubAllEnvs());

// `pnpm db:migrate` runs this module as a script: importing it runs it.
async function migrateCommand() {
  vi.resetModules();
  await import("./migrate-command");
}

it("migrates the database named by DATABASE_URL", async () => {
  vi.stubEnv("DATABASE_URL", appUrl);

  await migrateCommand();

  const app = createPlatformDatabase(appUrl);
  try {
    const applied = await app.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
    );
    expect(applied.rows[0]?.count).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
}, 30_000);

it("refuses to run without DATABASE_URL", async () => {
  vi.stubEnv("DATABASE_URL", "");

  await expect(migrateCommand()).rejects.toThrow(
    "DATABASE_URL is required for platform persistence.",
  );
});

it("shares one process-wide database from DATABASE_URL", async () => {
  vi.stubEnv("DATABASE_URL", pg.memberUrl);
  vi.resetModules();
  const { getPlatformDatabase } = await import("./connection");

  const database = getPlatformDatabase();

  expect(getPlatformDatabase()).toBe(database);
  expect((await database.query("SELECT 1 AS one")).rows).toEqual([{ one: 1 }]);
  await database.close();
});
