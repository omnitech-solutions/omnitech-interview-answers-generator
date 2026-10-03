import {
  createPlatformDatabase,
  type PlatformDatabase,
  type TenantDatabase,
  withTenant,
} from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  documentRevisions,
  documentExports,
  documents,
  documentTemplateRevisions,
  documentTemplates,
} from "./documents.js";

let pg: DisposablePostgres;
let member: PlatformDatabase;
const ids = {
  tenant: "",
  otherTenant: "",
  alice: "",
  carol: "",
  bob: "",
  aliceCandidacy: "",
  carolCandidacy: "",
  template: "",
  builtin: "",
  sourceArtifact: "",
};

const as = <T>(actorId: string, work: (db: TenantDatabase) => Promise<T>) =>
  withTenant(
    { tenantId: ids.tenant, actorId, productId: "omnitech.interview" },
    work,
    { database: member },
  );

const id = async (query: string, values: unknown[] = []) =>
  String((await pg.owner.query<{ id: string }>(query, values)).rows[0]?.id);

async function expectDatabaseFailure(work: Promise<unknown>, pattern: RegExp) {
  const error = await work.then(
    () => undefined,
    (failure: unknown) => failure,
  );
  expect(error).toBeDefined();
  expect((error as { cause?: Error }).cause?.message ?? "").toMatch(pattern);
}

beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await pg.owner.query(`
    GRANT USAGE ON SCHEMA platform, interview TO fixture_member;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA interview TO fixture_member;
    GRANT SELECT ON ALL TABLES IN SCHEMA platform TO fixture_member;
  `);
  ids.tenant = await id(
    "INSERT INTO platform.tenants(slug,name) VALUES('documents-a','Documents A') RETURNING id",
  );
  ids.otherTenant = await id(
    "INSERT INTO platform.tenants(slug,name) VALUES('documents-b','Documents B') RETURNING id",
  );
  ids.alice = await id(
    "INSERT INTO platform.users(email,display_name) VALUES('documents-alice@x','Alice') RETURNING id",
  );
  ids.carol = await id(
    "INSERT INTO platform.users(email,display_name) VALUES('documents-carol@x','Carol') RETURNING id",
  );
  ids.bob = await id(
    "INSERT INTO platform.users(email,display_name) VALUES('documents-bob@x','Bob') RETURNING id",
  );
  await pg.owner.query(
    "INSERT INTO platform.tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'member'),($1,$3,'member'),($4,$5,'member')",
    [ids.tenant, ids.alice, ids.carol, ids.otherTenant, ids.bob],
  );
  const company = await id(
    "INSERT INTO interview.companies(tenant_id,name) VALUES($1,'Acme') RETURNING id",
    [ids.tenant],
  );
  for (const [actor, personName, key] of [
    [ids.alice, "Alice", "aliceCandidacy"],
    [ids.carol, "Carol", "carolCandidacy"],
  ] as const) {
    const person = await id(
      "INSERT INTO interview.people(tenant_id,full_name) VALUES($1,$2) RETURNING id",
      [ids.tenant, personName],
    );
    await pg.owner.query(
      "INSERT INTO interview.member_people(tenant_id,user_id,person_id) VALUES($1,$2,$3)",
      [ids.tenant, actor, person],
    );
    ids[key] = await id(
      "INSERT INTO interview.candidacies(tenant_id,company_id,candidate_person_id,title) VALUES($1,$2,$3,'Engineer') RETURNING id",
      [ids.tenant, company, person],
    );
    await pg.owner.query(
      "INSERT INTO interview.candidate_profiles(tenant_id,actor_id,product_id,id,name,revision) VALUES($1,$2,'omnitech.interview','profile','Profile',1)",
      [ids.tenant, actor],
    );
    await pg.owner.query(
      "INSERT INTO interview.candidate_profile_revisions(tenant_id,actor_id,product_id,id,revision,name,sha256,matrix) VALUES($1,$2,'omnitech.interview','profile',1,'Profile',$3,'{}')",
      [ids.tenant, actor, "0".repeat(64)],
    );
  }
  const source = await id(
    "INSERT INTO platform.artifacts(tenant_id,owner_user_id,product_id,artifact_type,title,payload_reference) VALUES($1,$2,'omnitech.interview','interview.document-template-source','Source','payload:source') RETURNING id",
    [ids.tenant, ids.alice],
  );
  ids.sourceArtifact = source;
  const builtinSource = await id(
    "INSERT INTO platform.artifacts(tenant_id,owner_user_id,product_id,artifact_type,title,payload_reference) VALUES($1,NULL,'omnitech.interview','interview.document-template-builtin','Built-in','payload:builtin') RETURNING id",
    [ids.tenant],
  );
  ids.template = await id(
    "INSERT INTO interview.document_templates(tenant_id,owner_user_id,kind,format,name) VALUES($1,$2,'resume','md','Private') RETURNING id",
    [ids.tenant, ids.alice],
  );
  ids.builtin = await id(
    "INSERT INTO interview.document_templates(tenant_id,owner_user_id,kind,format,name) VALUES($1,NULL,'resume','md','Built-in') RETURNING id",
    [ids.tenant],
  );
  await pg.owner.query(
    "INSERT INTO interview.document_template_revisions(tenant_id,template_id,revision,owner_user_id,source_artifact_id,fields,instructions) VALUES($1,$2,1,$3,$4,'[]','Generate')",
    [ids.tenant, ids.template, ids.alice, source],
  );
  await pg.owner.query(
    "INSERT INTO interview.document_template_revisions(tenant_id,template_id,revision,owner_user_id,source_artifact_id,fields,instructions) VALUES($1,$2,1,NULL,$3,'[]','Generate')",
    [ids.tenant, ids.builtin, builtinSource],
  );
  member = createPlatformDatabase(pg.memberUrl);
}, 60_000);

