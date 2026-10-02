import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgresql://omnitech:omnitech@127.0.0.1:5432/omnitech",
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

for (const command of ["db:migrate", "db:bootstrap"]) {
  const setup = spawnSync(
    "pnpm",
    ["--filter", "@omnitech/platform-storage", command],
    { env: localEnvironment, stdio: "inherit" },
  );
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

const child = spawn(
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
