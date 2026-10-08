// Ingest on a disposable PostgreSQL as the member role: identity from the
// credential only, one refusal for every bad credential, membership re-checked
// before any write, bounds enforced before writing, dedup returning the original
// acknowledgement, screenshots accepted by leading bytes into owner-private
// artifacts, and ended or purging sessions refusing everything.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestObservation } from "./ingest";
import {
  type Fixture,
  type Person,
  PNG_BYTES,
  SVG_BYTES,
  screenshot,
  startFixture,
  transcript,
} from "./live-session-fixture";
import { ActiveSessionRepository } from "./repository";

let fx: Fixture;
let repo: ActiveSessionRepository;
let tenant = "";

const scopeOf = (person: Person) => ({ tenantId: tenant, actorId: person.id });

async function begin(name: string) {
  const person = await fx.provision(tenant, name);
  const started = await repo.startSession(scopeOf(person), {
    processingPolicy: "permitted-remote",
    captureSources: ["microphone", "screen"],
  });
  return {
    person,
    session: started.session,
    credential: started.credential.value,
  };
}

const ingest = (
  credential: string,
  envelope: unknown,
  options?: Parameters<typeof ingestObservation>[4],
  forTenant = tenant,
) => ingestObservation(fx.member, credential, forTenant, envelope, options);

const count = async (table: string, session: string) =>
  Number(
    (
      await fx.owner.query(
        `SELECT count(*) AS n FROM interview.${table} WHERE ${table === "active_sessions" ? "id" : "session_id"}=$1`,
        [session],
      )
    ).rows[0].n,
  );

beforeAll(async () => {
  fx = await startFixture();
  tenant = fx.tenantA;
  repo = new ActiveSessionRepository(fx.member);
}, 90_000);
afterAll(() => fx?.stop());

describe("accepted observations", () => {
  it("stores a final transcript with a per-session sequence and acknowledges with control state", async () => {
    const { session, credential } = await begin("ann");
    const first = await ingest(
      credential,
      transcript("mic", 0, "first words", "e-1"),
    );
    const second = await ingest(
      credential,
      transcript("mic", 1, "second words", "e-2"),
    );
    expect(first).toMatchObject({
      status: "accepted",
      sourceId: "mic",
      eventId: "e-1",
      control: { state: "active" },
    });
    expect(
      (first as { control: { credentialExpiresAt: string } }).control
        .credentialExpiresAt,
    ).toMatch(/^\d{4}-/);
    expect(second.status).toBe("accepted");
    const rows = await fx.owner.query(
      "SELECT sequence, kind, content FROM interview.session_observations WHERE session_id=$1 ORDER BY sequence",
      [session.id],
    );
    expect(rows.rows.map((r) => Number(r.sequence))).toEqual([1, 2]);
    expect(rows.rows[0].content).toMatchObject({
      sourceSequence: 0,
      body: { text: "first words" },
    });
  });

  it("refuses a source kind the session never agreed to, storing nothing", async () => {
    const person = await fx.provision(tenant, "ann-sources");
    const started = await repo.startSession(scopeOf(person), {
      processingPolicy: "permitted-remote",
      captureSources: ["microphone"],
    });
    const result = await ingest(started.credential.value, {
      version: 1,
      kind: "screen.snapshot",
      sourceId: "scr",
      eventId: "shot-1",
      occurredAt: "2026-10-03T10:00:00.000Z",
      sequence: 0,
      content: { mediaType: "image/png", byteLength: 4, windowLabel: "w" },
    });
    expect(result.status).toBe("refused");
    expect(await count("session_observations", started.session.id)).toBe(0);
  });

  it("returns the ORIGINAL stored acknowledgement for a resend and stores nothing new", async () => {
    const { person, session, credential } = await begin("ben");
    const envelope = transcript("mic", 0, "once only", "e-dup");
    const original = await ingest(credential, envelope);
    // The session's control state moves on, yet the resend echoes the original.
    await repo.controlSession(scopeOf(person), session.id, "pause");
    await repo.controlSession(scopeOf(person), session.id, "resume");
    const resend = await ingest(credential, envelope);
    expect(resend).toEqual({ version: 1, status: "duplicate", original });
    expect(await count("session_observations", session.id)).toBe(1);
  });

  it("accepts disconnects and capture gaps as state, never content", async () => {
    const { session, credential } = await begin("cat");
    const base = {
      version: 1,
      sourceId: "mic",
      occurredAt: "2026-10-03T10:00:00.000Z",
    };
    const gap = await ingest(credential, {
      ...base,
      kind: "capture.gap",
      eventId: "g-1",
      sequence: 0,
      content: {
        source: "microphone",
        durationMs: 800,
        reason: "buffer-overflow",
      },
    });
    const gone = await ingest(credential, {
      ...base,
      kind: "source.disconnected",
      eventId: "d-1",
      sequence: 1,
      content: { source: "microphone", reason: "user-stopped" },
    });
    expect([gap.status, gone.status]).toEqual(["accepted", "accepted"]);
    expect(await count("session_observations", session.id)).toBe(2);
  });
});