afterAll(async () => {
  await member?.close();
  await pg?.stop();
});

it("keeps private templates hidden from another member while exposing read-only built-ins", async () => {
  const alice = await as(ids.alice, (db) =>
    db.select().from(documentTemplates),
  );
  const carol = await as(ids.carol, (db) =>
    db.select().from(documentTemplates),
  );
  expect(alice.map((row) => row.id).sort()).toEqual(
    [ids.builtin, ids.template].sort(),
  );
  expect(carol.map((row) => row.id)).toEqual([ids.builtin]);
  expect(
    await as(ids.carol, (db) => db.select().from(documentTemplateRevisions)),
  ).toHaveLength(1);
  const edited = await as(ids.alice, (db) =>
    db
      .update(documentTemplates)
      .set({ name: "Changed" })
      .where(eq(documentTemplates.id, ids.builtin))
      .returning(),
  );
  expect(edited).toEqual([]);
  const outside = await withTenant(
    {
      tenantId: ids.otherTenant,
      actorId: ids.bob,
      productId: "omnitech.interview",
    },
    (db) => db.select().from(documentTemplates),
    { database: member },
  );
  expect(outside).toEqual([]);
  await expectDatabaseFailure(
    as(ids.alice, (db) =>
      db.insert(documentTemplateRevisions).values({
        tenantId: ids.tenant,
        templateId: ids.builtin,
        revision: 2,
        ownerUserId: ids.alice,
        sourceArtifactId: ids.sourceArtifact,
        fields: [],
        instructions: "Replace built-in",
      }),
    ),
    /template revision owner mismatch/i,
  );
});

it("forces row security on all five document tables and detects a disabled FORCE flag", async () => {
  const names = [
    "document_templates",
    "document_template_revisions",
    "documents",
    "document_revisions",
    "document_exports",
  ];
  const flags = async () =>
    (
      await pg.owner.query<{ relname: string; relforcerowsecurity: boolean }>(
        "SELECT relname, relforcerowsecurity FROM pg_class WHERE oid = ANY($1::regclass[])",
        [names.map((name) => `interview.${name}`)],
      )
    ).rows;
  expect((await flags()).map((row) => row.relforcerowsecurity)).toEqual([
    true,
    true,
    true,
    true,
    true,
  ]);
  await pg.owner.query(
    "ALTER TABLE interview.document_exports NO FORCE ROW LEVEL SECURITY",
  );
  try {
    expect(
      (await flags()).find((row) => row.relname === "document_exports")
        ?.relforcerowsecurity,
    ).toBe(false);
  } finally {
    await pg.owner.query(
      "ALTER TABLE interview.document_exports FORCE ROW LEVEL SECURITY",
    );
  }
  expect(
    (await flags()).find((row) => row.relname === "document_exports")
      ?.relforcerowsecurity,
  ).toBe(true);
});

it("binds a document to its actor's candidacy and profile revision", async () => {
  const insert = (candidacyId: string, profileId = "profile") =>
    as(ids.alice, (db) =>
      db
        .insert(documents)
        .values({
          tenantId: ids.tenant,
          ownerUserId: ids.alice,
          templateId: ids.template,
          templateRevision: 1,
          profileId,
          profileRevision: 1,
          candidacyId,
          title: "Resume",
        })
        .returning(),
    );
  await expectDatabaseFailure(insert(ids.carolCandidacy), /candidacy.*member/i);
  await expectDatabaseFailure(
    insert(ids.aliceCandidacy, "missing"),
    /profile.*member/i,
  );
  const saved = await insert(ids.aliceCandidacy);
  expect(saved).toHaveLength(1);
  const hidden = await as(ids.carol, (db) => db.select().from(documents));
  expect(hidden).toEqual([]);
  await as(ids.alice, (db) =>
    db.insert(documentRevisions).values({
      tenantId: ids.tenant,
      ownerUserId: ids.alice,
      documentId: saved[0]!.id,
      revision: 1,
      values: { name: "Alice" },
      provenance: {},
      validation: {},
    }),
  );
  await expectDatabaseFailure(
    as(ids.alice, (db) =>
      db
        .update(documentRevisions)
        .set({ values: { name: "Other" } })
        .where(eq(documentRevisions.documentId, saved[0]!.id)),
    ),
    /immutable/i,
  );
  const unchanged = await as(ids.alice, (db) =>
    db.select().from(documentRevisions),
  );
  expect(unchanged[0]?.values).toEqual({ name: "Alice" });
  await expectDatabaseFailure(
    as(ids.alice, (db) =>
      db.insert(documentExports).values({
        tenantId: ids.tenant,
        ownerUserId: ids.alice,
        documentId: saved[0]!.id,
        revision: 1,
        format: "md",
        artifactId: ids.sourceArtifact,
      }),
    ),
    /export artifact mismatch/i,
  );
});
