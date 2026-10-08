import { spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  defaultLocalModelEnvironment,
  ensureLmStudioContext,
} from "./local-model.mjs";
import { loadDevEnvironment } from "./dev-env.mjs";

const configuredEnvironment = loadDevEnvironment();
const localEnvironment = {
  ...configuredEnvironment,
  ...(await defaultLocalModelEnvironment(configuredEnvironment)),
  NODE_ENV: configuredEnvironment.NODE_ENV ?? "development",
  // The readable session story, with the words heard and answered, on this
  // machine's own terminal (set LOG_FORMAT=pretty or LOG_CONTENT=false in .env
  // to turn either off; production never writes content).
  LOG_FORMAT: configuredEnvironment.LOG_FORMAT ?? "story",
  LOG_CONTENT: configuredEnvironment.LOG_CONTENT ?? "true",
  LOG_LEVEL: configuredEnvironment.LOG_LEVEL ?? "debug",
  FAKE_AUTH_ENABLED: configuredEnvironment.FAKE_AUTH_ENABLED ?? "true",
  // Claude Code is the assistant and the screenshot analyser by default; LM
  // Studio is never required (set these in .env to change it).
  INTERVIEW_ASSISTANT_DEFAULT_MODEL:
    configuredEnvironment.INTERVIEW_ASSISTANT_DEFAULT_MODEL ?? "agent/claude-code",
  ACTIVE_SESSION_AGENT_PORT:
    configuredEnvironment.ACTIVE_SESSION_AGENT_PORT ?? "on",
  ACTIVE_SESSION_AGENT_PROFILE:
    configuredEnvironment.ACTIVE_SESSION_AGENT_PROFILE ?? "claude",
  NEXT_PUBLIC_FAKE_AUTH_ENABLED:
    configuredEnvironment.NEXT_PUBLIC_FAKE_AUTH_ENABLED ?? "true",
  AUTH_SECRET:
    configuredEnvironment.AUTH_SECRET ??
    "development-only-auth-secret-change-before-deployment",
  // The compose.yaml database, as its application role.
  DATABASE_URL: "postgresql://omnitech:omnitech@127.0.0.1:54320/omnitech",
  // This fallback is scoped to the local `pnpm dev` launcher. Production and
  // direct worker starts still require an explicitly configured secret.
  AGENT_PAYLOAD_SECRET:
    configuredEnvironment.AGENT_PAYLOAD_SECRET ??
    "omnitech-local-agent-payload-secret-change-me",
};

if (localEnvironment.INTERVIEW_ASSISTANT_DEFAULT_MODEL === "agent/claude-code") {
  console.log(
    `[dev] Studio assistant default: Claude Code (${localEnvironment.CLAUDE_ASSISTANT_MODEL ?? "sonnet"}, medium effort).`,
  );
}

// The local HTTP model needs enough context for generated answers and
// Active Session. DEV_SKIP_LM_STUDIO_LOAD=1 leaves LM Studio alone and lets
// it load the model on first use.
if (
  localEnvironment.LM_STUDIO_MODEL &&
  !localEnvironment.AI_MODEL &&
  !localEnvironment.DEV_SKIP_LM_STUDIO_LOAD
) {
  const contextTokens = await ensureLmStudioContext(
    localEnvironment.LM_STUDIO_MODEL,
    localEnvironment,
  );
  if (contextTokens)
    localEnvironment.ASSISTANT_CONTEXT_TOKENS = String(contextTokens);
}

// The on-device (WebGPU) model: served from a packed model directory and
// pinned by its manifest digest. Defaults to the sibling omnitech-on-device-llm
// checkout's packed model; without one the on-device model is not offered.
{
  const directory =
    localEnvironment.ON_DEVICE_MODEL_DIR ??
    new URL(
      "../../omnitech-on-device-llm/.cache/app-assets/model",
      import.meta.url,
    ).pathname;
  try {
    const pin = readFileSync(join(directory, "manifest.sha256"), "utf8").split(
      /\s+/,
    )[0];
    if (/^[a-f0-9]{64}$/.test(pin ?? "")) {
      localEnvironment.ON_DEVICE_MODEL_DIR = directory;
      localEnvironment.NEXT_PUBLIC_ON_DEVICE_MODEL_SHA256 ??= pin;
    }
  } catch {
    // No packed model: the picker simply leaves the on-device model out.
  }
}

