// `pnpm test:browser [playwright args]`: runs the live-session browser suite
// after checking what it needs, so a missing requirement is one clear message
// naming the fix instead of a stack trace from deep inside a fixture.
//
//   pnpm test:browser                       the whole suite
//   pnpm test:browser tests/smoke-web-end.spec.ts --project=chromium
//   E2E_HEADED=1 pnpm test:browser          watch the browser
//   E2E_STRICT=1 pnpm test:browser          pending claims fail the run
//   E2E_REBUILD=1 pnpm test:browser         force a fresh `next build`
//   E2E_BROWSER_CHANNEL=chrome ...          use the installed Google Chrome
//   E2E_SHARDS=1 pnpm test:browser          one process, one stack (no sharding)
//
// The whole suite runs as E2E_SHARDS parallel shards (by default one per two
// CPU cores, from 1 to 4; at most 8 when set by hand):
// the web app is built once, then each shard is its own Playwright process with
// its own stack (own PostgreSQL container, ports, worker and storage state).
// A run that names spec files, or uses --shard, --list, --ui or --debug, is one
// process: sharding is for the whole suite.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";

const require = createRequire(import.meta.url);
const problems = [];

try {
  execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    stdio: "ignore",
  });
} catch {
  problems.push(
    "Docker is not running. The suite starts a disposable PostgreSQL container (postgres:17-alpine); start Docker and rerun.",
  );
}

// The browsers Playwright downloads (`pnpm test:browser:install`). Chrome is
// only needed when E2E_BROWSER_CHANNEL=chrome.
const { chromium, webkit } = require("@playwright/test");
const missing = [];
if (process.env.E2E_BROWSER_CHANNEL !== "chrome") {
  if (!existsSync(chromium.executablePath())) missing.push("chromium");
}
if (!existsSync(webkit.executablePath())) missing.push("webkit");
if (missing.length > 0)
  problems.push(
    `Playwright browsers are not installed (${missing.join(", ")}). Run \`pnpm test:browser:install\` (it downloads Chromium and WebKit once).`,
  );

if (problems.length > 0) {
  console.error(
    `pnpm test:browser cannot run:\n - ${problems.join("\n - ")}\n(The suite also needs the workspace built: \`pnpm build\`.)`,
  );
  process.exit(1);
}

const args = process.argv.slice(2);
// How many shards this machine can carry when E2E_SHARDS does not say: each
// shard is a whole stack (PostgreSQL, the web app, the worker, two browsers),
// so it wants about two cores. A small machine (a 2-core CI runner) gets one
// process and no sharding; four stacks there starve each other into timeouts.
const cores = availableParallelism();
const fitting = Math.min(Math.max(Math.floor(cores / 2), 1), 4);
const requested = Number(process.env.E2E_SHARDS ?? fitting);
const shards = Number.isInteger(requested)
  ? Math.min(Math.max(requested, 1), 8)
  : fitting;
const oneProcess =
  shards === 1 ||
  args.some(
    (arg) =>
      !arg.startsWith("-") ||
      ["--shard", "--list", "--ui", "--debug"].some(
        (flag) => arg === flag || arg.startsWith(`${flag}=`),
      ),
  );

if (oneProcess) {
  const result = spawnSync("pnpm", ["exec", "playwright", "test", ...args], {
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

// Build once so the shards find the build current instead of racing N builds.
const prebuild = spawnSync("pnpm", ["exec", "tsx", "src/stack/prebuild.ts"], {
  stdio: "inherit",
});
if (prebuild.status !== 0) process.exit(prebuild.status ?? 1);

console.log(`[e2e] running ${shards} shards in parallel (${cores} cores)`);
const started = Date.now();
const codes = await Promise.all(
  Array.from({ length: shards }, (_, index) => runShard(index + 1)),
);
console.log(
  `[e2e] ${shards} shards finished in ${Math.round((Date.now() - started) / 1000)}s: ${codes.map((code, i) => `s${i + 1}=${code}`).join(" ")}`,
);
process.exit(codes.some((code) => code !== 0) ? 1 : 0);

// One shard: its own Playwright process (so its own stack and database), every
// output line prefixed with the shard so interleaved output stays readable.
function runShard(number) {
  return new Promise((resolve) => {
    const child = spawn(
      "pnpm",
      ["exec", "playwright", "test", `--shard=${number}/${shards}`, ...args],
      {
        env: { ...process.env, E2E_SHARD: String(number) },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    for (const stream of [child.stdout, child.stderr]) {
      let pending = "";
      stream.on("data", (chunk) => {
        const lines = (pending + chunk).split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) console.log(`[s${number}] ${line}`);
      });
      stream.on("end", () => {
        if (pending) console.log(`[s${number}] ${pending}`);
      });
    }
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}
