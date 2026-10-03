import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import type { PlatformDatabase } from "../connection.js";

// Every Drizzle table a schema module exports.
export function tablesOf(module: Record<string, unknown>): PgTable[] {
  return Object.values(module).filter((value): value is PgTable =>
    is(value, PgTable),
  );
}

// Where a migrated database disagrees with the Drizzle tables that declare it:
// a missing table or column, nullability, foreign-key names, policy names and
// row-level security. Empty when the schema files and the migrations agree.
export async function schemaDrift(
  database: PlatformDatabase,
  tables: readonly PgTable[],
): Promise<string[]> {
  const drift: string[] = [];
  for (const table of tables) {
    const config = getTableConfig(table);
    const name = `${config.schema ?? "public"}.${config.name}`;
    const relation = await database.query<{ rls: boolean }>(
      `SELECT c.relrowsecurity AS rls FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'r'`,
      [config.schema ?? "public", config.name],
    );
    const found = relation.rows[0];
    if (!found) {
      drift.push(`${name}: table missing`);
      continue;
    }
    if (found.rls !== config.enableRLS)
      drift.push(`${name}: row-level security ${found.rls ? "on" : "off"}`);

    const columns = new Map(
      (
        await database.query<{ column_name: string; is_nullable: string }>(
          `SELECT column_name, is_nullable FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2`,
          [config.schema ?? "public", config.name],
        )
      ).rows.map((row) => [row.column_name, row.is_nullable === "YES"]),
    );
    for (const column of config.columns) {
      const nullable = columns.get(column.name);
      if (nullable === undefined)
        drift.push(`${name}.${column.name}: column missing`);
      else if (nullable === column.notNull)
        drift.push(`${name}.${column.name}: nullability differs`);
    }

    // A foreign key is matched by its columns and the table they reference;
    // its name is checked only where the schema declares one.
    const constraints = (
      await database.query<{ name: string; shape: string }>(
        `SELECT con.conname AS name,
                (SELECT string_agg(a.attname, ',' ORDER BY k.i) FROM unnest(con.conkey) WITH ORDINALITY k(n, i)
                   JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n)
                || '>' || fn.nspname || '.' || fc.relname AS shape
           FROM pg_constraint con
           JOIN pg_class c ON c.oid = con.conrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_class fc ON fc.oid = con.confrelid
           JOIN pg_namespace fn ON fn.oid = fc.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2 AND con.contype = 'f'`,
        [config.schema ?? "public", config.name],
      )
    ).rows;
    for (const foreignKey of config.foreignKeys) {
      const reference = foreignKey.reference();
      const target = getTableConfig(reference.foreignTable);
      const shape = `${reference.columns.map((column) => column.name).join(",")}>${target.schema ?? "public"}.${target.name}`;
      const match = constraints.find(
        (constraint) => constraint.shape === shape,
      );
      if (!match) drift.push(`${name}: foreign key ${shape} missing`);
      else if (reference.name && reference.name !== match.name)
        drift.push(`${name}: foreign key ${shape} is ${match.name}`);
    }

    const policies = new Set(
      (
        await database.query<{ policyname: string }>(
          "SELECT policyname FROM pg_policies WHERE schemaname = $1 AND tablename = $2",
          [config.schema ?? "public", config.name],
        )
      ).rows.map((row) => row.policyname),
    );
    for (const policy of config.policies)
      if (!policies.has(policy.name))
        drift.push(`${name}: policy ${policy.name} missing`);
  }
  return drift;
}
