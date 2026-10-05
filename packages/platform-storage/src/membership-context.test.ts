import {
  createPlatformDatabase,
  type PlatformDatabase,
} from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import { afterAll, beforeAll, expect, it } from "vitest";
import { PlatformRepository } from "./platform-repository";

// fixture_member is NOSUPERUSER NOBYPASSRLS, so forced row-level security on
// tenant_memberships binds it exactly as it binds the app role.
let pg: DisposablePostgres;
let member: PlatformDatabase;
let north: string;
beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await pg.owner.query(`
    GRANT USAGE ON SCHEMA platform TO fixture_member;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO fixture_member;`);
  const user = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.users (email, display_name) VALUES ('ada@example.test', 'Ada') RETURNING id",
  );
  const tenants = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.tenants (slug, name) VALUES ('north', 'North'), ('south', 'South') RETURNING id",
  );
  north = tenants.rows[0]!.id;
  await pg.owner.query(
    "INSERT INTO platform.tenant_memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')",
    [north, user.rows[0]!.id],
  );
  member = createPlatformDatabase(pg.memberUrl);
}, 30_000);
afterAll(async () => {
  await member?.close();
  await pg?.stop();
});

it("resolves a member's context inside the tenant they belong to", async () => {
  const repository = new PlatformRepository(member);

  const context = await repository.resolveContext("ada@example.test", "north");

  expect(context).toMatchObject({
    tenant: { id: north, slug: "north", name: "North" },
    user: { email: "ada@example.test", displayName: "Ada" },
    membership: { tenantId: north, role: "owner" },
  });
  expect(context?.permissions).toContain("tenant.manage");
});

it("resolves no context for a workspace the person is not a member of", async () => {
  const repository = new PlatformRepository(member);

  expect(
    await repository.resolveContext("ada@example.test", "south"),
  ).toBeNull();
  expect(
    await repository.resolveContext("nobody@example.test", "north"),
  ).toBeNull();
});
