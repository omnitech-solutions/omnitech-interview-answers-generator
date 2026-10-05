// Starts and stops the real stack the specs drive, in ONE process:
//   disposable PostgreSQL (fixture) -> migrations -> member role -> bootstrap
//   -> control server (scripted model) -> agent worker (in-process) ->
//   `next start` of the production build -> signed-in storageState.
// Everything behind the browser is the product's own code; the only scripted
// part is the model (see control.ts). Teardown runs on success, failure and
// signal, so no container or child survives a run.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  grantApplicationRole,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
// The one sanctioned seam into the worker: its own entry point, with the
// runtimes map the worker's tests use (apps/agent-worker/src/main.test.ts).
import { runConfiguredAgentWorker } from "../../../../apps/agent-worker/src/main";
import { STACK_ENV, type StackConfig } from "./config";
import { ControlState, fakeRuntime, startControlServer } from "./control";
import { e2eDistDir } from "./dist-dir";
import { freePort } from "./ports";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "../../../..");
export const harnessRoot = resolve(here, "../..");
const webDir = join(repoRoot, "apps/web");
// One build directory per run when E2E_DIST_DIR is set (parallel runs must not
// share a build); the name must keep the `.next-e2e` prefix the guards, git and
// Biome already ignore.
const distDir = e2eDistDir();
const tenantSlug = "local";
// The coding answers run their tests in the repo's own runner image; the
// suite only uses TypeScript ones. `pnpm runner:build` builds it.
const RUNNER_IMAGES = ["omnitech/vitest-runner:latest"];

// This run's files (storage state, worker and web logs): a dot-directory, one
// folder per process, so concurrent runs never share a log.
const runDir = join(harnessRoot, ".stack", String(process.pid));

// Removes the folders of runs that are no longer alive (and the old shared
// worker.log), so `.stack` does not grow without bound. A folder whose process
// still runs belongs to a concurrent run and stays.
function sweepStaleRuns(): void {
  const root = join(harnessRoot, ".stack");
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isFile()) {
      rmSync(path, { force: true });
      continue;
    }
    const pid = Number(entry.name);
    let alive = false;
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        alive = true;
      } catch (error) {
        alive = (error as NodeJS.ErrnoException).code === "EPERM";
      }
    }
    if (!alive) rmSync(path, { recursive: true, force: true });
  }
}

const run = (cmd: string, args: string[], cwd = repoRoot) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8" });

// The requirements named in one message, so a missing one is a single clear
// failure rather than a raw ENOENT deep in a fixture.
export function preflight(): void {
  const problems: string[] = [];
  try {
    run("docker", ["version", "--format", "{{.Server.Version}}"]);
  } catch {
    problems.push(
      "Docker is not running: the harness starts a disposable PostgreSQL container (postgres:17-alpine).",
    );
  }
  if (!existsSync(join(repoRoot, "products/interview/dist/backend/index.js")))
    problems.push(
      "Workspace packages are not built: run `pnpm build` (the web app loads every package from dist).",
    );
  // The code runner starts its images with --pull=never: a missing image would
  // fail deep inside a coding-answer spec, so name the fix here.
  if (!problems.some((problem) => problem.startsWith("Docker"))) {
    const missing = RUNNER_IMAGES.filter((image) => {
      try {
        run("docker", ["image", "inspect", image]);
        return false;
      } catch {
        return true;
      }
    });
    if (missing.length)
      problems.push(
        `Code-runner images are missing (${missing.join(", ")}): run \`pnpm runner:build\` (the runner starts them with --pull=never).`,
      );
  }
  if (problems.length)
    throw new Error(
      `pnpm test:browser cannot start:\n - ${problems.join("\n - ")}`,
    );
}

// A stamp of everything the web build reads from source: commit, uncommitted
// edits and untracked files under the app, products and packages. A build
// whose stamp differs is rebuilt, so a spec never runs against stale code.
function sourceStamp(): string {
  const paths = ["apps/web", "products", "packages"];
  const hash = createHash("sha256");
  hash.update(run("git", ["rev-parse", "HEAD"]));
  hash.update(run("git", ["diff", "HEAD", "--", ...paths]));
  for (const file of run("git", [
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    ...paths,
  ])
    .split("\n")
    .filter(Boolean)) {
    hash.update(file);
    hash.update(readFileSync(join(repoRoot, file)));
  }
  // The web app imports the packages and products from their BUILT dist
  // (gitignored, so git cannot see a rebuild): hash every dist file's content.
  hash.update(distSignature());
  return hash.digest("hex");
}

