import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
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
const bin = "/opt/homebrew/opt/postgresql@15/bin";

// This fixture owns its foreground postgres PID and its mkdtemp directory only.
// Readiness has a new bounded 10s budget; it changes no existing product policy.
export async function disposablePostgres() {
  const root = await mkdtemp(`${tmpdir()}/omnitech-assistant-pg-`);
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  execFileSync(
    `${bin}/initdb`,
    [
      "-D",
      `${root}/data`,
      "--auth=trust",
      "--username=fixture_owner",
      "--no-locale",
    ],
    { stdio: "pipe" },
  );
  const process = spawn(
    `${bin}/postgres`,
    ["-D", `${root}/data`, "-p", String(port), "-k", root, "-h", "127.0.0.1"],
    // macOS postgres aborts ("became multithreaded") without a valid locale.
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...globalThis.process.env, LC_ALL: "C" },
    },
  );
  let log = "";
  process.stdout.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  process.stderr.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  const config = {
    host: "127.0.0.1",
    port,
    user: "fixture_owner",
    database: "postgres",
  };
  const admin = new Pool(config);
  const deadline = Date.now() + 10_000;
  try {
    for (;;) {
      try {
        await admin.query("SELECT 1");
        break;
      } catch (error) {
        if (Date.now() >= deadline || process.exitCode !== null)
          throw new Error(`Fixture startup failed: ${log}`, { cause: error });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    await admin.query(
      "CREATE ROLE fixture_member LOGIN NOSUPERUSER NOBYPASSRLS",
    );
  } catch (error) {
    await admin.end();
    process.kill("SIGTERM");
    await once(process, "exit");
    await rm(root, { recursive: true, force: true });
    throw error;
  }
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
    root,
    pid: process.pid!,
    config,
    admin,
    member,
    database,
    worker,
    migrate: async (url: URL) => {
      await admin.query(await readFile(url, "utf8"));
      await admin.query(
        "GRANT USAGE ON SCHEMA interview TO fixture_member; GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA interview TO fixture_member",
      );
    },
    close: async () => {
      await member.end();
      await admin.end();
      const exited = once(process, "exit");
      process.kill("SIGTERM");
      await exited;
      await rm(root, { recursive: true, force: true });
    },
  };
}
