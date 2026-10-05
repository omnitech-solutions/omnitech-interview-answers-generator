import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

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
afterEach(() => vi.unstubAllEnvs());

// `pnpm db:bootstrap` runs this module as a script: importing it runs it.
async function bootstrap(env: Record<string, string> = {}) {
  vi.stubEnv("DATABASE_URL", pg.memberUrl);
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  await import("./bootstrap");
}

async function installedProducts(slug: string) {
  const installations = await pg.owner.query<{
    product_id: string;
    name: string;
  }>(
    `SELECT i.product_id, t.name FROM platform.product_installations i
       JOIN platform.tenants t ON t.id = i.tenant_id
      WHERE t.slug = $1 ORDER BY i.product_id`,
    [slug],
  );
  return installations.rows;
}

it("bootstraps the local tenant with its installed products as the app role", async () => {
  // Twice: re-running the bootstrap updates rather than duplicates.
  await bootstrap();
  await bootstrap();

  expect(await installedProducts("local")).toEqual([
    { product_id: "omnitech.interview", name: "Local Workspace" },
    { product_id: "omnitech.presentation", name: "Local Workspace" },
  ]);
  const owners = await pg.owner.query<{ email: string; role: string }>(
    `SELECT u.email, m.role FROM platform.tenant_memberships m
       JOIN platform.users u ON u.id = m.user_id
       JOIN platform.tenants t ON t.id = m.tenant_id
      WHERE t.slug = 'local'`,
  );
  expect(owners.rows).toEqual([
    { email: "local@omnitech.test", role: "owner" },
  ]);
}, 30_000);

it("bootstraps the tenant and owner named by the environment", async () => {
  await bootstrap({
    PLATFORM_BOOTSTRAP_EMAIL: "grace@example.test",
    PLATFORM_BOOTSTRAP_TENANT: "navy",
    PLATFORM_BOOTSTRAP_TENANT_NAME: "Navy Lab",
  });

  expect(await installedProducts("navy")).toEqual([
    { product_id: "omnitech.interview", name: "Navy Lab" },
    { product_id: "omnitech.presentation", name: "Navy Lab" },
  ]);
}, 30_000);