// Content signature of every `dist` directory of packages/* and products/*.
function distSignature(): string {
  const hash = createHash("sha256");
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        hash.update(path);
        hash.update(readFileSync(path));
      }
    }
  };
  for (const group of ["packages", "products"]) {
    const groupDir = join(repoRoot, group);
    for (const name of readdirSync(groupDir).sort()) {
      const dist = join(groupDir, name, "dist");
      if (existsSync(dist)) walk(dist);
    }
  }
  return hash.digest("hex");
}

// What the web build reads from the environment (NEXT_PUBLIC_* is inlined into
// the bundle), shared by the stack and the shard prebuild so both build alike.
const webBuildEnv = {
  FAKE_AUTH_ENABLED: "true",
  NEXT_PUBLIC_FAKE_AUTH_ENABLED: "true",
  NEXT_DIST_DIR: distDir,
};

// Builds the web app once, before sharded runs start their own stacks, so the
// shards find the build current (their stamp matches) instead of racing N
// `next build`s into one directory. Run by scripts/run.mjs.
export function prebuildWeb(
  log: (line: string) => void = (line) => console.log(`[e2e] ${line}`),
): void {
  preflight();
  buildWeb({ ...process.env, ...webBuildEnv }, log);
}

function buildWeb(env: NodeJS.ProcessEnv, log: (line: string) => void): void {
  const stampFile = join(webDir, distDir, "e2e-stamp");
  const stamp = sourceStamp();
  const current =
    existsSync(stampFile) && readFileSync(stampFile, "utf8") === stamp;
  if (current && process.env["E2E_REBUILD"] !== "1") {
    log("web build is current");
    return;
  }
  // The OCR assets under apps/web/public/ocr are build inputs (gitignored):
  // copy them before every build so a fresh checkout builds.
  log("copying OCR assets ...");
  execFileSync("node", ["apps/web/scripts/copy-ocr-assets.mjs"], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  log("building the web app (next build) ...");
  execFileSync(
    "pnpm",
    ["--filter", "@omnitech/interview-web", "exec", "next", "build"],
    { cwd: repoRoot, env, stdio: "inherit" },
  );
  writeFileSync(stampFile, stamp);
}

async function waitFor(
  what: string,
  probe: () => Promise<boolean>,
  timeoutMs = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${what} did not become ready in ${timeoutMs} ms`);
}

// Signs in as the fake-auth local user over HTTP (no browser needed) and
// writes the cookies as a Playwright storageState.
async function signIn(webUrl: string, file: string): Promise<void> {
  const jar = new Map<string, string>();
  const keep = (response: Response) => {
    for (const line of response.headers.getSetCookie()) {
      const [pair = ""] = line.split(";");
      const at = pair.indexOf("=");
      if (at > 0) jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
  };
  const cookies = () =>
    [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  const csrfResponse = await fetch(`${webUrl}/api/auth/csrf`);
  keep(csrfResponse);
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
  const response = await fetch(`${webUrl}/api/auth/callback/local`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookies(),
    },
    body: new URLSearchParams({
      csrfToken,
      callbackUrl: `${webUrl}/t/${tenantSlug}`,
    }),
  });
  keep(response);
  const session = [...jar.keys()].find((name) =>
    name.includes("session-token"),
  );
  if (!session) throw new Error("fake sign-in did not set a session cookie");
  const { hostname } = new URL(webUrl);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      cookies: [...jar].map(([name, value]) => ({
        name,
        value,
        domain: hostname,
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      })),
      origins: [],
    }),
  );
}

export type Stack = { config: StackConfig; stop(): Promise<void> };

export async function startStack(
  log: (line: string) => void = (line) => console.log(`[e2e] ${line}`),
): Promise<Stack> {
  preflight();
  sweepStaleRuns();
  mkdirSync(runDir, { recursive: true });
  const workerLogPath = join(runDir, "worker.log");
  const webLogPath = join(runDir, "web.log");
  const cleanups: Array<() => Promise<void> | void> = [];
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    // Each step is bounded so one stuck step never keeps the container alive.
    for (const cleanup of cleanups.reverse())
      await Promise.race([
        Promise.resolve(cleanup()).catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 20_000)),
      ]);
  };
  const onSignal = () => void stop().finally(() => process.exit(130));
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  cleanups.push(() => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  });

  try {
    log("starting disposable PostgreSQL ...");
    const postgres: DisposablePostgres = await startDisposablePostgres();
    cleanups.push(() => postgres.stop());
    await migrateDatabase(postgres.owner);
    await grantApplicationRole(postgres.owner);

    // Throwaway secrets, generated per run.
    const secrets = {
      AUTH_SECRET: randomBytes(24).toString("hex"),
      AGENT_PAYLOAD_SECRET: randomBytes(24).toString("hex"),
    };
    const controlPort = await freePort();
    const webPort = await freePort();
    const controlUrl = `http://127.0.0.1:${controlPort}`;
    const webUrl = `http://127.0.0.1:${webPort}`;

    // The stack's environment: the member role (row-level security applies),
    // the fake sign-in, the agent port pinned to the scripted runtime, and a
    // loopback model endpoint declared on-device for the device-only path.
    const stackEnv: Record<string, string> = {
      DATABASE_URL: postgres.memberUrl,
      ...secrets,
      ...webBuildEnv,
      ACTIVE_SESSION_AGENT_PORT: "on",
      ACTIVE_SESSION_AGENT_PROFILE: "claude",
      // The real sandboxed test runner (Docker, the repo's runner images), so a
      // coding answer's tests, counts, failure messages and "fully verified"
      // are the server's own, not scripted.
      ACTIVE_SESSION_CODE_RUNNER: "docker",
      AI_BASE_URL: `${controlUrl}/v1`,
      AI_MODEL: "e2e-model",
      AI_API_KEY: "e2e-not-a-key",
      AI_LOCALITY: "device",
      AGENT_WORKER_POLL_MS: "50",
    };
    const childEnv = { ...process.env, ...stackEnv };

    log("bootstrapping the local tenant and user (member role) ...");
    execFileSync(
      "pnpm",
      ["--filter", "@omnitech/platform-storage", "run", "db:bootstrap"],
      { cwd: repoRoot, env: childEnv, stdio: "pipe" },
    );

    // The build is CPU heavy: finish it before the worker's 5 s connection
    // timeout can be starved by it.
    buildWeb(childEnv, log);

    const state = new ControlState();
    const server: Server = await startControlServer(state, controlPort);
    cleanups.push(
      () =>
        new Promise<void>((done) => {
          server.close(() => done());
          // Keep-alive connections (the worker's and the specs' fetches) would
          // hold close() open forever.
          server.closeAllConnections();
        }),
    );

    // The worker, in this process, with the scripted runtime at its seam.
    const abort = new AbortController();
    const worker = runConfiguredAgentWorker(
      { ...stackEnv, PATH: process.env["PATH"] },
      abort.signal,
      { "claude-code": fakeRuntime(state) },
      // Structured, content-free trace lines: kept in a file, not on the console.
      (line) => appendFileSync(workerLogPath, `${line}\n`),
    ).catch((error: unknown) => {
      if (!abort.signal.aborted)
        log(
          `worker stopped: ${error instanceof Error ? `${error.name}: ${error.message}` : "error"}`,
        );
    });
    cleanups.push(async () => {
      abort.abort();
      await Promise.race([
        worker,
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]);
    });

    log(`starting the web app on ${webUrl} ...`);
    // The web server's own stdout and stderr go to a file the privacy spec
    // reads, so a content leak into the server log cannot go unseen.
    const webLog = openSync(webLogPath, "a");
    cleanups.push(() => closeSync(webLog));
    const web: ChildProcess = spawn(
      "pnpm",
      [
        "--filter",
        "@omnitech/interview-web",
        "exec",
        "next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(webPort),
      ],
      {
        cwd: repoRoot,
        env: childEnv,
        stdio: ["ignore", webLog, webLog],
        detached: true,
      },
    );
    cleanups.push(() => {
      if (web.pid) {
        try {
          process.kill(-web.pid, "SIGTERM");
        } catch {}
      }
    });
    await waitFor("the web app", async () => {
      const response = await fetch(`${webUrl}/sign-in`);
      return response.ok;
    });

    const storageStatePath = join(runDir, "storage-state.json");
    await signIn(webUrl, storageStatePath);

    const config: StackConfig = {
      webUrl,
      controlUrl,
      problemUrl: `${controlUrl}/problem`,
      ownerUrl: postgres.ownerUrl,
      tenantSlug,
      storageStatePath,
      workerLogPath,
      webLogPath,
    };
    process.env[STACK_ENV] = JSON.stringify(config);
    log("stack ready");
    return { config, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
