// Characterisation of ingest on a disposable PostgreSQL as the member role:
// what the existing suites did not pin before ingest was split into layers.
// Which handler a message kind reaches (and that an unknown or prototype-named
// kind is an observation), the reserved owner sources, the order of the
// bounds, what is told after commit and in which order, that a listener or the
// job repository failing never changes the acknowledgement, the log events and
// their fields, and two messages racing for one session.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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
import type { SessionJobs } from "./session-jobs";
import { createVoiceActivityGate } from "./voice-activity";

// Every line ingest logs, as the JSON a deployment would emit (the real logger
// and its redaction), at debug so the refusal lines are there to read.
const logged = vi.hoisted(() => [] as string[]);
vi.mock("@omnitech/logging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@omnitech/logging")>();
  return {
    ...actual,
    createLogger: (options: Parameters<typeof actual.createLogger>[0]) =>
      actual.createLogger({
        ...options,
        level: "debug",
        format: "json",
        content: false,
        write: (line) => logged.push(line),
      }),
  };
});

type Line = Record<string, unknown> & { event: string; level: string };
const INGEST_EVENTS = new Set([
  "companion.refused",
  "observation.stored",
  "companion.heartbeat_stop",
  "companion.capability",
]);
const lines = (): Line[] =>
  logged
    .map((line) => JSON.parse(line) as Line)
    .filter((line) => INGEST_EVENTS.has(line.event))
    .map(({ time: _time, ...rest }) => rest as Line);

let fx: Fixture;
let repo: ActiveSessionRepository;
let tenant = "";

const scopeOf = (person: Person) => ({ tenantId: tenant, actorId: person.id });

async function begin(
  name: string,
  processingPolicy: "permitted-remote" | "device-only" = "permitted-remote",
) {
  const person = await fx.provision(tenant, name);
  const started = await repo.startSession(scopeOf(person), {
    processingPolicy,
    captureSources: ["microphone", "screen"],
  });
  return {
    person,
    session: started.session.id,
    credential: started.credential.value,
  };
}

const ingest = (
  credential: string,
  envelope: unknown,
  options?: Parameters<typeof ingestObservation>[4],
) => ingestObservation(fx.member, credential, tenant, envelope, options);

const stored = async (session: string) =>
  (
    await fx.owner.query(
      "SELECT source_id, event_id, sequence, kind FROM interview.session_observations WHERE session_id=$1 ORDER BY sequence",
      [session],
    )
  ).rows as {
    source_id: string;
    event_id: string;
    sequence: string;
    kind: string;
  }[];

const sessionRow = async (session: string) =>
  (
    await fx.owner.query(
      "SELECT status, last_heartbeat_at, credential_revoked_at FROM interview.active_sessions WHERE id=$1",
      [session],
    )
  ).rows[0] as {
    status: string;
    last_heartbeat_at: Date | null;
    credential_revoked_at: Date | null;
  };

const beat = (capturing = true, extra: Record<string, unknown> = {}) => ({
  version: 1,
  kind: "heartbeat",
  sourceId: "companion",
  sentAt: "2026-10-03T10:00:00.000Z",
  capturing,
  ...extra,
});

const capability = () => ({
  version: 1,
  kind: "capability.report",
  sourceId: "companion",
  sentAt: "2026-10-03T10:00:00.000Z",
  speech: {
    locale: "en-US",
    onDeviceAvailable: true,
    recognizerAvailable: true,
    authorizationStatus: "authorized",
  },
  permissions: { microphone: "granted", screen: "denied" },
});

const activity = (speaking = true) => ({
  version: 1,
  kind: "voice.activity",
  sourceId: "companion",
  sentAt: "2026-10-03T10:00:05.000Z",
  source: "microphone",
  speaking,
});

const NO_SPACING = { limits: { minHeartbeatIntervalMs: 0 } };

