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

export interface AgentJobRepository {
  create(input: CreateAgentJob): Promise<AgentJob>;
  get(tenantId: string, jobId: string): Promise<AgentJob | undefined>;
  setResultReference(jobId: string, reference: string): Promise<void>;
  setSessionId(jobId: string, sessionId: string): Promise<void>;
  claim(workerId: string, leaseMs: number): Promise<AgentJob | undefined>;
  transition(
    jobId: string,
    expected: readonly AgentJobStatus[],
    next: AgentJobStatus,
  ): Promise<boolean>;
  appendEvent(jobId: string, event: AgentEvent): Promise<PersistedAgentEvent>;
  eventsAfter(jobId: string, sequence: number): Promise<PersistedAgentEvent[]>;
  requestCancellation(tenantId: string, jobId: string): Promise<boolean>;
  requestResume(
    tenantId: string,
    jobId: string,
    promptReference: string,
  ): Promise<boolean>;
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
      return this.repository.eventsAfter(jobId, afterSequence);
    });
  }
}
