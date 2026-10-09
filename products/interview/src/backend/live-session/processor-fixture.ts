// Test support for the session processor suites: a fake engine that returns
// canned closed-schema output (and can be held mid-call), a trace collector, a
// replay helper that ingests the synthetic fixtures through the real ingest
// path, and a world that composes the real processor over the database
// fixture. Tests, not production code, import this.
import { randomUUID } from "node:crypto";
import type {
  Execution,
  Failure,
  ModelInput,
  StreamPart,
} from "@omnitech/ai-engine";
import type { CandidateMatrix } from "@omnitech/interview-contracts";
import { expect } from "vitest";
import { matrixSha256 } from "./context-snapshot";
import type { SessionAttachment, SessionEngine } from "./engine-call";
import { ingestObservation } from "./ingest";
import { createInterviewSessionPolicy } from "./interview-policy";
import type { Fixture, Person } from "./live-session-fixture";
import type { WorkspaceDraftKey } from "./mapping";
import { createSessionProcessor } from "./processor";
import type {
  SessionClaimPort,
  SessionProcessorOptions,
  SessionProcessorPorts,
  SessionStorePort,
} from "./processor-ports";
import { capturedText } from "./replay-evidence-fixture";
import { SYNTHETIC_MATRIX } from "./replay-fixture-matrix";
import type { ActiveSessionRepository } from "./repository";
import {
  createDatabaseClaimPort,
  createDatabaseStorePort,
} from "./session-ports";
import {
  CANNED_DRAFT,
  CANNED_LOGISTICS_DRAFT,
  FIXTURE_SOURCES,
  type FixtureSegment,
} from "./session-replay-fixtures";
import type { SessionTraceEvent, TraceSink } from "./trace";

// One call as the session put it to the engine, read back from what the
// engine was given, in the words a test wants to assert on.
export type SessionAsk = {
  profileId: string;
  system: string | undefined;
  prompt: string;
  schema: unknown;
  attachments: SessionAttachment[];
  policy: Execution["policy"];
  idempotencyKey: string | undefined;
  scope: Execution["scope"];
  permissions: readonly string[] | undefined;
  for: Execution["for"];
  traceId: string | undefined;
  signal: AbortSignal;
};
const textOf = (input: ModelInput, role: "system" | "user") => {
  const message = input.messages.find((entry) => entry.role === role);
  return message?.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
};
export const askOf = (input: ModelInput, execution: Execution): SessionAsk => ({
  profileId: input.profileId,
  system: textOf(input, "system"),
  prompt: textOf(input, "user") ?? "",
  schema: input.schema,
  attachments: input.messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      part.type === "attachment"
        ? [
            {
              id: part.id,
              kind: part.kind,
              name: part.name,
              reference: part.reference,
              ...(part.mediaType ? { mimeType: part.mediaType } : {}),
            },
          ]
        : [],
    ),
  ),
  policy: execution.policy,
  idempotencyKey: execution.idempotencyKey,
  scope: execution.scope,
  permissions: execution.permissions,
  for: execution.for,
  traceId: execution.traceId,
  signal: execution.signal,
});

export type EngineCall = {
  input: ModelInput;
  execution: Execution;
  options?: unknown;
};

export type FakeEngine = SessionEngine & {
  requests: SessionAsk[];
  // Every call exactly as the engine was handed it, for a suite that must see
  // a field the session should never send (a tool, an option).
  sent: EngineCall[];
  // Resolves once the engine has been called `count` times in total.
  called(count: number): Promise<void>;
  // Holds every call until release() is called.
  hold(): { release(): void };
  // Releases any hold still in place (test cleanup).
  releaseAll(): void;
  // The answer to one call, before it is streamed. A suite wraps this to
  // count, delay or replace an answer; every call goes through it.
  answer(ask: SessionAsk): Promise<{ result: unknown } | { failure: Failure }>;
};

const NO_USAGE = {
  status: "unavailable",
  reason: "not-reported",
  cost: { status: "unavailable", reason: "not-reported" },
} as const;

