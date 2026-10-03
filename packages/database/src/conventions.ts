import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  foreignKey,
  index,
  type PgColumn,
  pgPolicy,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Plain helpers for tenant-owned tables (see
// bionic/research/concepts/interview-domain-model.md). The platform tables
// are arguments, so this package never imports @omnitech/platform-storage.
export interface PlatformTables {
  tenants: { id: AnyPgColumn };
  users: { id: AnyPgColumn };
}

export const tenantPredicate = (tenantId: AnyPgColumn) =>
  sql`${tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`;
export const actorPredicate = (userId: AnyPgColumn) =>
  sql`${userId} = nullif(current_setting('app.actor_id', true), '')::uuid`;

export const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const tenantColumns = ({ tenants, users }: PlatformTables) => ({
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps(),
});

// USING and WITH CHECK both pin rows to the transaction's tenant.
export const tenantPolicy = (table: string, tenantId: AnyPgColumn) =>
  pgPolicy(`tenant_${table}`, {
    as: "permissive",
    for: "all",
    using: tenantPredicate(tenantId),
    withCheck: tenantPredicate(tenantId),
  });

// UNIQUE (tenant_id, id): the target of composite foreign keys.
export const tenantUnique = (table: string, tenantId: PgColumn, id: PgColumn) =>
  unique(`${table}_tenant_id_id_key`).on(tenantId, id);

// FOREIGN KEY (tenant_id, x_id) → parent (tenant_id, id): a row can never
// reference a row in another workspace. The index on the same columns keeps
// lookups by parent and cascading deletes from scanning the table.
export const tenantReference = (
  name: string,
  columns: [PgColumn, PgColumn],
  parent: [PgColumn, PgColumn],
  options: { onDelete?: "cascade" } = {},
) =>
  [
    options.onDelete
      ? foreignKey({ name, columns, foreignColumns: parent }).onDelete(
          options.onDelete,
        )
      : foreignKey({ name, columns, foreignColumns: parent }),
    index(name.replace(/_fkey$/, "_idx")).on(...columns),
  ] as const;
