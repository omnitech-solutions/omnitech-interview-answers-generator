import pg, { type PoolClient, type QueryResult, type QueryResultRow } from "pg";

const { Pool } = pg;

export interface DatabaseClient {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface PlatformDatabase extends DatabaseClient {
  close(): Promise<void>;
  transaction<Result>(
    callback: (client: DatabaseClient) => Promise<Result>,
  ): Promise<Result>;
  tenantTransaction<Result>(
    tenantId: string,
    callback: (client: DatabaseClient) => Promise<Result>,
  ): Promise<Result>;
}

class PostgresDatabase implements PlatformDatabase {
  private readonly pool: InstanceType<typeof Pool>;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>> {
    return this.pool.query<Row>(text, values);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async transaction<Result>(
    callback: (client: DatabaseClient) => Promise<Result>,
  ): Promise<Result> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  tenantTransaction<Result>(
    tenantId: string,
    callback: (client: DatabaseClient) => Promise<Result>,
  ): Promise<Result> {
    return this.transaction(async (client) => {
      await enterTenant(client, { tenantId });
      return callback(client);
    });
  }

  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }
}

// [SAFETY] Scopes an already-open raw transaction to a tenant (and actor)
// that is only known after a query inside it — a share-token lookup, or a
// bootstrap that has just created the tenant. When the tenant is known up
// front, use tenantTransaction() or withTenant() instead. The settings are
// transaction-local (is_local = true), so they end with the transaction and a
// pooled connection never carries them into the next request; outside a
// transaction they lapse at the end of this one statement. ADR-0005 keeps
// this the only place outside withTenant() that sets them.
export async function enterTenant(
  client: { query(text: string, values: string[]): Promise<unknown> },
  context: { tenantId: string; actorId?: string },
): Promise<void> {
  if (context.actorId === undefined) {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [
      context.tenantId,
    ]);
    return;
  }
  await client.query(
    "SELECT set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true)",
    [context.tenantId, context.actorId],
  );
}

let database: PlatformDatabase | undefined;

export function createPlatformDatabase(
  connectionString = process.env["DATABASE_URL"],
): PlatformDatabase {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for platform persistence.");
  }
  return new PostgresDatabase(connectionString);
}

export function getPlatformDatabase(): PlatformDatabase {
  database ??= createPlatformDatabase();
  return database;
}

// Internal: a checked-out client for code inside this package (withTenant).
// Not exported from index.ts, so product code can never hold a raw client.
export async function withPoolClient<T>(
  database: PlatformDatabase,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!(database instanceof PostgresDatabase))
    throw new Error(
      "withPoolClient needs a database from createPlatformDatabase().",
    );
  return database.withClient(fn);
}

export type { PoolClient };
