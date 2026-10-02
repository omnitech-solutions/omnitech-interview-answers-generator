import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  getPlatformDatabase,
  type PlatformDatabase,
  withPoolClient,
} from "./connection.js";

export interface TenantContext {
  tenantId: string;
  actorId: string;
}
export type TenantDatabase<S = Record<string, never>> = NodePgDatabase<any>;

// [SAFETY] The only way to get a tenant-scoped Drizzle handle. One transaction
// carries the tenant and actor as transaction-local settings, so row-level
// security applies to every query, and a pooled connection can never carry
// them into the next request.
export async function withTenant<T, S = Record<string, never>>(
  context: TenantContext,
  work: (db: TenantDatabase<S>) => Promise<T>,
  options: { schema?: S; database?: PlatformDatabase } = {},
): Promise<T> {
  return withPoolClient(
    options.database ?? getPlatformDatabase(),
    async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(
          "SELECT set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true)",
          [context.tenantId, context.actorId],
        );
        const db = drizzle({
          client,
          ...(options.schema ? { schema: options.schema } : {}),
        }) as unknown as TenantDatabase<S>;
        const result = await work(db);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    },
  );
}
