// Active Session persistence on a disposable PostgreSQL, connected as the
// NOSUPERUSER NOBYPASSRLS member role (the application's role), as in
// documents-security.test.ts. The fixture owner is a superuser and is used only
// to arrange rows. Covers ADR-0012's database-level rules: actor-private rows,
// composite owner references, linked-resource authorization, immutable and
// monotonic columns, no content after purging, the claim, the credential lookup,
// the purge delete setting, private session artifacts and the tombstone.
import { randomUUID } from "node:crypto";
import {
  createPlatformDatabase,
  type DatabaseClient,
  enterTenant,
  type PlatformDatabase,
} from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withCredentialLookup } from "../live-session/credential-lookup.js";
import {
  asSessionWorker,
  CLAIM_COLUMNS,
  CLAIM_SELECT,
} from "../live-session/session-claim.js";
import { asSessionPurge } from "../live-session/session-purge.js";
import { SESSION_SCREENSHOT_ARTIFACT_TYPE } from "./live-session.js";

let pg: DisposablePostgres;
let member: PlatformDatabase;

type Person = {
  id: string;
  candidacy: string;
  interview: string;
  profile: string;
};
let tenantA = "";
let tenantB = "";
let alice: Person;
let carol: Person;
let bob: Person;

let counter = 0;
const one = async (sql: string, values: unknown[] = []) =>
  String((await pg.owner.query<{ id: string }>(sql, values)).rows[0]?.id);

async function provision(tenant: string, name: string): Promise<Person> {
  counter += 1;
  const id = await one(
    "INSERT INTO platform.users(email,display_name) VALUES($1,$2) RETURNING id",
    [`${name}-${counter}@live-session.test`, name],
  );
  await pg.owner.query(
    "INSERT INTO platform.tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
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
}

// The owner connection arranges rows and bypasses row security, but every
// trigger still runs. `status` and the rest default to an open session.
async function arrangeSession(
  tenant: string,
  owner: string,
  columns: Record<string, unknown> = {},
): Promise<string> {
  const row: Record<string, unknown> = {
    tenant_id: tenant,
    owner_user_id: owner,
    processing_policy: "permitted_remote",
    expires_at: new Date(Date.now() + 2 * 3_600_000),
    ...columns,
  };
  const names = Object.keys(row);
  const values = names.map((name) => {
    const value = row[name];
    return value !== null &&
      typeof value === "object" &&
      !(value instanceof Date)
      ? JSON.stringify(value)
      : value;
  });
  return one(
    `INSERT INTO interview.active_sessions(${names.join(",")}) VALUES(${names.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`,
    values,
  );
}

const setStatus = (session: string, status: string) =>
  pg.owner.query("UPDATE interview.active_sessions SET status=$2 WHERE id=$1", [
    session,
    status,
  ]);

// An actor-scoped transaction as the application role.
const asActor = <T>(
  tenant: string,
  actor: string,
  work: (client: DatabaseClient) => Promise<T>,
) =>
  member.transaction(async (client) => {
    await enterTenant(client, { tenantId: tenant, actorId: actor });
    await client.query(
      "SELECT set_config('app.product_id', 'omnitech.interview', true)",
    );
    return work(client);
  });

async function refused(work: Promise<unknown>, pattern: RegExp) {
  const error = await work.then(
    () => undefined,
    (failure: unknown) => failure,
  );
  expect(error, `expected a refusal matching ${pattern}`).toBeDefined();
  expect((error as Error).message).toMatch(pattern);
}

const observation = (
  tenant: string,
  owner: string,
  session: string,
  overrides: Record<string, unknown> = {},
) => {
  const row = {
    source_id: "mic",
    event_id: randomUUID(),
    sequence: counter++,
    kind: "transcript.final",
    content: JSON.stringify({ text: "synthetic words" }),
    ack: JSON.stringify({ accepted: true }),
    screenshot_artifact_id: null,
    ...overrides,
  };
  return {
    text: `INSERT INTO interview.session_observations(tenant_id,owner_user_id,session_id,source_id,event_id,sequence,kind,content,ack,screenshot_artifact_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    values: [
      tenant,
      owner,
      session,
      row.source_id,
      row.event_id,
      row.sequence,
      row.kind,
      row.content,
      row.ack,
      row.screenshot_artifact_id,
    ],
  };
};

const action = (
  tenant: string,
  owner: string,
  session: string,
  overrides: Record<string, unknown> = {},
) => {
  const row: Record<string, unknown> = {
    task_id: "task-1",
    task_revision: 1,
    action_kind: "answer",
    dispatch_status: "in_flight",
    attempt: 1,
    job_id: null,
    job_created: false,
    result: null,
    fence_at_dispatch: 1,
    suppression_reason: null,
    shown: false,
    ...overrides,
  };
  const names = Object.keys(row);
  return {
    text: `INSERT INTO interview.session_actions(tenant_id,owner_user_id,session_id,${names.join(",")}) VALUES($1,$2,$3,${names.map((_, i) => `$${i + 4}`).join(",")}) RETURNING id`,
    values: [
      tenant,
      owner,
      session,
      ...names.map((n) => {
        const value = row[n];
        return value !== null && typeof value === "object"
          ? JSON.stringify(value)
          : value;
      }),
    ],
  };
};

async function artifact(
  tenant: string,
  owner: string | null,
  type: string,
  metadata: Record<string, unknown> = {},
) {
  return one(
    "INSERT INTO platform.artifacts(tenant_id,owner_user_id,product_id,artifact_type,title,payload_reference,metadata) VALUES($1,$2,'omnitech.interview',$3,'t','payload:x',$4) RETURNING id",
    [tenant, owner, type, JSON.stringify(metadata)],
  );
}

async function job(tenant: string, user: string, isPrivate: boolean) {
  return pg.owner.transaction(async (client) => {
    if (isPrivate) {
      await client.query(
        "SELECT set_config('app.session_dispatch','on',true), set_config('app.actor_id',$1,true)",
        [user],
      );
    }
    const result = await client.query<{ id: string }>(
      `INSERT INTO ai.agent_jobs(tenant_id,user_id,product_id,status,profile_snapshot,prompt_reference,private)
       VALUES($1,$2,'omnitech.interview','queued','{}','agent-payload:x',$3) RETURNING id`,
      [tenant, user, isPrivate],
    );
    return String(result.rows[0]?.id);
  });
}

beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await pg.owner.query(`
    GRANT USAGE ON SCHEMA platform, interview, ai TO fixture_member;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA interview TO fixture_member;
    GRANT SELECT, INSERT, UPDATE, DELETE ON platform.artifacts, platform.artifact_payloads TO fixture_member;
    GRANT SELECT ON ALL TABLES IN SCHEMA platform TO fixture_member;
    GRANT SELECT ON ai.agent_jobs TO fixture_member;
  `);
  tenantA = await one(
    "INSERT INTO platform.tenants(slug,name) VALUES('live-a','Live A') RETURNING id",
  );
  tenantB = await one(
    "INSERT INTO platform.tenants(slug,name) VALUES('live-b','Live B') RETURNING id",
  );
  alice = await provision(tenantA, "alice");
  carol = await provision(tenantA, "carol");
  bob = await provision(tenantB, "bob");
  member = createPlatformDatabase(pg.memberUrl);
}, 60_000);

afterAll(async () => {
  await member?.close();
  await pg?.stop();
});

describe("actor-private rows (rule:actor-private-session-rows)", () => {
  it("forces row security on all three tables", async () => {
    const rows = await pg.owner.query<{ relname: string; force: boolean }>(
      `SELECT relname, relforcerowsecurity AS force FROM pg_class
        WHERE oid = ANY($1::regclass[]) ORDER BY relname`,
      [
        [
          "interview.active_sessions",
          "interview.session_observations",
          "interview.session_actions",
        ],
      ],
    );
    expect(rows.rows).toEqual([
      { relname: "active_sessions", force: true },
      { relname: "session_actions", force: true },
      { relname: "session_observations", force: true },
    ]);
  });

  it("hides, refuses and ignores another user's rows in every table (same tenant)", async () => {
    const owner = await provision(tenantA, "dana");
    const other = await provision(tenantA, "erin");
    const session = await arrangeSession(tenantA, owner.id, {
      status: "active",
    });
    const obs = observation(tenantA, owner.id, session);
    await pg.owner.query(obs.text, obs.values);
    const act = action(tenantA, owner.id, session);
    const actionId = String(
      (await pg.owner.query<{ id: string }>(act.text, act.values)).rows[0]?.id,
    );

    // The owner sees them; the other member sees nothing.
    for (const table of [
      "active_sessions",
      "session_observations",
      "session_actions",
    ]) {
      expect(
        (
          await asActor(tenantA, owner.id, (c) =>
            c.query(`SELECT 1 FROM interview.${table}`),
          )
        ).rows,
        table,
      ).toHaveLength(1);
      expect(
        (
          await asActor(tenantA, other.id, (c) =>
            c.query(`SELECT 1 FROM interview.${table}`),
          )
        ).rows,
        table,
      ).toHaveLength(0);
    }
    // Another member cannot update, even to something harmless.
    expect(
      (
        await asActor(tenantA, other.id, (c) =>
          c.query(
            "UPDATE interview.active_sessions SET last_heartbeat_at = now() WHERE id=$1",
            [session],
          ),
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await asActor(tenantA, other.id, (c) =>
          c.query(
            "UPDATE interview.session_actions SET attempt = attempt WHERE id=$1",
            [actionId],
          ),
        )
      ).rowCount,
    ).toBe(0);
    // Another member cannot delete, even with the purge setting on for itself.
    for (const table of [
      "active_sessions",
      "session_observations",
      "session_actions",
    ]) {
      expect(
        (
          await asSessionPurge(
            member,
            { tenantId: tenantA, ownerUserId: other.id },
            (c) => c.query(`DELETE FROM interview.${table}`),
          )
        ).rowCount,
        table,
      ).toBe(0);
    }
    // Another member cannot write a row as the owner, nor as itself into the owner's session.
    await refused(
      asActor(tenantA, other.id, (c) =>
        c.query(
          "INSERT INTO interview.active_sessions(tenant_id,owner_user_id,processing_policy,expires_at) VALUES($1,$2,'permitted_remote',now()+interval '1 hour')",
          [tenantA, owner.id],
        ),
      ),
      /row-level security/,
    );
    const asOwner = observation(tenantA, owner.id, session);
    await refused(
      asActor(tenantA, other.id, (c) => c.query(asOwner.text, asOwner.values)),
      /row-level security|names no session of its owner/,
    );
    const asOther = observation(tenantA, other.id, session);
    await refused(
      asActor(tenantA, other.id, (c) => c.query(asOther.text, asOther.values)),
      /foreign key|session_observations_session_fkey|no session of its owner/,
    );
    const actAsOwner = action(tenantA, owner.id, session);
    await refused(
      asActor(tenantA, other.id, (c) =>
        c.query(actAsOwner.text, actAsOwner.values),
      ),
      /row-level security|names no session of its owner/,
    );
    // Nothing was deleted, and the owner's rows are intact.
    expect(
      (
        await asActor(tenantA, owner.id, (c) =>
          c.query("SELECT 1 FROM interview.session_observations"),
        )
      ).rows,
    ).toHaveLength(1);
  });

  it("refuses another tenant for every table", async () => {
    const owner = await provision(tenantA, "fay");
    const session = await arrangeSession(tenantA, owner.id, {
      status: "active",
    });
    for (const table of [
      "active_sessions",
      "session_observations",
      "session_actions",
    ]) {
      expect(
        (
          await asActor(tenantB, bob.id, (c) =>
            c.query(`SELECT 1 FROM interview.${table}`),
          )
        ).rows,
        table,
      ).toHaveLength(0);
    }
    // Bob in tenant B cannot name tenant A, nor reuse the actor in A's tenant.
    await refused(
      asActor(tenantB, bob.id, (c) =>
        c.query(
          "INSERT INTO interview.active_sessions(tenant_id,owner_user_id,processing_policy,expires_at) VALUES($1,$2,'permitted_remote',now()+interval '1 hour')",
          [tenantA, bob.id],
        ),
      ),
      /row-level security/,
    );
    expect(
      (
        await asActor(tenantA, bob.id, (c) =>
          c.query("SELECT 1 FROM interview.active_sessions WHERE id=$1", [
            session,
          ]),
        )
      ).rows,
    ).toHaveLength(0);
  });

  it("stops a child from naming another owner's session (rule:composite-owner-references)", async () => {
    const owner = await provision(tenantA, "gil");
    const other = await provision(tenantA, "hana");
    const session = await arrangeSession(tenantA, owner.id, {
      status: "active",
    });
    // The superuser skips row security, and with the open-session triggers
    // disabled only the composite keys are left to refuse.
    for (const [table, trigger] of [
      ["session_observations", "session_observations_open"],
      ["session_actions", "session_actions_open"],
    ])
      await pg.owner.query(
        `ALTER TABLE interview.${table} DISABLE TRIGGER ${trigger}`,
      );
    try {
      const obs = observation(tenantA, other.id, session);
      await refused(
        pg.owner.query(obs.text, obs.values),
        /session_observations_session_fkey/,
      );
      const act = action(tenantA, other.id, session);
      await refused(
        pg.owner.query(act.text, act.values),
        /session_actions_session_fkey/,
      );
      const crossTenant = observation(tenantB, owner.id, session);
      await refused(
        pg.owner.query(crossTenant.text, crossTenant.values),
        /session_observations_session_fkey/,
      );
    } finally {
      for (const [table, trigger] of [
        ["session_observations", "session_observations_open"],
        ["session_actions", "session_actions_open"],
      ])
        await pg.owner.query(
          `ALTER TABLE interview.${table} ENABLE TRIGGER ${trigger}`,
        );
    }
    // Both keys name tenant, owner and session.
    const keys = await pg.owner.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname IN ('session_observations_session_fkey','session_actions_session_fkey')`,
    );
    expect(keys.rows).toHaveLength(2);
    for (const row of keys.rows)
      expect(row.def).toContain(
        "FOREIGN KEY (tenant_id, owner_user_id, session_id)",
      );
  });
});

