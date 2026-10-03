import type { SQL } from "drizzle-orm";
import {
  getTableConfig,
  type PgColumn,
  PgDialect,
  pgSchema,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { expect, it } from "vitest";
import {
  actorPredicate,
  tenantColumns,
  tenantPolicy,
  tenantPredicate,
  tenantReference,
  tenantUnique,
} from "./conventions.js";
import * as index from "./index.js";

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
    ...tenantReference(
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
  expect(c.indexes.map((i) => i.config.name)).toContain("child_parent_idx");
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

const dialect = new PgDialect();
const render = (query: SQL | undefined) => {
  expect(query).toBeDefined();
  return dialect.sqlToQuery(query as SQL).sql;
};
const TENANT_SQL = `nullif(current_setting('app.tenant_id', true), '')::uuid`;
const ACTOR_SQL = `nullif(current_setting('app.actor_id', true), '')::uuid`;

it("pins USING and WITH CHECK to the same permissive all-commands tenant predicate", () => {
  const [policy] = getTableConfig(parent).policies;
  expect(policy?.for).toBe("all");
  expect(policy?.as).toBe("permissive");
  const using = render(policy?.using);
  const withCheck = render(policy?.withCheck);
  expect(withCheck).toBe(using);
  expect(using).toBe(
    render(tenantPredicate(getTableConfig(parent).columns[1] as PgColumn)),
  );
  expect(using).toContain(TENANT_SQL);
});

it("renders the actor predicate from app.actor_id", () => {
  const userId = getTableConfig(parent).columns[2] as PgColumn;
  expect(render(actorPredicate(userId))).toContain(ACTOR_SQL);
});

it("makes tenant_id a required cascading FK, created_by an author FK and id a defaulted key", () => {
  const { columns, foreignKeys } = getTableConfig(parent);
  const col = (name: string) => columns.find((c) => c.name === name);
  expect(col("tenant_id")?.notNull).toBe(true);
  expect(col("id")?.primary).toBe(true);
  expect(col("id")?.hasDefault).toBe(true);
  const fkOn = (name: string) =>
    foreignKeys.find((fk) => fk.reference().columns[0]?.name === name);
  const tenantFk = fkOn("tenant_id");
  expect(getTableConfig(tenantFk?.reference().foreignTable as never).name).toBe(
    "tenants",
  );
  expect(tenantFk?.onDelete).toBe("cascade");
  const authorFk = fkOn("created_by");
  expect(getTableConfig(authorFk?.reference().foreignTable as never).name).toBe(
    "users",
  );
});

it("names the composite target key <table>_tenant_id_id_key", () => {
  const [unique] = getTableConfig(parent).uniqueConstraints;
  expect(unique?.name).toBe("parent_tenant_id_id_key");
});

it("exposes exactly the convention helpers from the package entrypoint", () => {
  const exported = Object.keys(index)
    .filter(
      (key) => typeof (index as Record<string, unknown>)[key] === "function",
    )
    .filter(
      (key) =>
        ![
          "createPlatformDatabase",
          "getPlatformDatabase",
          "withTenant",
        ].includes(key),
    )
    .sort();
  expect(exported).toEqual(
    [
      "actorPredicate",
      "tenantColumns",
      "tenantPolicy",
      "tenantPredicate",
      "tenantReference",
      "tenantUnique",
      "timestamps",
    ].sort(),
  );
});