describe("one refusal for every bad credential (rule:credential-strength)", () => {
  it("gives identical refusals for unknown, expired, revoked and other-tenant credentials", async () => {
    const live = await begin("dan");
    const expired = await begin("eli");
    const revoked = await begin("fay");
    await fx.owner.query(
      "UPDATE interview.active_sessions SET credential_expires_at = now() - interval '1 second' WHERE id=$1",
      [expired.session.id],
    );
    await repo.revokeCredential(scopeOf(revoked.person), revoked.session.id);
    const unknown = `asc_${"A".repeat(43)}`;
    const envelope = transcript("mic", 0);
    const refusals = [
      await ingest(unknown, envelope),
      await ingest(expired.credential, envelope),
      await ingest(revoked.credential, envelope),
      // A credential bound to another tenant, presented on this tenant's route.
      await ingest(live.credential, envelope, undefined, fx.tenantB),
      // Malformed credential and malformed tenant.
      await ingest("not-a-credential", envelope),
      await ingest(live.credential, envelope, undefined, "not-a-uuid"),
    ];
    for (const refusal of refusals)
      expect(refusal).toEqual({
        version: 1,
        status: "refused",
        code: "credential_refused",
      });
    // The live session saw none of it.
    expect(await count("session_observations", live.session.id)).toBe(0);
    expect(await count("session_observations", expired.session.id)).toBe(0);
  });

  it("never puts the credential in a refusal", async () => {
    const { credential } = await begin("gil");
    const refusal = await ingest(
      credential,
      transcript("mic", 0, "x".repeat(10), "e-1"),
      undefined,
      fx.tenantB,
    );
    expect(JSON.stringify(refusal)).not.toContain(credential);
  });
});

describe("membership is re-verified before any write (rule:ingest-membership-recheck)", () => {
  it("refuses a removed member's ingest, revokes the credential and writes nothing", async () => {
    const { person, session, credential } = await begin("hal");
    expect(
      (await ingest(credential, transcript("mic", 0, "before", "e-1"))).status,
    ).toBe("accepted");
    await fx.owner.query(
      "DELETE FROM platform.tenant_memberships WHERE tenant_id=$1 AND user_id=$2",
      [tenant, person.id],
    );
    const refused = await ingest(
      credential,
      transcript("mic", 1, "after", "e-2"),
    );
    expect(refused).toEqual({
      version: 1,
      status: "refused",
      code: "credential_refused",
    });
    expect(await count("session_observations", session.id)).toBe(1);
    const stored = await fx.owner.query(
      "SELECT credential_revoked_at FROM interview.active_sessions WHERE id=$1",
      [session.id],
    );
    expect(stored.rows[0].credential_revoked_at).not.toBeNull();
  });
});

describe("the start permission is re-verified at ingest", () => {
  it("refuses a demoted member's ingest and revokes the credential, writing nothing", async () => {
    const { person, session, credential } = await begin("dee");
    expect(
      (await ingest(credential, transcript("mic", 0, "before", "e-1"))).status,
    ).toBe("accepted");
    // A member holds no interview.write (rolePermissions in platform-storage).
    await fx.owner.query(
      "UPDATE platform.tenant_memberships SET role='member' WHERE tenant_id=$1 AND user_id=$2",
      [tenant, person.id],
    );
    expect(
      await ingest(credential, transcript("mic", 1, "after", "e-2")),
    ).toEqual({ version: 1, status: "refused", code: "credential_refused" });
    expect(await count("session_observations", session.id)).toBe(1);
    const stored = await fx.owner.query(
      "SELECT credential_revoked_at FROM interview.active_sessions WHERE id=$1",
      [session.id],
    );
    expect(stored.rows[0].credential_revoked_at).not.toBeNull();
  });
});

