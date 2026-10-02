import { readFile } from "node:fs/promises";
import { runDrizzleMigrations } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import { afterAll, beforeAll, expect, it } from "vitest";
import { legacyMigrations } from "./legacy-migrations.js";

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
  expect(first.length).toBeGreaterThanOrEqual(1);
  // Legacy SQL and the Drizzle stream run again without errors or new rows.
  for (const file of legacyMigrations())
    await pg.owner.query(await readFile(file, "utf8"));
  await runDrizzleMigrations(pg.owner);
  expect(await applied()).toEqual(first);
});
