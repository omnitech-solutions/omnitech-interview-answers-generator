import type { AnyRelations, EmptyRelations } from "drizzle-orm";
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
export type TenantDatabase<R extends AnyRelations = EmptyRelations> =
  NodePgDatabase<R>;

// [SAFETY] The only way to get a tenant-scoped Drizzle handle. The handle is
// typed by its relations parameter. One transaction carries the tenant and
// actor as transaction-local settings, so row-level security applies to every
// query, and a pooled connection can never carry them into the next request.
export async function withTenant<T, R extends AnyRelations = EmptyRelations>(
  context: TenantContext,
  work: (db: TenantDatabase<R>) => Promise<T>,
  options: {
    relations?: R;
    schema?: Record<string, unknown>;
    database?: PlatformDatabase;
  } = {},
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
          ...(options.relations ? { relations: options.relations } : {}),
          ...(options.schema ? { schema: options.schema } : {}),
        });
        const result = await work(db);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    },
  );
}