describe("bounded ingest writes nothing over a limit (rule:bounded-ingest)", () => {
  it("refuses an oversized envelope", async () => {
    const { session, credential } = await begin("ida");
    const huge = transcript("mic", 0, "y", "e-1");
    const padded = JSON.stringify({ ...huge, pad: "z".repeat(40_000) });
    expect(await ingest(credential, padded)).toMatchObject({
      status: "refused",
      code: "envelope_too_large",
    });
    expect(await count("session_observations", session.id)).toBe(0);
  });

  it("refuses past the per-session count and the per-minute rate", async () => {
    const { session, credential } = await begin("jon");
    const options = {
      limits: { maxObservationsPerSession: 2, maxIngestPerMinute: 100 },
    };
    expect(
      (await ingest(credential, transcript("mic", 0, "a", "c-1"), options))
        .status,
    ).toBe("accepted");
    expect(
      (await ingest(credential, transcript("mic", 1, "b", "c-2"), options))
        .status,
    ).toBe("accepted");
    expect(
      await ingest(credential, transcript("mic", 2, "c", "c-3"), options),
    ).toMatchObject({
      status: "refused",
      code: "limit_reached",
      control: { state: "active" },
    });
    expect(await count("session_observations", session.id)).toBe(2);
    // A resend of a stored observation still returns its acknowledgement.
    expect(
      (await ingest(credential, transcript("mic", 0, "a", "c-1"), options))
        .status,
    ).toBe("duplicate");

    const kim = await begin("kim");
    const rate = { limits: { maxIngestPerMinute: 2 } };
    await ingest(kim.credential, transcript("mic", 0, "a", "r-1"), rate);
    await ingest(kim.credential, transcript("mic", 1, "b", "r-2"), rate);
    expect(
      await ingest(kim.credential, transcript("mic", 2, "c", "r-3"), rate),
    ).toMatchObject({
      status: "refused",
      code: "rate_limited",
    });
    expect(await count("session_observations", kim.session.id)).toBe(2);
  });

  it("refuses past the screenshot count and an oversized payload, writing no artifact", async () => {
    const { session, credential } = await begin("lou");
    const options = {
      payload: PNG_BYTES,
      limits: { maxScreenshotsPerSession: 1 },
    };
    expect(
      (
        await ingest(
          credential,
          screenshot("scr", 0, "image/png", PNG_BYTES.byteLength, "s-1"),
          options,
        )
      ).status,
    ).toBe("accepted");
    const bigger = new Uint8Array(PNG_BYTES.byteLength + 1);
    bigger.set(PNG_BYTES);
    expect(
      await ingest(
        credential,
        screenshot("scr", 1, "image/png", bigger.byteLength, "s-2"),
        {
          payload: bigger,
          limits: {
            maxScreenshotsPerSession: 5,
            maxScreenshotBytes: PNG_BYTES.byteLength,
          },
        },
      ),
    ).toMatchObject({ status: "refused", code: "payload_too_large" });
    expect(
      await ingest(
        credential,
        screenshot("scr", 2, "image/png", PNG_BYTES.byteLength, "s-3"),
        options,
      ),
    ).toMatchObject({
      status: "refused",
      code: "limit_reached",
    });
    expect(await count("session_observations", session.id)).toBe(1);
    const artifacts = await fx.owner.query(
      "SELECT 1 FROM platform.artifacts WHERE artifact_type='interview.session-screenshot' AND metadata->>'session_id'=$1",
      [session.id],
    );
    expect(artifacts.rows).toHaveLength(1);
  });

  it("refuses an invalid observation with paths and codes only", async () => {
    const { session, credential } = await begin("max");
    const withIdentity = {
      ...transcript("mic", 0, "hello there", "e-1"),
      content: {
        speaker: "s",
        text: "hello there",
        startMs: 0,
        endMs: 5,
        tenantId: "t",
      },
    };
    const refused = await ingest(credential, withIdentity);
    expect(refused).toMatchObject({
      status: "refused",
      code: "invalid_observation",
    });
    expect(JSON.stringify(refused)).not.toContain("hello there");
    expect(JSON.stringify(refused)).toContain("identity_field_forbidden");
    expect(
      await ingest(credential, { ...transcript("mic", 1), version: 2 }),
    ).toMatchObject({
      code: "unsupported_version",
    });
    expect(await ingest(credential, "{not json")).toMatchObject({
      code: "invalid_observation",
    });
    expect(await count("session_observations", session.id)).toBe(0);
  });
});

