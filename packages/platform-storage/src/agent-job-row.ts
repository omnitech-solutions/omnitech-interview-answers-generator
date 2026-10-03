import type { AgentJob } from "@omnitech/agent-job-service";
import type {
  AgentJobStatus,
  AgentProfile,
} from "@omnitech/agent-runtime-contracts";

// One ai.agent_jobs row, as both job repositories read it.
export type JobRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  product_id: string;
  status: AgentJobStatus;
  profile_snapshot: AgentProfile;
  prompt_reference: string;
  result_reference: string | null;
  session_id: string | null;
  claimed_by: string | null;
  lease_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export function mapJob(row: JobRow): AgentJob {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    productId: row.product_id,
    status: row.status,
    profile: row.profile_snapshot,
    promptReference: row.prompt_reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.result_reference === null
      ? {}
      : { resultReference: row.result_reference }),
    ...(row.session_id === null ? {} : { sessionId: row.session_id }),
    ...(row.claimed_by === null ? {} : { claimedBy: row.claimed_by }),
    ...(row.lease_expires_at === null
      ? {}
      : { leaseExpiresAt: row.lease_expires_at }),
  };
}
