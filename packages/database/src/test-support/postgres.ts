import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import {
  createPlatformDatabase,
  type PlatformDatabase,
} from "../connection.js";

const bin =
  process.env["POSTGRES_BIN"] ?? "/opt/homebrew/opt/postgresql@15/bin";

export interface DisposablePostgres {
  ownerUrl: string;
  memberUrl: string;
  owner: PlatformDatabase;
  stop(): Promise<void>;
}

// A throwaway cluster for one test file.
// fixture_owner is the bootstrap superuser (it bypasses row-level security even
// under FORCE); fixture_member is NOSUPERUSER NOBYPASSRLS, like the application
// role must be.
export async function startDisposablePostgres(): Promise<DisposablePostgres> {
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
  const child = spawn(
    `${bin}/postgres`,
    ["-D", `${root}/data`, "-p", String(port), "-k", root, "-h", "127.0.0.1"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      // macOS postgres aborts ("became multithreaded") without a valid locale.
      env: { ...process.env, LC_ALL: "C" },
    },
  );
  let log = "";
  child.stdout.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  const ownerUrl = `postgresql://fixture_owner@127.0.0.1:${port}/postgres`;
  const memberUrl = `postgresql://fixture_member@127.0.0.1:${port}/postgres`;
  const owner = createPlatformDatabase(ownerUrl);
  const stop = async () => {
    await owner.close().catch(() => undefined);
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    await rm(root, { recursive: true, force: true });
  };
  const deadline = Date.now() + 10_000;
  try {
    for (;;) {
      try {
        await owner.query("SELECT 1");
        break;
      } catch (error) {
        if (Date.now() >= deadline || child.exitCode !== null)
          throw new Error(`Fixture startup failed: ${log}`, { cause: error });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    await owner.query(
      "CREATE ROLE fixture_member LOGIN NOSUPERUSER NOBYPASSRLS",
    );
  } catch (error) {
    await stop();
    throw error;
  }
  return { ownerUrl, memberUrl, owner, stop };
}
