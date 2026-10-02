import { getTableConfig, pgSchema, text, uuid } from "drizzle-orm/pg-core";
import { expect, it } from "vitest";
import {
  tenantColumns,
  tenantPolicy,
  tenantReference,
  tenantUnique,
} from "./conventions.js";

const platform = pgSchema("platform");
const tenants = platform.table("tenants", { id: uuid("id").primaryKey() });
const users = platform.table("users", { id: uuid("id").primaryKey() });
const s = pgSchema("s");
const parent = s.table.withRLS(
  "parent",
  { ...tenantColumns({ tenants, users }) },
  (t) => [
    tenantUnique("parent", t.tenantId, t.id),
    tenantPolicy("parent", t.tenantId),
  ],
);
const child = s.table.withRLS(
  "child",
  {
    ...tenantColumns({ tenants, users }),
    parentId: uuid("parent_id"),
    note: text("note"),
  },
  (t) => [
    tenantReference(
      "child_parent_fkey",
      [t.tenantId, t.parentId],
      [parent.tenantId, parent.id],
    ),
    tenantPolicy("child", t.tenantId),
  ],
);

it("gives tenant-owned tables the id, tenant, author, timestamps, unique key, policy and composite FK", () => {
  const p = getTableConfig(parent);
  expect(p.columns.map((c) => c.name).sort()).toEqual([
    "created_at",
    "created_by",
    "id",
    "tenant_id",
    "updated_at",
  ]);
  expect(p.uniqueConstraints.map((u) => u.columns.map((c) => c.name))).toEqual([
    ["tenant_id", "id"],
  ]);
  expect(p.policies.map((x) => x.name)).toEqual(["tenant_parent"]);
  expect(p.enableRLS).toBe(true);
  const c = getTableConfig(child);
  const composite = c.foreignKeys.find(
    (fk) => fk.getName() === "child_parent_fkey",
  );
  expect(composite).toBeDefined();
  expect(composite?.reference().columns.map((x) => x.name)).toEqual([
    "tenant_id",
    "parent_id",
  ]);
  expect(composite?.reference().foreignColumns.map((x) => x.name)).toEqual([
    "tenant_id",
    "id",
  ]);
});