// The database runs in Docker Compose; wait until it accepts connections.
const database = spawnSync(
  "docker",
  ["compose", "up", "--detach", "--wait", "postgres"],
  { stdio: "inherit" },
);
if (database.status !== 0) {
  process.exit(database.status ?? 1);
}

// Roles and grants (the owner/runtime split, ADR-0005 d4). The image's init
// script runs only on an EMPTY volume, so an existing volume is upgraded here
// instead: docker/postgres/ensure-roles.sql is idempotent, changes ownership
// and privileges only, and never touches data. It runs before the migration
// (so the owner exists) and after it (so new tables are granted).
function ensureDatabaseRoles() {
  const ensure = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "--single-transaction",
      "-q",
      "-U",
      "postgres",
      "-d",
      "omnitech",
      "-f",
      "-",
    ],
    {
      input: readFileSync(
        new URL("../docker/postgres/ensure-roles.sql", import.meta.url),
      ),
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  if (ensure.status !== 0) process.exit(ensure.status ?? 1);
}

ensureDatabaseRoles();
for (const [workspace, command, extraEnvironment] of [
  [
    "@omnitech/database",
    "db:migrate",
    // Only the migration gets the owner; the app never sees this URL.
    {
      DATABASE_OWNER_URL:
        "postgresql://omnitech_owner:omnitech_owner@127.0.0.1:54320/omnitech",
    },
  ],
  ["@omnitech/platform-storage", "db:bootstrap", {}],
]) {
  const setup = spawnSync("pnpm", ["--filter", workspace, command], {
    env: { ...localEnvironment, ...extraEnvironment },
    stdio: "inherit",
  });
  if (setup.status !== 0) {
    process.exit(setup.status ?? 1);
  }
  if (command === "db:migrate") ensureDatabaseRoles();
}

// The web app loads every workspace package from its dist, so build the
// whole graph it depends on (in dependency order) before it starts.
const build = spawnSync(
  "pnpm",
  ["--filter", "@omnitech/interview-web^...", "build"],
  { env: localEnvironment, stdio: "inherit" },
);
if (build.status !== 0) process.exit(build.status ?? 1);

// [DOMAIN] Everything the servers print also goes to .dev-local/dev.log (this
// run only, colours stripped), so a failure can be read after the terminal
// has scrolled past it, and by a tool that cannot see the terminal.
mkdirSync(new URL("../.dev-local/", import.meta.url), { recursive: true });
const devLog = createWriteStream(new URL("../.dev-local/dev.log", import.meta.url));
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
// The children write to pipes, so they are told to keep their colours.
const loggedEnvironment = process.env.NO_COLOR
  ? localEnvironment
  : { ...localEnvironment, FORCE_COLOR: localEnvironment.FORCE_COLOR ?? "1" };
const logged = { env: loggedEnvironment, stdio: ["inherit", "pipe", "pipe"] };
function tee(running) {
  for (const [stream, terminal] of [
    [running.stdout, process.stdout],
    [running.stderr, process.stderr],
  ])
    stream.on("data", (chunk) => {
      terminal.write(chunk);
      devLog.write(String(chunk).replace(ANSI, ""));
    });
  return running;
}

const child = tee(spawn(
  "pnpm",
  [
    "--parallel",
    "--filter",
    "@omnitech/interview-web",
    "--filter",
    "@omnitech/terminal-gateway",
    "--filter",
    "@omnitech/agent-worker",
    "run",
    "dev",
  ],
  logged,
));

// Every package and product rebuilds its dist on save through the root
// solution, so the web app never loads a stale build.
const watcher = tee(spawn(
  "pnpm",
  ["exec", "tsc", "-b", "tsconfig.json", "--watch", "--preserveWatchOutput"],
  logged,
));

// `pnpm dev:stop` finds this launcher through its recorded pid.
const stateFile = new URL("../.dev-local/state.json", import.meta.url);
mkdirSync(new URL("../.dev-local/", import.meta.url), { recursive: true });
writeFileSync(
  stateFile,
  JSON.stringify({ launcherPid: process.pid, childPid: child.pid }, null, 2),
);
const forgetState = () => rmSync(stateFile, { force: true });
process.once("exit", forgetState);

const forwardSignal = (signal) => {
  watcher.kill(signal);
  child.kill(signal);
};
// The watcher has no work of its own once the servers are gone.
process.once("exit", () => watcher.kill());
process.once("SIGINT", () => forwardSignal("SIGINT"));
process.once("SIGTERM", () => forwardSignal("SIGTERM"));

child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
