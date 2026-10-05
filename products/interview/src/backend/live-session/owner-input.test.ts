// Owner input on a disposable PostgreSQL as the member role (requires Docker,
// like the other session suites): the DB-only `owner.input` kind has its own
// source namespace, is exempt from the capture caps, validates its frozen
// snapshot ids against the owner's own session, dedups on the request id, and
// can never arrive on the capture wire (ADR-0016 Decision 4).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OWNER_INPUT_SOURCE_ID,
  OWNER_MICROPHONE_SOURCE_ID,
} from "../db/live-session";
import { ingestObservation } from "./ingest";
import {
  type Fixture,
  type Person,
  PNG_BYTES,
  screenshot,
  startFixture,
  transcript,
} from "./live-session-fixture";
import { OWNER_INPUT_MAX_PER_SESSION } from "./owner-input";
import { ActiveSessionRepository } from "./repository";
import { createDatabaseStorePort } from "./session-ports";
import { purgeSession } from "./session-purge";

let fx: Fixture;
let repo: ActiveSessionRepository;
let tenant = "";
const scopeOf = (person: Person) => ({ tenantId: tenant, actorId: person.id });

beforeAll(async () => {
  fx = await startFixture();
  tenant = fx.tenantA;
  repo = new ActiveSessionRepository(fx.member);
}, 90_000);
afterAll(() => fx?.stop());

async function begin(name: string) {
  const person = await fx.provision(tenant, name);
  const started = await repo.startSession(scopeOf(person), {
    processingPolicy: "permitted-remote",
    captureSources: ["microphone", "screen"],
  });
  return {
    person,
    scope: scopeOf(person),
    session: started.session,
    credential: started.credential.value,
  };
}
const ingest = (
  credential: string,
  envelope: unknown,
  options?: Parameters<typeof ingestObservation>[4],
) => ingestObservation(fx.member, credential, tenant, envelope, options);

const rows = async (sessionId: string, kind?: string) =>
  (
    await fx.owner.query(
      `SELECT * FROM interview.session_observations WHERE session_id=$1
       ${kind ? "AND kind=$2" : ""} ORDER BY sequence`,
      kind ? [sessionId, kind] : [sessionId],
    )
  ).rows;

async function withSnapshot(
  world: Awaited<ReturnType<typeof begin>>,
  eventId = "shot-1",
) {
  const ack = await ingest(
    world.credential,
    screenshot("scr", 0, "image/png", PNG_BYTES.byteLength, eventId),
    { payload: PNG_BYTES },
  );
  expect(ack.status).toBe("accepted");
  return { sourceId: "scr", eventId };
}

describe("the capture wire cannot send owner.input", () => {
  it("answers unknown_kind for a companion-sent owner.input and stores nothing", async () => {
    const world = await begin("wire-kind");
    const refused = await ingest(world.credential, {
      version: 1,
      kind: "owner.input",
      sourceId: "mic",
      eventId: "e-1",
      occurredAt: "2026-10-03T10:00:00.000Z",
      sequence: 0,
      content: { operation: "follow-up", text: "hi" },
    });
    expect(refused).toMatchObject({
      status: "refused",
      code: "invalid_observation",
      issues: [{ path: ["kind"], code: "unknown_kind" }],
    });
    expect(await rows(world.session.id)).toHaveLength(0);
  });

  it("refuses the reserved source id on any wire message, so a dedup key cannot be pre-claimed", async () => {
    const world = await begin("wire-source");
    const claimed = await ingest(world.credential, {
      ...transcript("mic", 0, "words", "r-1"),
      sourceId: OWNER_INPUT_SOURCE_ID,
    });
    expect(claimed).toMatchObject({
      status: "refused",
      code: "invalid_observation",
      issues: [{ path: ["sourceId"], code: "invalid_value" }],
    });
    // The owner's input with that request id still stores.
    const ack = await repo.submitOwnerInput(world.scope, world.session.id, {
      requestId: "r-1",
      operation: "follow-up",
      text: "and the cost?",
      snapshots: [],
    });
    expect(ack.requestId).toBe("r-1");
  });

  it("is also refused by the database: the kind and the source id come only as a pair", async () => {
    const world = await begin("check-pair");
    const insert = (kind: string, source: string) =>
      fx.owner.query(
        `INSERT INTO interview.session_observations
           (tenant_id, owner_user_id, session_id, source_id, event_id, sequence, kind, content, ack)
         VALUES ($1,$2,$3,$4,'e-pair',900,$5,'{}','{}')`,
        [tenant, world.person.id, world.session.id, source, kind],
      );
    await expect(
      insert("transcript.final", OWNER_INPUT_SOURCE_ID),
    ).rejects.toThrow(/session_observations_owner_source_check/);
    await expect(insert("owner.input", "mic")).rejects.toThrow(
      /session_observations_owner_source_check/,
    );
    await expect(
      insert("owner.input", OWNER_INPUT_SOURCE_ID),
    ).resolves.toBeDefined();
  });
});

