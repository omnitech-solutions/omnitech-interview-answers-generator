// The owner-facing Active Session repository on a disposable PostgreSQL,
// connected as the NOSUPERUSER NOBYPASSRLS member role. Covers start (same-owner
// link validation, pinned profile, policy and retention, strict rehearsal, one
// open session per owner, the credential helper), control authority through the
// core's status machine, credential renewal and revocation, tighten-only policy,
// owner delete and the owner-checked read paths.
import { createHash } from "node:crypto";
import {
  ACTIVE_SESSION_LIMITS,
  CREDENTIAL_TRANSPORT,
} from "@omnitech/active-session-contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SessionError } from "./errors.js";
import {
  type Fixture,
  type Person,
  startFixture,
} from "./live-session-fixture.js";
import { ActiveSessionRepository } from "./repository.js";
import {
  credentialExpiry,
  presentedCredentialHash,
} from "./session-credential.js";
import { type SessionJobs } from "./session-jobs.js";

let fx: Fixture;
let repo: ActiveSessionRepository;
let tenant = "";

const scopeOf = (person: Person) => ({ tenantId: tenant, actorId: person.id });
const start = (person: Person, extra: Record<string, unknown> = {}) =>
  repo.startSession(scopeOf(person), {
    processingPolicy: "permitted-remote",
    captureSources: ["microphone"],
    ...extra,
  } as never);
const fresh = (name: string) => fx.provision(tenant, name);

async function refusal(work: Promise<unknown>): Promise<SessionError> {
  const error = await work.then(
    () => undefined,
    (failure: unknown) => failure,
  );
  expect(error).toBeInstanceOf(SessionError);
  return error as SessionError;
}

beforeAll(async () => {
  fx = await startFixture();
  tenant = fx.tenantA;
  repo = new ActiveSessionRepository(fx.member);
}, 90_000);
afterAll(() => fx?.stop());

describe("start (rule:linked-resource-authorization, rule:retention-modes)", () => {
  it("records the policy, default retention, sources and a pinned profile revision", async () => {
    const alice = await fresh("alice");
    const started = await start(alice, {
      candidacyId: alice.candidacy,
      interviewId: alice.interview,
      profile: { id: alice.profile },
    });
    expect(started.session).toMatchObject({
      status: "active",
      retention: "delete-at-end",
      processingPolicy: "permitted-remote",
      captureSources: ["microphone"],
      liveAssistance: true,
      candidacyId: alice.candidacy,
      interviewId: alice.interview,
      profile: { id: alice.profile, revision: 1 },
      strict: false,
    });
    const stored = await fx.owner.query(
      "SELECT retention_mode, processing_policy, profile_revision FROM interview.active_sessions WHERE id=$1",
      [started.session.id],
    );
    expect(stored.rows[0]).toMatchObject({
      retention_mode: "delete_at_end",
      processing_policy: "permitted_remote",
    });
  });

  it("starts a strict rehearsal with live assistance disabled and an immutable run id", async () => {
    const bob = await fresh("bob");
    const started = await start(bob, {
      rehearsal: { runId: "run-1", strict: true },
      liveAssistance: true,
    });
    expect(started.session).toMatchObject({
      strict: true,
      rehearsalRunId: "run-1",
      liveAssistance: false,
    });
    const looser = await fresh("bella");
    const second = await start(looser, {
      rehearsal: { runId: "run-2", strict: false },
    });
    expect(second.session.liveAssistance).toBe(true);
  });

  it("refuses another user's candidacy, interview, profile and a missing draft", async () => {
    const dana = await fresh("dana");
    const erin = await fresh("erin");
    for (const extra of [
      { candidacyId: erin.candidacy },
      { candidacyId: dana.candidacy, interviewId: erin.interview },
      { interviewId: dana.interview },
      { profile: { id: erin.profile } },
      { profile: { id: dana.profile, revision: 9 } },
      { workspaceDraft: { workspaceId: "ws", artifactId: "missing" } },
    ]) {
      const error = await refusal(start(dana, extra));
      expect(error.code).toBe("link_refused");
    }
    // Nothing was created by any refused start.
    expect(
      (
        await fx.owner.query(
          "SELECT 1 FROM interview.active_sessions WHERE owner_user_id=$1",
          [dana.id],
        )
      ).rows,
    ).toHaveLength(0);
  });

  it("accepts the owner's existing Workspace draft and refuses another owner's", async () => {
    const fiona = await fresh("fiona");
    const gus = await fresh("gus");
    await fx.owner.query(
      "INSERT INTO interview.assistant_drafts(tenant_id,actor_id,product_id,workspace_id,artifact_id,value) VALUES($1,$2,'omnitech.interview','ws-1','art-1','{}')",
      [tenant, fiona.id],
    );
    const ok = await start(fiona, {
      workspaceDraft: { workspaceId: "ws-1", artifactId: "art-1" },
    });
    expect(ok.session.workspaceDraft).toEqual({
      workspaceId: "ws-1",
      artifactId: "art-1",
    });
    const error = await refusal(
      start(gus, {
        workspaceDraft: { workspaceId: "ws-1", artifactId: "art-1" },
      }),
    );
    expect(error.code).toBe("link_refused");
  });

  it("allows one open session per owner, and a new one once it ended", async () => {
    const hana = await fresh("hana");
    const first = await start(hana);
    expect((await refusal(start(hana))).code).toBe("open_session_exists");
    await repo.controlSession(scopeOf(hana), first.session.id, "end");
    const second = await start(hana);
    expect(second.session.id).not.toBe(first.session.id);
  });

  it("rejects malformed input without touching the database", async () => {
    const ivy = await fresh("ivy");
    for (const extra of [
      { captureSources: [] },
      { captureSources: ["camera"] },
      { processingPolicy: "anywhere" },
      { retention: "forever" },
      { durationMs: 5 },
      { surprise: true },
    ])
      expect((await refusal(start(ivy, extra))).code).toBe("invalid_input");
  });

  it("caps the credential at the session's duration cap", async () => {
    const jo = await fresh("jo");
    const started = await start(jo, { durationMs: 10 * 60_000 });
    expect(started.credential.expiresAt).toBe(started.session.expiresAt);
    const kim = await fresh("kim");
    const normal = await start(kim);
    expect(Date.parse(normal.credential.expiresAt)).toBeLessThan(
      Date.parse(normal.session.expiresAt),
    );
  });
});