describe("screenshots (rule:screenshots-as-private-artifacts)", () => {
  it("stores a PNG as an owner-private artifact bound to the session and dedupes identical bytes", async () => {
    const { person, session, credential } = await begin("nia");
    const options = { payload: PNG_BYTES };
    const ack = await ingest(
      credential,
      screenshot("scr", 0, "image/png", PNG_BYTES.byteLength, "p-1"),
      options,
    );
    expect(ack.status).toBe("accepted");
    await ingest(
      credential,
      screenshot("scr", 1, "image/png", PNG_BYTES.byteLength, "p-2"),
      options,
    );
    const rows = await fx.owner.query(
      "SELECT screenshot_artifact_id FROM interview.session_observations WHERE session_id=$1 ORDER BY sequence",
      [session.id],
    );
    // Two observations, one stored artifact for the identical bytes.
    expect(rows.rows[0].screenshot_artifact_id).toBe(
      rows.rows[1].screenshot_artifact_id,
    );
    const artifact = (
      await fx.owner.query(
        "SELECT owner_user_id, product_id, artifact_type, metadata FROM platform.artifacts WHERE id=$1",
        [rows.rows[0].screenshot_artifact_id],
      )
    ).rows[0];
    expect(artifact).toMatchObject({
      owner_user_id: person.id,
      product_id: "omnitech.interview",
      artifact_type: "interview.session-screenshot",
    });
    expect(artifact.metadata).toMatchObject({
      session_id: session.id,
      media_type: "image/png",
    });
    // The owner downloads it with its stored type; another member cannot.
    const download = await repo.readScreenshot(
      scopeOf(person),
      session.id,
      rows.rows[0].screenshot_artifact_id,
    );
    expect(download?.mediaType).toBe("image/png");
    expect(Array.from(download?.bytes ?? [])).toEqual(Array.from(PNG_BYTES));
    const other = await fx.provision(tenant, "nora");
    expect(
      await repo.readScreenshot(
        scopeOf(other),
        session.id,
        rows.rows[0].screenshot_artifact_id,
      ),
    ).toBeNull();
    const direct = await fx.member.transaction(async (client) => {
      await client.query(
        "SELECT set_config('app.tenant_id',$1,true), set_config('app.actor_id',$2,true), set_config('app.product_id','omnitech.interview',true)",
        [tenant, other.id],
      );
      return client.query(
        "SELECT 1 FROM platform.artifacts WHERE artifact_type='interview.session-screenshot'",
      );
    });
    expect(direct.rows).toHaveLength(0);
  });

  it("refuses SVG and a declared type the bytes do not bear out, never decoding", async () => {
    const { session, credential } = await begin("oli");
    expect(
      await ingest(
        credential,
        screenshot("scr", 0, "image/png", SVG_BYTES.byteLength, "v-1"),
        { payload: SVG_BYTES },
      ),
    ).toMatchObject({ status: "refused", code: "invalid_observation" });
    expect(
      await ingest(
        credential,
        screenshot("scr", 1, "image/jpeg", PNG_BYTES.byteLength, "v-2"),
        { payload: PNG_BYTES },
      ),
    ).toMatchObject({ status: "refused", code: "invalid_observation" });
    // The envelope itself cannot declare SVG.
    expect(
      await ingest(
        credential,
        screenshot("scr", 2, "image/svg+xml", SVG_BYTES.byteLength, "v-3"),
        { payload: SVG_BYTES },
      ),
    ).toMatchObject({ status: "refused", code: "invalid_observation" });
    // A screenshot with no payload is refused too.
    expect(
      await ingest(
        credential,
        screenshot("scr", 3, "image/png", PNG_BYTES.byteLength, "v-4"),
      ),
    ).toMatchObject({
      status: "refused",
      code: "invalid_observation",
    });
    expect(await count("session_observations", session.id)).toBe(0);
    const artifacts = await fx.owner.query(
      "SELECT 1 FROM platform.artifacts WHERE metadata->>'session_id'=$1",
      [session.id],
    );
    expect(artifacts.rows).toHaveLength(0);
  });
});

