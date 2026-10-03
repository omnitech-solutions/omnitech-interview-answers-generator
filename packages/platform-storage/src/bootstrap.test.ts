import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import { afterAll, beforeAll, expect, it } from "vitest";

const run = promisify(execFile);
const packageRoot = fileURLToPath(new URL("..", import.meta.url));

// fixture_member is NOSUPERUSER NOBYPASSRLS, so every tenant policy binds it
// exactly as forced row-level security binds the app role that owns the tables.
let pg: DisposablePostgres;
beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await pg.owner.query(`
    GRANT USAGE ON SCHEMA platform TO fixture_member;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA platform TO fixture_member;`);
}, 30_000);
afterAll(async () => pg?.stop());

it("bootstraps the local tenant with its installed products as the app role", async () => {
  const env = { ...process.env, DATABASE_URL: pg.memberUrl };
  // Twice: re-running the bootstrap updates rather than duplicates.
  for (let pass = 0; pass < 2; pass++)
    await run(process.execPath, ["--import", "tsx", "src/bootstrap.ts"], {
      cwd: packageRoot,
      env,
    });

  const installations = await pg.owner.query<{ product_id: string }>(
    `SELECT i.product_id FROM platform.product_installations i
       JOIN platform.tenants t ON t.id = i.tenant_id
      WHERE t.slug = 'local' ORDER BY i.product_id`,
  );
  expect(installations.rows.map((row) => row.product_id)).toEqual([
    "omnitech.interview",
    "omnitech.presentation",
  ]);
}, 30_000);
