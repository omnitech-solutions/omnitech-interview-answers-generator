// The backend-only public entrypoint of the Active Session worker side
// (`@omnitech/product-interview/session-worker`). The worker app composes the
// gateway and its profiles itself and hands the gateway in; this entrypoint
// composes everything else - the cross-tenant claim, the owner-checked
// repository and fenced writes, the purge, the baseline interview policy and
// the processor - over the real PlatformDatabase. The claim lives in the
// product (session-claim.ts owns app.session_worker), so the worker app needs
// nothing from the cross-tenant worker storage entrypoint for sessions.
//
// It imports no Next.js and no frontend code, and never builds a gateway: the
// host builds one from the same profile and model configuration source as the
// web host and passes it in (rule:model-calls-gateway-routed).
import type { AiExecutionGateway } from "@omnitech/ai-contracts";
import type { PlatformDatabase } from "@omnitech/database";
import type { Clock } from "./core/index.js";
import type { AgentEscalationPort } from "./escalation.js";
import {
  createInterviewSessionPolicy,
  type InterviewSessionPolicy,
} from "./interview-policy.js";
import { createSessionProcessor, type SessionProcessor } from "./processor.js";
import type {
  SessionProcessorOptions,
  SessionProcessorPorts,
} from "./processor-ports.js";
import {
  createDatabaseClaimPort,
  createDatabaseStorePort,
  type DatabasePortOptions,
} from "./session-ports.js";
import type { SessionCodeRunner } from "./session-run.js";
import { createLoggerTraceSink, type TraceSink } from "./trace.js";

export {
  INTERVIEW_ANSWER_PROFILE,
  INTERVIEW_SESSION_DEVICE_PROFILE,
  INTERVIEW_SESSION_FAST_PROFILE,
} from "../../assistant-profile.js";
export type { AgentEscalationPort } from "./escalation.js";
export {
  SESSION_GATEWAY_CONTEXT,
  sessionGatewayContext,
} from "./gateway-context.js";
export {
  isOwnerInputProvenanceId,
  isSnapshotProvenanceId,
  parseSnapshotProvenanceId,
} from "./owner-input.js";
export type { SessionProcessor } from "./processor.js";
export type { SessionProcessorOptions } from "./processor-ports.js";
export {
  createSessionScreenshotLoader,
  loadVerifiedScreenshot,
  type SnapshotRead,
  type StoredSnapshot,
} from "./screenshot-loader.js";
export type { SessionCodeRunner } from "./session-run.js";
export { createSessionStillPermitted } from "./session-standing.js";
export {
  createLoggerTraceSink,
  type SessionTraceEvent,
  type TraceSink,
} from "./trace.js";

export type SessionWorkerOptions = Omit<SessionProcessorOptions, "workerId"> &
  Pick<DatabasePortOptions, "leaseMs" | "jobs" | "drafts"> & {
    database: PlatformDatabase;
    gateway: AiExecutionGateway;
    workerId: string;
    // Where id-only trace lines go; defaults to a no-op logger-free sink.
    trace?: TraceSink;
    // Convenience: build the default JSON-line sink over this logger.
    log?: (line: string) => void;
    policy?: InterviewSessionPolicy;
    clock?: Clock;
    // The sandboxed test runner for coding tasks (a DockerCodeRunner in the
    // agent worker). Absent: solutions publish with tests never claimed passed.
    codeRunner?: SessionCodeRunner;
    // The host declares the runner runs on the person's own device; without it
    // a device-only session never uses the runner.
    runnerDeviceLocal?: boolean;
    // The typed agent profiles and prompt store for escalation jobs. Absent:
    // an escalation request creates no job.
    agentEscalation?: AgentEscalationPort;
    // The gateway profile that serves a task carrying screenshots (an agent
    // profile whose runtime takes image input). Absent: such a task is refused.
    visionProfileId?: string;
    // Removes content the host staged outside the database after a purge.
    afterPurge?: SessionProcessorPorts["afterPurge"];
  };

export type SessionWorker = SessionProcessor;

const systemClock: Clock = { nowMs: () => Date.now() };

export function createSessionWorker(
  options: SessionWorkerOptions,
): SessionWorker {
  const {
    database,
    gateway,
    workerId,
    policy,
    clock,
    trace,
    log,
    codeRunner,
    runnerDeviceLocal,
    agentEscalation,
    visionProfileId,
    afterPurge,
    ...rest
  } = options;
  const portOptions: DatabasePortOptions = {
    workerId,
    ...(rest.leaseMs === undefined ? {} : { leaseMs: rest.leaseMs }),
    ...(rest.jobs === undefined ? {} : { jobs: rest.jobs }),
    ...(rest.drafts === undefined ? {} : { drafts: rest.drafts }),
  };
  const sink: TraceSink =
    trace ?? (log ? createLoggerTraceSink(log) : { emit: () => undefined });
  return createSessionProcessor(
    {
      claim: createDatabaseClaimPort(database, portOptions),
      store: createDatabaseStorePort(database, portOptions),
      gateway,
      policy: policy ?? createInterviewSessionPolicy(),
      clock: clock ?? systemClock,
      trace: sink,
      ...(codeRunner ? { codeRunner } : {}),
      ...(runnerDeviceLocal === undefined ? {} : { runnerDeviceLocal }),
      ...(agentEscalation ? { agentEscalation } : {}),
      ...(visionProfileId ? { visionProfileId } : {}),
      ...(afterPurge ? { afterPurge } : {}),
    },
    {
      workerId,
      ...(rest.maxSessions === undefined
        ? {}
        : { maxSessions: rest.maxSessions }),
      ...(rest.settleMs === undefined ? {} : { settleMs: rest.settleMs }),
      ...(rest.maxAttempts === undefined
        ? {}
        : { maxAttempts: rest.maxAttempts }),
      ...(rest.sweepEveryMs === undefined
        ? {}
        : { sweepEveryMs: rest.sweepEveryMs }),
      ...(rest.sweepBatch === undefined ? {} : { sweepBatch: rest.sweepBatch }),
      ...(rest.maxRenewFailures === undefined
        ? {}
        : { maxRenewFailures: rest.maxRenewFailures }),
      ...(rest.observationPage === undefined
        ? {}
        : { observationPage: rest.observationPage }),
      ...(rest.sweepOnly ? { sweepOnly: true } : {}),
    },
  );
}

// A gateway that refuses everything: the sweep-only worker never calls a model.
const refusingGateway: AiExecutionGateway = {
  async execute() {
    throw new Error("No model is configured.");
  },
  async *streamStructured() {
    throw new Error("No model is configured.");
  },
  async *stream() {
    throw new Error("No model is configured.");
  },
  async cancel() {},
  async *resume() {
    throw new Error("No model is configured.");
  },
  async listAvailableTargets() {
    return [];
  },
};

// The cap and purge sweeps alone, for a host with no language model: ended
// sessions still delete their observations (owner inputs included), artifacts
// and staged content. It claims no session and never calls a model.
export function createSessionSweeper(
  options: Omit<SessionWorkerOptions, "gateway" | "sweepOnly">,
): SessionWorker {
  return createSessionWorker({
    ...options,
    gateway: refusingGateway,
    sweepOnly: true,
    sweepEveryMs: options.sweepEveryMs ?? 30_000,
  });
}
