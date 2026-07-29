import { createPlatformDatabase } from "./database.js";

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
    await client.query(
      `INSERT INTO platform.tenant_memberships (tenant_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'owner'`,
      [tenantId, userId],
    );
    await client.query(
      `INSERT INTO platform.product_installations
         (tenant_id, product_id, display_name, description, icon, configuration)
       VALUES ($1, 'omnitech.interview', 'Interview',
         'Create, practise, and organize interview material.', 'sparkles', $2)
       ON CONFLICT (tenant_id, product_id) DO UPDATE SET
         configuration = EXCLUDED.configuration,
         updated_at = now()`,
      [
        tenantId,
        {
          enabled: true,
          routePrefix: "/p/interview",
          navigation: {
            group: "Products",
            order: 10,
            hidden: false,
            routes: {
              "interview.workspace": {
                label: "Workspace",
                description: "Create and refine material",
                path: "/p/interview/workspace",
                hidden: false,
              },
              "interview.knowledge": {
                label: "Knowledge",
                description: "Browse reusable material",
                path: "/p/interview/knowledge",
                hidden: false,
              },
            },
          },
          featureFlags: {},
          settings: {},
          revision: 1,
        },
      ],
    );
  });
} finally {
  await database.close();
}
