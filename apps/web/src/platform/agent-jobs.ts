// The platform's agent-job use cases behind agent-api.ts: which profiles a job
// may start with, who may start one for a product, and starting, reading and
// resuming a job through the engine's job service. No HTTP here; the web host
// submits and follows jobs and never starts a runtime (AGENTS rule 7).
import {
  AgentJobService,
  type AgentProfile,
  validateAgentProfile,
} from "@omnitech/ai-engine";
import { getPlatformDatabase } from "@omnitech/database";
import type {
  PlatformContext,
  ProductManifest,
} from "@omnitech/platform-contracts";
import { resolveAgentProfiles } from "@omnitech/platform-runtime/ai-config";
import {
  AgentPayloadStore,
  agentPayloadSecret,
  PostgresAgentJobRepository,
} from "@omnitech/platform-storage";

// The profiles a product may start a job with, by id; their definitions are
// central (@omnitech/platform-runtime/ai-config).
const JOB_PROFILES = [
  "coding-fast",
  "coding-quality",
  "document-quality",
  "presentation-editor",
] as const;

export function jobProfiles(): ReadonlyMap<string, AgentProfile> {
  const all = resolveAgentProfiles();
  return new Map(
    JOB_PROFILES.flatMap((id) => {
      const profile = all.get(id);
      return profile ? [[id, profile] as const] : [];
    }),
  );
}

// [SAFETY] A job is started for a product the member has installed and may
// use (INV-0004): the tenant's installation is enabled and the member holds
// the permission of at least one of the product's routes.
export function mayStartJobFor(
  member: Pick<PlatformContext, "products" | "permissions">,
  productId: string,
  registered: readonly { manifest: Pick<ProductManifest, "id" | "routes"> }[],
): boolean {
  const installed = member.products.some(
    (product) => product.productId === productId && product.enabled,
  );
  const product = registered.find(({ manifest }) => manifest.id === productId);
  const permitted = product?.manifest.routes.some((route) =>
    member.permissions.includes(route.requiredPermission),
  );
  return Boolean(installed && permitted);
}

/** The job service over the platform's store; no payloads without a secret. */
export function createAgentJobs() {
  const database = getPlatformDatabase();
  const repository = new PostgresAgentJobRepository(database);
  const secret = agentPayloadSecret(process.env);
  return {
    repository,
    service: new AgentJobService(repository),
    payloads: secret ? new AgentPayloadStore(database, secret) : undefined,
  };
}

type AgentJobs = ReturnType<typeof createAgentJobs>;
type Member = Pick<PlatformContext, "tenant" | "user">;

/** Keeps the prompt encrypted and queues the job; null for an unknown profile. */
export async function startJob(
  jobs: Pick<AgentJobs, "service"> & { payloads: AgentPayloadStore },
  member: Member,
  input: { productId: string; profileId: string; prompt: string },
) {
  const profile = jobProfiles().get(input.profileId);
  if (!profile) return null;
  validateAgentProfile(profile);
  const promptReference = await jobs.payloads.save(
    member.tenant.id,
    input.prompt,
  );
  return jobs.service.create({
    tenantId: member.tenant.id,
    userId: member.user.id,
    productId: input.productId,
    profile,
    promptReference,
  });
}

/** The member's job and, once it has one, its result; null when not theirs. */
export async function readJob(jobs: AgentJobs, member: Member, jobId: string) {
  const job = await jobs.service.get(member.tenant.id, member.user.id, jobId);
  if (!job) return null;
  let result: unknown;
  if (job.resultReference && jobs.payloads) {
    try {
      result = JSON.parse(await jobs.payloads.load(job.resultReference));
    } catch {
      result = undefined;
    }
  }
  return {
    id: job.id,
    status: job.status,
    ...(job.resultReference && result !== undefined ? { result } : {}),
  };
}

export async function resumeJob(
  jobs: Pick<AgentJobs, "service"> & { payloads: AgentPayloadStore },
  member: Member,
  jobId: string,
  prompt: string,
): Promise<void> {
  const promptReference = await jobs.payloads.save(member.tenant.id, prompt);
  await jobs.service.resume(
    member.tenant.id,
    member.user.id,
    jobId,
    promptReference,
  );
}