describe("session standing refuses ingest", () => {
  it("refuses while paused, with the control state, and resumes after the owner resumes", async () => {
    const { person, session, credential } = await begin("pam");
    await repo.controlSession(scopeOf(person), session.id, "pause");
    expect(
      await ingest(credential, transcript("mic", 0, "x", "e-1")),
    ).toMatchObject({
      status: "refused",
      code: "session_paused",
      control: { state: "paused" },
    });
    expect(await count("session_observations", session.id)).toBe(0);
    await repo.controlSession(scopeOf(person), session.id, "resume");
    expect(
      (await ingest(credential, transcript("mic", 0, "x", "e-1"))).status,
    ).toBe("accepted");
  });

  it("refuses an ended or purging session whose credential is still live (defence in depth)", async () => {
    const ended = await begin("quin");
    await fx.owner.query(
      "UPDATE interview.active_sessions SET status='ended', ended_at=now() WHERE id=$1",
      [ended.session.id],
    );
    expect(await ingest(ended.credential, transcript("mic", 0))).toMatchObject({
      code: "session_ended",
      control: { state: "ended" },
    });
    const purging = await begin("rae");
    await fx.owner.query(
      "UPDATE interview.active_sessions SET status='purging' WHERE id=$1",
      [purging.session.id],
    );
    expect(
      await ingest(purging.credential, transcript("mic", 0)),
    ).toMatchObject({
      code: "session_purging",
      control: { state: "purging" },
    });
    for (const id of [ended.session.id, purging.session.id])
      expect(await count("session_observations", id)).toBe(0);
  });

  it("gives an ended session's revoked credential the single refusal", async () => {
    const { person, session, credential } = await begin("sid");
    await repo.controlSession(scopeOf(person), session.id, "end");
    expect(await ingest(credential, transcript("mic", 0))).toEqual({
      version: 1,
      status: "refused",
      code: "credential_refused",
    });
  });

  it("refuses a purging session opened by the owner's delete", async () => {
    const { person, session, credential } = await begin("tom");
    await repo.deleteSession(scopeOf(person), session.id);
    expect(await ingest(credential, transcript("mic", 0))).toMatchObject({
      status: "refused",
    });
    expect(await count("session_observations", session.id)).toBe(0);
  });
});

describe("heartbeat", () => {
  it("updates the contact stamp without storing anything and acknowledges with control", async () => {
    const { session, credential } = await begin("uri");
    const beat = {
      version: 1,
      kind: "heartbeat",
      sourceId: "mic",
      sentAt: "2026-10-03T10:00:00.000Z",
      capturing: true,
    };
    const ack = await ingest(credential, beat);
    expect(ack).toMatchObject({
      status: "accepted",
      eventId: "heartbeat",
      control: { state: "active" },
    });
    const row = await fx.owner.query(
      "SELECT last_heartbeat_at FROM interview.active_sessions WHERE id=$1",
      [session.id],
    );
    expect(row.rows[0].last_heartbeat_at).not.toBeNull();
    expect(await count("session_observations", session.id)).toBe(0);
  });

  it("pauses (never ends) when the companion reports it stopped capturing", async () => {
    const { session, credential } = await begin("val");
    const stopped = await ingest(credential, {
      version: 1,
      kind: "heartbeat",
      sourceId: "mic",
      sentAt: "2026-10-03T10:00:00.000Z",
      capturing: false,
    });
    expect(stopped).toMatchObject({
      code: "session_paused",
      control: { state: "paused" },
    });
    const row = await fx.owner.query(
      "SELECT status, ended_at FROM interview.active_sessions WHERE id=$1",
      [session.id],
    );
    expect(row.rows[0]).toMatchObject({ status: "paused", ended_at: null });
  });

  it("makes resume observable while paused", async () => {
    const { person, session, credential } = await begin("wyn");
    await repo.controlSession(scopeOf(person), session.id, "pause");
    const beat = {
      version: 1,
      kind: "heartbeat",
      sourceId: "mic",
      sentAt: "2026-10-03T10:00:00.000Z",
      capturing: true,
    };
    expect(await ingest(credential, beat)).toMatchObject({
      code: "session_paused",
      control: { state: "paused" },
    });
    await repo.controlSession(scopeOf(person), session.id, "resume");
    // The paused heartbeat stamped contact a moment ago; spacing is covered in
    // ingest-hardening.test.ts, so it is switched off here.
    expect(
      await ingest(credential, beat, {
        limits: { minHeartbeatIntervalMs: 0 },
      }),
    ).toMatchObject({
      status: "accepted",
      control: { state: "active" },
    });
  });
});