describe("the credential (rule:credential-storage, rule:credential-strength)", () => {
  it("stores only a hash and returns the plaintext once", async () => {
    const lee = await fresh("lee");
    const started = await start(lee);
    const plaintext = started.credential.value;
    expect(plaintext).toMatch(/^asc_[A-Za-z0-9_-]{43}$/);
    const row = (
      await fx.owner.query(
        "SELECT * FROM interview.active_sessions WHERE id=$1",
        [started.session.id],
      )
    ).rows[0];
    expect(row.credential_hash).toBe(
      createHash("sha256").update(plaintext).digest("hex"),
    );
    // The plaintext appears in no stored column and in no later read.
    expect(JSON.stringify(row)).not.toContain(plaintext);
    const read = await repo.getSession(scopeOf(lee), started.session.id);
    expect(JSON.stringify(read)).not.toContain(plaintext);
    expect(JSON.stringify(read)).not.toContain(row.credential_hash);
    expect(
      JSON.stringify(await repo.getOpenSession(scopeOf(lee))),
    ).not.toContain(plaintext);
    expect(CREDENTIAL_TRANSPORT.allowedInUrl).toBe(false);
  });

  it("never appears in a thrown error message or a log (canary)", async () => {
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const mo = await fresh("mo");
    const started = await start(mo);
    const canary = started.credential.value;
    const messages: string[] = [];
    const stranger = await fresh("stranger");
    // Every failure path of the owner-facing API.
    for (const work of [
      () => start(mo),
      () => repo.controlSession(scopeOf(mo), "not-a-uuid", "pause"),
      () =>
        repo.tightenProcessingPolicy(
          scopeOf(mo),
          started.session.id,
          "x" as never,
        ),
      () => repo.renewCredential(scopeOf(stranger), started.session.id),
    ]) {
      try {
        await work();
      } catch (failure) {
        messages.push(String((failure as Error).message));
      }
    }
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) expect(message).not.toContain(canary);
    for (const spy of [log, warn, error])
      expect(JSON.stringify(spy.mock.calls)).not.toContain(canary);
  });

  it("renews with a new credential, replacing the old one, never past the cap", async () => {
    const ned = await fresh("ned");
    const started = await start(ned);
    const renewed = await repo.renewCredential(
      scopeOf(ned),
      started.session.id,
    );
    expect(renewed.value).not.toBe(started.credential.value);
    const row = (
      await fx.owner.query(
        "SELECT credential_hash, credential_expires_at, expires_at FROM interview.active_sessions WHERE id=$1",
        [started.session.id],
      )
    ).rows[0];
    expect(row.credential_hash).toBe(
      createHash("sha256").update(renewed.value).digest("hex"),
    );
    expect(row.credential_hash).not.toBe(
      createHash("sha256").update(started.credential.value).digest("hex"),
    );
    expect(new Date(row.credential_expires_at).getTime()).toBeLessThanOrEqual(
      new Date(row.expires_at).getTime(),
    );
  });

  it("refuses renewal for another user, an ended session and a capped one", async () => {
    const olga = await fresh("olga");
    const other = await fresh("pat");
    const started = await start(olga);
    expect(
      (await refusal(repo.renewCredential(scopeOf(other), started.session.id)))
        .code,
    ).toBe("not_found");
    await repo.controlSession(scopeOf(olga), started.session.id, "end");
    expect(
      (await refusal(repo.renewCredential(scopeOf(olga), started.session.id)))
        .code,
    ).toBe("status_refused");
    // A session past its duration cap cannot get a credential beyond it.
    const quinn = await fresh("quinn");
    const capped = await fx.one(
      "INSERT INTO interview.active_sessions(tenant_id,owner_user_id,processing_policy,status,expires_at) VALUES($1,$2,'permitted_remote','active',now() - interval '1 minute') RETURNING id",
      [tenant, quinn.id],
    );
    expect(
      (await refusal(repo.renewCredential(scopeOf(quinn), capped))).code,
    ).toBe("duration_cap_reached");
  });

  it("revokes on request and pauses the live session", async () => {
    const ray = await fresh("ray");
    const started = await start(ray);
    await repo.revokeCredential(scopeOf(ray), started.session.id);
    const read = await repo.getSession(scopeOf(ray), started.session.id);
    expect(read).toMatchObject({ status: "paused", credentialRevoked: true });
  });

  it("derives expiry from the shorter of lifetime and cap, and rejects malformed values", async () => {
    const now = Date.now();
    expect(credentialExpiry(now, now + 60_000).getTime()).toBe(now + 60_000);
    expect(credentialExpiry(now, now + 10 ** 10).getTime()).toBe(
      now + ACTIVE_SESSION_LIMITS.credentialLifetimeMs,
    );
    expect(await presentedCredentialHash("short")).toBeNull();
    expect(await presentedCredentialHash(42)).toBeNull();
  });
});