// A job repository that records what it was asked and can be made to fail.
const jobsThat = (fail: boolean) => {
  const asked: string[] = [];
  const jobs = {
    requestCancellation: async (_t: string, _a: string, jobId: string) => {
      asked.push(jobId);
      if (fail) throw new Error("job repository down");
      return "requested" as const;
    },
  } as unknown as SessionJobs;
  return { jobs, asked };
};

// An action of the session that names a job, so a cancellation has one to ask.
async function nameJob(person: Person, session: string): Promise<string> {
  return fx.one(
    `INSERT INTO interview.session_actions
       (tenant_id, owner_user_id, session_id, task_id, task_revision,
        action_kind, dispatch_status, job_id, job_created, fence_at_dispatch)
     VALUES ($1,$2,$3,'task-1',1,'draft','succeeded',gen_random_uuid(),false,0)
     RETURNING job_id AS id`,
    [tenant, person.id, session],
  );
}

beforeAll(async () => {
  fx = await startFixture();
  tenant = fx.tenantA;
  repo = new ActiveSessionRepository(fx.member);
}, 90_000);
afterAll(() => fx?.stop());
beforeEach(() => {
  logged.length = 0;
});

describe("which handler a message reaches", () => {
  it("treats an unknown kind, a kind named like an object's own members, and no kind at all as an observation that fails validation", async () => {
    const { credential, session } = await begin("kinds");
    for (const kind of [
      "session.control",
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
      42,
      null,
    ]) {
      const ack = await ingest(credential, {
        version: 1,
        kind,
        sourceId: "companion",
        sentAt: "2026-10-03T10:00:00.000Z",
      });
      expect(ack, String(kind)).toMatchObject({
        status: "refused",
        code: "invalid_observation",
        control: { state: "active" },
      });
    }
    for (const envelope of [[], 7, "null", '"words"', "[1,2]"]) {
      const ack = await ingest(credential, envelope);
      expect(ack, JSON.stringify(envelope)).toMatchObject({
        status: "refused",
        code: "invalid_observation",
      });
    }
    expect(await stored(session)).toEqual([]);
    expect((await sessionRow(session)).last_heartbeat_at).toBeNull();
  });

  it("refuses an envelope that cannot be read before any credential is looked at: unparseable text, and a value that cannot be serialised", async () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    for (const envelope of ["{not json", circular, { big: 1n }]) {
      const ack = await ingest("not-a-credential", envelope);
      expect(ack).toEqual({
        version: 1,
        status: "refused",
        code: "invalid_observation",
      });
    }
    // A well-formed envelope with a malformed credential is the one refusal.
    expect(await ingest("not-a-credential", beat())).toEqual({
      version: 1,
      status: "refused",
      code: "credential_refused",
    });
    expect(
      await ingestObservation(fx.member, "x", "not-a-uuid", beat()),
    ).toEqual({ version: 1, status: "refused", code: "credential_refused" });
  });

  it("answers a paused session with its standing, for every kind, and stamps contact only for the kinds that are taken", async () => {
    const { credential, session, person } = await begin("paused");
    await repo.controlSession(scopeOf(person), session, "pause");
    expect(await ingest(credential, transcript("mic", 1))).toMatchObject({
      status: "refused",
      code: "session_paused",
      control: { state: "paused" },
    });
    expect(await ingest(credential, activity())).toMatchObject({
      code: "session_paused",
    });
    expect((await sessionRow(session)).last_heartbeat_at).toBeNull();
    // A heartbeat of a session that is not active stamps contact and answers
    // paused; it is not spaced.
    expect(await ingest(credential, beat())).toMatchObject({
      status: "refused",
      code: "session_paused",
      control: { state: "paused" },
    });
    expect((await sessionRow(session)).last_heartbeat_at).not.toBeNull();
    expect(await ingest(credential, beat())).toMatchObject({
      code: "session_paused",
    });
    expect(await ingest(credential, capability(), NO_SPACING)).toMatchObject({
      status: "accepted",
      eventId: "capability",
      control: { state: "paused" },
    });
    expect((await sessionRow(session)).status).toBe("paused");
  });
});

