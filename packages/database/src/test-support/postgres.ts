import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createPlatformDatabase,
  type PlatformDatabase,
} from "../connection.js";

const docker = promisify(execFile);

// The image compose.yaml runs, so tests see the same PostgreSQL as `pnpm dev`.
const image = "postgres:17-alpine";

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
    owner = createPlatformDatabase(ownerUrl);
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