describe("control authority (rule:stop-authority as amended)", () => {
  it("lets the owner pause, resume and end through the status machine", async () => {
    const sam = await fresh("sam");
    const { session } = await start(sam);
    const scope = scopeOf(sam);
    expect((await repo.controlSession(scope, session.id, "pause")).status).toBe(
      "paused",
    );
    expect((await repo.controlSession(scope, session.id, "pause")).status).toBe(
      "paused",
    );
    expect(
      (await repo.controlSession(scope, session.id, "resume")).status,
    ).toBe("active");
    const ended = await repo.controlSession(scope, session.id, "end");
    expect(ended.status).toBe("ended");
    expect(ended.endedAt).not.toBeNull();
    // An ended session's credential is revoked and it cannot be resumed.
    expect(ended.credentialRevoked).toBe(true);
    expect(
      (await refusal(repo.controlSession(scope, session.id, "resume"))).code,
    ).toBe("status_refused");
  });

  it("lets only the owner's control start or resume; expiry and companion stop only pause", async () => {
    const tia = await fresh("tia");
    const { session } = await start(tia);
    const scope = scopeOf(tia);
    // Neither internal actor may end.
    for (const actor of ["credential-expiry", "companion-stop"] as const)
      expect(
        (await refusal(repo.controlSession(scope, session.id, "end", actor)))
          .code,
      ).toBe("status_refused");
    const paused = await repo.controlSession(
      scope,
      session.id,
      "pause",
      "companion-stop",
    );
    expect(paused.status).toBe("paused");
    for (const actor of [
      "credential-expiry",
      "companion-stop",
      "duration-cap",
    ] as const)
      expect(
        (await refusal(repo.controlSession(scope, session.id, "resume", actor)))
          .code,
      ).toBe("status_refused");
    expect(
      (await repo.controlSession(scope, session.id, "resume")).status,
    ).toBe("active");
    // The duration cap does end.
    expect(
      (await repo.controlSession(scope, session.id, "end", "duration-cap"))
        .status,
    ).toBe("ended");
  });

  it("refuses resume with a dead credential until the owner renews", async () => {
    const uma = await fresh("uma");
    const { session } = await start(uma);
    const scope = scopeOf(uma);
    await repo.controlSession(scope, session.id, "pause");
    await fx.owner.query(
      "UPDATE interview.active_sessions SET credential_expires_at = now() - interval '1 minute' WHERE id=$1",
      [session.id],
    );
    expect(
      (await refusal(repo.controlSession(scope, session.id, "resume"))).code,
    ).toBe("credential_renewal_required");
    await repo.renewCredential(scope, session.id);
    expect(
      (await repo.controlSession(scope, session.id, "resume")).status,
    ).toBe("active");
  });

  it("pauses, never ends, on credential expiry or a silent companion", async () => {
    const vic = await fresh("vic");
    const { session } = await start(vic);
    const scope = scopeOf(vic);
    await fx.owner.query(
      "UPDATE interview.active_sessions SET credential_expires_at = now() - interval '1 second' WHERE id=$1",
      [session.id],
    );
    const afterExpiry = await repo.reconcileSession(scope, session.id);
    expect(afterExpiry.status).toBe("paused");
    expect(afterExpiry.endedAt).toBeNull();

    const wes = await fresh("wes");
    const second = await start(wes);
    await fx.owner.query(
      "UPDATE interview.active_sessions SET last_heartbeat_at = now() - interval '1 hour' WHERE id=$1",
      [second.session.id],
    );
    const silent = await repo.reconcileSession(scopeOf(wes), second.session.id);
    expect(silent.status).toBe("paused");
    expect(silent.endedAt).toBeNull();
    // A fresh session with no contact yet is not paused for want of a heartbeat.
    const xia = await fresh("xia");
    const third = await start(xia);
    expect(
      (await repo.reconcileSession(scopeOf(xia), third.session.id)).status,
    ).toBe("active");
  });

  it("ends a session past its duration cap", async () => {
    const yan = await fresh("yan");
    const id = await fx.one(
      "INSERT INTO interview.active_sessions(tenant_id,owner_user_id,processing_policy,status,expires_at) VALUES($1,$2,'permitted_remote','active',now() - interval '1 minute') RETURNING id",
      [tenant, yan.id],
    );
    await fx.owner.query(
      "UPDATE interview.active_sessions SET status='paused' WHERE id=$1",
      [id],
    );
    const reconciled = await repo.reconcileSession(scopeOf(yan), id);
    expect(reconciled.status).toBe("ended");
    expect(reconciled.credentialRevoked).toBe(true);
  });
});

