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
  private readonly allowRlsBypass: boolean;

  constructor(connectionString: string, allowRlsBypass: boolean) {
    this.allowRlsBypass = allowRlsBypass;
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  // [GUARD] The one role check of this handle: every entry below awaits it
  // first, so no path can serve a query as a role that skips row-level
  // security. A handle opted in with allowRlsBypass is never checked here.
  verifyRole(): Promise<void> {
    return this.allowRlsBypass
      ? Promise.resolve()
      : assertRowLevelSecurityApplies(this.pool);
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>> {
    await this.verifyRole();
    return this.pool.query<Row>(text, values);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async transaction<Result>(
    callback: (client: DatabaseClient) => Promise<Result>,
  ): Promise<Result> {
    await this.verifyRole();
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

  async tenantTransaction<Result>(
    tenantId: string,
    callback: (client: DatabaseClient) => Promise<Result>,
  ): Promise<Result> {
    return this.transaction(async (client) => {
      await setTenantContext(client, { tenantId });
      return callback(client);
    });
  }

  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    await this.verifyRole();
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
  client: TenantEntryClient,
  context: { tenantId: string; actorId?: string },
): Promise<void> {
  await assertRowLevelSecurityApplies(client);
  await setTenantContext(client, context);
}

async function setTenantContext(
  client: TenantEntryClient,
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

// What entering a tenant needs from a client: a `query`. Pooled pg clients
// answer with a QueryResult; host adapters (e.g. the workspace port) answer
// with the rows themselves, so the role check reads either shape.
export interface TenantEntryClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

const roleChecks = new WeakMap<TenantEntryClient, Promise<void>>();

// [GUARD] Fails closed: the role row always exists, so anything other than an
// explicit `bypass: false` is refused instead of waved through.
function refuseUnlessRlsApplies(result: unknown): void {
  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] } | null)?.rows ?? []);
  if ((rows[0] as { bypass?: unknown } | undefined)?.bypass !== false)
    throw new Error(roleBypassesRowLevelSecurityMessage);
}

// [GUARD] Superusers and BYPASSRLS roles skip every policy, even under FORCE,
// so tenant isolation would silently vanish. A database handle checks its role
// once before serving anything (see PostgresDatabase.verifyRole), and
// enterTenant checks the client it is given. The check is cached per pool (or
// per client), and a failed lookup is retried rather than cached. The refusal
// message is fixed: it never carries SQL, settings or data.
export const roleBypassesRowLevelSecurityMessage =
  "database access refused: the database role bypasses row-level security (superuser or BYPASSRLS); connect as a NOSUPERUSER NOBYPASSRLS role (tests: use the fixture's memberUrl after grantApplicationRole, never ownerUrl)";

function assertRowLevelSecurityApplies(
  client: TenantEntryClient,
): Promise<void> {
  let check = roleChecks.get(client);
  if (!check) {
    // Only a failed lookup is retried; a refusal stays cached.
    check = client
      .query(
        "select rolsuper or rolbypassrls as bypass from pg_roles where rolname = current_user",
      )
      .catch((error: unknown) => {
        roleChecks.delete(client);
        throw error;
      })
      .then(refuseUnlessRlsApplies);
    roleChecks.set(client, check);
  }
  return check;
}

let database: PlatformDatabase | undefined;

export interface PlatformDatabaseOptions {
  // Opt in to a role that bypasses row-level security (a superuser or
  // BYPASSRLS). Only an owner/bootstrap handle that seeds or administers data
  // may set it; application code never does. scripts/rls-role-guard.test.ts
  // allowlists every use, with its reason.
  allowRlsBypass?: true;
}

export function createPlatformDatabase(
  connectionString = process.env["DATABASE_URL"],
  options: PlatformDatabaseOptions = {},
): PlatformDatabase {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for platform persistence.");
  }
  return new PostgresDatabase(
    connectionString,
    options.allowRlsBypass === true,
  );
}

// Fails fast at process start: resolves when the handle's role is subject to
// row-level security (or the handle opted in), rejects with the fixed refusal
// message otherwise. The lookup is the handle's own memoised check.
export function verifyDatabaseRole(database: PlatformDatabase): Promise<void> {
  return database instanceof PostgresDatabase
    ? database.verifyRole()
    : assertRowLevelSecurityApplies(database);
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
