import { type AnyRelations, type EmptyRelations, sql } from "drizzle-orm";
import { drizzle, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgAsyncTransaction } from "drizzle-orm/pg-core";
import {
  getPlatformDatabase,
  type PlatformDatabase,
  withPoolClient,
} from "./connection.js";

export interface TenantContext {
  tenantId: string;
  actorId: string;
  productId?: string;
}
export type TenantDatabase<R extends AnyRelations = EmptyRelations> =
  PgAsyncTransaction<NodePgQueryResultHKT, R>;

// [SAFETY] The only way to get a tenant-scoped Drizzle handle. The handle is
// Drizzle's own transaction, typed by its relations parameter, so a nested
// db.transaction() becomes a savepoint instead of committing the outer unit
// of work. The tenant and actor are transaction-local settings, so row-level
// security applies to every query, and a pooled connection can never carry
// them into the next request.
export async function withTenant<T, R extends AnyRelations = EmptyRelations>(
  context: TenantContext,
  work: (db: TenantDatabase<R>) => Promise<T>,
  options: {
    relations?: R;
    schema?: Record<string, unknown>;
    database?: PlatformDatabase;
  } = {},
): Promise<T> {
  const database = options.database ?? getPlatformDatabase();
  return withPoolClient(database, (client) =>
    drizzle({
      client,
      ...(options.relations ? { relations: options.relations } : {}),
      ...(options.schema ? { schema: options.schema } : {}),
    }).transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.tenant_id', ${context.tenantId}, true), set_config('app.actor_id', ${context.actorId}, true)`,
      );
      if (context.productId !== undefined)
        await tx.execute(
          sql`select set_config('app.product_id', ${context.productId}, true)`,
        );
      return work(tx);
    }),
  );
}