describe("linked-resource authorization (rule:linked-resource-authorization)", () => {
  const startSession = (
    owner: Person,
    tenant: string,
    links: Record<string, unknown>,
  ) =>
    asActor(tenant, owner.id, (c) =>
      c.query(
        `INSERT INTO interview.active_sessions(tenant_id,owner_user_id,processing_policy,expires_at,${Object.keys(links).join(",")})
         VALUES($1,$2,'permitted_remote',now()+interval '1 hour',${Object.keys(
           links,
         )
           .map((_, i) => `$${i + 3}`)
           .join(",")})`,
        [tenant, owner.id, ...Object.values(links)],
      ),
    );

  it("accepts the owner's own candidacy, interview and profile revision", async () => {
    const owner = await provision(tenantA, "ivy");
    await startSession(owner, tenantA, {
      candidacy_id: owner.candidacy,
      interview_id: owner.interview,
      profile_id: owner.profile,
      profile_revision: 1,
      workspace_draft_id: "draft-ivy",
    });
  });

  it("refuses a foreign, another-tenant and nonexistent candidacy", async () => {
    const owner = await provision(tenantA, "jon");
    for (const candidacy_id of [carol.candidacy, bob.candidacy, randomUUID()])
      await refused(
        startSession(owner, tenantA, { candidacy_id }),
        /does not belong to its owner|foreign key|active_sessions_candidacy_fkey/,
      );
  });

  it("refuses a foreign, another-tenant and nonexistent interview, and one off another candidacy", async () => {
    const owner = await provision(tenantA, "kai");
    for (const interview_id of [carol.interview, bob.interview, randomUUID()])
      await refused(
        startSession(owner, tenantA, {
          candidacy_id: owner.candidacy,
          interview_id,
        }),
        /foreign key|active_sessions_interview_candidacy_fkey/,
      );
    // An interview only through a candidacy.
    await refused(
      startSession(owner, tenantA, { interview_id: owner.interview }),
      /only through its candidacy/,
    );
    // Through someone else's candidacy is a candidacy refusal.
    await refused(
      startSession(owner, tenantA, {
        candidacy_id: carol.candidacy,
        interview_id: carol.interview,
      }),
      /candidacy does not belong/,
    );
  });

  it("refuses a foreign, another-tenant and nonexistent profile revision", async () => {
    const owner = await provision(tenantA, "lee");
    for (const [profile_id, profile_revision] of [
      [carol.profile, 1],
      [bob.profile, 1],
      ["no-such-profile", 1],
      [owner.profile, 99],
    ] as const)
      await refused(
        startSession(owner, tenantA, { profile_id, profile_revision }),
        /profile revision does not belong/,
      );
  });

  it("refuses a screenshot artifact that is foreign, from another tenant, nonexistent, another session's or not a session type", async () => {
    const owner = await provision(tenantA, "mia");
    // An earlier session of the owner's own, ended, with a screenshot bound to it.
    const earlier = await arrangeSession(tenantA, owner.id, {
      status: "active",
    });
    const bound = await artifact(
      tenantA,
      owner.id,
      SESSION_SCREENSHOT_ARTIFACT_TYPE,
      { session_id: earlier },
    );
    await setStatus(earlier, "ended");
    const session = await arrangeSession(tenantA, owner.id, {
      status: "active",
    });
    const carolSession = await arrangeSession(tenantA, carol.id, {
      status: "active",
    });
    const bobSession = await arrangeSession(tenantB, bob.id, {
      status: "active",
    });
    const foreign = await artifact(
      tenantA,
      carol.id,
      SESSION_SCREENSHOT_ARTIFACT_TYPE,
      { session_id: carolSession },
    );
    const otherTenant = await artifact(
      tenantB,
      bob.id,
      SESSION_SCREENSHOT_ARTIFACT_TYPE,
      { session_id: bobSession },
    );
    const wrongType = await artifact(
      tenantA,
      owner.id,
      "interview.document-export",
    );
    const own = await artifact(
      tenantA,
      owner.id,
      SESSION_SCREENSHOT_ARTIFACT_TYPE,
      { session_id: session },
    );
    // Foreign (same tenant, other owner), another tenant's, nonexistent, an
    // artifact bound to a different session, and a non-session type.
    for (const artifactId of [
      foreign,
      otherTenant,
      randomUUID(),
      bound,
      wrongType,
    ]) {
      const obs = observation(tenantA, owner.id, session, {
        kind: "screen.snapshot",
        screenshot_artifact_id: artifactId,
      });
      await refused(
        asActor(tenantA, owner.id, (c) => c.query(obs.text, obs.values)),
        /artifact mismatch|foreign key/,
      );
      // Not even the superuser (no row security) can link it.
      await refused(
        pg.owner.query(obs.text, obs.values),
        /artifact mismatch|foreign key/,
      );
    }
    const good = observation(tenantA, owner.id, session, {
      kind: "screen.snapshot",
      screenshot_artifact_id: own,
    });
    await asActor(tenantA, owner.id, (c) => c.query(good.text, good.values));
  });

  it("verifies an action's job once it exists: foreign, another tenant's and nonexistent ids are refused", async () => {
    const owner = await provision(tenantA, "ned");
    const session = await arrangeSession(tenantA, owner.id, {
      status: "active",
    });
    const own = await job(tenantA, owner.id, true);
    const carolPrivate = await job(tenantA, carol.id, true);
    const carolPlain = await job(tenantA, carol.id, false);
    const ownPlain = await job(tenantA, owner.id, false);
    const bobPrivate = await job(tenantB, bob.id, true);

    // A reservation names no row yet (rule:action-before-job).
    const reserved = action(tenantA, owner.id, session, {
      job_id: randomUUID(),
      task_id: "reserve",
    });
    await asActor(tenantA, owner.id, (c) =>
      c.query(reserved.text, reserved.values),
    );
    // Binding it to a job that does not exist is refused.
    await refused(
      asActor(tenantA, owner.id, (c) =>
        c.query(
          "UPDATE interview.session_actions SET job_created = true WHERE session_id=$1 AND task_id='reserve'",
          [session],
        ),
      ),
      /job does not exist/,
    );
    // A job that is not the owner's private Interview job is never linked.
    // Row security hides some of them from the owner (a foreign private job,
    // another tenant's), so a reservation naming one is indistinguishable from
    // a fresh id and is accepted, but it can never become a job link, and
    // creating a job under a taken id fails on ai.agent_jobs' primary key.
    const cases = [
      { id: carolPrivate, visibleToOwner: false, sameTenant: true },
      { id: carolPlain, visibleToOwner: true, sameTenant: true },
      { id: ownPlain, visibleToOwner: true, sameTenant: true },
      { id: bobPrivate, visibleToOwner: false, sameTenant: false },
    ];
    let n = 0;
    for (const { id: job_id, visibleToOwner, sameTenant } of cases) {
      n += 1;
      const bound = action(tenantA, owner.id, session, {
        job_id,
        job_created: true,
        task_id: `bound-${n}`,
      });
      await refused(
        asActor(tenantA, owner.id, (c) => c.query(bound.text, bound.values)),
        /job does not (belong|exist)/,
      );
      const reservation = action(tenantA, owner.id, session, {
        job_id,
        task_id: `reserved-${n}`,
      });
      if (visibleToOwner)
        await refused(
          asActor(tenantA, owner.id, (c) =>
            c.query(reservation.text, reservation.values),
          ),
          /job does not belong/,
        );
      else {
        await asActor(tenantA, owner.id, (c) =>
          c.query(reservation.text, reservation.values),
        );
        await refused(
          asActor(tenantA, owner.id, (c) =>
            c.query(
              "UPDATE interview.session_actions SET job_created = true WHERE session_id=$1 AND task_id=$2",
              [session, `reserved-${n}`],
            ),
          ),
          /job does not (belong|exist)/,
        );
      }
      // The superuser sees every job in the tenant (row security hides none),
      // so a foreign job of this tenant is refused outright, reserved or not.
      if (sameTenant) {
        const everything = action(tenantA, owner.id, session, {
          job_id,
          task_id: `super-${n}`,
        });
        await refused(
          pg.owner.query(everything.text, everything.values),
          /job does not belong/,
        );
      }
    }
    // The owner's own private job binds.
    const good = action(tenantA, owner.id, session, {
      job_id: own,
      job_created: true,
      task_id: "good",
    });
    await asActor(tenantA, owner.id, (c) => c.query(good.text, good.values));
    // One job id, one action.
    const again = action(tenantA, owner.id, session, {
      job_id: own,
      job_created: true,
      task_id: "again",
    });
    await refused(
      asActor(tenantA, owner.id, (c) => c.query(again.text, again.values)),
      /session_actions_job_key|duplicate key/,
    );
    // The link cannot be moved afterwards.
    await refused(
      asActor(tenantA, owner.id, (c) =>
        c.query(
          "UPDATE interview.session_actions SET job_id=$2 WHERE session_id=$1 AND task_id='good'",
          [session, randomUUID()],
        ),
      ),
      /job link is immutable/,
    );
  });

  it("refuses deleting a linked candidacy, interview or profile revision until the session is a tombstone", async () => {
    const owner = await provision(tenantA, "oli");
    const session = await arrangeSession(tenantA, owner.id, {
      status: "active",
      candidacy_id: owner.candidacy,
      interview_id: owner.interview,
      profile_id: owner.profile,
      profile_revision: 1,
    });
    await refused(
      pg.owner.query("DELETE FROM interview.interviews WHERE id=$1", [
        owner.interview,
      ]),
      /active_sessions_interview_candidacy_fkey/,
    );
    // A candidacy with no interview still cannot go while a session links it.
    const lone = await provision(tenantA, "oli-lone");
    await pg.owner.query("DELETE FROM interview.interviews WHERE id=$1", [
      lone.interview,
    ]);
    await arrangeSession(tenantA, lone.id, {
      status: "active",
      candidacy_id: lone.candidacy,
    });
    await refused(
      pg.owner.query("DELETE FROM interview.candidacies WHERE id=$1", [
        lone.candidacy,
      ]),
      /active_sessions_candidacy_fkey/,
    );
    // Profile revisions are already immutable (briefing_immutable); with that
    // older guard out of the way the pin itself is what refuses the delete.
    const profileDelete = () =>
      pg.owner.query(
        "DELETE FROM interview.candidate_profile_revisions WHERE actor_id=$1 AND id=$2",
        [owner.id, owner.profile],
      );
    await pg.owner.query(
      "ALTER TABLE interview.candidate_profile_revisions DISABLE TRIGGER briefing_immutable",
    );
    try {
      await refused(profileDelete(), /pinned by an Active Session/);
      // Purge: end, purge, clear links, tombstone.
      await setStatus(session, "ended");
      await setStatus(session, "purging");
      await pg.owner.query(
        `UPDATE interview.active_sessions SET interview_id=NULL, candidacy_id=NULL,
         profile_id=NULL, profile_revision=NULL WHERE id=$1`,
        [session],
      );
      await pg.owner.query(
        `UPDATE interview.active_sessions SET status='ended', purged_at=now(),
         purge_outcome='complete', purge_counts='{}' WHERE id=$1`,
        [session],
      );
      await profileDelete();
    } finally {
      await pg.owner.query(
        "ALTER TABLE interview.candidate_profile_revisions ENABLE TRIGGER briefing_immutable",
      );
    }
    await pg.owner.query("DELETE FROM interview.interviews WHERE id=$1", [
      owner.interview,
    ]);
  });
});

