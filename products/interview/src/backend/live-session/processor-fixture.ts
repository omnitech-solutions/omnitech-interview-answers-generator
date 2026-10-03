// Test support for the session processor suites: a fake gateway that returns
// canned closed-schema output (and can be held mid-call), a trace collector, a
// replay helper that ingests the synthetic fixtures through the real ingest
// path, and a world that composes the real processor over the database
// fixture. Tests, not production code, import this.
import type {
  AiExecution,
  AiExecutionGateway,
  AiExecutionRequest,
} from "@omnitech/ai-contracts";
import { expect } from "vitest";
import { ingestObservation } from "./ingest.js";
import { createInterviewSessionPolicy } from "./interview-policy.js";
import type { Fixture, Person } from "./live-session-fixture.js";
import { createSessionProcessor } from "./processor.js";
import type {
  SessionClaimPort,
  SessionProcessorOptions,
  SessionProcessorPorts,
  SessionStorePort,
} from "./processor-ports.js";
import { ActiveSessionRepository } from "./repository.js";
import {
  createDatabaseClaimPort,
  createDatabaseStorePort,
} from "./session-ports.js";
import {
  CANNED_DRAFT,
  FIXTURE_SOURCES,
  type FixtureSegment,
} from "./session-replay-fixtures.js";
import type { SessionTraceEvent, TraceSink } from "./trace.js";

export type FakeGateway = AiExecutionGateway & {
  requests: AiExecutionRequest[];
  // Resolves once the gateway has been called `count` times in total.
  called(count: number): Promise<void>;
  // Holds every call until release() is called.
  hold(): { release(): void };
  // Releases any hold still in place (test cleanup).
  releaseAll(): void;
};

export function createFakeGateway(
  behaviour: {
    result?: (request: AiExecutionRequest) => unknown;
    fail?: (request: AiExecutionRequest) => unknown | undefined;
  } = {},
): FakeGateway {
  const requests: AiExecutionRequest[] = [];
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
  const unsupported = () => {
    throw new Error("The fake gateway only executes.");
  };
  return {
    requests,
    called: (count) =>
      requests.length >= count
        ? Promise.resolve()
        : new Promise((resolve) => waiters.push({ count, resolve })),
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
    async execute<T = unknown>(
      request: AiExecutionRequest,
    ): Promise<AiExecution<T>> {
      requests.push(request);
      notify();
      if (gate) await gate;
      const failure = behaviour.fail?.(request);
      if (failure !== undefined) throw failure;
      return {
        executionId: `exec-${requests.length}`,
        family: "direct-model",
        targetId: "fake",
        result: (behaviour.result?.(request) ?? CANNED_DRAFT) as T,
      };
    },
    streamStructured: unsupported,
    stream: unsupported,
    cancel: async () => undefined,
    resume: unsupported,
    listAvailableTargets: async () => [],
  };
}

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

export async function startSessionFor(
  fx: Fixture,
  repo: ActiveSessionRepository,
  tenant: string,
  name: string,
  processingPolicy: "device-only" | "permitted-remote" = "permitted-remote",
): Promise<StartedFor> {
  const person = await fx.provision(tenant, name);
  const scope = { tenantId: tenant, actorId: person.id };
  const started = await repo.startSession(scope, {
    processingPolicy,
    captureSources: ["microphone", "application-audio"],
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
  gateway: AiExecutionGateway;
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
};

export function buildProcessor(fx: Fixture, build: ProcessorBuild) {
  const store = createDatabaseStorePort(fx.member);
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
    gateway: build.gateway,
    policy: build.policy ?? createInterviewSessionPolicy(),
    clock: { nowMs: () => Date.now() },
    trace: build.trace ?? collectTraces(),
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
