// Every Active Session call runs in an actor-scoped transaction for the session
// OWNER: tenant, actor and product are set by withTenant, so forced row
// security binds every query (rule:owner-checked-read-paths,
// rule:actor-private-session-rows).
import {
  type PlatformDatabase,
  type TenantDatabase,
  withTenant,
} from "@omnitech/database";
import type { SQL } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile.js";

export type OwnerScope = { tenantId: string; actorId: string };

export function inOwnerScope<Result>(
  database: PlatformDatabase,
  scope: OwnerScope,
  work: (tx: TenantDatabase) => Promise<Result>,
): Promise<Result> {
  return withTenant(
    {
      tenantId: scope.tenantId,
      actorId: scope.actorId,
      productId: INTERVIEW_PRODUCT_ID,
    },
    work,
    { database },
  );
}

export async function rowsOf<Row>(
  tx: TenantDatabase,
  statement: SQL,
): Promise<Row[]> {
  const result = await tx.execute(statement);
  return result.rows as unknown as Row[];
}

export async function firstRow<Row>(
  tx: TenantDatabase,
  statement: SQL,
): Promise<Row | undefined> {
  return (await rowsOf<Row>(tx, statement))[0];
}