describe("tighten-only policy and retention (rule:tighten-only-locality)", () => {
  it("tightens to device-only and refuses loosening, in the core and in the database", async () => {
    const zed = await fresh("zed");
    const { session } = await start(zed);
    const scope = scopeOf(zed);
    expect(
      (await repo.tightenProcessingPolicy(scope, session.id, "device-only"))
        .processingPolicy,
    ).toBe("device-only");
    expect(
      (
        await refusal(
          repo.tightenProcessingPolicy(scope, session.id, "permitted-remote"),
        )
      ).code,
    ).toBe("loosening_refused");
    // The database refuses it too, even around the repository.
    await expect(
      fx.member.transaction(async (client) => {
        await client.query(
          "SELECT set_config('app.tenant_id',$1,true), set_config('app.actor_id',$2,true)",
          [tenant, zed.id],
        );
        await client.query(
          "UPDATE interview.active_sessions SET processing_policy='permitted_remote' WHERE id=$1",
          [session.id],
        );
      }),
    ).rejects.toThrow(/never loosens/);
  });

  it("shortens retention and refuses to lengthen it", async () => {
    const abe = await fresh("abe");
    const { session } = await start(abe, { retention: "until-deleted" });
    const scope = scopeOf(abe);
    expect(
      (await repo.shortenRetention(scope, session.id, "thirty-days")).retention,
    ).toBe("thirty-days");
    expect(
      (await refusal(repo.shortenRetention(scope, session.id, "until-deleted")))
        .code,
    ).toBe("retention_lengthening_refused");
    expect(
      (await repo.shortenRetention(scope, session.id, "delete-at-end"))
        .retention,
    ).toBe("delete-at-end");
  });
});