describe("session lifecycle columns", () => {
  it("allows one open session per owner; ended and purging sessions free the slot", async () => {
    const owner = await provision(tenantA, "pam");
    const first = await arrangeSession(tenantA, owner.id);
    await refused(
      arrangeSession(tenantA, owner.id),
      /active_sessions_one_open_per_owner/,
    );
    await setStatus(first, "active");
    await refused(
      arrangeSession(tenantA, owner.id),
      /active_sessions_one_open_per_owner/,
    );
    await setStatus(first, "paused");
    await refused(
      arrangeSession(tenantA, owner.id),
      /active_sessions_one_open_per_owner/,
    );
    await setStatus(first, "ended");
    const second = await arrangeSession(tenantA, owner.id);
    await setStatus(second, "purging");
    await arrangeSession(tenantA, owner.id);
  });

  it("starts clean: no ended status, fence, lease or purge state at insert", async () => {
    const owner = await provision(tenantA, "quin");
    await refused(
      arrangeSession(tenantA, owner.id, { status: "ended" }),
      /starts with a clean lease/,
    );
    await refused(
      arrangeSession(tenantA, owner.id, { fence: 3 }),
      /starts with a clean lease/,
    );
    await refused(
      arrangeSession(tenantA, owner.id, { lease_holder_id: "w" }),
      /starts with a clean lease/,
    );
    await refused(
      arrangeSession(tenantA, owner.id, {
        credential_hash: "h",
        credential_expires_at: new Date(Date.now() + 9 * 3_600_000),
      }),
      /credential_cap_check/,
    );
  });

  it("refuses changing identity, rehearsal link, links and sources; clears them only while purging (rule:immutable-privacy-columns)", async () => {
    const owner = await provision(tenantA, "rae");
    const session = await arrangeSession(tenantA, owner.id, {
      status: "active",
      rehearsal_run_id: "run-1",
      strict: true,
      candidacy_id: owner.candidacy,
      interview_id: owner.interview,
      profile_id: owner.profile,
      profile_revision: 1,
      workspace_draft_id: "draft-rae",
      sources: { microphone: true },
      credential_hash: "rae-hash",
      credential_expires_at: new Date(Date.now() + 3_600_000),
    });
    const update = (set: string, value: unknown) =>
      asActor(tenantA, owner.id, (c) =>
        c.query(`UPDATE interview.active_sessions SET ${set} WHERE id=$1`, [
          session,
          value,
        ]),
      );
    for (const [set, value] of [
      ["rehearsal_run_id = $2", "run-2"],
      ["rehearsal_run_id = $2", null],
      ["strict = $2", false],
      ["expires_at = $2", new Date(Date.now() + 9_000)],
      ["created_at = $2", new Date(0)],
      ["owner_user_id = $2", carol.id],
      ["tenant_id = $2", tenantB],
      ["workspace_draft_id = $2", "draft-other"],
      ["workspace_draft_id = $2", null],
      ["sources = $2", JSON.stringify({ microphone: true, screen: true })],
      ["sources = $2", null],
      ["profile_id = $2", null],
      ["candidacy_id = $2", null],
      ["interview_id = $2", null],
    ] as const)
      await refused(update(set, value), /immutable|never change/);
    // A credential is replaced by the owner while the session runs.
    await update("credential_hash = $2", "rae-hash-2");

    // While purging only clearing is allowed; a different value never is.
    await setStatus(session, "purging");
    await refused(
      update("workspace_draft_id = $2", "draft-other"),
      /may only clear/,
    );
    await refused(
      update("credential_hash = $2", "rae-hash-3"),
      /may only clear its credential/,
    );
    await refused(update("strict = $2", false), /immutable/);
    await refused(
      asActor(tenantA, owner.id, (c) =>
        c.query(
          "UPDATE interview.active_sessions SET interview_id=$2 WHERE id=$1",
          [session, bob.interview],
        ),
      ),
      /may only clear/,
    );
    await asActor(tenantA, owner.id, (c) =>
      c.query(
        `UPDATE interview.active_sessions SET interview_id=NULL, candidacy_id=NULL,
           profile_id=NULL, profile_revision=NULL, workspace_draft_id=NULL,
           sources=NULL, credential_hash=NULL WHERE id=$1`,
        [session],
      ),
    );
  });

  it("never loosens the processing policy, lengthens retention, lowers the fence or revives a session (rule:monotonic-privacy-columns)", async () => {
    const owner = await provision(tenantA, "sia");
    const session = await arrangeSession(tenantA, owner.id, {
      status: "active",
      processing_policy: "device_only",
      retention_mode: "thirty_days",
    });
    const update = (set: string, values: unknown[] = []) =>
      asActor(tenantA, owner.id, (c) =>
        c.query(`UPDATE interview.active_sessions SET ${set} WHERE id=$1`, [
          session,
          ...values,
        ]),
      );
    await refused(
      update("processing_policy = 'permitted_remote'"),
      /never loosens/,
    );
    await refused(
      update("retention_mode = 'until_deleted'"),
      /never lengthens/,
    );
    await update("retention_mode = 'delete_at_end'");
    await refused(update("retention_mode = 'thirty_days'"), /never lengthens/);
    await pg.owner.query(
      "UPDATE interview.active_sessions SET fence=5 WHERE id=$1",
      [session],
    );
    await refused(update("fence = 4"), /fence never falls/);
    // A tightening is fine, and so is the same value.
    const loose = await arrangeSession(
      tenantA,
      (await provision(tenantA, "tam")).id,
      { processing_policy: "permitted_remote", status: "active" },
    );
    await pg.owner.query(
      "UPDATE interview.active_sessions SET processing_policy='device_only' WHERE id=$1",
      [loose],
    );
    await setStatus(session, "ended");
    await refused(update("status = 'active'"), /cannot become/);
    await refused(update("status = 'paused'"), /cannot become/);
    await setStatus(session, "purging");
    await refused(update("status = 'active'"), /cannot become/);
  });

  it("bounds the credential by the session's duration cap", async () => {
    const owner = await provision(tenantA, "uma");
    const cap = new Date(Date.now() + 3_600_000);
    await refused(
      arrangeSession(tenantA, owner.id, {
        expires_at: cap,
        credential_hash: "uma-hash",
        credential_expires_at: new Date(cap.getTime() + 1000),
      }),
      /credential_cap_check/,
    );
  });
});

