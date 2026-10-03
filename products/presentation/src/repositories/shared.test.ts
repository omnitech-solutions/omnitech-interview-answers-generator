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
import { PresentationRepository } from "./index.js";

// fixture_member is NOSUPERUSER NOBYPASSRLS, so every tenant policy binds it
// exactly as forced row-level security binds the app role that owns the tables.
let pg: DisposablePostgres;
let member: PlatformDatabase;
let tenants: string[];
let userId: string;
beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await pg.owner.query(`
    GRANT USAGE ON SCHEMA platform, presentation TO fixture_member;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform, presentation TO fixture_member;`);
  const user = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.users (email, display_name) VALUES ('ada@example.test', 'Ada') RETURNING id",
  );
  userId = user.rows[0]!.id;
  const created = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.tenants (slug, name) VALUES ('north', 'North'), ('south', 'South') RETURNING id",
  );
  tenants = created.rows.map((row) => row.id);
  member = createPlatformDatabase(pg.memberUrl);
}, 30_000);
afterAll(async () => {
  await member?.close();
  await pg?.stop();
});

it("opens a shared presentation by its token without a signed-in tenant", async () => {
  const repository = new PresentationRepository(member);
  const north = { tenantId: tenants[0]!, userId };
  const id = await repository.create(north, {
    title: "Quarterly plan",
    outline: ["Goals", "Risks"],
    idempotencyKey: crypto.randomUUID(),
  });
  const share = await repository.createShare(north, id);

  const shared = await repository.getShared(share.token);

  expect(shared?.id).toBe(id);
  expect(shared?.slides.map((slide) => slide.position)).toEqual([0, 1]);
});

it("opens nothing for an unknown or revoked token", async () => {
  const repository = new PresentationRepository(member);
  const south = { tenantId: tenants[1]!, userId };
  const id = await repository.create(south, {
    title: "Hiring plan",
    idempotencyKey: crypto.randomUUID(),
  });
  const share = await repository.createShare(south, id);
  await repository.revokeShare(south, share.id);

  expect(await repository.getShared(share.token)).toBeUndefined();
  expect(await repository.getShared("not-a-share-token")).toBeUndefined();
});
