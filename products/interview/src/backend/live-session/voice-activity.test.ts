// Voice activity from a session's audio sources, through the ingest route on a
// disposable PostgreSQL as the member role (the harness of routes.test.ts):
// the session credential is the only principal; a device-only session, a
// Studio with the switch off, a paused session and an unregistered source tell
// the coach nothing; nothing is stored; and, end to end, a synthetic voice run
// through the shared detector makes the coach's transcript feed say who is
// speaking, until the voice stops or the source goes quiet.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createVoiceActivityDetector,
  createVoiceActivityReporter,
  type VoiceActivitySource,
} from "@omnitech/active-session-contracts";
import type { PlatformContext } from "@omnitech/platform-contracts";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  type BehaviourFlagStore,
  createBehaviourFlagStore,
} from "../behaviour-flags";
import { createCoachTranscript } from "../coach-transcript";
import { ingestObservation } from "./ingest";
import {
  type Fixture,
  type Person,
  startFixture,
} from "./live-session-fixture";
import { ActiveSessionRepository } from "./repository";
import { createSessionRoutes } from "./routes";
import {
  createVoiceActivityGate,
  tellCoachWhoSpeaks,
  type VoiceActivityHeard,
  voiceActivityEnabled,
} from "./voice-activity";

let fx: Fixture;
let repo: ActiveSessionRepository;
let slug = "";

beforeAll(async () => {
  fx = await startFixture();
  repo = new ActiveSessionRepository(fx.member);
  slug = String(
    (
      await fx.owner.query("SELECT slug FROM platform.tenants WHERE id=$1", [
        fx.tenantA,
      ])
    ).rows[0].slug,
  );
  for (const tenant of [fx.tenantA, fx.tenantB])
    await fx.owner.query(
      `INSERT INTO platform.product_installations(tenant_id,product_id,display_name,description,icon,configuration)
       VALUES($1,'omnitech.interview','Interview','Interview','sparkles','{}')`,
      [tenant],
    );
}, 120_000);
afterAll(() => fx?.stop());
afterEach(() => vi.useRealTimers());

const scopeOf = (person: Person, tenant = fx.tenantA) => ({
  tenantId: tenant,
  actorId: person.id,
});

async function begin(
  name: string,
  processingPolicy: "permitted-remote" | "device-only" = "permitted-remote",
  captureSources = ["microphone", "application-audio", "screen"],
  tenant = fx.tenantA,
) {
  const person = await fx.provision(tenant, name);
  const started = await repo.startSession(scopeOf(person, tenant), {
    processingPolicy,
    captureSources,
  } as never);
  return {
    person,
    session: started.session,
    credential: started.credential.value,
  };
}

const activity = (
  source: VoiceActivitySource | "screen",
  speaking: boolean,
  extra: Record<string, unknown> = {},
) => ({
  version: 1,
  kind: "voice.activity",
  sourceId: "companion",
  sentAt: "2026-10-03T10:00:05.000Z",
  source,
  speaking,
  ...extra,
});

// Ingests with the switch on (unless told otherwise) and a listener, and
// gives back what the listener was told.
async function telling(
  credential: string,
  envelope: unknown,
  options: {
    on?: boolean;
    told?: VoiceActivityHeard[];
    perMinute?: number;
    gate?: ReturnType<typeof createVoiceActivityGate>;
    tenant?: string;
  } = {},
) {
  const told = options.told ?? [];
  const ack = await ingestObservation(
    fx.member,
    credential,
    options.tenant ?? fx.tenantA,
    envelope,
    {
      voiceActivity: options.on ?? true,
      onActivity: (heard) => told.push(heard),
      activityGate: options.gate ?? createVoiceActivityGate(),
      ...(options.perMinute !== undefined
        ? { limits: { maxVoiceActivityPerMinute: options.perMinute } }
        : {}),
    },
  );
  return { ack, told };
}