describe("observations", () => {
  it("deduplicates by source and event id and keeps the original acknowledgement (rule:idempotent-observation)", async () => {
    const owner = await provision(tenantA, "val");
    const session = await arrangeSession(tenantA, owner.id, {
      status: "active",
    });
    const first = observation(tenantA, owner.id, session, {
      event_id: "evt-1",
      ack: JSON.stringify({ accepted: true, sequence: 1 }),
    });
    await asActor(tenantA, owner.id, (c) => c.query(first.text, first.values));
    const resend = observation(tenantA, owner.id, session, {
      event_id: "evt-1",
      ack: JSON.stringify({ accepted: true, sequence: 99 }),
    });
    await refused(
      asActor(tenantA, owner.id, (c) => c.query(resend.text, resend.values)),
      /session_observations_pkey/,
    );
    const conflict = await asActor(tenantA, owner.id, (c) =>
      c.query(
        `${resend.text} ON CONFLICT (tenant_id,owner_user_id,session_id,source_id,event_id) DO NOTHING RETURNING event_id`,
        resend.values,
      ),
    );
    expect(conflict.rows).toEqual([]);
    const stored = await asActor(tenantA, owner.id, (c) =>
      c.query<{ ack: { sequence: number } }>(
        "SELECT ack FROM interview.session_observations WHERE session_id=$1 AND event_id='evt-1'",
        [session],
      ),
    );
    expect(stored.rows[0]?.ack.sequence).toBe(1);
    // Another source may reuse the event id; a sequence is used once.
    const sameEventOtherSource = observation(tenantA, owner.id, session, {
      source_id: "screen",
      event_id: "evt-1",
    });
    await asActor(tenantA, owner.id, (c) =>
      c.query(sameEventOtherSource.text, sameEventOtherSource.values),
    );
    const sameSequence = observation(tenantA, owner.id, session, {
      event_id: "evt-2",
      sequence: first.values[5],
    });
    await refused(
      asActor(tenantA, owner.id, (c) =>
        c.query(sameSequence.text, sameSequence.values),
      ),
      /session_observations_sequence_key/,
    );
    // Append-only.
    await refused(
      pg.owner.query(
        "UPDATE interview.session_observations SET content='{}' WHERE session_id=$1",
        [session],
      ),
      /append-only/,
    );
  });
});

