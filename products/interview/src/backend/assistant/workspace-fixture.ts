import { createRequire } from "node:module";
import { migrateDatabase } from "@omnitech/database/migrate";
import { startDisposablePostgres } from "@omnitech/database/test-support";
import type {
  WorkspaceDatabasePort as DatabasePort,
  WorkspaceTransaction as Transaction,
} from "./workspace.js";

const require = createRequire(
  new URL(
    "../../../../../packages/platform-storage/package.json",
    import.meta.url,
  ),
);
interface FixtureClient {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}
interface FixturePool {
  query: FixtureClient["query"];
  connect(): Promise<FixtureClient>;
  end(): Promise<void>;
}
const { Pool } = require("pg") as { Pool: new (config: object) => FixturePool };

// The server lifecycle is the shared @omnitech/database fixture; this wraps it
// in pg pools and the workspace transaction helpers.
export async function disposablePostgres() {
  const server = await startDisposablePostgres();
  const owner = new URL(server.ownerUrl);
  const config = {
    host: owner.hostname,
    port: Number(owner.port),
    user: "fixture_owner",
    database: "postgres",
  };
  const admin = new Pool(config);
  const member = new Pool({ ...config, user: "fixture_member" });
  function transaction(
    pool: InstanceType<typeof Pool>,
    tenantId: string | undefined,
    fn: (tx: Transaction) => Promise<unknown>,
  ) {
    return (async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (tenantId !== undefined)
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [
            tenantId,
          ]);
        const result = await fn({
          query: async (sql, values) =>
            (await client.query(sql, values ? [...values] : undefined)).rows,
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    })();
  }
  const database: DatabasePort = {
    tenantTransaction: (tenant, fn) =>
      transaction(member, tenant, fn) as ReturnType<typeof fn>,
  };
  const worker = {
    transaction: <T>(fn: (tx: Transaction) => Promise<T>) =>
      transaction(admin, undefined, fn) as Promise<T>,
  };
  return {
    config,
    admin,
    member,
    database,
    worker,
    // The full current schema, as the app migrates it; the member role may
    // read and write Interview Studio's tables (never delete).
    migrate: async () => {
      await migrateDatabase(server.owner);
      await admin.query(
        "GRANT USAGE ON SCHEMA interview TO fixture_member; GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA interview TO fixture_member",
      );
    },
    close: async () => {
      await member.end();
      await admin.end();
      await server.stop();
    },
  };
}