// A started session is capturing at once.
const beginActive = begin;

describe("the reserved owner sources", () => {
  it("refuses each of them as a sender's source id, by path and code, storing nothing", async () => {
    const { credential, session } = await beginActive("reserved");
    for (const sourceId of [
      "studio.owner-input",
      "studio.owner-capture",
      "studio.owner-microphone",
    ]) {
      const ack = await ingest(credential, transcript(sourceId, 1));
      expect(ack).toMatchObject({
        status: "refused",
        code: "invalid_observation",
        issues: [{ path: ["sourceId"], code: "invalid_value" }],
        control: { state: "active" },
      });
    }
    expect(await stored(session)).toEqual([]);
  });
});

describe("the order of the bounds", () => {
  it("answers the session cap before the rate, a resend before either, and tells no retry-after for an observation", async () => {
    const { credential, session } = await beginActive("bounds");
    const first = transcript("mic", 1);
    expect((await ingest(credential, first)).status).toBe("accepted");
    const waits: number[] = [];
    const both = {
      limits: { maxObservationsPerSession: 1, maxIngestPerMinute: 1 },
      onRetryAfter: (seconds: number) => waits.push(seconds),
    };
    expect(await ingest(credential, transcript("mic", 2), both)).toMatchObject({
      status: "refused",
      code: "limit_reached",
    });
    expect(
      await ingest(credential, transcript("mic", 2), {
        limits: { maxIngestPerMinute: 1 },
        onRetryAfter: (seconds: number) => waits.push(seconds),
      }),
    ).toMatchObject({ status: "refused", code: "rate_limited" });
    // The resend of what is stored is a duplicate whatever the bounds say.
    expect(await ingest(credential, first, both)).toMatchObject({
      status: "duplicate",
      original: { status: "accepted", eventId: first.eventId },
    });
    expect(waits).toEqual([]);
    expect(await stored(session)).toHaveLength(1);
  });

  it("checks a screenshot in order: its count, its payload, its size, its leading bytes, its declared length", async () => {
    const { credential, session } = await beginActive("shot-order");
    const shot = () => screenshot("screen", 1);
    expect(
      await ingest(credential, shot(), {
        limits: { maxScreenshotsPerSession: 0 },
      }),
    ).toMatchObject({ code: "limit_reached" });
    expect(await ingest(credential, shot())).toMatchObject({
      code: "invalid_observation",
      issues: [{ path: ["payload"], code: "too_small" }],
    });
    expect(
      await ingest(credential, shot(), {
        payload: PNG_BYTES,
        limits: { maxScreenshotBytes: 4 },
      }),
    ).toMatchObject({ code: "payload_too_large" });
    expect(
      await ingest(credential, screenshot("screen", 1, "image/jpeg"), {
        payload: PNG_BYTES,
      }),
    ).toMatchObject({
      code: "invalid_observation",
      issues: [{ path: ["payload"], code: "invalid_value" }],
    });
    expect(
      await ingest(
        credential,
        screenshot("screen", 1, "image/png", PNG_BYTES.byteLength + 1),
        { payload: PNG_BYTES },
      ),
    ).toMatchObject({
      code: "invalid_observation",
      issues: [{ path: ["content", "byteLength"], code: "invalid_value" }],
    });
    expect(await stored(session)).toEqual([]);
    expect((await sessionRow(session)).last_heartbeat_at).toBeNull();
  });

  it("counts every stored row for the sequence but not the owner's own rows toward the cap", async () => {
    const { credential, session, person } = await beginActive("owner-rows");
    await fx.owner.query(
      `INSERT INTO interview.session_observations
         (tenant_id, owner_user_id, session_id, source_id, event_id, sequence, kind, content, ack)
       VALUES ($1,$2,$3,'studio.owner-input','req-1',5,'owner.input','{}','{}'),
              ($1,$2,$3,'studio.owner-microphone','said-1',6,'transcript.final','{}','{}')`,
      [tenant, person.id, session],
    );
    const ack = await ingest(credential, transcript("mic", 1), {
      limits: { maxObservationsPerSession: 1, maxIngestPerMinute: 1 },
    });
    expect(ack.status).toBe("accepted");
    expect((await stored(session)).map((row) => Number(row.sequence))).toEqual([
      5, 6, 7,
    ]);
  });
});