describe("actions", () => {
  it("deduplicates dispatch by session, task, revision and kind among in-flight and succeeded rows", async () => {
    const owner = await provision(tenantA, "wes");
    const session = await arrangeSession(tenantA, owner.id, {
      status: "active",
    });
    const run = (overrides: Record<string, unknown>) => {
      const act = action(tenantA, owner.id, session, overrides);
      return asActor(tenantA, owner.id, (c) => c.query(act.text, act.values));
    };
    await run({});
    await refused(run({}), /session_actions_dispatch_key/);
    // Another revision, another kind and another task are different keys.
    await run({ task_revision: 2 });
    await run({ action_kind: "outline" });
    await run({ task_id: "task-2" });
    // A failed dispatch records its outcome; a retry is allowed against it.
    await asActor(tenantA, owner.id, (c) =>
      c.query(
        "UPDATE interview.session_actions SET dispatch_status='failed' WHERE session_id=$1 AND task_id='task-1' AND task_revision=1",
        [session],
      ),
    );
    await run({ attempt: 2 });
    // A succeeded dispatch blocks a new in-flight one.
    await asActor(tenantA, owner.id, (c) =>
      c.query(
        "UPDATE interview.session_actions SET dispatch_status='succeeded', result='{\"draft\":\"x\"}' WHERE session_id=$1 AND task_id='task-1' AND task_revision=1 AND attempt=2",
        [session],
      ),
    );
    await refused(run({ attempt: 3 }), /session_actions_dispatch_key/);
  });

  it("keeps an action's identity, makes terminal statuses final and never un-shows a draft", async () => {
    const owner = await provision(tenantA, "xan");
    const session = await arrangeSession(tenantA, owner.id, {
      status: "active",
    });
    const act = action(tenantA, owner.id, session);
    await asActor(tenantA, owner.id, (c) => c.query(act.text, act.values));
    const update = (set: string) =>
      asActor(tenantA, owner.id, (c) =>
        c.query(
          `UPDATE interview.session_actions SET ${set} WHERE session_id=$1`,
          [session],
        ),
      );
    await refused(update("task_revision = 2"), /identity is immutable/);
    await refused(update("fence_at_dispatch = 9"), /identity is immutable/);
    await refused(update("result='{}'"), /session_actions_result_check/);
    await refused(update("shown = true"), /session_actions_result_check/);
    await update(
      "dispatch_status='succeeded', result='{\"draft\":\"x\"}', shown=true",
    );
    await refused(update("dispatch_status='failed'"), /terminal dispatch/);
    await refused(update("shown = false"), /stays shown/);
    const suppressed = action(tenantA, owner.id, session, {
      task_id: "t2",
      dispatch_status: "suppressed",
    });
    await refused(
      asActor(tenantA, owner.id, (c) =>
        c.query(suppressed.text, suppressed.values),
      ),
      /session_actions_suppression_check/,
    );
  });
});

describe("no content after purging (rule:no-content-after-purging)", () => {
  it.each(["ended", "purging"])(
    "refuses observations, published results and screenshots for a %s session",
    async (status) => {
      const owner = await provision(tenantA, `no-${status}`);
      const session = await arrangeSession(tenantA, owner.id, {
        status: "active",
      });
      const open = action(tenantA, owner.id, session, { task_id: "pending" });
      await asActor(tenantA, owner.id, (c) => c.query(open.text, open.values));
      const screenshot = await artifact(
        tenantA,
        owner.id,
        SESSION_SCREENSHOT_ARTIFACT_TYPE,
        { session_id: session },
      );
      await setStatus(session, status);

      const obs = observation(tenantA, owner.id, session);
      await refused(
        asActor(tenantA, owner.id, (c) => c.query(obs.text, obs.values)),
        /accepts no new observations/,
      );
      // A late result cannot publish, and no new dispatch starts.
      await refused(
        asActor(tenantA, owner.id, (c) =>
          c.query(
            "UPDATE interview.session_actions SET dispatch_status='succeeded', result='{\"draft\":\"late\"}' WHERE session_id=$1",
            [session],
          ),
        ),
        /accepts no published results/,
      );
      const next = action(tenantA, owner.id, session, { task_id: "new" });
      await refused(
        asActor(tenantA, owner.id, (c) => c.query(next.text, next.values)),
        status === "purging"
          ? /accepts no new actions/
          : /accepts no published results/,
      );
      // A screenshot artifact and its bytes are refused too.
      await refused(
        asActor(tenantA, owner.id, (c) =>
          c.query(
            "INSERT INTO platform.artifacts(tenant_id,owner_user_id,product_id,artifact_type,title,payload_reference,metadata) VALUES($1,$2,'omnitech.interview',$3,'t','payload:x',$4)",
            [
              tenantA,
              owner.id,
              SESSION_SCREENSHOT_ARTIFACT_TYPE,
              JSON.stringify({ session_id: session }),
            ],
          ),
        ),
        /accepts no screenshots/,
      );
      await refused(
        asActor(tenantA, owner.id, (c) =>
          c.query(
            "INSERT INTO platform.artifact_payloads(tenant_id,artifact_id,bytes,byte_length) VALUES($1,$2,'\\x89504e47',4)",
            [tenantA, screenshot],
          ),
        ),
        /accepts no screenshots/,
      );
    },
  );

  it("lets a paused session still record outcome and suppression rows", async () => {
    const owner = await provision(tenantA, "yuri");
    const session = await arrangeSession(tenantA, owner.id, {
      status: "active",
    });
    const inFlight = action(tenantA, owner.id, session, { task_id: "t" });
    await asActor(tenantA, owner.id, (c) =>
      c.query(inFlight.text, inFlight.values),
    );
    await setStatus(session, "paused");
    await asActor(tenantA, owner.id, (c) =>
      c.query(
        "UPDATE interview.session_actions SET dispatch_status='suppressed', suppression_reason='session_paused' WHERE session_id=$1",
        [session],
      ),
    );
    const suppressed = action(tenantA, owner.id, session, {
      task_id: "t2",
      dispatch_status: "suppressed",
      suppression_reason: "session_paused",
    });
    await asActor(tenantA, owner.id, (c) =>
      c.query(suppressed.text, suppressed.values),
    );
  });

  it("records an outcome (not a result) on an ended session, but never on a tombstone", async () => {
    const owner = await provision(tenantA, "zed");
    const session = await arrangeSession(tenantA, owner.id, {
      status: "active",
    });
    const pending = action(tenantA, owner.id, session, { task_id: "p" });
    await asActor(tenantA, owner.id, (c) =>
      c.query(pending.text, pending.values),
    );
    await setStatus(session, "ended");
    await asActor(tenantA, owner.id, (c) =>
      c.query(
        "UPDATE interview.session_actions SET dispatch_status='suppressed', suppression_reason='session_ended' WHERE session_id=$1",
        [session],
      ),
    );
    const failed = action(tenantA, owner.id, session, {
      task_id: "f",
      dispatch_status: "failed",
    });
    await asActor(tenantA, owner.id, (c) =>
      c.query(failed.text, failed.values),
    );
  });
});

