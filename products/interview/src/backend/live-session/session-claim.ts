// The worker's cross-tenant claim of Active Sessions. This is the one file that
// sets app.session_worker (rule:session-claim-setting; scripts/tenant-context-
// boundary.test.ts). Under it the database admits SELECT of every session and
// permits changing only lease and fence columns
// (rule:claim-writes-lease-and-fence-only), and the claim port projects tenant,
// owner and session ids only. U6 fills out the claim, renew and release queries
// on top of this wrapper.
import type { DatabaseClient, PlatformDatabase } from "@omnitech/database";

// [SAFETY] The explicit claim projection. It is read from the
// interview.active_session_claims view, which omits credential_hash, the
// sources snapshot, the links and the rehearsal fields, and this list names no
// column beyond it. A test pins both.
export const CLAIM_COLUMNS = [
  "id",
  "tenant_id",
  "owner_user_id",
  "status",
  "processing_policy",
  "retention_mode",
  "fence",
  "lease_holder_id",
  "lease_expires_at",
  "expires_at",
  "last_heartbeat_at",
  "credential_expires_at",
  "credential_revoked_at",
  "ended_at",
  "purge_started_at",
  "purged_at",
] as const;

export const CLAIM_SELECT = `SELECT ${CLAIM_COLUMNS.join(", ")} FROM interview.active_session_claims`;

// Runs `work` in a transaction with the claim setting on. The setting is
// transaction-local, so a pooled connection never carries it away. The worker
// acts as the owner only afterwards, in a separate actor-scoped transaction.
export function asSessionWorker<Result>(
  database: PlatformDatabase,
  work: (client: DatabaseClient) => Promise<Result>,
): Promise<Result> {
  return database.transaction(async (client) => {
    await client.query("SELECT set_config('app.session_worker', 'on', true)");
    return work(client);
  });
}