const stored = async (session: string) =>
  Number(
    (
      await fx.owner.query(
        "SELECT count(*) AS n FROM interview.session_observations WHERE session_id=$1",
        [session],
      )
    ).rows[0].n,
  );
const contactOf = async (session: string) =>
  (
    await fx.owner.query(
      "SELECT last_heartbeat_at FROM interview.active_sessions WHERE id=$1",
      [session],
    )
  ).rows[0].last_heartbeat_at as Date | null;

describe("the owner's switch", () => {
  it("is off unless it says on", () => {
    expect(voiceActivityEnabled({})).toBe(false);
    for (const value of ["off", "", "true", "1", "ON"])
      expect(
        voiceActivityEnabled({ ACTIVE_SESSION_VOICE_ACTIVITY: value }),
      ).toBe(false);
    expect(voiceActivityEnabled({ ACTIVE_SESSION_VOICE_ACTIVITY: "on" })).toBe(
      true,
    );
  });

  it("is what Settings stored when the environment says nothing, and off by default", () => {
    const KEY = "ACTIVE_SESSION_VOICE_ACTIVITY";
    expect(voiceActivityEnabled({}, {})).toBe(false);
    expect(voiceActivityEnabled({}, { [KEY]: "on" })).toBe(true);
    expect(voiceActivityEnabled({}, { [KEY]: "off" })).toBe(false);
    // An empty variable says nothing, so Settings still decides.
    expect(voiceActivityEnabled({ [KEY]: "" }, { [KEY]: "on" })).toBe(true);
    // A stored value that is not one of the flag's is no setting at all.
    expect(voiceActivityEnabled({}, { [KEY]: "true" })).toBe(false);
  });

  it("is the environment's when the host set it, whatever Settings stored", () => {
    const KEY = "ACTIVE_SESSION_VOICE_ACTIVITY";
    expect(voiceActivityEnabled({ [KEY]: "off" }, { [KEY]: "on" })).toBe(false);
    expect(voiceActivityEnabled({ [KEY]: "on" }, { [KEY]: "off" })).toBe(true);
    // Set to anything that is not `on`, it is off, as it always was.
    expect(voiceActivityEnabled({ [KEY]: "true" }, { [KEY]: "on" })).toBe(
      false,
    );
  });
});