describe("tombstone (rule:tombstone-keeps-hint-count)", () => {
  it("accepts only purge state once purged, and keeps owner, run id, strict flag and hint count", async () => {
    const owner = await provision(tenantA, "abe");
    const session = await arrangeSession(tenantA, owner.id, {
      status: "active",
      rehearsal_run_id: "run-abe",
      strict: false,
    });
    await pg.owner.query(
      "UPDATE interview.active_sessions SET shown_draft_count=2 WHERE id=$1",
      [session],
    );
    await setStatus(session, "purging");
    await pg.owner.query(
      `UPDATE interview.active_sessions SET status='ended', purged_at=now(),
         purge_outcome='complete', purge_counts='{"observations":3}' WHERE id=$1`,
      [session],
    );
    const update = (set: string) =>
      asActor(tenantA, owner.id, (c) =>
        c.query(`UPDATE interview.active_sessions SET ${set} WHERE id=$1`, [
          session,
        ]),
      );
    for (const set of [
      "shown_draft_count = 3",
      "shown_draft_count = 0",
      "retention_mode = 'thirty_days'",
      "last_heartbeat_at = now()",
      "ended_at = now()",
      "credential_hash = 'x', credential_expires_at = now()",
      "purged_at = NULL",
    ])
      await refused(update(set), /accepts only purge state/);
    // Lease and fence are closed to the claim too.
    await refused(
      asSessionWorker(member, (c) =>
        c.query(
          "UPDATE interview.active_sessions SET fence = fence + 1 WHERE id=$1",
          [session],
        ),
      ),
      /accepts only purge state/,
    );
    // Purge state may still be written (an idempotent re-run).
    await update('purge_counts = \'{"observations":3,"actions":1}\'');
    // No content lands on it.
    const obs = observation(tenantA, owner.id, session);
    await refused(
      asActor(tenantA, owner.id, (c) => c.query(obs.text, obs.values)),
      /accepts no new observations/,
    );
    const kept = await asActor(tenantA, owner.id, (c) =>
      c.query(
        "SELECT owner_user_id, rehearsal_run_id, strict, shown_draft_count FROM interview.active_sessions WHERE id=$1",
        [session],
      ),
    );
    expect(kept.rows).toEqual([
      {
        owner_user_id: owner.id,
        rehearsal_run_id: "run-abe",
        strict: false,
        shown_draft_count: 2,
      },
    ]);
  });
});