export function createFakeEngine(
  behaviour: {
    result?: (ask: SessionAsk) => unknown;
    // A typed failure ends the call failed, as the engine ends one.
    fail?: (ask: SessionAsk) => Failure | undefined;
    // A runtime whose answer was already on its way when the call was
    // cancelled: the answer is delivered anyway, so a suite can prove a late
    // result is refused at the fenced write.
    answersAfterCancel?: boolean;
  } = {},
): FakeEngine {
  const requests: SessionAsk[] = [];
  const waiters: Array<{ count: number; resolve: () => void }> = [];
  let gate: Promise<void> | null = null;
  let releaseGate: () => void = () => {};
  const notify = () => {
    for (const waiter of [...waiters])
      if (requests.length >= waiter.count) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
  };
  const engine: FakeEngine = {
    requests,
    sent: [],
    called: (count) =>
      requests.length >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => waiters.push({ count, resolve })),
    hold() {
      const release = () => {
        gate = null;
        releaseGate();
      };
      gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      return { release };
    },
    releaseAll() {
      gate = null;
      releaseGate();
    },
    async answer(ask) {
      requests.push(ask);
      notify();
      if (gate) await gate;
      const failure = behaviour.fail?.(ask);
      if (failure !== undefined) return { failure };
      return {
        result:
          behaviour.result?.(ask) ??
          (/\b(?:notice|salary|pay|compensation|available|availability|start|join|remote|onsite|hybrid)\b/i.test(
            capturedText(ask),
          )
            ? CANNED_LOGISTICS_DRAFT
            : CANNED_DRAFT),
      };
    },
    // Every stage reads the engine's stream (session-dispatch.ts): the canned
    // result is written as text in two parts, then done, exactly as a runtime
    // writes structured output. It goes through `answer`, so a suite that
    // wraps it (a hold, a count) still sees every call.
    async *stream(input, execution, options): AsyncGenerator<StreamPart> {
      engine.sent.push({
        input,
        execution,
        ...(options === undefined ? {} : { options }),
      });
      const answered = await engine.answer(askOf(input, execution));
      // A call cancelled while it was held ends as the engine ends one.
      if (execution.signal.aborted && !behaviour.answersAfterCancel) {
        yield { type: "cancelled" };
        return;
      }
      if ("failure" in answered) {
        yield { type: "failed", failure: answered.failure };
        return;
      }
      const text = JSON.stringify(answered.result) ?? "";
      const half = Math.ceil(text.length / 2);
      if (text.slice(0, half))
        yield { type: "text", text: text.slice(0, half) };
      if (text.slice(half)) yield { type: "text", text: text.slice(half) };
      yield {
        type: "done",
        value: answered.result as never,
        usage: NO_USAGE,
      };
    },
  };
  return engine;
}

// The failure a runtime or the engine ends a call with, for a suite that
// scripts one: `failed("refused", { refusal: "policy" })`.
export const failed = (
  code: Failure["code"],
  extra: Partial<Failure> = {},
): Failure => ({
  code,
  reason: "scripted failure",
  retryable:
    code === "unavailable" || code === "timeout" || code === "rate-limited",
  ...extra,
});

export type CollectedTrace = TraceSink & { events: SessionTraceEvent[] };
export function collectTraces(): CollectedTrace {
  const events: SessionTraceEvent[] = [];
  return { events, emit: (event) => events.push(event) };
}

// A fixture world: the database, a started session for one person, and a way
// to ingest synthetic segments through the real ingest path.
export type Ingestor = {
  credential: string;
  ingest(segment: FixtureSegment, text?: string): Promise<void>;
};

export function ingestorFor(
  fx: Fixture,
  tenant: string,
  credential: string,
): Ingestor {
  const sequences: Record<string, number> = {};
  return {
    credential,
    async ingest(segment, text) {
      const source = FIXTURE_SOURCES[segment.role];
      sequences[source.sourceId] = (sequences[source.sourceId] ?? 0) + 1;
      const ack = await ingestObservation(fx.member, credential, tenant, {
        version: 1,
        kind: "transcript.final",
        sourceId: source.sourceId,
        eventId: segment.eventId,
        occurredAt: "2026-10-03T10:00:00.000Z",
        sequence: sequences[source.sourceId],
        content: {
          speaker: source.speaker,
          text: text ?? segment.text,
          startMs: segment.startMs,
          endMs: segment.endMs,
          ...(segment.supersedes ? { supersedes: segment.supersedes } : {}),
        },
      });
      expect(ack.status).toBe("accepted");
    },
  };
}

export type StartedFor = {
  person: Person;
  scope: { tenantId: string; actorId: string };
  sessionId: string;
  ingestor: Ingestor;
};

// What a session may pin at start: a candidate-profile revision and one linked
// Workspace draft (see seedMatrixProfile and seedBriefingDraft).
export type SessionLinks = {
  profile?: { id: string; revision?: number };
  workspaceDraft?: WorkspaceDraftKey;
};

