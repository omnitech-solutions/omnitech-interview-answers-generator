// Ingest's credential lookup. This is the one file that sets
// app.session_credential_hash (rule:credential-lookup-policy;
// scripts/tenant-context-boundary.test.ts). The named select-only policy then
// admits the one live row of the route's tenant whose credential hash equals
// the setting; an unknown, expired, revoked or other-tenant credential finds no
// row, one refusal for all of them (rule:credential-strength). Identity comes
// from the row found, and every later read or write opens a separate
// actor-scoped transaction. U6 fills out the lookup query.
import type { DatabaseClient, PlatformDatabase } from "@omnitech/database";

// Runs `work` in the tenant the route names with the presented credential's
// hash set for this transaction only. The hash, never the credential, reaches
// the database, and neither is logged.
export function withCredentialLookup<Result>(
  database: PlatformDatabase,
  scope: { tenantId: string; credentialHash: string },
  work: (client: DatabaseClient) => Promise<Result>,
): Promise<Result> {
  return database.tenantTransaction(scope.tenantId, async (client) => {
    await client.query(
      "SELECT set_config('app.session_credential_hash', $1, true)",
      [scope.credentialHash],
    );
    return work(client);
  });
}
