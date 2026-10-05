import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createPlatformDatabase, type PlatformDatabase } from "../connection";

const docker = promisify(execFile);

// The image compose.yaml runs, so tests see the same PostgreSQL as `pnpm dev`.
const image = "postgres:17-alpine";

// Checked once per test file: a missing or stopped Docker would otherwise show
// as a raw `execFile docker ENOENT` that names neither the cause nor the way
// around it.
let dockerReady: Promise<void> | undefined;
function requireDocker(): Promise<void> {
  dockerReady ??= docker("docker", [
    "version",
    "--format",
    "{{.Server.Version}}",
  ]).then(
    () => undefined,
    (error: NodeJS.ErrnoException & { stderr?: string }) => {
      const cause =
        error.code === "ENOENT"
          ? "the docker command is not installed or not on PATH"
          : `the Docker daemon did not answer (${(error.stderr ?? error.message).trim().split("\n")[0]})`;
      throw new Error(
        `These tests need Docker: they start a disposable PostgreSQL container (${image}), and ${cause}. Start Docker and rerun, or run the suites that do not need it with \`pnpm test:no-docker\`.`,
        { cause: error },
      );
    },
  );
  return dockerReady;
}

export interface DisposablePostgres {
  ownerUrl: string;
  memberUrl: string;
  owner: PlatformDatabase;
  stop(): Promise<void>;
}

// A throwaway PostgreSQL container for one test file, on a free local port
// with its data in memory. fixture_owner is the bootstrap superuser (it
// bypasses row-level security even under FORCE); fixture_member is NOSUPERUSER
// NOBYPASSRLS, like the application role.
export async function startDisposablePostgres(): Promise<DisposablePostgres> {
  await requireDocker();
  const { stdout } = await docker("docker", [
    "run",
    "--detach",
    "--rm",
    "--publish",
    "127.0.0.1::5432",
    "--tmpfs",
    "/var/lib/postgresql/data",
    "--env",
    "POSTGRES_USER=fixture_owner",
    "--env",
    "POSTGRES_DB=postgres",
    "--env",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    image,
    // Durability is irrelevant for a database that lives for one test file.
    "-c",
    "fsync=off",
    "-c",
    "synchronous_commit=off",
    "-c",
    "full_page_writes=off",
  ]);
  const container = stdout.trim();
  let owner: PlatformDatabase | undefined;
  // `docker stop` asks PostgreSQL for a smart shutdown and kills the
  // container if it has not exited within five seconds.
  const stop = async () => {
    await owner?.close().catch(() => undefined);
    await docker("docker", ["stop", "--time", "5", container]).catch(
      () => undefined,
    );
  };
  try {
    const { stdout: published } = await docker("docker", [
      "port",
      container,
      "5432/tcp",
    ]);
    const port = Number(published.trim().split("\n")[0]?.split(":").pop());
    const ownerUrl = `postgresql://fixture_owner@127.0.0.1:${port}/postgres`;
    const memberUrl = `postgresql://fixture_member@127.0.0.1:${port}/postgres`;
    // The one owner handle: it seeds and migrates, so it opts in to bypass.
    owner = createPlatformDatabase(ownerUrl, { allowRlsBypass: true });
    // The image initialises the cluster before it accepts TCP connections.
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        await owner.query("SELECT 1");
        break;
      } catch (error) {
        if (Date.now() >= deadline)
          throw new Error(`PostgreSQL container ${container} did not start`, {
            cause: error,
          });
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    await owner.query(
      "CREATE ROLE fixture_member LOGIN NOSUPERUSER NOBYPASSRLS",
    );
    return { ownerUrl, memberUrl, owner, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

// Gives the application role (fixture_member) what the deployed app role has:
// it may create schemas (the deployed role owns its database; pg-boss creates
// its own schema at start), plus usage on every migrated schema and read/write
// on its tables and sequences.
// Call it after migrateDatabase so an app under test runs as a role that row
// level security applies to, never as the superuser.
export async function grantApplicationRole(
  owner: PlatformDatabase,
): Promise<void> {
  await owner.query(`
    DO $grant$
    DECLARE schema_name text;
    BEGIN
      EXECUTE format('GRANT CREATE ON DATABASE %I TO fixture_member', current_database());
      FOR schema_name IN
        SELECT nspname FROM pg_namespace
        WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema'
      LOOP
        EXECUTE format('GRANT USAGE ON SCHEMA %I TO fixture_member', schema_name);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO fixture_member', schema_name);
        EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO fixture_member', schema_name);
      END LOOP;
    END
    $grant$`);
}

// A fresh database owned by fixture_app, a NOSUPERUSER NOBYPASSRLS role that
// may create roles (the migrations need it), like the deployed app role that
// runs migrations. Returns its connection URL.
export async function createMigratingApplicationDatabase(
  pg: DisposablePostgres,
  name: string,
): Promise<string> {
  await pg.owner.query(`
    DO $role$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fixture_app') THEN
        CREATE ROLE fixture_app LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE;
      END IF;
    END $role$`);
  await pg.owner.query(`CREATE DATABASE ${name} OWNER fixture_app`);
  return pg.memberUrl
    .replace("fixture_member", "fixture_app")
    .replace(/\/postgres$/, `/${name}`);
}