describe("storing an owner input", () => {
  it("stores a typed follow-up with the next sequence, content only in its own row", async () => {
    const world = await begin("typed");
    await ingest(world.credential, transcript("mic", 0, "words", "t-1"));
    const ack = await repo.submitOwnerInput(world.scope, world.session.id, {
      requestId: "r-typed",
      operation: "follow-up",
      text: "and the cost?",
      target: { taskId: "task-q1", revision: 2 },
      snapshots: [],
    });
    expect(ack).toEqual({ requestId: "r-typed", sequence: 2 });
    const [stored] = await rows(world.session.id, "owner.input");
    expect(stored).toMatchObject({
      source_id: OWNER_INPUT_SOURCE_ID,
      event_id: "r-typed",
      sequence: "2",
      screenshot_artifact_id: null,
    });
    expect(stored.content.body).toEqual({
      operation: "follow-up",
      text: "and the cost?",
      target: { taskId: "task-q1", revision: 2 },
      snapshots: [],
    });
  });

  it("names a snapshot only by ids that are this session's own screen snapshots", async () => {
    const world = await begin("snap-ok");
    const snapshot = await withSnapshot(world);
    await expect(
      repo.submitOwnerInput(world.scope, world.session.id, {
        requestId: "r-1",
        operation: "analyze",
        snapshots: [snapshot],
      }),
    ).resolves.toMatchObject({ requestId: "r-1" });

    // Unknown ids, a transcript's ids, another owner's snapshot and a
    // duplicate are all the same refusal; nothing is stored for them.
    const transcriptAck = await ingest(
      world.credential,
      transcript("mic", 1, "words", "t-9"),
    );
    expect(transcriptAck.status).toBe("accepted");
    const other = await begin("snap-other");
    const foreign = await withSnapshot(other, "shot-other");
    for (const [index, snapshots] of [
      [{ sourceId: "scr", eventId: "ghost" }],
      [{ sourceId: "mic", eventId: "t-9" }],
      [foreign],
      [snapshot, snapshot],
    ].entries()) {
      await expect(
        repo.submitOwnerInput(world.scope, world.session.id, {
          requestId: `r-bad-${index}`,
          operation: "analyze",
          snapshots,
        }),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect(await rows(world.session.id, "owner.input")).toHaveLength(1);
  });

  it("dedups on the request id and refuses the same id with different content", async () => {
    const world = await begin("dedup");
    const input = {
      requestId: "r-dup",
      operation: "follow-up" as const,
      text: "once",
      snapshots: [],
    };
    const first = await repo.submitOwnerInput(
      world.scope,
      world.session.id,
      input,
    );
    expect(
      await repo.submitOwnerInput(world.scope, world.session.id, input),
    ).toEqual(first);
    await expect(
      repo.submitOwnerInput(world.scope, world.session.id, {
        ...input,
        text: "different",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(await rows(world.session.id, "owner.input")).toHaveLength(1);
  });

  it("is the owner's alone: another member and an ended session see not-found and a status refusal", async () => {
    const world = await begin("owner-only");
    const intruder = await fx.provision(tenant, "intruder");
    const input = {
      requestId: "r-1",
      operation: "follow-up" as const,
      text: "hello",
      snapshots: [],
    };
    await expect(
      repo.submitOwnerInput(scopeOf(intruder), world.session.id, input),
    ).rejects.toMatchObject({ code: "not_found" });
    await repo.controlSession(world.scope, world.session.id, "end");
    await expect(
      repo.submitOwnerInput(world.scope, world.session.id, input),
    ).rejects.toMatchObject({ code: "status_refused" });
  });

  it("takes no request on a session without live assistance", async () => {
    const person = await fx.provision(tenant, "no-assist");
    const started = await repo.startSession(scopeOf(person), {
      processingPolicy: "permitted-remote",
      captureSources: ["microphone"],
      liveAssistance: false,
    });
    await expect(
      repo.submitOwnerInput(scopeOf(person), started.session.id, {
        requestId: "r-1",
        operation: "follow-up",
        text: "hello",
        snapshots: [],
      }),
    ).rejects.toMatchObject({ code: "status_refused" });
    expect(await rows(started.session.id, "owner.input")).toHaveLength(0);
  });

  it("rejects an invalid body, identity fields and oversized text", async () => {
    const world = await begin("invalid");
    for (const body of [
      {},
      { requestId: "r", operation: "analyze", snapshots: [] },
      { requestId: "r", operation: "follow-up", snapshots: [] },
      {
        requestId: "r",
        operation: "follow-up",
        text: "x".repeat(2_001),
        snapshots: [],
      },
      {
        requestId: "r",
        operation: "follow-up",
        text: "x",
        snapshots: [],
        ownerUserId: world.person.id,
      },
    ])
      await expect(
        repo.submitOwnerInput(world.scope, world.session.id, body),
      ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("is bounded by its own cap, not the capture caps", async () => {
    const world = await begin("caps");
    // Fill the capture count: owner inputs do not count toward it, and a
    // capture refused for the cap never refuses an owner input.
    const limits = { maxObservationsPerSession: 1, maxIngestPerMinute: 1 };
    expect(
      (
        await ingest(world.credential, transcript("mic", 0, "a", "c-1"), {
          limits,
        })
      ).status,
    ).toBe("accepted");
    for (let i = 0; i < 3; i += 1)
      await repo.submitOwnerInput(world.scope, world.session.id, {
        requestId: `r-${i}`,
        operation: "follow-up",
        text: "more",
        snapshots: [],
      });
    expect(await rows(world.session.id, "owner.input")).toHaveLength(3);
    // The capture cap still counts captures only (one stored, one refused).
    expect(
      await ingest(world.credential, transcript("mic", 1, "b", "c-2"), {
        limits,
      }),
    ).toMatchObject({ status: "refused", code: "limit_reached" });
    // Owner inputs also leave the per-minute capture rate untouched.
    const fresh = await begin("rate");
    for (let i = 0; i < 3; i += 1)
      await repo.submitOwnerInput(fresh.scope, fresh.session.id, {
        requestId: `r-${i}`,
        operation: "follow-up",
        text: "more",
        snapshots: [],
      });
    expect(
      (
        await ingest(fresh.credential, transcript("mic", 0, "a", "c-1"), {
          limits: { maxIngestPerMinute: 1 },
        })
      ).status,
    ).toBe("accepted");
    expect(OWNER_INPUT_MAX_PER_SESSION).toBe(500);
  });

  it("refuses an input past the per-session cap and stores nothing more", async () => {
    const world = await begin("cap");
    // The cap's worth of stored inputs, inserted directly.
    await fx.owner.query(
      `INSERT INTO interview.session_observations
         (tenant_id, owner_user_id, session_id, source_id, event_id, sequence, kind, content, ack)
       SELECT $1, $2, $3, $4, 'cap-' || n, 1000 + n, 'owner.input', '{}', '{}'
       FROM generate_series(1, $5::int) AS n`,
      [
        tenant,
        world.person.id,
        world.session.id,
        OWNER_INPUT_SOURCE_ID,
        OWNER_INPUT_MAX_PER_SESSION,
      ],
    );
    await expect(
      repo.submitOwnerInput(world.scope, world.session.id, {
        requestId: "over-cap",
        operation: "follow-up",
        text: "one more",
        snapshots: [],
      }),
    ).rejects.toMatchObject({ code: "status_refused" });
    expect(await rows(world.session.id, "owner.input")).toHaveLength(
      OWNER_INPUT_MAX_PER_SESSION,
    );
  });
});

describe("purging a session with owner inputs", () => {
  it("leaves no owner.input row and no trace of its typed text", async () => {
    const world = await begin("purge-input");
    const canary = "CANARY-OWNER-TYPED-5d2e";
    await repo.submitOwnerInput(world.scope, world.session.id, {
      requestId: "r-purge",
      operation: "follow-up",
      text: `typed ${canary}`,
      snapshots: [],
    });
    // The processor's own read sees it.
    const read = await createDatabaseStorePort(fx.member).observationsAfter(
      world.scope,
      world.session.id,
      0,
      200,
    );
    expect(read.filter((row) => row.kind === "owner.input")).toHaveLength(1);

    const result = await purgeSession(
      fx.member,
      {
        tenantId: tenant,
        ownerUserId: world.person.id,
        sessionId: world.session.id,
      },
      {
        waitMs: 0,
        pollMs: 1,
        sleep: async () => {},
        trigger: "owner-delete",
      },
    );
    expect(result.outcome).toBe("complete");
    expect(await rows(world.session.id, "owner.input")).toHaveLength(0);
    const leftovers = await fx.owner.query(
      `SELECT 1 FROM interview.session_observations WHERE content::text LIKE $1
       UNION ALL
       SELECT 1 FROM interview.active_sessions s WHERE row_to_json(s)::text LIKE $1`,
      [`%${canary}%`],
    );
    expect(leftovers.rows).toHaveLength(0);
  });
});

describe("heard speech (ADR-0022)", () => {
  it("stores a heard phrase as a transcript from the reserved owner microphone source, idempotent by request id", async () => {
    const world = await begin("heard-store");
    const input = {
      requestId: "h-1",
      operation: "heard",
      text: "Tell me about a time you led a team?",
    };
    const ack = await repo.submitOwnerInput(
      world.scope,
      world.session.id,
      input,
    );
    expect(ack.requestId).toBe("h-1");
    const stored = await rows(world.session.id, "transcript.final");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      source_id: OWNER_MICROPHONE_SOURCE_ID,
      event_id: "h-1",
    });
    expect(stored[0].content.body).toMatchObject({
      speaker: "microphone",
      text: input.text,
    });
    // Whole milliseconds: the page's transcript schema requires integers, so a
    // fractional time would drop the row from the Transcript tab.
    const { startMs, endMs } = stored[0].content.body;
    expect(Number.isInteger(startMs)).toBe(true);
    expect(Number.isInteger(endMs)).toBe(true);
    expect(startMs).toBeGreaterThanOrEqual(0);
    // A resend returns the same acknowledgement and stores nothing more.
    expect(
      await repo.submitOwnerInput(world.scope, world.session.id, input),
    ).toEqual(ack);
    expect(await rows(world.session.id, "transcript.final")).toHaveLength(1);
    // The same id with other words is refused and the original stays.
    await expect(
      repo.submitOwnerInput(world.scope, world.session.id, {
        ...input,
        text: "something else",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("refuses bounded-text violations and takes none while paused or from another owner", async () => {
    const world = await begin("heard-refusals");
    await expect(
      repo.submitOwnerInput(world.scope, world.session.id, {
        requestId: "h-long",
        operation: "heard",
        text: "x".repeat(1_001),
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      repo.submitOwnerInput(world.scope, world.session.id, {
        requestId: "h-extra",
        operation: "heard",
        text: "hello",
        snapshots: [],
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    const intruder = await fx.provision(tenant, "heard-intruder");
    await expect(
      repo.submitOwnerInput(scopeOf(intruder), world.session.id, {
        requestId: "h-2",
        operation: "heard",
        text: "hello",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await repo.controlSession(world.scope, world.session.id, "pause");
    await expect(
      repo.submitOwnerInput(world.scope, world.session.id, {
        requestId: "h-3",
        operation: "heard",
        text: "hello",
      }),
    ).rejects.toMatchObject({ code: "status_refused" });
    expect(await rows(world.session.id, "transcript.final")).toHaveLength(0);
  });

  it("refuses the reserved source id on the capture wire", async () => {
    const world = await begin("heard-wire");
    const claimed = await ingest(world.credential, {
      ...transcript("mic", 0, "words", "w-1"),
      sourceId: OWNER_MICROPHONE_SOURCE_ID,
    });
    expect(claimed).toMatchObject({
      status: "refused",
      code: "invalid_observation",
      issues: [{ path: ["sourceId"], code: "invalid_value" }],
    });
  });
});