describe("owner delete begins the purge", () => {
  it("makes the session purging, revokes the credential and frees the owner's slot", async () => {
    const cal = await fresh("cal");
    const { session } = await start(cal);
    const deleted = await repo.deleteSession(scopeOf(cal), session.id);
    expect(deleted).toMatchObject({
      status: "purging",
      credentialRevoked: true,
    });
    expect((await repo.deleteSession(scopeOf(cal), session.id)).status).toBe(
      "purging",
    );
    const next = await start(cal);
    expect(next.session.status).toBe("active");
  });
});

describe("owner-checked read paths (rule:owner-checked-read-paths)", () => {
  it("shows another same-tenant user nothing of the session on any read path", async () => {
    const dee = await fresh("dee");
    const eve = await fresh("eve");
    const { session } = await start(dee, { profile: { id: dee.profile } });
    await fx.owner.query(
      `INSERT INTO interview.session_observations(tenant_id,owner_user_id,session_id,source_id,event_id,sequence,kind,content,ack)
       VALUES($1,$2,$3,'mic','e1',1,'transcript.final','{"body":{"text":"x"}}','{}')`,
      [tenant, dee.id, session.id],
    );
    await fx.owner.query(
      `INSERT INTO interview.session_actions(tenant_id,owner_user_id,session_id,task_id,task_revision,action_kind,fence_at_dispatch)
       VALUES($1,$2,$3,'t1',1,'answer',1)`,
      [tenant, dee.id, session.id],
    );
    const own = scopeOf(dee);
    const foreign = scopeOf(eve);
    // The owner reads everything.
    expect(await repo.listObservations(own, session.id)).toHaveLength(1);
    expect(await repo.listActions(own, session.id)).toHaveLength(1);
    expect((await repo.getSessionContext(own, session.id))?.profile?.id).toBe(
      dee.profile,
    );
    // The other member reads nothing, and the refusal matches "no such session".
    expect(await repo.getSession(foreign, session.id)).toBeNull();
    expect(await repo.getOpenSession(foreign)).toBeNull();
    expect(await repo.getSessionContext(foreign, session.id)).toBeNull();
    expect(
      (await refusal(repo.listObservations(foreign, session.id))).code,
    ).toBe("not_found");
    expect((await refusal(repo.listActions(foreign, session.id))).code).toBe(
      "not_found",
    );
    expect(
      (
        await refusal(
          repo.listObservations(
            foreign,
            "11111111-1111-1111-1111-111111111111",
          ),
        )
      ).message,
    ).toBe((await refusal(repo.listObservations(foreign, session.id))).message);
    expect(
      await repo.readScreenshot(foreign, session.id, session.id),
    ).toBeNull();
    const jobs = repo.jobs as SessionJobs;
    expect(jobs).toBeDefined();
  });

  it("pages observations in order by sequence cursor", async () => {
    const fay = await fresh("fay");
    const { session } = await start(fay);
    for (const sequence of [3, 1, 2])
      await fx.owner.query(
        `INSERT INTO interview.session_observations(tenant_id,owner_user_id,session_id,source_id,event_id,sequence,kind,content,ack)
         VALUES($1,$2,$3,'mic',$4,$5,'transcript.final','{}','{}')`,
        [tenant, fay.id, session.id, `e${sequence}`, sequence],
      );
    const all = await repo.listObservations(scopeOf(fay), session.id);
    expect(all.map((o) => o.sequence)).toEqual([1, 2, 3]);
    const next = await repo.listObservations(scopeOf(fay), session.id, {
      afterSequence: 1,
      limit: 1,
    });
    expect(next.map((o) => o.sequence)).toEqual([2]);
  });
});