// An approved candidate-profile revision holding a real matrix and its real
// digest, arranged as the fixture owner for one person.
export async function seedMatrixProfile(
  fx: Fixture,
  tenant: string,
  actorId: string,
  options: {
    matrix?: CandidateMatrix;
    revision?: number;
    // Records this digest instead of the matrix's own (a tampered revision).
    sha256?: string;
  } = {},
): Promise<{ id: string; revision: number; sha256: string }> {
  const matrix = options.matrix ?? SYNTHETIC_MATRIX;
  const revision = options.revision ?? 1;
  const sha256 = options.sha256 ?? matrixSha256(matrix);
  const id = `matrix-profile-${randomUUID().slice(0, 8)}`;
  await fx.owner.query(
    "INSERT INTO interview.candidate_profiles(tenant_id,actor_id,product_id,id,name,revision) VALUES($1,$2,'omnitech.interview',$3,'Synthetic profile',$4)",
    [tenant, actorId, id, revision],
  );
  await fx.owner.query(
    "INSERT INTO interview.candidate_profile_revisions(tenant_id,actor_id,product_id,id,revision,name,sha256,matrix) VALUES($1,$2,'omnitech.interview',$3,$4,'Synthetic profile',$5,$6::jsonb)",
    [tenant, actorId, id, revision, sha256, JSON.stringify(matrix)],
  );
  return { id, revision, sha256 };
}

// A briefing draft with the given employer material and candidate preferences,
// arranged as the fixture owner at the given revision.
export async function seedBriefingDraft(
  fx: Fixture,
  tenant: string,
  actorId: string,
  profile: { id: string; revision: number },
  context: {
    candidatePreferences?: string;
    jobDescription?: string;
    employerNotes?: string;
    research?: string;
  },
  revision = 4,
): Promise<WorkspaceDraftKey> {
  const key = {
    workspaceId: `ws-${randomUUID().slice(0, 8)}`,
    artifactId: `art-${randomUUID().slice(0, 8)}`,
  };
  const value = {
    question: "Prepare the recruiter screen",
    notes: "",
    answer: null,
    briefing: {
      kind: "non-technical-briefing",
      title: "Recruiter screen",
      context: {
        company: "Example Corp",
        role: "Senior software engineer",
        stage: "recruiter",
        profile: { id: profile.id, revision: profile.revision },
        ...context,
      },
      questions: [],
    },
  };
  await fx.owner.query(
    "INSERT INTO interview.assistant_drafts(tenant_id,actor_id,product_id,workspace_id,artifact_id,revision,value) VALUES($1,$2,'omnitech.interview',$3,$4,$5,$6::jsonb)",
    [
      tenant,
      actorId,
      key.workspaceId,
      key.artifactId,
      revision,
      JSON.stringify(value),
    ],
  );
  return key;
}

export async function startSessionFor(
  fx: Fixture,
  repo: ActiveSessionRepository,
  tenant: string,
  name: string,
  processingPolicy: "device-only" | "permitted-remote" = "permitted-remote",
): Promise<StartedFor> {
  const person = await fx.provision(tenant, name);
  return startSessionForPerson(fx, repo, tenant, person, processingPolicy);
}

// Starts a session for an already provisioned person, so a profile or draft
// can be seeded for them first.
export async function startSessionForPerson(
  fx: Fixture,
  repo: ActiveSessionRepository,
  tenant: string,
  person: Person,
  processingPolicy: "device-only" | "permitted-remote" = "permitted-remote",
  links: SessionLinks = {},
): Promise<StartedFor> {
  const scope = { tenantId: tenant, actorId: person.id };
  const started = await repo.startSession(scope, {
    processingPolicy,
    captureSources: ["microphone", "application-audio"],
    ...links,
  });
  return {
    person,
    scope,
    sessionId: started.session.id,
    ingestor: ingestorFor(fx, tenant, started.credential.value),
  };
}

