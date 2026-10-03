// Shared test fixture for the Active Session repository layer: a disposable
// PostgreSQL migrated to head, the NOSUPERUSER NOBYPASSRLS member role (the
// application's role) as the connection under test, and a fixture owner used
// only to arrange rows. Tests, not production code, import this.
import { randomUUID } from "node:crypto";
import {
  createPlatformDatabase,
  type PlatformDatabase,
} from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";

export type Person = {
  id: string;
  candidacy: string;
  interview: string;
  profile: string;
};

// Raw rows read back to assert on stored state; their columns are asserted by
// name, so they are deliberately loosely typed.
export type AnyRow = any;

export type Fixture = {
  pg: DisposablePostgres;
  // The fixture owner (a superuser that bypasses row security), for arranging
  // and inspecting rows only.
  owner: {
    query(sql: string, values?: unknown[]): Promise<{ rows: AnyRow[] }>;
  };
  member: PlatformDatabase;
  tenantA: string;
  tenantB: string;
  one(sql: string, values?: unknown[]): Promise<string>;
  provision(tenant: string, name: string): Promise<Person>;
  stop(): Promise<void>;
};

export async function startFixture(): Promise<Fixture> {
  const pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await pg.owner.query(`
    GRANT USAGE ON SCHEMA platform, interview, ai TO fixture_member;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA interview TO fixture_member;
    GRANT SELECT, INSERT, UPDATE, DELETE ON platform.artifacts, platform.artifact_payloads TO fixture_member;
    GRANT SELECT ON ALL TABLES IN SCHEMA platform TO fixture_member;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ai TO fixture_member;
  `);
  const one = async (sql: string, values: unknown[] = []) =>
    String((await pg.owner.query<{ id: string }>(sql, values)).rows[0]?.id);
  const tenantA = await one(
    "INSERT INTO platform.tenants(slug,name) VALUES($1,'Live A') RETURNING id",
    [`live-a-${randomUUID().slice(0, 8)}`],
  );
  const tenantB = await one(
    "INSERT INTO platform.tenants(slug,name) VALUES($1,'Live B') RETURNING id",
    [`live-b-${randomUUID().slice(0, 8)}`],
  );
  let counter = 0;
  const provision = async (tenant: string, name: string): Promise<Person> => {
    counter += 1;
    const id = await one(
      "INSERT INTO platform.users(email,display_name) VALUES($1,$2) RETURNING id",
      [`${name}-${counter}-${randomUUID().slice(0, 6)}@live.test`, name],
    );
    await pg.owner.query(
      "INSERT INTO platform.tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
      [tenant, id],
    );
    const company = await one(
      "INSERT INTO interview.companies(tenant_id,name) VALUES($1,$2) RETURNING id",
      [tenant, `Acme ${counter}`],
    );
    const person = await one(
      "INSERT INTO interview.people(tenant_id,full_name) VALUES($1,$2) RETURNING id",
      [tenant, name],
    );
    await pg.owner.query(
      "INSERT INTO interview.member_people(tenant_id,user_id,person_id) VALUES($1,$2,$3)",
      [tenant, id, person],
    );
    const candidacy = await one(
      "INSERT INTO interview.candidacies(tenant_id,company_id,candidate_person_id,title) VALUES($1,$2,$3,'Engineer') RETURNING id",
      [tenant, company, person],
    );
    const interview = await one(
      "INSERT INTO interview.interviews(tenant_id,candidacy_id,ordinal,kind,label) VALUES($1,$2,1,'technical','Round 1') RETURNING id",
      [tenant, candidacy],
    );
    const profile = `${name}-profile-${counter}`;
    await pg.owner.query(
      "INSERT INTO interview.candidate_profiles(tenant_id,actor_id,product_id,id,name,revision) VALUES($1,$2,'omnitech.interview',$3,'Profile',1)",
      [tenant, id, profile],
    );
    await pg.owner.query(
      "INSERT INTO interview.candidate_profile_revisions(tenant_id,actor_id,product_id,id,revision,name,sha256,matrix) VALUES($1,$2,'omnitech.interview',$3,1,'Profile',$4,'{}')",
      [tenant, id, profile, "0".repeat(64)],
    );
    return { id, candidacy, interview, profile };
  };
  const member = createPlatformDatabase(pg.memberUrl);
  return {
    pg,
    owner: {
      query: (text, values) => pg.owner.query<AnyRow>(text, values),
    },
    member,
    tenantA,
    tenantB,
    one,
    provision,
    async stop() {
      await member.close();
      await pg.stop();
    },
  };
}

export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4,
]);
export const SVG_BYTES = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>',
);

let eventCounter = 0;
export function transcript(
  sourceId: string,
  sequence: number,
  text = "synthetic words",
  eventId = `evt-${(eventCounter += 1)}`,
) {
  return {
    version: 1,
    kind: "transcript.final",
    sourceId,
    eventId,
    occurredAt: "2026-10-03T10:00:00.000Z",
    sequence,
    content: { speaker: "speaker-1", text, startMs: 0, endMs: 1000 },
  };
}

export function screenshot(
  sourceId: string,
  sequence: number,
  mediaType = "image/png",
  byteLength = PNG_BYTES.byteLength,
  eventId = `evt-${(eventCounter += 1)}`,
) {
  return {
    version: 1,
    kind: "screen.snapshot",
    sourceId,
    eventId,
    occurredAt: "2026-10-03T10:00:00.000Z",
    sequence,
    content: {
      payloadRef: `shot-${eventId}`,
      mediaType,
      byteLength,
      windowLabel: "Shared window",
    },
  };
}
