// `pnpm db:bootstrap`: the first user, tenant, owner membership and installed
// products of a fresh database. It runs before any tenant or actor exists, on
// the raw client with enterTenant, so its statements are raw upserts with
// conflict targets; what it installs is data in ./bootstrap-installations.
import { createPlatformDatabase, enterTenant } from "@omnitech/database";
import { BOOTSTRAP_INSTALLATIONS } from "./bootstrap-installations";

const database = createPlatformDatabase();
const userEmail =
  process.env["PLATFORM_BOOTSTRAP_EMAIL"] ?? "local@omnitech.test";
const tenantSlug = process.env["PLATFORM_BOOTSTRAP_TENANT"] ?? "local";
const tenantName =
  process.env["PLATFORM_BOOTSTRAP_TENANT_NAME"] ?? "Local Workspace";

try {
  await database.transaction(async (client) => {
    const user = await client.query<{ id: string }>(
      `INSERT INTO platform.users (email, display_name)
       VALUES ($1, 'Local User')
       ON CONFLICT (email) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [userEmail],
    );
    const tenant = await client.query<{ id: string }>(
      `INSERT INTO platform.tenants (slug, name)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
       RETURNING id`,
      [tenantSlug, tenantName],
    );
    const userId = user.rows[0]?.id;
    const tenantId = tenant.rows[0]?.id;
    if (!userId || !tenantId)
      throw new Error("Bootstrap records were not created.");
    // Memberships and installations are tenant-owned rows under forced
    // row-level security, so they are written inside the tenant this
    // bootstrap just resolved.
    await enterTenant(client, { tenantId, actorId: userId });
    await client.query(
      `INSERT INTO platform.tenant_memberships (tenant_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'owner'`,
      [tenantId, userId],
    );
    // One row per product the tenant starts with; a re-run refreshes only the
    // configuration, so labels and order an owner changed are kept.
    for (const installation of BOOTSTRAP_INSTALLATIONS) {
      await client.query(
        `INSERT INTO platform.product_installations
           (tenant_id, product_id, display_name, description, icon, sort_order,
            configuration)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, product_id) DO UPDATE SET
           configuration = EXCLUDED.configuration,
           updated_at = now()`,
        [
          tenantId,
          installation.productId,
          installation.displayName,
          installation.description,
          installation.icon,
          installation.sortOrder,
          installation.configuration,
        ],
      );
    }
  });
} finally {
  await database.close();
}