describe("the claim (rule:session-claim-setting, rule:claim-writes-lease-and-fence-only)", () => {
  it("shows sessions across tenants through the claim projection only under the setting", async () => {
    const one = await provision(tenantA, "cam");
    const two = await provision(tenantB, "cab");
    const sA = await arrangeSession(tenantA, one.id, {
      status: "active",
      credential_hash: "claim-secret-a",
      credential_expires_at: new Date(Date.now() + 3_600_000),
    });
    const sB = await arrangeSession(tenantB, two.id, { status: "active" });
    const claimed = await asSessionWorker(member, (c) =>
      c.query<{ id: string; tenant_id: string; owner_user_id: string }>(
        `${CLAIM_SELECT} WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[sA, sB]],
      ),
    );
    expect(claimed.rows.map((row) => row.id).sort()).toEqual([sA, sB].sort());
    const projected = claimed.rows.find((row) => row.id === sA);
    expect(projected?.tenant_id).toBe(tenantA);
    expect(projected?.owner_user_id).toBe(one.id);
    expect(Object.keys(projected ?? {}).sort()).toEqual(
      [...CLAIM_COLUMNS].sort(),
    );
    expect(JSON.stringify(claimed.rows)).not.toContain("claim-secret");

    // The projection has no credential, links, sources or rehearsal column.
    const columns = await pg.owner.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='interview' AND table_name='active_session_claims'`,
    );
    const names = columns.rows.map((row) => row.column_name).sort();
    expect(names).toEqual([...CLAIM_COLUMNS].sort());
    for (const hidden of [
      "credential_hash",
      "sources",
      "interview_id",
      "candidacy_id",
      "profile_id",
      "workspace_draft_id",
      "rehearsal_run_id",
      "strict",
    ])
      expect(names).not.toContain(hidden);

    // Without the setting a member sees only its own session, not across tenants.
    const own = await asActor(tenantA, one.id, (c) =>
      c.query<{ id: string }>("SELECT id FROM interview.active_session_claims"),
    );
    expect(own.rows.map((row) => row.id)).toEqual([sA]);
    expect(
      (await member.query("SELECT 1 FROM interview.active_sessions")).rows,
    ).toHaveLength(0);
  });

  it("changes only lease and fence, whoever else is set", async () => {
    const owner = await provision(tenantA, "dev");
    const session = await arrangeSession(tenantA, owner.id, {
      status: "active",
      credential_hash: "dev-hash",
      credential_expires_at: new Date(Date.now() + 3_600_000),
    });
    const claim = await asSessionWorker(member, (c) =>
      c.query(
        `UPDATE interview.active_sessions
            SET fence = fence + 1, lease_holder_id = 'worker-1',
                lease_expires_at = now() + interval '30 seconds'
          WHERE id = $1 RETURNING fence, lease_holder_id`,
        [session],
      ),
    );
    expect(claim.rows).toEqual([{ fence: "1", lease_holder_id: "worker-1" }]);
    for (const set of [
      "status = 'ended'",
      "owner_user_id = gen_random_uuid()",
      "tenant_id = gen_random_uuid()",
      "credential_hash = 'stolen'",
      "credential_revoked_at = now()",
      "processing_policy = 'device_only'",
      "last_heartbeat_at = now()",
      "sources = '{}'",
      "shown_draft_count = 9",
      "fence = fence + 1, status = 'paused'",
    ])
      await refused(
        asSessionWorker(member, (c) =>
          c.query(`UPDATE interview.active_sessions SET ${set} WHERE id=$1`, [
            session,
          ]),
        ),
        /claim changes only lease and fence/,
      );
    // The setting never widens an actor-scoped write either.
    await refused(
      member.transaction(async (client) => {
        await enterTenant(client, { tenantId: tenantA, actorId: owner.id });
        await client.query("SELECT set_config('app.session_worker','on',true)");
        return client.query(
          "UPDATE interview.active_sessions SET status='paused' WHERE id=$1",
          [session],
        );
      }),
      /claim changes only lease and fence/,
    );
    // The claim reads and leases; it cannot insert or delete.
    await refused(
      asSessionWorker(member, (c) =>
        c.query(
          "INSERT INTO interview.active_sessions(tenant_id,owner_user_id,processing_policy,expires_at) VALUES($1,$2,'permitted_remote',now()+interval '1 hour')",
          [tenantA, owner.id],
        ),
      ),
      /row-level security/,
    );
    expect(
      (
        await asSessionWorker(member, (c) =>
          c.query("DELETE FROM interview.active_sessions WHERE id=$1", [
            session,
          ]),
        )
      ).rowCount,
    ).toBe(0);
    // It does not read observations or actions.
    expect(
      (
        await asSessionWorker(member, (c) =>
          c.query("SELECT 1 FROM interview.session_observations"),
        )
      ).rows,
    ).toHaveLength(0);
  });
});

describe("the credential lookup (rule:credential-lookup-policy)", () => {
  it("admits exactly the one live row whose hash is presented, in the route's tenant", async () => {
    const one = await provision(tenantA, "cla");
    const two = await provision(tenantA, "clb");
    const expired = await provision(tenantA, "clc");
    const revoked = await provision(tenantA, "cld");
    const inB = await provision(tenantB, "cle");
    const live = new Date(Date.now() + 3_600_000);
    const sOne = await arrangeSession(tenantA, one.id, {
      status: "active",
      credential_hash: "lookup-1",
      credential_expires_at: live,
    });
    await arrangeSession(tenantA, two.id, {
      status: "active",
      credential_hash: "lookup-2",
      credential_expires_at: live,
    });
    await arrangeSession(tenantA, expired.id, {
      status: "active",
      credential_hash: "lookup-expired",
      credential_expires_at: new Date(Date.now() - 1000),
      expires_at: new Date(Date.now() + 3_600_000),
    });
    await arrangeSession(tenantA, revoked.id, {
      status: "active",
      credential_hash: "lookup-revoked",
      credential_expires_at: live,
      credential_revoked_at: new Date(),
    });
    await arrangeSession(tenantB, inB.id, {
      status: "active",
      credential_hash: "lookup-b",
      credential_expires_at: live,
    });
    const find = (tenantId: string, credentialHash: string) =>
      withCredentialLookup(member, { tenantId, credentialHash }, (c) =>
        c.query<{ id: string; owner_user_id: string }>(
          "SELECT id, owner_user_id FROM interview.active_sessions",
        ),
      );
    const found = await find(tenantA, "lookup-1");
    expect(found.rows).toEqual([{ id: sOne, owner_user_id: one.id }]);
    // Nothing else: another credential, an unknown, an expired and a revoked
    // one, and another tenant's credential presented under this tenant all
    // look the same.
    for (const hash of [
      "lookup-3",
      "lookup-expired",
      "lookup-revoked",
      "",
      "lookup-b",
    ])
      expect((await find(tenantA, hash)).rows, hash).toEqual([]);
    expect((await find(tenantB, "lookup-1")).rows).toEqual([]);
    expect((await find(tenantB, "lookup-b")).rows).toHaveLength(1);
    // Select-only: no write, and nothing else of the session is readable.
    expect(
      (
        await withCredentialLookup(
          member,
          { tenantId: tenantA, credentialHash: "lookup-1" },
          (c) =>
            c.query(
              "UPDATE interview.active_sessions SET last_heartbeat_at = now()",
            ),
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await withCredentialLookup(
          member,
          { tenantId: tenantA, credentialHash: "lookup-1" },
          (c) => c.query("SELECT 1 FROM interview.session_observations"),
        )
      ).rows,
    ).toHaveLength(0);
    await refused(
      withCredentialLookup(
        member,
        { tenantId: tenantA, credentialHash: "lookup-1" },
        (c) =>
          c.query(
            "INSERT INTO interview.active_sessions(tenant_id,owner_user_id,processing_policy,expires_at) VALUES($1,$2,'permitted_remote',now()+interval '1 hour')",
            [tenantA, one.id],
          ),
      ),
      /row-level security/,
    );
  });

  it("keeps one live credential hash per session row and never repeats a hash", async () => {
    const owner = await provision(tenantA, "clf");
    const other = await provision(tenantA, "clg");
    const live = new Date(Date.now() + 3_600_000);
    await arrangeSession(tenantA, owner.id, {
      credential_hash: "unique-hash",
      credential_expires_at: live,
    });
    await refused(
      arrangeSession(tenantA, other.id, {
        credential_hash: "unique-hash",
        credential_expires_at: live,
      }),
      /active_sessions_credential_hash_key/,
    );
  });
});

describe("session artifacts (rule:private-session-artifact-types, rule:purge-delete-setting)", () => {
  async function screenshot(owner: Person, session: string) {
    const id = await asActor(tenantA, owner.id, async (c) => {
      const inserted = await c.query<{ id: string }>(
        "INSERT INTO platform.artifacts(tenant_id,owner_user_id,product_id,artifact_type,title,payload_reference,metadata) VALUES($1,$2,'omnitech.interview',$3,'Screenshot','payload:shot',$4) RETURNING id",
        [
          tenantA,
          owner.id,
          SESSION_SCREENSHOT_ARTIFACT_TYPE,
          JSON.stringify({ session_id: session }),
        ],
      );
      const artifactId = String(inserted.rows[0]?.id);
      await c.query(
        "INSERT INTO platform.artifact_payloads(tenant_id,artifact_id,bytes,byte_length) VALUES($1,$2,'\\x89504e47',4)",
        [tenantA, artifactId],
      );
      return artifactId;
    });
    return id;
  }

  it("lists a session artifact for its owner only and never updates it", async () => {
    const owner = await provision(tenantA, "ara");
    const other = await provision(tenantA, "arb");
    const session = await arrangeSession(tenantA, owner.id, {
      status: "active",
    });
    const id = await screenshot(owner, session);
    const listing = (actor: Person) =>
      asActor(tenantA, actor.id, (c) =>
        c.query<{ id: string }>(
          "SELECT id FROM platform.artifacts WHERE artifact_type=$1",
          [SESSION_SCREENSHOT_ARTIFACT_TYPE],
        ),
      );
    expect((await listing(owner)).rows.map((row) => row.id)).toContain(id);
    // A same-tenant member who is not the owner sees none, nor its bytes.
    expect((await listing(other)).rows).toEqual([]);
    expect(
      (
        await asActor(tenantA, other.id, (c) =>
          c.query(
            "SELECT 1 FROM platform.artifact_payloads WHERE artifact_id=$1",
            [id],
          ),
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await asActor(tenantA, other.id, (c) =>
          c.query("SELECT 1 FROM platform.artifacts WHERE id=$1", [id]),
        )
      ).rows,
    ).toEqual([]);
    // Another member cannot create one in the owner's name.
    await refused(
      asActor(tenantA, other.id, (c) =>
        c.query(
          "INSERT INTO platform.artifacts(tenant_id,owner_user_id,product_id,artifact_type,title,payload_reference,metadata) VALUES($1,$2,'omnitech.interview',$3,'t','payload:x',$4)",
          [
            tenantA,
            owner.id,
            SESSION_SCREENSHOT_ARTIFACT_TYPE,
            JSON.stringify({ session_id: session }),
          ],
        ),
      ),
      /row-level security|names no session of its owner/,
    );
    // Never updated, not even by its owner.
    expect(
      (
        await asActor(tenantA, owner.id, (c) =>
          c.query("UPDATE platform.artifacts SET title='x' WHERE id=$1", [id]),
        )
      ).rowCount,
    ).toBe(0);
    // A session screenshot must name its owner's own session.
    await refused(
      asActor(tenantA, other.id, (c) =>
        c.query(
          "INSERT INTO platform.artifacts(tenant_id,owner_user_id,product_id,artifact_type,title,payload_reference,metadata) VALUES($1,$2,'omnitech.interview',$3,'t','payload:x',$4)",
          [
            tenantA,
            other.id,
            SESSION_SCREENSHOT_ARTIFACT_TYPE,
            JSON.stringify({ session_id: session }),
          ],
        ),
      ),
      /names no session of its owner/,
    );
    await refused(
      asActor(tenantA, owner.id, (c) =>
        c.query(
          "INSERT INTO platform.artifacts(tenant_id,owner_user_id,product_id,artifact_type,title,payload_reference,metadata) VALUES($1,$2,'omnitech.interview',$3,'t','payload:x','{}')",
          [tenantA, owner.id, SESSION_SCREENSHOT_ARTIFACT_TYPE],
        ),
      ),
      /names no session of its owner/,
    );
  });

  it("deletes artifacts and payloads only under the purge setting, for the owner and the session type", async () => {
    const owner = await provision(tenantA, "arc");
    const other = await provision(tenantA, "ard");
    const session = await arrangeSession(tenantA, owner.id, {
      status: "active",
    });
    const id = await screenshot(owner, session);
    const documentExport = await artifact(
      tenantA,
      owner.id,
      "interview.document-export",
    );
    const plain = await artifact(tenantA, owner.id, "interview.other");
    const count = async (query: string, values: unknown[]) =>
      Number((await pg.owner.query<{ n: string }>(query, values)).rows[0]?.n);

    // No setting: nothing is deleted, payload or artifact.
    for (const query of [
      "DELETE FROM platform.artifact_payloads WHERE artifact_id=$1",
      "DELETE FROM platform.artifacts WHERE id=$1",
    ])
      expect(
        (await asActor(tenantA, owner.id, (c) => c.query(query, [id])))
          .rowCount,
        query,
      ).toBe(0);
    // The setting without the owner: nothing.
    for (const query of [
      "DELETE FROM platform.artifact_payloads WHERE artifact_id=$1",
      "DELETE FROM platform.artifacts WHERE id=$1",
    ])
      expect(
        (
          await asSessionPurge(
            member,
            { tenantId: tenantA, ownerUserId: other.id },
            (c) => c.query(query, [id]),
          )
        ).rowCount,
        query,
      ).toBe(0);
    // The setting and the owner, but not the session type: a document type is
    // still refused by its own policy, while an unrelated type keeps its
    // existing tenant behaviour (the setting grants nothing for it).
    expect(
      (
        await asSessionPurge(
          member,
          { tenantId: tenantA, ownerUserId: owner.id },
          (c) =>
            c.query("DELETE FROM platform.artifacts WHERE id=$1", [
              documentExport,
            ]),
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await asSessionPurge(
          member,
          { tenantId: tenantA, ownerUserId: owner.id },
          (c) =>
            c.query(
              "DELETE FROM platform.artifact_payloads WHERE artifact_id=$1",
              [plain],
            ),
        )
      ).rowCount,
    ).toBe(0);
    expect(
      await count("SELECT count(*) AS n FROM platform.artifacts WHERE id=$1", [
        id,
      ]),
    ).toBe(1);
    // The owner under the setting deletes the bytes, then the artifact.
    expect(
      (
        await asSessionPurge(
          member,
          { tenantId: tenantA, ownerUserId: owner.id },
          (c) =>
            c.query(
              "DELETE FROM platform.artifact_payloads WHERE artifact_id=$1",
              [id],
            ),
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await asSessionPurge(
          member,
          { tenantId: tenantA, ownerUserId: owner.id },
          (c) => c.query("DELETE FROM platform.artifacts WHERE id=$1", [id]),
        )
      ).rowCount,
    ).toBe(1);
  });

  it("deletes observations, actions and the session row only under the purge setting, observations first", async () => {
    const owner = await provision(tenantA, "ase");
    const session = await arrangeSession(tenantA, owner.id, {
      status: "active",
    });
    const shot = await screenshot(owner, session);
    const obs = observation(tenantA, owner.id, session, {
      kind: "screen.snapshot",
      screenshot_artifact_id: shot,
    });
    await asActor(tenantA, owner.id, (c) => c.query(obs.text, obs.values));
    const act = action(tenantA, owner.id, session);
    await asActor(tenantA, owner.id, (c) => c.query(act.text, act.values));
    for (const table of [
      "session_observations",
      "session_actions",
      "active_sessions",
    ])
      expect(
        (
          await asActor(tenantA, owner.id, (c) =>
            c.query(`DELETE FROM interview.${table}`),
          )
        ).rowCount,
        table,
      ).toBe(0);
    await setStatus(session, "purging");
    const purge = <T>(work: (c: DatabaseClient) => Promise<T>) =>
      asSessionPurge(
        member,
        { tenantId: tenantA, ownerUserId: owner.id },
        work,
      );
    // The artifact is still referenced by its observation.
    await refused(
      purge((c) =>
        c.query("DELETE FROM platform.artifacts WHERE id=$1", [shot]),
      ),
      /session_observations_artifact_fkey|foreign key/,
    );
    expect(
      (
        await purge((c) =>
          c.query("DELETE FROM interview.session_observations"),
        )
      ).rowCount,
    ).toBe(1);
    // Deleting the artifact removes its payload with it.
    expect(
      (
        await purge((c) =>
          c.query("DELETE FROM platform.artifacts WHERE id=$1", [shot]),
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await pg.owner.query(
          "SELECT 1 FROM platform.artifact_payloads WHERE artifact_id=$1",
          [shot],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (await purge((c) => c.query("DELETE FROM interview.session_actions")))
        .rowCount,
    ).toBe(1);
  });
});

// The companion's capability row is device capability, not session content: it
// is the owner's alone under forced row security, bound to the tenant membership
// by a composite reference, and a session purge does not touch it (the purge
// itself is covered in session-purge.test.ts).
describe("companion capability (device capability, owner-only)", () => {
  const insertFor = (tenant: string, owner: string, locale = "en-US") => ({
    text: `INSERT INTO interview.companion_capabilities
      (tenant_id,owner_user_id,speech_locale,speech_on_device_available,speech_recognizer_available,speech_authorization_status,microphone,screen)
      VALUES($1,$2,$3,true,true,'authorized','granted','denied')`,
    values: [tenant, owner, locale],
  });

  it("forces row security and has no delete policy", async () => {
    const forced = await pg.owner.query<{ force: boolean }>(
      "SELECT relforcerowsecurity AS force FROM pg_class WHERE oid = 'interview.companion_capabilities'::regclass",
    );
    expect(forced.rows[0]?.force).toBe(true);
    const policies = await pg.owner.query<{ cmd: string }>(
      "SELECT cmd FROM pg_policies WHERE tablename = 'companion_capabilities' ORDER BY cmd",
    );
    expect(policies.rows.map((p) => p.cmd)).toEqual([
      "INSERT",
      "SELECT",
      "UPDATE",
    ]);
  });

  it("lets the owner write and read their own row, and nobody else read or write it", async () => {
    const mine = insertFor(tenantA, alice.id);
    await asActor(tenantA, alice.id, (c) => c.query(mine.text, mine.values));
    expect(
      (
        await asActor(tenantA, alice.id, (c) =>
          c.query("SELECT speech_locale FROM interview.companion_capabilities"),
        )
      ).rows,
    ).toEqual([{ speech_locale: "en-US" }]);
    // The same-tenant other user sees nothing, cannot write for the owner and
    // cannot update the owner's row.
    expect(
      (
        await asActor(tenantA, carol.id, (c) =>
          c.query("SELECT 1 FROM interview.companion_capabilities"),
        )
      ).rows,
    ).toEqual([]);
    await refused(
      asActor(tenantA, carol.id, (c) => c.query(mine.text, mine.values)),
      /row-level security/,
    );
    expect(
      (
        await asActor(tenantA, carol.id, (c) =>
          c.query(
            "UPDATE interview.companion_capabilities SET speech_locale='xx-XX'",
          ),
        )
      ).rowCount,
    ).toBe(0);
    // Another tenant's actor sees nothing and cannot write into tenant A.
    expect(
      (
        await asActor(tenantB, bob.id, (c) =>
          c.query("SELECT 1 FROM interview.companion_capabilities"),
        )
      ).rows,
    ).toEqual([]);
    await refused(
      asActor(tenantB, bob.id, (c) => c.query(mine.text, mine.values)),
      /row-level security/,
    );
    // Nobody deletes (there is no delete policy), the owner included.
    expect(
      (
        await asActor(tenantA, alice.id, (c) =>
          c.query("DELETE FROM interview.companion_capabilities"),
        )
      ).rowCount,
    ).toBe(0);
  });

  it("holds one row per owner, replaced in place", async () => {
    const dup = insertFor(tenantA, alice.id, "fr-CA");
    await refused(
      asActor(tenantA, alice.id, (c) => c.query(dup.text, dup.values)),
      /duplicate key/,
    );
    await asActor(tenantA, alice.id, (c) =>
      c.query(
        "UPDATE interview.companion_capabilities SET speech_locale='fr-CA'",
      ),
    );
    expect(
      (
        await pg.owner.query(
          "SELECT speech_locale FROM interview.companion_capabilities WHERE owner_user_id=$1",
          [alice.id],
        )
      ).rows,
    ).toEqual([{ speech_locale: "fr-CA" }]);
  });

  it("refuses an owner who is not a member of the tenant, and unknown states", async () => {
    // alice is a member of tenant A only: the composite membership reference.
    const outsider = insertFor(tenantB, alice.id);
    await refused(
      pg.owner.query(outsider.text, outsider.values),
      /companion_capabilities_membership_fkey/,
    );
    await refused(
      pg.owner.query(
        "UPDATE interview.companion_capabilities SET microphone='maybe'",
      ),
      /companion_capabilities_microphone_check/,
    );
  });
});

it("selects the claim projection through the claim file's own SELECT list", async () => {
  expect(CLAIM_SELECT).toBe(
    `SELECT ${CLAIM_COLUMNS.join(", ")} FROM interview.active_session_claims`,
  );
  expect(CLAIM_SELECT).not.toContain("credential_hash");
  const rows = await asSessionWorker(member, (c) => c.query(CLAIM_SELECT));
  expect(rows.rows.length).toBeGreaterThan(0);
});
