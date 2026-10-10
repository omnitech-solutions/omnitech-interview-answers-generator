// Platform rows the interview host reads outside its own schema: persistence
// only, on the client the caller's transaction holds.
type Client = {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
};

// Memberships are tenant-owned rows: call inside the scope's tenant.
export async function tenantMembershipExists(
  client: Client,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const result = await client.query(
    "SELECT 1 FROM platform.tenant_memberships WHERE tenant_id::text=$1 AND user_id::text=$2",
    [tenantId, userId],
  );
  return result.rows.length > 0;
}

// Marks this transaction as the run worker's, for the worker's row policies.
export const markRunWorker = (client: Client) =>
  client.query("SELECT set_config('app.run_worker', 'on', true)");