export type ProcessorBuild = {
  workerId: string;
  engine: SessionEngine;
  answeredBy?: SessionProcessorPorts["answeredBy"];
  trace?: TraceSink;
  options?: Partial<SessionProcessorOptions>;
  // Wraps the database store port, to inject faults or spy on scopes.
  wrapStore?: (store: SessionStorePort) => SessionStorePort;
  wrapClaim?: (claim: SessionClaimPort) => SessionClaimPort;
  policy?: SessionProcessorPorts["policy"];
  leaseMs?: number;
  // The cap and purge sweeps run on the first tick; most tests are not about
  // them and must not purge another test's leftovers, so they are off unless
  // asked for.
  sweeps?: boolean;
  // A virtual clock for timing replays; defaults to the wall clock.
  clock?: SessionProcessorPorts["clock"];
  // The coding path's runner and its device-local declaration.
  codeRunner?: SessionProcessorPorts["codeRunner"];
  runnerDeviceLocal?: boolean;
  agentEscalation?: SessionProcessorPorts["agentEscalation"];
  // The profile a screenshot dispatch is bound to (without it, images are
  // refused as vision_unavailable).
  visionProfileId?: string;
  // The job repository the store port creates and cancels jobs through.
  jobs?: NonNullable<Parameters<typeof createDatabaseStorePort>[1]>["jobs"];
  // How many of a session's newest actions a rebuilt run is seeded from.
  actionLimit?: number;
};

export function buildProcessor(fx: Fixture, build: ProcessorBuild) {
  const store = createDatabaseStorePort(fx.member, {
    ...(build.jobs ? { jobs: build.jobs } : {}),
    ...(build.actionLimit === undefined
      ? {}
      : { actionLimit: build.actionLimit }),
  });
  const claim = createDatabaseClaimPort(fx.member, {
    workerId: build.workerId,
    ...(build.leaseMs === undefined ? {} : { leaseMs: build.leaseMs }),
  });
  const swept: SessionClaimPort = build.sweeps
    ? claim
    : {
        ...claim,
        purgeCandidates: async () => [],
        capExpired: async () => [],
      };
  const ports: SessionProcessorPorts = {
    claim: build.wrapClaim ? build.wrapClaim(swept) : swept,
    store: build.wrapStore ? build.wrapStore(store) : store,
    engine: build.engine,
    ...(build.answeredBy ? { answeredBy: build.answeredBy } : {}),
    policy: build.policy ?? createInterviewSessionPolicy(),
    clock: build.clock ?? { nowMs: () => Date.now() },
    trace: build.trace ?? collectTraces(),
    ...(build.codeRunner ? { codeRunner: build.codeRunner } : {}),
    ...(build.runnerDeviceLocal === undefined
      ? {}
      : { runnerDeviceLocal: build.runnerDeviceLocal }),
    ...(build.agentEscalation
      ? { agentEscalation: build.agentEscalation }
      : {}),
    ...(build.visionProfileId
      ? { visionProfileId: build.visionProfileId }
      : {}),
  };
  return createSessionProcessor(ports, {
    workerId: build.workerId,
    settleMs: 0,
    sweepEveryMs: 3_600_000,
    ...build.options,
  });
}

export const NEVER_ABORTED = new AbortController().signal;

// Ticks until the processor reports idle (no work) twice in a row, letting
// every started dispatch finish between ticks.
export async function settle(
  processor: ReturnType<typeof createSessionProcessor>,
  maxTicks = 8,
): Promise<void> {
  for (let i = 0; i < maxTicks; i += 1) {
    const worked = await processor.tick(NEVER_ABORTED);
    await processor.idle();
    if (!worked) return;
  }
}

export const expireLease = (fx: Fixture, sessionId: string) =>
  fx.owner.query(
    "UPDATE interview.active_sessions SET lease_expires_at = now() - interval '1 second' WHERE id=$1",
    [sessionId],
  );

// A running private session job and the action naming it, arranged as the
// fixture owner (the processor of this loop creates no jobs).
export async function insertSessionJob(
  fx: Fixture,
  world: { person: Person; sessionId: string },
  tenant: string,
  status = "running",
): Promise<string> {
  const jobId = await fx.pg.owner.transaction(async (client) => {
    await client.query(
      "SELECT set_config('app.session_dispatch','on',true), set_config('app.actor_id',$1,true)",
      [world.person.id],
    );
    const result = await client.query<{ id: string }>(
      `INSERT INTO ai.agent_jobs(tenant_id,user_id,product_id,status,profile_snapshot,prompt_reference,private)
       VALUES($1,$2,'omnitech.interview',$3,'{}','agent-payload:x',true) RETURNING id`,
      [tenant, world.person.id, status],
    );
    return String(result.rows[0]?.id);
  });
  await fx.owner.query(
    `INSERT INTO interview.session_actions(tenant_id,owner_user_id,session_id,task_id,task_revision,action_kind,fence_at_dispatch,job_id,job_created)
     VALUES($1,$2,$3,'job-task',1,'repair',1,$4,true)`,
    [tenant, world.person.id, world.sessionId, jobId],
  );
  return jobId;
}