describe("what is told after the commit", () => {
  it("tells the wait of a too-soon heartbeat and capability report (the spacing in whole seconds, never under one) and of a voice report over its bound (one second)", async () => {
    const { credential } = await beginActive("waits");
    const waits: number[] = [];
    const onRetryAfter = (seconds: number) => waits.push(seconds);
    expect((await ingest(credential, beat())).status).toBe("accepted");
    expect(
      await ingest(credential, beat(), {
        limits: { minHeartbeatIntervalMs: 2_500 },
        onRetryAfter,
      }),
    ).toMatchObject({ code: "rate_limited" });
    expect(
      await ingest(credential, beat(), {
        limits: { minHeartbeatIntervalMs: 60_000 },
        onRetryAfter,
      }),
    ).toMatchObject({ code: "rate_limited" });
    expect((await ingest(credential, capability(), NO_SPACING)).status).toBe(
      "accepted",
    );
    expect(
      await ingest(credential, capability(), {
        limits: { minHeartbeatIntervalMs: 400 },
        onRetryAfter,
      }),
    ).toMatchObject({ code: "rate_limited" });
    const gate = createVoiceActivityGate();
    const voice = {
      voiceActivity: true,
      activityGate: gate,
      limits: { maxVoiceActivityPerMinute: 1 },
      onRetryAfter,
    };
    expect((await ingest(credential, activity(), voice)).status).toBe(
      "accepted",
    );
    expect(await ingest(credential, activity(false), voice)).toMatchObject({
      code: "rate_limited",
    });
    expect(waits).toEqual([3, 60, 1, 1]);
  });

  it("keeps the acknowledgement of a voice report when the listener throws", async () => {
    const { credential } = await beginActive("voice-throws");
    const ack = await ingest(credential, activity(), {
      voiceActivity: true,
      activityGate: createVoiceActivityGate(),
      onActivity: () => {
        throw new Error("listener down");
      },
    });
    expect(ack).toMatchObject({
      status: "accepted",
      eventId: "voice-activity",
      control: { state: "active" },
    });
  });

  it("tells a heard line before it asks for the session's jobs to be cancelled, and only after the row is committed", async () => {
    const { credential, session, person } = await beginActive("order");
    const seen: string[] = [];
    const ack = await ingest(credential, transcript("mic", 1, "said aloud"), {
      onHeard: async () => {
        // Read on another connection: the line is there, so it was committed.
        seen.push(`heard:${(await stored(session)).length}`);
      },
    });
    expect(ack.status).toBe("accepted");
    await vi.waitFor(() => expect(seen).toEqual(["heard:1"]));

    // A stop report pauses and cancels: the pause is committed first.
    const jobId = await nameJob(person, session);
    const statusAtCancel: string[] = [];
    const jobs = {
      requestCancellation: async (_t: string, _a: string, id: string) => {
        statusAtCancel.push(`${id}:${(await sessionRow(session)).status}`);
        return "requested" as const;
      },
    } as unknown as SessionJobs;
    const stop = await ingest(credential, beat(false), { jobs });
    expect(stop).toMatchObject({
      status: "refused",
      code: "session_paused",
      control: { state: "paused" },
    });
    expect(statusAtCancel).toEqual([`${jobId}:paused`]);
  });

  it("keeps the acknowledgement and the pause when cancelling the jobs fails, and asks again on nothing but a change of standing", async () => {
    const { credential, session, person } = await beginActive("cancel-fails");
    const jobId = await nameJob(person, session);
    const failing = jobsThat(true);
    const stop = await ingest(credential, beat(false), { jobs: failing.jobs });
    expect(stop).toMatchObject({ status: "refused", code: "session_paused" });
    expect(failing.asked).toEqual([jobId]);
    expect((await sessionRow(session)).status).toBe("paused");
    // The session is paused now: a later message changes no standing and asks
    // for no cancellation.
    const quiet = jobsThat(false);
    expect(
      await ingest(credential, beat(false), { jobs: quiet.jobs }),
    ).toMatchObject({
      code: "session_paused",
    });
    expect(
      await ingest(credential, transcript("mic", 1), { jobs: quiet.jobs }),
    ).toMatchObject({
      code: "session_paused",
    });
    expect(quiet.asked).toEqual([]);
  });

  it("revokes the credential of a member who lost the role and cancels nothing", async () => {
    const { credential, session, person } = await beginActive("demoted");
    await nameJob(person, session);
    await fx.owner.query(
      "UPDATE platform.tenant_memberships SET role='member' WHERE tenant_id=$1 AND user_id=$2",
      [tenant, person.id],
    );
    const quiet = jobsThat(false);
    const heard: unknown[] = [];
    const ack = await ingest(credential, transcript("mic", 1), {
      jobs: quiet.jobs,
      onHeard: (line) => heard.push(line),
    });
    expect(ack).toEqual({
      version: 1,
      status: "refused",
      code: "credential_refused",
    });
    const row = await sessionRow(session);
    expect(row.credential_revoked_at).not.toBeNull();
    // Revoked, not paused: the standing is untouched by the refusal.
    expect(row.status).toBe("active");
    expect(quiet.asked).toEqual([]);
    expect(heard).toEqual([]);
  });
});

