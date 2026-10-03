import type {
  AgentEvent,
  AgentJobStatus,
  AgentProfile,
} from "@omnitech/agent-runtime-contracts";

export interface AgentJob {
  id: string;
  tenantId: string;
  userId: string;
  productId: string;
  status: AgentJobStatus;
  profile: AgentProfile;
  promptReference: string;
  resultReference?: string;
  sessionId?: string;
  // [SAFETY] Immutable; set only by the session dispatch path. A private job
  // is visible and cancellable only by its creator (userId) or the worker.
  private: boolean;
  claimedBy?: string;
  leaseExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PersistedAgentEvent {
  jobId: string;
  sequence: number;
  event: AgentEvent;
  createdAt: Date;
}

export interface CreateAgentJob {
  // Optional caller-chosen id. Creation is idempotent on it: repeating a
  // create with the same id, tenant and creator returns the existing job.
  id?: string;
  // Only the session dispatch path may set this; the database refuses it
  // otherwise, and refuses changing it later.
  private?: boolean;
  tenantId: string;
  userId: string;
  productId: string;
  profile: AgentProfile;
  promptReference: string;
}

// The open transaction a create or resume hook runs in, so its work commits
// or rolls back with the job change (for example, locking a session row).
export interface JobTransaction {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

export interface CreateJobOptions {
  // Runs inside the creating transaction, after the tenant and actor are set
  // and before the insert. Throw to refuse the job.
  beforeInsert?: (transaction: JobTransaction) => Promise<void>;
}

export interface ResumeJobOptions {
  // Runs inside the resuming transaction before the job is touched. Return
  // false to refuse the resume.
  guard?: (transaction: JobTransaction) => Promise<boolean>;
}

// The user a request acts for. `null` is a caller with no user (the terminal
// gateway's service token): it sees no private job.
export type JobActor = string | null;

// "not-found" covers a job that does not exist and one the actor cannot see,
// so a refusal never confirms a private job's existence.
export type CancellationOutcome = "requested" | "already-ended" | "not-found";

// Everything a member's request does to a job, always inside its tenant and
// as an explicit actor: the actor is a required parameter so a caller that
// forgets it fails to compile instead of reading as nobody.
export interface AgentJobRepository {
  create(input: CreateAgentJob, options?: CreateJobOptions): Promise<AgentJob>;
  get(
    tenantId: string,
    actorId: JobActor,
    jobId: string,
  ): Promise<AgentJob | undefined>;
  eventsAfter(
    tenantId: string,
    actorId: JobActor,
    jobId: string,
    sequence: number,
  ): Promise<PersistedAgentEvent[]>;
  requestCancellation(
    tenantId: string,
    actorId: JobActor,
    jobId: string,
  ): Promise<CancellationOutcome>;
  requestResume(
    tenantId: string,
    actorId: JobActor,
    jobId: string,
    promptReference: string,
    options?: ResumeJobOptions,
  ): Promise<boolean>;
}

// [SAFETY] The isolated agent worker's view: it leases a job before it knows
// the tenant, then advances it by id. Only apps/agent-worker constructs one.
export interface AgentJobWorkerRepository {
  claim(workerId: string, leaseMs: number): Promise<AgentJob | undefined>;
  // A running job keeps its lease; otherwise another claimer would take it.
  // False means the job is no longer this worker's: stop and write nothing.
  renewLease(
    jobId: string,
    workerId: string,
    leaseMs: number,
  ): Promise<boolean>;
  get(tenantId: string, jobId: string): Promise<AgentJob | undefined>;
  // With a claimant, only that worker's job moves: the lease is the fence.
  transition(
    jobId: string,
    expected: readonly AgentJobStatus[],
    next: AgentJobStatus,
    claimant?: string,
  ): Promise<boolean>;
  // With a claimant, a write by a worker that no longer holds the job changes
  // nothing (appendEvent throws, so the caller stops).
  setSessionId(
    jobId: string,
    sessionId: string,
    claimant?: string,
  ): Promise<void>;
  setResultReference(
    jobId: string,
    reference: string,
    claimant?: string,
  ): Promise<void>;
  appendEvent(
    jobId: string,
    event: AgentEvent,
    claimant?: string,
  ): Promise<PersistedAgentEvent>;
}

export class AgentJobService {
  constructor(private readonly repository: AgentJobRepository) {}

  create(input: CreateAgentJob, options?: CreateJobOptions): Promise<AgentJob> {
    return this.repository.create(input, options);
  }

  get(
    tenantId: string,
    actorId: JobActor,
    jobId: string,
  ): Promise<AgentJob | undefined> {
    return this.repository.get(tenantId, actorId, jobId);
  }

  // A job that already ended counts as cancelled; one the actor cannot see
  // fails closed with the same error as one that does not exist.
  async cancel(
    tenantId: string,
    actorId: JobActor,
    jobId: string,
  ): Promise<CancellationOutcome> {
    const outcome = await this.repository.requestCancellation(
      tenantId,
      actorId,
      jobId,
    );
    if (outcome === "not-found") {
      throw new Error("Agent job was not found or cannot be cancelled.");
    }
    return outcome;
  }

  async resume(
    tenantId: string,
    actorId: JobActor,
    jobId: string,
    promptReference: string,
    options?: ResumeJobOptions,
  ): Promise<void> {
    if (
      !(await this.repository.requestResume(
        tenantId,
        actorId,
        jobId,
        promptReference,
        options,
      ))
    ) {
      throw new Error("Agent job was not found or cannot be resumed.");
    }
  }

  events(
    tenantId: string,
    actorId: JobActor,
    jobId: string,
    afterSequence = 0,
  ): Promise<PersistedAgentEvent[]> {
    return this.repository.get(tenantId, actorId, jobId).then((job) => {
      if (!job) throw new Error("Agent job was not found.");
      return this.repository.eventsAfter(
        tenantId,
        actorId,
        jobId,
        afterSequence,
      );
    });
  }
}