describe("the stored setting, asked at every report", () => {
  const KEY = "ACTIVE_SESSION_VOICE_ACTIVITY";
  const directory = mkdtempSync(join(tmpdir(), "voice-activity-flags-"));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  // Ingests as the Studio does: the switch is the flag store's value, read
  // when the report arrives.
  const report = async (
    flags: BehaviourFlagStore,
    credential: string,
    told: VoiceActivityHeard[],
  ) =>
    ingestObservation(
      fx.member,
      credential,
      fx.tenantA,
      activity("application-audio", true),
      {
        voiceActivity: () => flags.value(KEY) === "on",
        onActivity: (heard) => told.push(heard),
        activityGate: createVoiceActivityGate(),
      },
    );

  it("refuses until Settings turns it on, takes the very next report, and refuses again once it is turned off", async () => {
    const flags = createBehaviourFlagStore(join(directory, "a.json"), {});
    const { session, credential } = await begin("va-setting");
    const told: VoiceActivityHeard[] = [];
    expect(await report(flags, credential, told)).toMatchObject({
      status: "refused",
      code: "voice_activity_off",
    });
    expect(told).toEqual([]);
    expect(flags.set(KEY, "on")).toBe("stored");
    expect((await report(flags, credential, told)).status).toBe("accepted");
    expect(told.map((heard) => heard.session.sessionId)).toEqual([session.id]);
    expect(flags.set(KEY, "off")).toBe("stored");
    expect(await report(flags, credential, told)).toMatchObject({
      status: "refused",
      code: "voice_activity_off",
    });
    expect(told).toHaveLength(1);
    expect(await stored(session.id)).toBe(0);
  });

  it("never reaches the listener from a device-only session, however Settings is set", async () => {
    const flags = createBehaviourFlagStore(join(directory, "b.json"), {});
    flags.set(KEY, "on");
    const { session, credential } = await begin(
      "va-setting-local",
      "device-only",
    );
    const told: VoiceActivityHeard[] = [];
    expect(await report(flags, credential, told)).toMatchObject({
      status: "refused",
      code: "voice_activity_off",
    });
    expect(told).toEqual([]);
    expect(await stored(session.id)).toBe(0);
  });

  it("stays off when the host set it off, whatever Settings holds, and Settings cannot change it", async () => {
    const file = join(directory, "c.json");
    createBehaviourFlagStore(file, {}).set(KEY, "on");
    const flags = createBehaviourFlagStore(file, { [KEY]: "off" });
    const { credential } = await begin("va-setting-host-off");
    const told: VoiceActivityHeard[] = [];
    expect(flags.set(KEY, "on")).toBe("environment");
    expect(await report(flags, credential, told)).toMatchObject({
      status: "refused",
      code: "voice_activity_off",
    });
    expect(told).toEqual([]);
  });

  it("is on when the host set it on, with nothing stored", async () => {
    const flags = createBehaviourFlagStore(join(directory, "d.json"), {
      [KEY]: "on",
    });
    const { credential } = await begin("va-setting-host-on");
    const told: VoiceActivityHeard[] = [];
    expect((await report(flags, credential, told)).status).toBe("accepted");
    expect(told).toHaveLength(1);
  });

  it("treats a switch that answers anything but true as off", async () => {
    const { credential } = await begin("va-setting-odd");
    const told: VoiceActivityHeard[] = [];
    const ack = await ingestObservation(
      fx.member,
      credential,
      fx.tenantA,
      activity("microphone", true),
      {
        voiceActivity: (() => "on") as unknown as () => boolean,
        onActivity: (heard) => told.push(heard),
      },
    );
    expect(ack).toMatchObject({
      status: "refused",
      code: "voice_activity_off",
    });
    expect(told).toEqual([]);
  });
});

