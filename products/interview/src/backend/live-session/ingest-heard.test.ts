// What ingest tells a listener (the coach's transcript, the owner's own
// recording): EVERY final transcript line a session newly stored, with
// whether its owner allowed processing off the device (`remote`), so a
// listener on a remote model can leave a device-only line alone. On a
// disposable PostgreSQL as the member role, with the harness of
// ingest.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type HeardLine, ingestObservation } from "./ingest";
import {
  type Fixture,
  type Person,
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
  processingPolicy: "permitted-remote" | "device-only" = "permitted-remote",
  captureSources = ["microphone", "application-audio", "screen"],
) {
  const person = await fx.provision(tenant, name);
  const started = await repo.startSession(scopeOf(person), {
    processingPolicy,
    captureSources,
  } as never);
  return {
    person,
    session: started.session,
    credential: started.credential.value,
  };
}

// Ingests with a listener, and gives back what the listener was told.
async function hearing(
  credential: string,
  envelope: unknown,
  heard: HeardLine[] = [],
) {
  const ack = await ingestObservation(fx.member, credential, tenant, envelope, {
    onHeard: (line) => heard.push(line),
  });
  return { ack, heard };
}

// A final transcript line that names its audio source.
const from = (
  source: "microphone" | "application-audio",
  sequence: number,
  text: string,
  eventId: string,
  occurredAt = "2026-10-03T10:00:00.000Z",
) => {
  const envelope = transcript(source, sequence, text, eventId);
  return {
    ...envelope,
    occurredAt,
    content: { ...envelope.content, source },
  };
};

