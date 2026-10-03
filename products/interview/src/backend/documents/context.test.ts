import { createHash } from "node:crypto";
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
import { DocumentContextNotFound, resolveDocumentContext } from "./context.js";

let pg: DisposablePostgres;
let member: PlatformDatabase;
const ids = { tenant: "", alice: "", bob: "", candidacy: "" };
const matrix = { candidate: { name: "Synthetic Candidate" }, roles: [] };
const sha256 = createHash("sha256")
  .update('{"candidate":{"name":"Synthetic Candidate"},"roles":[]}')
  .digest("hex");
const id = async (query: string, values: unknown[] = []) =>
  String((await pg.owner.query<{ id: string }>(query, values)).rows[0]?.id);

beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await pg.owner.query(`
    GRANT USAGE ON SCHEMA interview TO fixture_member;
    GRANT SELECT ON ALL TABLES IN SCHEMA interview TO fixture_member;
  `);
  ids.tenant = await id(
    "INSERT INTO platform.tenants(slug,name) VALUES('document-context','Documents') RETURNING id",
  );
  ids.alice = await id(
    "INSERT INTO platform.users(email,display_name) VALUES('context-alice@x','Alice') RETURNING id",
  );
  ids.bob = await id(
    "INSERT INTO platform.users(email,display_name) VALUES('context-bob@x','Bob') RETURNING id",
  );
  await pg.owner.query(
    "INSERT INTO platform.tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'member'),($1,$3,'member')",
    [ids.tenant, ids.alice, ids.bob],
  );
  const company = await id(
    "INSERT INTO interview.companies(tenant_id,name) VALUES($1,'Acme') RETURNING id",
    [ids.tenant],
  );
  const person = await id(
    "INSERT INTO interview.people(tenant_id,full_name) VALUES($1,'Alice') RETURNING id",
    [ids.tenant],
  );
  await pg.owner.query(
    "INSERT INTO interview.member_people(tenant_id,user_id,person_id) VALUES($1,$2,$3)",
    [ids.tenant, ids.alice, person],
  );
  ids.candidacy = await id(
    "INSERT INTO interview.candidacies(tenant_id,company_id,candidate_person_id,title,job_description) VALUES($1,$2,$3,'Engineer','Build systems') RETURNING id",
    [ids.tenant, company, person],
  );
  await pg.owner.query(
    "INSERT INTO interview.candidate_profiles(tenant_id,actor_id,product_id,id,name,revision) VALUES($1,$2,'omnitech.interview','profile','Profile',1)",
    [ids.tenant, ids.alice],
  );
  await pg.owner.query(
    "INSERT INTO interview.candidate_profile_revisions(tenant_id,actor_id,product_id,id,revision,name,sha256,matrix) VALUES($1,$2,'omnitech.interview','profile',1,'Profile',$3,$4::jsonb)",
    [ids.tenant, ids.alice, sha256, JSON.stringify(matrix)],
  );
  member = createPlatformDatabase(pg.memberUrl);
}, 60_000);

afterAll(async () => {
  await member?.close();
  await pg?.stop();
});

const context = (actorId: string) =>
  resolveDocumentContext(member, {
    tenantId: ids.tenant,
    actorId,
    profileId: "profile",
    profileRevision: 1,
    candidacyId: ids.candidacy,
    interviewId: null,
  });

it("attaches only the member's intact active profile and candidacy", async () => {
  const alice = await context(ids.alice);
  expect(alice.candidateProfile).toEqual(matrix);
  expect(alice.candidacyValues).toEqual({
    company_name: "Acme",
    role_title: "Engineer",
    target_role: "Engineer",
    job_description: "Build systems",
  });
  // The matrix names no contact details, so none are invented or filled.
  expect(alice.profileValues).toMatchObject({
    heading_name: "Synthetic Candidate",
  });
  expect(alice.missingProfileKeys).toEqual(
    expect.arrayContaining([
      "email_address",
      "heading_phone_number",
      "portfolio",
      "city",
      "province",
    ]),
  );
  expect(alice.missingProfileKeys).not.toContain("heading_name");
  await expect(context(ids.bob)).rejects.toBeInstanceOf(
    DocumentContextNotFound,
  );

  await pg.owner.query(
    "UPDATE interview.candidate_profiles SET revoked_at=now() WHERE tenant_id=$1 AND actor_id=$2 AND id='profile'",
    [ids.tenant, ids.alice],
  );
  await expect(context(ids.alice)).rejects.toBeInstanceOf(
    DocumentContextNotFound,
  );
});
