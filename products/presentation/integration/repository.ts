import assert from "node:assert/strict";
import {
  createPlatformDatabase,
  type PlatformDatabase,
} from "@omnitech/platform-storage";
import { PresentationRepository } from "../src/repositories/index.js";

if (!process.env["DATABASE_URL"])
  throw new Error("DATABASE_URL must point to the local integration database.");
const database = createPlatformDatabase();
const rollback = new Error("rollback integration fixtures");
try {
  await database.transaction(async (client) => {
    const identities = await client.query<{
      tenant_id: string;
      user_id: string;
    }>(
      `SELECT t.id AS tenant_id, u.id AS user_id FROM platform.tenants t JOIN platform.tenant_memberships m ON m.tenant_id = t.id JOIN platform.users u ON u.id = m.user_id WHERE t.slug = 'local' AND u.email = 'local@omnitech.test'`,
    );
    const identity = identities.rows[0];
    assert(
      identity,
      "Run the repository local launcher to bootstrap the local tenant.",
    );
    const context = { tenantId: identity.tenant_id, userId: identity.user_id };
    const transactional = {
      ...database,
      query: client.query.bind(client),
      transaction: async (work) => work(client),
      tenantTransaction: async (tenantId, work) => {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [
          tenantId,
        ]);
        return work(client);
      },
      close: async () => {},
    } satisfies PlatformDatabase;
    const repository = new PresentationRepository(transactional);
    const id = await repository.create(context, {
      title: "Integration garden plan",
      outline: ["First", "Second", "Third"],
      idempotencyKey: crypto.randomUUID(),
    });
    let document = await repository.get(context, id);
    assert.equal(document?.slides.length, 3);
    const first = document!.slides[0]!;
    await repository.saveSlide(context, id, {
      ...first,
      sourceXml: "<SECTION><H1>Saved content</H1></SECTION>",
    });
    document = await repository.get(context, id);
    assert.equal(document!.slides[0]!.revision, 2);
    assert(document!.slides[0]!.sourceXml.includes("Saved content"));
    await repository.moveSlide(context, id, first.id, 2);
    document = await repository.get(context, id);
    assert.equal(document!.slides[2]!.id, first.id);
    assert.deepEqual(
      document!.slides.map((slide) => slide.position),
      [0, 1, 2],
    );
    await repository.moveSlide(context, id, first.id, 0);
    document = await repository.get(context, id);
    assert.equal(document!.slides[0]!.id, first.id);
    const revision = await repository.save(context, id, {
      expectedRevision: document!.revision,
      title: "Renamed after reorder",
    });
    assert(revision > document!.revision);
    await repository.deleteSlide(context, id, document!.slides[1]!.id);
    document = await repository.get(context, id);
    assert.deepEqual(
      document!.slides.map((slide) => slide.position),
      [0, 1],
    );
    assert.equal(document!.title, "Renamed after reorder");
    assert.equal(
      await repository.get({ ...context, tenantId: crypto.randomUUID() }, id),
      undefined,
    );
    const share = await repository.createShare(context, id);
    assert.equal((await repository.getShared(share.token))?.id, id);
    await repository.revokeShare(context, share.id);
    assert.equal(await repository.getShared(share.token), undefined);
    console.log(
      "Local PostgreSQL: create, slide save, forward/backward reorder, rename, delete/renumber, tenant isolation, share/revoke passed; rolling back all fixtures.",
    );
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await database.close();
}