describe("a voice-activity report", () => {
  it("is told to the listener with its source and session, and nothing is stored or stamped", async () => {
    const { person, session, credential } = await begin("va-ann");
    const where = {
      tenantId: fx.tenantA,
      actorId: person.id,
      sessionId: session.id,
    };
    const told: VoiceActivityHeard[] = [];
    const started = await telling(
      credential,
      activity("application-audio", true),
      { told },
    );
    const stopped = await telling(credential, activity("microphone", false), {
      told,
    });
    expect(started.ack).toMatchObject({
      status: "accepted",
      eventId: "voice-activity",
      control: { state: "active" },
    });
    expect(stopped.ack.status).toBe("accepted");
    expect(told).toEqual([
      { source: "application-audio", speaking: true, session: where },
      { source: "microphone", speaking: false, session: where },
    ]);
    // [SAFETY] A transient signal: no observation, and not the contact stamp,
    // so the heartbeat that follows at once is not spaced out by it.
    expect(await stored(session.id)).toBe(0);
    expect(await contactOf(session.id)).toBeNull();
    const beat = await ingestObservation(fx.member, credential, fx.tenantA, {
      version: 1,
      kind: "heartbeat",
      sourceId: "companion",
      sentAt: "2026-10-03T10:00:05.000Z",
      capturing: true,
    });
    expect(beat.status).toBe("accepted");
  });

  it("is refused voice_activity_off, and told to nobody, while the switch is off", async () => {
    const { session, credential } = await begin("va-off");
    for (const on of [false, undefined]) {
      const told: VoiceActivityHeard[] = [];
      const ack = await ingestObservation(
        fx.member,
        credential,
        fx.tenantA,
        activity("application-audio", true),
        {
          ...(on === undefined ? {} : { voiceActivity: on }),
          onActivity: (heard) => told.push(heard),
        },
      );
      expect(ack).toMatchObject({
        status: "refused",
        code: "voice_activity_off",
        control: { state: "active" },
      });
      expect(told).toEqual([]);
    }
    expect(await stored(session.id)).toBe(0);
  });

  it("never reaches the listener from a device-only session, switch on or not", async () => {
    const { session, credential } = await begin("va-local", "device-only");
    const { ack, told } = await telling(
      credential,
      activity("application-audio", true),
    );
    expect(ack).toMatchObject({
      status: "refused",
      code: "voice_activity_off",
    });
    expect(told).toEqual([]);
    expect(await stored(session.id)).toBe(0);
  });

  it("stops being told once a remote session is tightened to device-only", async () => {
    const { person, session, credential } = await begin("va-tighten");
    const told: VoiceActivityHeard[] = [];
    expect(
      (await telling(credential, activity("microphone", true), { told })).ack
        .status,
    ).toBe("accepted");
    await repo.tightenProcessingPolicy(
      scopeOf(person),
      session.id,
      "device-only",
    );
    expect(
      (await telling(credential, activity("microphone", true), { told })).ack,
    ).toMatchObject({ status: "refused", code: "voice_activity_off" });
    expect(told).toHaveLength(1);
  });

  it("needs the session's own credential: an unknown one, another tenant's and a message that names a session are refused", async () => {
    const mine = await begin("va-mine");
    const theirs = await begin(
      "va-theirs",
      "permitted-remote",
      undefined,
      fx.tenantB,
    );
    const unknown = `asc_${"A".repeat(43)}`;
    for (const credential of [unknown, theirs.credential, "not-a-credential"]) {
      const { ack, told } = await telling(
        credential,
        activity("application-audio", true),
      );
      expect(ack).toEqual({
        version: 1,
        status: "refused",
        code: "credential_refused",
      });
      expect(told).toEqual([]);
    }
    // [SAFETY] Identity is the credential's alone: a report cannot name the
    // session it is for, so it can never be aimed at someone else's.
    const aimed = await telling(
      mine.credential,
      activity("application-audio", true, { sessionId: theirs.session.id }),
    );
    expect(aimed.ack).toMatchObject({
      status: "refused",
      code: "invalid_observation",
      issues: [{ path: ["sessionId"], code: "identity_field_forbidden" }],
    });
    expect(aimed.told).toEqual([]);
    // Each credential tells its own session and no other.
    const told = (
      await telling(theirs.credential, activity("microphone", true), {
        tenant: fx.tenantB,
      })
    ).told;
    expect(told.map((heard) => heard.session.sessionId)).toEqual([
      theirs.session.id,
    ]);
  });

  it("is refused for an audio source the session did not register, and for anything that is not one", async () => {
    const { credential } = await begin("va-mic-only", "permitted-remote", [
      "microphone",
      "screen",
    ]);
    const call = await telling(credential, activity("application-audio", true));
    expect(call.ack).toMatchObject({
      status: "refused",
      code: "invalid_observation",
      issues: [{ path: ["source"], code: "invalid_value" }],
    });
    expect(call.told).toEqual([]);
    for (const envelope of [
      activity("screen", true),
      activity("microphone", true, { levelDb: -30 }),
      { ...activity("microphone", true), speaking: "yes" },
      { ...activity("microphone", true), version: 2 },
    ]) {
      const { ack, told } = await telling(credential, envelope);
      expect(ack.status).toBe("refused");
      expect(told).toEqual([]);
    }
    expect(
      (await telling(credential, activity("microphone", true))).told,
    ).toHaveLength(1);
  });

  it("is refused with the session's standing while it is paused or ended", async () => {
    const { person, session, credential } = await begin("va-paused");
    await repo.controlSession(scopeOf(person), session.id, "pause");
    const paused = await telling(credential, activity("microphone", true));
    expect(paused.ack).toMatchObject({
      status: "refused",
      code: "session_paused",
      control: { state: "paused" },
    });
    expect(paused.told).toEqual([]);
    await repo.controlSession(scopeOf(person), session.id, "end");
    const ended = await telling(credential, activity("microphone", true));
    expect(ended.ack).toMatchObject({ status: "refused" });
    expect(ended.told).toEqual([]);
  });

  it("is bounded per session and minute, and one session's reports do not use up another's", async () => {
    const first = await begin("va-rate-a");
    const second = await begin("va-rate-b");
    const gate = createVoiceActivityGate();
    const send = (credential: string) =>
      telling(credential, activity("microphone", true), {
        gate,
        perMinute: 3,
      });
    const acks = [];
    for (let at = 0; at < 4; at += 1)
      acks.push((await send(first.credential)).ack);
    expect(acks.map((ack) => ack.status)).toEqual([
      "accepted",
      "accepted",
      "accepted",
      "refused",
    ]);
    expect(acks[3]).toMatchObject({ code: "rate_limited" });
    expect((await send(second.credential)).ack.status).toBe("accepted");
  });
});