describe("what ingest logs", () => {
  it("writes one line per stored observation with ids and sizes, and never the words unless content logging is on", async () => {
    const { credential, session } = await beginActive("log-stored");
    const line = {
      ...transcript("mic", 4, "the words said"),
      content: {
        speaker: "speaker-1",
        text: "the words said",
        startMs: 0,
        endMs: 1000,
        source: "microphone",
      },
    };
    expect((await ingest(credential, line)).status).toBe("accepted");
    expect(
      (
        await ingest(credential, screenshot("screen", 1), {
          payload: PNG_BYTES,
        })
      ).status,
    ).toBe("accepted");
    expect(lines()).toEqual([
      {
        level: "info",
        service: "interview-web",
        event: "observation.stored",
        sessionId: session,
        kind: "transcript.final",
        sourceId: "mic",
        sequence: 1,
        chars: 14,
        speaker: "microphone",
      },
      {
        level: "info",
        service: "interview-web",
        event: "observation.stored",
        sessionId: session,
        kind: "screen.snapshot",
        sourceId: "screen",
        sequence: 2,
      },
    ]);
    expect(logged.join("\n")).not.toContain("the words said");
  });

  it("writes a refusal as its code and control state, a stop as the companion's own codes before the refusal it answers, and a capability report once validated", async () => {
    const { credential, session } = await beginActive("log-refused");
    await ingest("not-a-credential", beat());
    await ingest(credential, transcript("studio.owner-input", 1));
    await ingest(
      credential,
      { ...capability(), extra: "smuggled" },
      NO_SPACING,
    );
    await ingest(credential, capability(), NO_SPACING);
    await ingest(
      credential,
      beat(false, {
        diagnostics: { state: "stopped", sources: { microphone: "failed" } },
      }),
    );
    const said = lines();
    expect(said.map((line) => `${line.level} ${line.event}`)).toEqual([
      "debug companion.refused",
      "debug companion.refused",
      "debug companion.refused",
      "debug companion.capability",
      "info companion.heartbeat_stop",
      "debug companion.refused",
    ]);
    expect(said[0]).toEqual({
      level: "debug",
      service: "interview-web",
      event: "companion.refused",
      code: "credential_refused",
    });
    expect(said[1]).toMatchObject({
      code: "invalid_observation",
      control: "active",
    });
    expect(said[3]).toMatchObject({
      sessionId: session,
      report: { kind: "capability.report", sourceId: "companion" },
    });
    expect(said[4]).toMatchObject({
      sessionId: session,
      sourceId: "companion",
      state: "stopped",
      sources: { microphone: "failed" },
      speechFailure: null,
    });
    expect(said[5]).toMatchObject({
      code: "session_paused",
      control: "paused",
    });
  });

  it("logs nothing for an accepted heartbeat, a duplicate or a voice report", async () => {
    const { credential } = await beginActive("log-quiet");
    const first = transcript("mic", 1);
    await ingest(credential, first);
    logged.length = 0;
    await ingest(credential, first);
    await ingest(credential, beat(), NO_SPACING);
    await ingest(credential, activity(), {
      voiceActivity: true,
      activityGate: createVoiceActivityGate(),
    });
    expect(lines()).toEqual([]);
  });
});