const count = async (session: string) =>
  Number(
    (
      await fx.owner.query(
        "SELECT count(*) AS n FROM interview.session_observations WHERE session_id=$1",
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

describe("a line a session heard", () => {
  it("is told once, when it is stored: its text, its audio source, when it was said, the session it was heard in and that it may leave the device", async () => {
    const { person, session, credential } = await begin("heard-ann");
    // The session it was heard in and its owner, by their ids alone.
    const where = {
      tenantId: tenant,
      actorId: person.id,
      sessionId: session.id,
    };
    const heard: HeardLine[] = [];
    const first = await hearing(
      credential,
      from(
        "application-audio",
        0,
        "How would you shard the booking table?",
        "h-1",
        "2026-10-03T10:00:05.000Z",
      ),
      heard,
    );
    const second = await hearing(
      credential,
      from(
        "microphone",
        0,
        "By region first.",
        "h-2",
        "2026-10-03T10:00:09.000Z",
      ),
      heard,
    );
    expect([first.ack.status, second.ack.status]).toEqual([
      "accepted",
      "accepted",
    ]);
    expect(heard).toEqual([
      {
        text: "How would you shard the booking table?",
        source: "application-audio",
        occurredAt: "2026-10-03T10:00:05.000Z",
        session: where,
        remote: true,
      },
      {
        text: "By region first.",
        source: "microphone",
        occurredAt: "2026-10-03T10:00:09.000Z",
        session: where,
        remote: true,
      },
    ]);
    expect(await count(session.id)).toBe(2);
  });

  it("carries no source when the transcript named none", async () => {
    const { person, session, credential } = await begin("heard-bea");
    const { ack, heard } = await hearing(
      credential,
      transcript("mic", 0, "words with no named source", "h-1"),
    );
    expect(ack.status).toBe("accepted");
    expect(heard).toEqual([
      {
        text: "words with no named source",
        occurredAt: "2026-10-03T10:00:00.000Z",
        session: {
          tenantId: tenant,
          actorId: person.id,
          sessionId: session.id,
        },
        remote: true,
      },
    ]);
    expect(heard[0]).not.toHaveProperty("source");
  });

  it("is not told again for a resend: the duplicate stores nothing and tells no one", async () => {
    const { session, credential } = await begin("heard-cal");
    const envelope = from("microphone", 0, "said once", "h-dup");
    const heard: HeardLine[] = [];
    const original = await hearing(credential, envelope, heard);
    const resend = await hearing(credential, envelope, heard);
    expect(resend.ack).toEqual({
      version: 1,
      status: "duplicate",
      original: original.ack,
    });
    expect(heard).toHaveLength(1);
    expect(await count(session.id)).toBe(1);
  });

  it("leaves the acknowledgement as it is when the listener throws, and the line stays stored", async () => {
    const { session, credential } = await begin("heard-dee");
    const quiet = await begin("heard-dee-quiet");
    let told = 0;
    const ack = await ingestObservation(
      fx.member,
      credential,
      tenant,
      from("microphone", 0, "the listener fails on this", "h-1"),
      {
        onHeard: () => {
          told += 1;
          throw new Error("the listener broke");
        },
      },
    );
    // The same line into a session nobody listens to is acknowledged alike.
    const plain = await ingestObservation(
      fx.member,
      quiet.credential,
      tenant,
      from("microphone", 0, "the listener fails on this", "h-1"),
    );
    expect(told).toBe(1);
    expect(ack).toMatchObject({
      version: 1,
      status: "accepted",
      sourceId: "microphone",
      eventId: "h-1",
      control: { state: "active" },
    });
    expect(Object.keys(ack).sort()).toEqual(Object.keys(plain).sort());
    expect(await count(session.id)).toBe(1);
    // The next line is heard as usual.
    const next = await hearing(
      credential,
      from("microphone", 1, "and the next one", "h-2"),
    );
    expect(next.heard).toHaveLength(1);
  });
});

describe("a line a device-only session heard", () => {
  it("is stored and told like any other, marked as not to leave the device", async () => {
    const { person, session, credential } = await begin(
      "heard-eve",
      "device-only",
    );
    const where = {
      tenantId: tenant,
      actorId: person.id,
      sessionId: session.id,
    };
    const heard: HeardLine[] = [];
    const named = await hearing(
      credential,
      from("application-audio", 0, "this stays on the device", "h-1"),
      heard,
    );
    const unnamed = await hearing(
      credential,
      transcript("mic", 0, "and so does this", "h-2"),
      heard,
    );
    expect([named.ack.status, unnamed.ack.status]).toEqual([
      "accepted",
      "accepted",
    ]);
    expect(heard).toEqual([
      {
        text: "this stays on the device",
        source: "application-audio",
        occurredAt: "2026-10-03T10:00:00.000Z",
        session: where,
        remote: false,
      },
      {
        text: "and so does this",
        occurredAt: "2026-10-03T10:00:00.000Z",
        session: where,
        remote: false,
      },
    ]);
    expect(await count(session.id)).toBe(2);
  });

  it("is not told again for a resend", async () => {
    const { credential } = await begin("heard-eve-dup", "device-only");
    const envelope = from("microphone", 0, "said once, on the device", "h-dup");
    const heard: HeardLine[] = [];
    await hearing(credential, envelope, heard);
    const resend = await hearing(credential, envelope, heard);
    expect(resend.ack.status).toBe("duplicate");
    expect(heard.map((line) => line.remote)).toEqual([false]);
  });

  it("is told as it is at the moment it is stored: a session tightened to the device says so from its next line", async () => {
    const { person, session, credential } = await begin("heard-eve-tighten");
    const heard: HeardLine[] = [];
    await hearing(
      credential,
      from("microphone", 0, "while it may leave the device", "h-1"),
      heard,
    );
    await repo.tightenProcessingPolicy(
      scopeOf(person),
      session.id,
      "device-only",
    );
    await hearing(
      credential,
      from("microphone", 1, "after it may not", "h-2"),
      heard,
    );
    expect(heard.map((line) => [line.text, line.remote])).toEqual([
      ["while it may leave the device", true],
      ["after it may not", false],
    ]);
  });
});

describe("what a listener is never told", () => {
  it("a refused observation: a bad credential, a source the session never registered, an invalid line, a paused session", async () => {
    const { person, session, credential } = await begin(
      "heard-fin",
      "permitted-remote",
      ["microphone"],
    );
    const heard: HeardLine[] = [];
    const refusals = [
      await hearing(
        `asc_${"A".repeat(43)}`,
        from("microphone", 0, "unknown credential", "r-1"),
        heard,
      ),
      await hearing(
        credential,
        from("application-audio", 0, "never registered", "r-2"),
        heard,
      ),
      await hearing(
        credential,
        { ...from("microphone", 0, "wrong version", "r-3"), version: 2 },
        heard,
      ),
      await hearing(credential, "{not json", heard),
    ];
    await repo.controlSession(scopeOf(person), session.id, "pause");
    refusals.push(
      await hearing(
        credential,
        from("microphone", 0, "said while paused", "r-4"),
        heard,
      ),
    );
    expect(refusals.map((each) => each.ack.status)).toEqual(
      refusals.map(() => "refused"),
    );
    expect(heard).toEqual([]);
    expect(await count(session.id)).toBe(0);
  });

  it("an observation that is not a transcript: a capture gap, a disconnect", async () => {
    const { session, credential } = await begin("heard-gus");
    const base = {
      version: 1,
      sourceId: "mic",
      occurredAt: "2026-10-03T10:00:00.000Z",
    };
    const heard: HeardLine[] = [];
    const gap = await hearing(
      credential,
      {
        ...base,
        kind: "capture.gap",
        eventId: "g-1",
        sequence: 0,
        content: {
          source: "microphone",
          durationMs: 800,
          reason: "buffer-overflow",
        },
      },
      heard,
    );
    const gone = await hearing(
      credential,
      {
        ...base,
        kind: "source.disconnected",
        eventId: "d-1",
        sequence: 1,
        content: { source: "microphone", reason: "user-stopped" },
      },
      heard,
    );
    expect([gap.ack.status, gone.ack.status]).toEqual(["accepted", "accepted"]);
    expect(heard).toEqual([]);
    expect(await count(session.id)).toBe(2);
  });

  it("anything at all when no listener is given: ingest answers as before", async () => {
    const { session, credential } = await begin("heard-hal");
    const ack = await ingestObservation(
      fx.member,
      credential,
      tenant,
      from("microphone", 0, "nobody listens", "h-1"),
    );
    expect(ack.status).toBe("accepted");
    expect(await count(session.id)).toBe(1);
  });
});
