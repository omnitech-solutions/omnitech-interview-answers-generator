import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  defaultLocalModelEnvironment,
  ensureLmStudioContext,
} from "./local-model.mjs";

const localEnvironment = {
  ...process.env,
  ...(await defaultLocalModelEnvironment()),
  NODE_ENV: process.env.NODE_ENV ?? "development",
  FAKE_AUTH_ENABLED: process.env.FAKE_AUTH_ENABLED ?? "true",
  NEXT_PUBLIC_FAKE_AUTH_ENABLED:
    process.env.NEXT_PUBLIC_FAKE_AUTH_ENABLED ?? "true",
  AUTH_SECRET:
    process.env.AUTH_SECRET ??
    "development-only-auth-secret-change-before-deployment",
  // The compose.yaml database, as its application role.
  DATABASE_URL: "postgresql://omnitech:omnitech@127.0.0.1:54320/omnitech",
  // This fallback is scoped to the local `pnpm dev` launcher. Production and
  // direct worker starts still require an explicitly configured secret.
  AGENT_PAYLOAD_SECRET:
    process.env.AGENT_PAYLOAD_SECRET ??
    "omnitech-local-agent-payload-secret-change-me",
};

// The interview assistant needs LM Studio's model loaded with enough context.
if (localEnvironment.LM_STUDIO_MODEL && !localEnvironment.AI_MODEL) {
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

for (const [workspace, command] of [
  ["@omnitech/database", "db:migrate"],
  ["@omnitech/platform-storage", "db:bootstrap"],
]) {
  const setup = spawnSync("pnpm", ["--filter", workspace, command], {
    env: localEnvironment,
    stdio: "inherit",
  });
  if (setup.status !== 0) {
    process.exit(setup.status ?? 1);
  }
}

for (const product of [
  "@omnitech/product-interview...",
  "@omnitech/product-presentation...",
]) {
  const build = spawnSync("pnpm", ["--filter", product, "build"], {
    env: localEnvironment,
    stdio: "inherit",
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

// The products rebuild their dist on save, so the web app reloads them.
const child = spawn(
  "pnpm",
  [
    "--parallel",
    "--filter",
    "@omnitech/interview-web",
    "--filter",
    "@omnitech/product-interview",
    "--filter",
    "@omnitech/product-presentation",
    "--filter",
    "@omnitech/terminal-gateway",
    "--filter",
    "@omnitech/agent-worker",
    "run",
    "dev",
  ],
  { env: localEnvironment, stdio: "inherit" },
);

// `pnpm dev:stop` finds this launcher through its recorded pid.
const stateFile = new URL("../.dev-local/state.json", import.meta.url);
mkdirSync(new URL("../.dev-local/", import.meta.url), { recursive: true });
writeFileSync(
  stateFile,
  JSON.stringify({ launcherPid: process.pid, childPid: child.pid }, null, 2),
);
const forgetState = () => rmSync(stateFile, { force: true });
process.once("exit", forgetState);

const forwardSignal = (signal) => child.kill(signal);
process.once("SIGINT", () => forwardSignal("SIGINT"));
process.once("SIGTERM", () => forwardSignal("SIGTERM"));

child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
