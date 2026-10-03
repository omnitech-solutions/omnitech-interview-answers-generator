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
  tenantId: string;
  userId: string;
  productId: string;
  profile: AgentProfile;
  promptReference: string;
}

// Everything a member's request does to a job, always inside its tenant.
export interface AgentJobRepository {
  create(input: CreateAgentJob): Promise<AgentJob>;
  get(tenantId: string, jobId: string): Promise<AgentJob | undefined>;
  eventsAfter(
    tenantId: string,
    jobId: string,
    sequence: number,
  ): Promise<PersistedAgentEvent[]>;
  requestCancellation(tenantId: string, jobId: string): Promise<boolean>;
  requestResume(
    tenantId: string,
    jobId: string,
    promptReference: string,
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

  create(input: CreateAgentJob): Promise<AgentJob> {
    return this.repository.create(input);
  }

  get(tenantId: string, jobId: string): Promise<AgentJob | undefined> {
    return this.repository.get(tenantId, jobId);
  }

  async cancel(tenantId: string, jobId: string): Promise<void> {
    if (!(await this.repository.requestCancellation(tenantId, jobId))) {
      throw new Error("Agent job was not found or cannot be cancelled.");
    }
  }

  async resume(
    tenantId: string,
    jobId: string,
    promptReference: string,
  ): Promise<void> {
    if (
      !(await this.repository.requestResume(tenantId, jobId, promptReference))
    ) {
      throw new Error("Agent job was not found or cannot be resumed.");
    }
  }

  events(
    tenantId: string,
    jobId: string,
    afterSequence = 0,
  ): Promise<PersistedAgentEvent[]> {
    return this.repository.get(tenantId, jobId).then((job) => {
      if (!job) throw new Error("Agent job was not found.");
      return this.repository.eventsAfter(tenantId, jobId, afterSequence);
    });
  }
}
