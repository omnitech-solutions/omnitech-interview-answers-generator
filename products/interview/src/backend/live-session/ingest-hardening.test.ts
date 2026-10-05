// Ingest hardening on a disposable PostgreSQL as the member role (PB-0002 dev
// loop 4): a transcript source label is checked against the session's permitted
// sources; the same source and event id with different content is an
// event_conflict that never overwrites; heartbeats and capability reports are
// bounded by minimum spacing; and a capability report is stored as the owner's
// latest device capability, content-free and surviving a session purge.
import { CAPABILITY_ACK_EVENT_ID } from "@omnitech/active-session-contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestObservation } from "./ingest";
import {
  type Fixture,
  type Person,
  PNG_BYTES,
  screenshot,
  startFixture,
  transcript,
} from "./live-session-fixture";
import { ActiveSessionRepository } from "./repository";

let fx: Fixture;
let repo: ActiveSessionRepository;
let tenant = "";

const scopeOf = (person: Person) => ({ tenantId: tenant, actorId: person.id });

async function begin(
  name: string,
  captureSources: ("microphone" | "application-audio" | "screen")[] = [
    "microphone",
    "screen",
  ],
) {
  const person = await fx.provision(tenant, name);
  const started = await repo.startSession(scopeOf(person), {
    processingPolicy: "permitted-remote",
    captureSources,
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
) => ingestObservation(fx.member, credential, tenant, envelope, options);

const rows = async (session: string) =>
  (
    await fx.owner.query(
      "SELECT kind, content, ack FROM interview.session_observations WHERE session_id=$1 ORDER BY sequence",
      [session],
    )
  ).rows;

const stamp = async (session: string) =>
  (
    await fx.owner.query(
      "SELECT last_heartbeat_at FROM interview.active_sessions WHERE id=$1",
      [session],
    )
  ).rows[0].last_heartbeat_at as Date | null;

const withSource = (
  base: ReturnType<typeof transcript>,
  source: "microphone" | "application-audio",
) => ({ ...base, content: { ...base.content, source } });

const beat = (capturing = true) => ({
  version: 1,
  kind: "heartbeat",
  sourceId: "companion",
  sentAt: "2026-10-03T10:00:00.000Z",
  capturing,
});

export const capabilityReport = (
  overrides: Record<string, unknown> = {},
  speech: Record<string, unknown> = {},
) => ({
  version: 1,
  kind: "capability.report",
  sourceId: "companion",
  sentAt: "2026-10-03T10:00:00.000Z",
  speech: {
    locale: "en-US",
    onDeviceAvailable: true,
    recognizerAvailable: true,
    authorizationStatus: "authorized",
    ...speech,
  },
  permissions: { microphone: "granted", screen: "denied" },
  ...overrides,
});

const capabilityRow = async (person: Person) =>
  (
    await fx.owner.query(
      "SELECT * FROM interview.companion_capabilities WHERE tenant_id=$1 AND owner_user_id=$2",
      [tenant, person.id],
    )
  ).rows[0];

const NO_SPACING = { limits: { minHeartbeatIntervalMs: 0 } };

beforeAll(async () => {
  fx = await startFixture();
  tenant = fx.tenantA;
  repo = new ActiveSessionRepository(fx.member);
}, 90_000);
afterAll(() => fx?.stop());

describe("transcript source label (dev loop 1 deferral F6)", () => {
  it("refuses a source label the session never permitted, by path and code, storing nothing", async () => {
    const { session, credential } = await begin("sia", ["microphone"]);
    const result = await ingest(
      credential,
      withSource(transcript("mic", 0, "x", "s-1"), "application-audio"),
    );
    expect(result).toMatchObject({
      status: "refused",
      code: "invalid_observation",
      issues: [{ path: ["content", "source"], code: "invalid_value" }],
    });
    expect(await rows(session.id)).toHaveLength(0);
  });

  it("accepts a permitted label, and an absent label keeps the kind-level check", async () => {
    const { session, credential } = await begin("sib", ["microphone"]);
    expect(
      (
        await ingest(
          credential,
          withSource(transcript("mic", 0, "x", "s-1"), "microphone"),
        )
      ).status,
    ).toBe("accepted");
    expect(
      (await ingest(credential, transcript("mic", 1, "y", "s-2"))).status,
    ).toBe("accepted");
    expect(await rows(session.id)).toHaveLength(2);
    // A screen-only session still refuses any transcript by kind.
    const screenOnly = await begin("sic", ["screen"]);
    expect(
      await ingest(screenOnly.credential, transcript("mic", 0, "x", "s-3")),
    ).toMatchObject({
      status: "refused",
      issues: [{ path: ["kind"], code: "invalid_value" }],
    });
  });
});

describe("event_conflict: same source and event id, different content", () => {
  it("refuses changed text and never overwrites the stored row or its ack", async () => {
    const { session, credential } = await begin("cona");
    const original = await ingest(
      credential,
      transcript("mic", 0, "first version", "c-1"),
    );
    const before = await rows(session.id);
    const conflict = await ingest(
      credential,
      transcript("mic", 0, "second version", "c-1"),
    );
    expect(conflict).toMatchObject({
      status: "refused",
      code: "event_conflict",
      control: { state: "active" },
    });
    expect(await rows(session.id)).toEqual(before);
    // The honest resend still answers with the ORIGINAL acknowledgement.
    expect(
      await ingest(credential, transcript("mic", 0, "first version", "c-1")),
    ).toEqual({ version: 1, status: "duplicate", original });
  });

  it("refuses a changed source sequence and a changed kind body", async () => {
    const { credential } = await begin("conb");
    await ingest(credential, transcript("mic", 0, "same words", "c-1"));
    expect(
      await ingest(credential, transcript("mic", 5, "same words", "c-1")),
    ).toMatchObject({ code: "event_conflict" });
  });

  it("treats a re-stamped occurredAt with identical content as a duplicate", async () => {
    const { session, credential } = await begin("conc");
    const original = await ingest(
      credential,
      transcript("mic", 0, "same words", "c-1"),
    );
    const restamped = {
      ...transcript("mic", 0, "same words", "c-1"),
      occurredAt: "2026-10-03T11:00:00.000Z",
    };
    expect(await ingest(credential, restamped)).toEqual({
      version: 1,
      status: "duplicate",
      original,
    });
    expect(await rows(session.id)).toHaveLength(1);
  });

  it("compares a screenshot's body only", async () => {
    const { session, credential } = await begin("cond");
    const shot = screenshot(
      "scr",
      0,
      "image/png",
      PNG_BYTES.byteLength,
      "sh-1",
    );
    const original = await ingest(credential, shot, { payload: PNG_BYTES });
    expect(original.status).toBe("accepted");
    // A different sequence alone is not a conflict for a screenshot.
    expect(
      await ingest(
        credential,
        { ...shot, sequence: 9 },
        { payload: PNG_BYTES },
      ),
    ).toEqual({ version: 1, status: "duplicate", original });
    const changed = {
      ...shot,
      content: { ...shot.content, windowLabel: "Another window" },
    };
    expect(
      await ingest(credential, changed, { payload: PNG_BYTES }),
    ).toMatchObject({ status: "refused", code: "event_conflict" });
    expect(await rows(session.id)).toHaveLength(1);
  });

  it("keeps session standing first: a paused session refuses a conflicting resend as paused", async () => {
    const { person, session, credential } = await begin("cone");
    await ingest(credential, transcript("mic", 0, "words", "c-1"));
    await repo.controlSession(scopeOf(person), session.id, "pause");
    expect(
      await ingest(credential, transcript("mic", 0, "other", "c-1")),
    ).toMatchObject({ code: "session_paused" });
  });
});

describe("heartbeat spacing (dev loop 1 deferral F7, heartbeats)", () => {
  it("refuses a heartbeat closer than the minimum spacing with control, writing nothing", async () => {
    const { session, credential } = await begin("hba");
    expect((await ingest(credential, beat())).status).toBe("accepted");
    const afterFirst = await stamp(session.id);
    const refused = await ingest(credential, beat());
    expect(refused).toMatchObject({
      status: "refused",
      code: "rate_limited",
      control: { state: "active" },
    });
    expect(await stamp(session.id)).toEqual(afterFirst);
    expect(await rows(session.id)).toHaveLength(0);
  });

  it("measures spacing from the last contact of any kind, and accepts once it has passed", async () => {
    const { session, credential } = await begin("hbb");
    await ingest(credential, transcript("mic", 0, "words", "h-1"));
    expect(await ingest(credential, beat())).toMatchObject({
      code: "rate_limited",
    });
    await fx.owner.query(
      "UPDATE interview.active_sessions SET last_heartbeat_at = now() - interval '5 seconds' WHERE id=$1",
      [session.id],
    );
    expect(await ingest(credential, beat())).toMatchObject({
      status: "accepted",
      eventId: "heartbeat",
    });
  });

  it("lets a stop signal through: a capturing:false heartbeat pauses even within the spacing", async () => {
    const { session, credential } = await begin("hbc");
    await ingest(credential, beat());
    expect(await ingest(credential, beat(false))).toMatchObject({
      code: "session_paused",
      control: { state: "paused" },
    });
    const status = await fx.owner.query(
      "SELECT status FROM interview.active_sessions WHERE id=$1",
      [session.id],
    );
    expect(status.rows[0].status).toBe("paused");
  });

  it("keeps ended and paused standing ahead of the spacing", async () => {
    const paused = await begin("hbd");
    await ingest(paused.credential, beat());
    await repo.controlSession(
      scopeOf(paused.person),
      paused.session.id,
      "pause",
    );
    expect(await ingest(paused.credential, beat())).toMatchObject({
      code: "session_paused",
    });
    const ended = await begin("hbe");
    await ingest(ended.credential, beat());
    await fx.owner.query(
      "UPDATE interview.active_sessions SET status='ended', ended_at=now() WHERE id=$1",
      [ended.session.id],
    );
    expect(await ingest(ended.credential, beat())).toMatchObject({
      code: "session_ended",
    });
  });

  it("refuses an invalid heartbeat with codes only", async () => {
    const { credential } = await begin("hbf");
    expect(
      await ingest(credential, { ...beat(), capturing: "yes" }),
    ).toMatchObject({
      status: "refused",
      code: "invalid_observation",
      control: { state: "active" },
    });
  });
});

describe("capability.report", () => {
  it("stores the owner's latest capability and acknowledges with the capability event id", async () => {
    const { person, credential } = await begin("capa");
    const ack = await ingest(credential, capabilityReport());
    expect(ack).toMatchObject({
      status: "accepted",
      sourceId: "companion",
      eventId: CAPABILITY_ACK_EVENT_ID,
      control: { state: "active" },
    });
    expect(await capabilityRow(person)).toMatchObject({
      speech_locale: "en-US",
      speech_on_device_available: true,
      speech_recognizer_available: true,
      speech_authorization_status: "authorized",
      microphone: "granted",
      screen: "denied",
    });
  });

  it("replaces the latest report and stores nothing in the session's observations", async () => {
    const { person, session, credential } = await begin("capb");
    await ingest(credential, capabilityReport(), NO_SPACING);
    expect(
      (
        await ingest(
          credential,
          capabilityReport(
            { permissions: { microphone: "denied", screen: "granted" } },
            { locale: "fr-CA", onDeviceAvailable: false },
          ),
          NO_SPACING,
        )
      ).status,
    ).toBe("accepted");
    const all = await fx.owner.query(
      "SELECT * FROM interview.companion_capabilities WHERE tenant_id=$1 AND owner_user_id=$2",
      [tenant, person.id],
    );
    expect(all.rows).toHaveLength(1);
    expect(all.rows[0]).toMatchObject({
      speech_locale: "fr-CA",
      speech_on_device_available: false,
      microphone: "denied",
      screen: "granted",
    });
    expect(await rows(session.id)).toHaveLength(0);
  });

  it("is bounded by the same minimum spacing, writing nothing when refused", async () => {
    const { person, credential } = await begin("capc");
    await ingest(credential, capabilityReport());
    const before = await capabilityRow(person);
    expect(
      await ingest(credential, capabilityReport({}, { locale: "de-DE" })),
    ).toMatchObject({
      status: "refused",
      code: "rate_limited",
      control: { state: "active" },
    });
    expect(await capabilityRow(person)).toEqual(before);
  });

  it("is refused for an ended or purging session like a heartbeat", async () => {
    const ended = await begin("capd");
    await fx.owner.query(
      "UPDATE interview.active_sessions SET status='ended', ended_at=now() WHERE id=$1",
      [ended.session.id],
    );
    expect(await ingest(ended.credential, capabilityReport())).toMatchObject({
      code: "session_ended",
    });
    const purging = await begin("cape");
    await fx.owner.query(
      "UPDATE interview.active_sessions SET status='purging' WHERE id=$1",
      [purging.session.id],
    );
    expect(await ingest(purging.credential, capabilityReport())).toMatchObject({
      code: "session_purging",
    });
    expect(await capabilityRow(ended.person)).toBeUndefined();
    expect(await capabilityRow(purging.person)).toBeUndefined();
  });

  it("accepts a report from a paused session, because capability is not capture", async () => {
    const { person, session, credential } = await begin("capf");
    await repo.controlSession(scopeOf(person), session.id, "pause");
    expect(await ingest(credential, capabilityReport())).toMatchObject({
      status: "accepted",
      control: { state: "paused" },
    });
    expect(await capabilityRow(person)).toBeDefined();
  });

  it("refuses an invalid report and one that smuggles identity, storing nothing", async () => {
    const { person, credential } = await begin("capg");
    expect(
      await ingest(
        credential,
        capabilityReport({}, { authorizationStatus: "maybe" }),
      ),
    ).toMatchObject({ status: "refused", code: "invalid_observation" });
    expect(
      await ingest(
        credential,
        capabilityReport({ tenantId: tenant }),
        NO_SPACING,
      ),
    ).toMatchObject({ status: "refused", code: "invalid_observation" });
    expect(await capabilityRow(person)).toBeUndefined();
  });

  it("keeps each owner's capability apart", async () => {
    const one = await begin("caph");
    const two = await begin("capi");
    await ingest(one.credential, capabilityReport({}, { locale: "en-GB" }));
    await ingest(two.credential, capabilityReport({}, { locale: "es-MX" }));
    expect((await capabilityRow(one.person)).speech_locale).toBe("en-GB");
    expect((await capabilityRow(two.person)).speech_locale).toBe("es-MX");
  });
});