describe("the gate", () => {
  it("opens again a minute after the count began, and forgets the oldest session past its cap", () => {
    const gate = createVoiceActivityGate();
    expect(gate.allow("s", 0, 2)).toBe(true);
    expect(gate.allow("s", 10_000, 2)).toBe(true);
    expect(gate.allow("s", 59_999, 2)).toBe(false);
    expect(gate.allow("s", 60_000, 2)).toBe(true);
    // A clock that went back starts the count again rather than locking out.
    expect(gate.allow("s", 100, 2)).toBe(true);
    for (let at = 0; at < 400; at += 1) gate.allow(`other-${at}`, 0, 2);
    expect(gate.allow("s", 200, 2)).toBe(true);
    expect(gate.allow("zero", 0, 0)).toBe(false);
  });
});

// ---- Over HTTP, and end to end. -------------------------------------------

const resolveContext = async (): Promise<PlatformContext | null> => null;
const base = () => `http://studio.test/api/interview/t/${slug}/sessions`;

function studio(on: boolean | (() => boolean) = true) {
  // The coach's transcript as the running Studio holds it, fed by the very
  // listener the Studio gives its routes.
  const transcript = createCoachTranscript();
  const app = createSessionRoutes({
    database: fx.member,
    resolveContext,
    voiceActivity: on,
    onActivity: tellCoachWhoSpeaks(transcript),
  });
  const send = (authorization: string | null, envelope: unknown) =>
    app.request(`${base()}/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(envelope),
    });
  return { transcript, send };
}

describe("the ingest route", () => {
  it("takes a report under the session credential alone, and refuses the API token, no credential and a query string", async () => {
    const { credential } = await begin("va-http");
    const { transcript, send } = studio();
    // Not known until a source says so.
    expect(transcript.since().speaking).toBeUndefined();
    for (const authorization of [
      null,
      "Bearer some-interview-api-token",
      `Bearer asc_${"B".repeat(43)}`,
    ]) {
      const refused = await send(
        authorization,
        activity("application-audio", true),
      );
      expect(refused.status).toBe(401);
      expect(await refused.json()).toMatchObject({
        status: "refused",
        code: "credential_refused",
      });
    }
    expect(transcript.since().speaking).toBeUndefined();

    const taken = await send(
      `Bearer ${credential}`,
      activity("application-audio", true),
    );
    expect(taken.status).toBe(200);
    expect(await taken.json()).toMatchObject({
      status: "accepted",
      eventId: "voice-activity",
    });
    expect(transcript.since().speaking).toEqual(["interviewer"]);
    await send(`Bearer ${credential}`, activity("microphone", true));
    expect(transcript.since().speaking).toEqual(["interviewer", "candidate"]);
    await send(`Bearer ${credential}`, activity("application-audio", false));
    expect(transcript.since().speaking).toEqual(["candidate"]);
  });

  it("answers voice_activity_off as a refusal the companion can read, and tells the coach nothing", async () => {
    const { credential } = await begin("va-http-off");
    const { transcript, send } = studio(false);
    const refused = await send(
      `Bearer ${credential}`,
      activity("application-audio", true),
    );
    expect(await refused.json()).toMatchObject({
      status: "refused",
      code: "voice_activity_off",
      control: { state: "active" },
    });
    expect(transcript.since().speaking).toBeUndefined();
  });

  it("asks the stored setting at every report: one running Studio refuses, then takes, with no restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "voice-activity-http-"));
    try {
      const KEY = "ACTIVE_SESSION_VOICE_ACTIVITY";
      const flags = createBehaviourFlagStore(join(directory, "f.json"), {});
      const { credential } = await begin("va-http-setting");
      const { transcript, send } = studio(() => flags.value(KEY) === "on");
      const report = () =>
        send(`Bearer ${credential}`, activity("application-audio", true));
      expect(await (await report()).json()).toMatchObject({
        status: "refused",
        code: "voice_activity_off",
      });
      expect(transcript.since().speaking).toBeUndefined();
      flags.set(KEY, "on");
      expect(await (await report()).json()).toMatchObject({
        status: "accepted",
        eventId: "voice-activity",
      });
      expect(transcript.since().speaking).toEqual(["interviewer"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

// A voice, near enough, as mono samples: a 140 Hz tone with harmonics cut
// into syllables (180 ms voiced, 70 ms nearly silent). The same generator as
// the detector's own tests.
const RATE = 16_000;
function voice(ms: number, level: number): number[] {
  return Array.from({ length: (RATE * ms) / 1000 }, (_, at) => {
    const t = at / RATE;
    const voiced = (t * 1000) % 250 < 180 ? 1 : 0.003;
    return (
      voiced *
      level *
      (Math.sin(2 * Math.PI * 140 * t) + 0.5 * Math.sin(2 * Math.PI * 280 * t))
    );
  });
}
const quiet = (ms: number): number[] =>
  Array.from({ length: (RATE * ms) / 1000 }, (_, at) =>
    at % 2 ? 0.0002 : -0.0002,
  );

// [STRATEGY] The companion's side, in miniature and on a clock the test
// moves: 100 ms frames of audio go into the shared detector, and every 250 ms
// (the companion's pass) the shared reporter decides whether to say anything;
// what it says goes to the real route under the session credential. The feed
// is read after every pass, as the coach would read it.
async function play(
  run: ReturnType<typeof studio>,
  credential: string,
  source: VoiceActivitySource,
  signal: number[],
  options: { from?: number; sending?: (atMs: number) => boolean } = {},
) {
  const detector = createVoiceActivityDetector();
  const reporter = createVoiceActivityReporter();
  const from = options.from ?? Date.now();
  const frame = RATE / 10;
  const feed: { at: number; speaking: readonly string[] | undefined }[] = [];
  let sent = 0;
  for (let start = 0; start < signal.length; start += frame) {
    detector.push(signal.slice(start, start + frame), RATE);
    const at = ((start + frame) / RATE) * 1000;
    vi.setSystemTime(from + at);
    if (at % 250 !== 0 && at % 500 !== 0) continue;
    const say = reporter.next(detector.speaking, from + at);
    if (say !== undefined && (options.sending?.(at) ?? true)) {
      const response = await run.send(`Bearer ${credential}`, {
        ...activity(source, say),
        sentAt: new Date(from + at).toISOString(),
      });
      const ack = (await response.json()) as { status: string };
      if (ack.status === "accepted") {
        reporter.sent(say, from + at);
        sent += 1;
      } else reporter.failed(from + at);
    }
    feed.push({ at, speaking: run.transcript.since().speaking });
  }
  return { feed, sent, end: from + (signal.length / RATE) * 1000 };
}

const at = (
  feed: { at: number; speaking: readonly string[] | undefined }[],
  ms: number,
) => feed.find((entry) => entry.at >= ms)?.speaking;

describe("a voice on a session's audio, end to end", () => {
  it("makes the coach's feed say the interviewer is speaking while the call's audio carries a voice, and not before or after", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { credential } = await begin("va-e2e-call");
    const run = studio();
    const played = await play(run, credential, "application-audio", [
      ...quiet(1_000),
      ...voice(7_000, 0.08),
      ...quiet(2_000),
    ]);
    // Before the voice: the signal is known, and nobody is speaking.
    expect(at(played.feed, 500)).toEqual([]);
    expect(at(played.feed, 1_000)).toEqual([]);
    // Within half a second of the voice starting, and for all of its seven
    // seconds: longer than the lapse, so the keep-alives are what hold it.
    for (const ms of [1_500, 3_000, 5_000, 6_500, 7_750])
      expect(at(played.feed, ms), `at ${ms}`).toEqual(["interviewer"]);
    // Within a second of it stopping.
    expect(at(played.feed, 9_000)).toEqual([]);
    expect(played.feed.at(-1)?.speaking).toEqual([]);
    // A change, a keep-alive a second, a change: not a message per frame.
    expect(played.sent).toBeGreaterThanOrEqual(8);
    expect(played.sent).toBeLessThanOrEqual(11);
  });

  it("says the candidate is speaking for a voice on the microphone, each source on its own", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { credential } = await begin("va-e2e-mic");
    const run = studio();
    const call = await play(run, credential, "application-audio", [
      ...quiet(500),
      ...voice(1_500, 0.08),
    ]);
    expect(call.feed.at(-1)?.speaking).toEqual(["interviewer"]);
    const mic = await play(
      run,
      credential,
      "microphone",
      [...quiet(500), ...voice(1_500, 0.05), ...quiet(1_500)],
      { from: call.end },
    );
    // The call's voice was still standing when the microphone's began.
    expect(at(mic.feed, 1_000)).toEqual(["interviewer", "candidate"]);
    // The microphone said it stopped; the call's source said nothing more, so
    // its "speaking" is left to lapse.
    expect(mic.feed.at(-1)?.speaking).toEqual(["interviewer"]);
    vi.setSystemTime(mic.end + 5_001);
    expect(run.transcript.since().speaking).toEqual([]);
  });

  it("lets a speaking that is not kept alive lapse after 5 s, and not before", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { credential } = await begin("va-e2e-lapse");
    const run = studio();
    // The source is lost one and a half seconds into a voice: no keep-alive
    // and no "stopped" ever arrives.
    const played = await play(
      run,
      credential,
      "application-audio",
      [...quiet(500), ...voice(8_000, 0.08)],
      { sending: (ms) => ms <= 1_500 },
    );
    const last = played.feed.findLast((entry) => entry.at <= 1_500);
    expect(last?.speaking).toEqual(["interviewer"]);
    // Still standing 4.9 s after the last word from the source, gone at 5 s.
    expect(at(played.feed, 6_000)).toEqual(["interviewer"]);
    expect(at(played.feed, 6_750)).toEqual([]);
    expect(played.feed.at(-1)?.speaking).toEqual([]);
  });

  it("tells the coach nothing from a device-only session, however loud the voice", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { credential } = await begin("va-e2e-local", "device-only");
    const run = studio();
    const played = await play(run, credential, "application-audio", [
      ...quiet(500),
      ...voice(2_000, 0.2),
    ]);
    expect(played.sent).toBe(0);
    expect(played.feed.every((entry) => entry.speaking === undefined)).toBe(
      true,
    );
  });
});