describe("two messages racing for one session", () => {
  it("gives concurrent observations distinct, gapless sequences", async () => {
    const { credential, session } = await beginActive("race");
    const sent = Array.from({ length: 12 }, (_, index) =>
      transcript(index % 2 === 0 ? "mic" : "call", index + 1),
    );
    const acks = await Promise.all(
      sent.map((observation) => ingest(credential, observation)),
    );
    expect(acks.map((ack) => ack.status)).toEqual(sent.map(() => "accepted"));
    const rows = await stored(session);
    expect(rows.map((row) => Number(row.sequence))).toEqual(
      sent.map((_, index) => index + 1),
    );
    expect(new Set(rows.map((row) => row.event_id)).size).toBe(sent.length);
  });

  it("stores a message sent twice at once exactly once: one accepted, one duplicate carrying the original", async () => {
    const { credential, session } = await beginActive("race-resend");
    const observation = transcript("mic", 1);
    const told: string[] = [];
    const acks = await Promise.all(
      [1, 2, 3].map(() =>
        ingest(credential, observation, {
          onHeard: (line) => told.push(line.text),
        }),
      ),
    );
    expect(acks.map((ack) => ack.status).sort()).toEqual([
      "accepted",
      "duplicate",
      "duplicate",
    ]);
    for (const ack of acks)
      if (ack.status === "duplicate")
        expect(ack.original).toMatchObject({
          status: "accepted",
          sourceId: "mic",
          eventId: observation.eventId,
        });
    expect(await stored(session)).toHaveLength(1);
    expect(told).toEqual(["synthetic words"]);
  });

  it("stores identical screenshot bytes sent at once as one artifact under two observations", async () => {
    const { credential, session } = await beginActive("race-shot");
    const acks = await Promise.all(
      [1, 2].map((sequence) =>
        ingest(credential, screenshot("screen", sequence), {
          payload: PNG_BYTES,
        }),
      ),
    );
    expect(acks.map((ack) => ack.status)).toEqual(["accepted", "accepted"]);
    const artifacts = await fx.owner.query(
      "SELECT count(DISTINCT screenshot_artifact_id)::int AS n FROM interview.session_observations WHERE session_id=$1",
      [session],
    );
    expect(artifacts.rows[0].n).toBe(1);
  });

  it("serialises a stop report against an observation: whichever commits second sees the other", async () => {
    const { credential, session } = await beginActive("race-stop");
    const [stop, line] = await Promise.all([
      ingest(credential, beat(false)),
      ingest(credential, transcript("mic", 1)),
    ]);
    expect(stop).toMatchObject({ status: "refused", code: "session_paused" });
    expect((await sessionRow(session)).status).toBe("paused");
    // The line was either stored before the pause or refused after it.
    const rows = await stored(session);
    if (line.status === "accepted") expect(rows).toHaveLength(1);
    else {
      expect(line).toMatchObject({ code: "session_paused" });
      expect(rows).toEqual([]);
    }
  });
});
