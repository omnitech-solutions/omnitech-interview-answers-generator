import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateDatabase } from "./migrate";
import {
  MigrationMismatchError,
  migrationRefusal,
  migrationStatus,
  verifyMigrations,
} from "./migration-check";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "./test-support/postgres";

const expected = ["a", "b", "c"];

describe("migrationStatus", () => {
  it.each([
    ["ok", ["a", "b", "c"], { state: "ok" }],
    ["pending tail", ["a"], { state: "pending", names: ["b", "c"] }],
    ["missing table: all pending", [], { state: "pending", names: expected }],
    ["ahead", ["a", "b", "c", "d"], { state: "ahead", names: ["d"] }],
    ["reordered", ["b", "a"], { state: "mismatch", names: ["b", "a"] }],
    ["renamed", ["a", "x", "c"], { state: "mismatch", names: ["x", "c"] }],
    ["gap", ["a", "c"], { state: "mismatch", names: ["c"] }],
  ])("%s", (_, applied, status) =>
    expect(migrationStatus(expected, applied)).toEqual(status),
  );

  it("names at most the first five migrations and no SQL", () => {
    const many = Array.from({ length: 8 }, (_, i) => `m${i}`);
    const message = migrationRefusal(migrationStatus(many, []))!;
    expect(message).toBe(
      "8 pending migration(s) (m0, m1, m2, m3, m4 and 3 more): run pnpm db:migrate",
    );
    expect(message).not.toContain("m5");
  });

  it("words ahead differently from pending", () => {
    expect(
      migrationRefusal(migrationStatus(expected, [...expected, "d"])),
    ).toContain("database is ahead of this build");
    expect(migrationRefusal({ state: "ok" })).toBeUndefined();
  });
});

describe("verifyMigrations against PostgreSQL", () => {
  let pg: DisposablePostgres;
  beforeAll(async () => {
    pg = await startDisposablePostgres();
  }, 30_000);
  afterAll(async () => pg?.stop());

  it("refuses a fresh database, accepts a migrated one, refuses a newer one", async () => {
    await expect(verifyMigrations(pg.owner)).rejects.toThrow(
      /pending migration\(s\).*pnpm db:migrate/,
    );
    await expect(verifyMigrations(pg.owner)).rejects.toBeInstanceOf(
      MigrationMismatchError,
    );

    await migrateDatabase(pg.owner);
    await expect(verifyMigrations(pg.owner)).resolves.toBeUndefined();

    await pg.owner.query(
      "INSERT INTO drizzle.__drizzle_migrations (hash, created_at, name) VALUES ('h', 1, '99999999999999_future')",
    );
    await expect(verifyMigrations(pg.owner)).rejects.toThrow(
      "database is ahead of this build",
    );
  });
});
