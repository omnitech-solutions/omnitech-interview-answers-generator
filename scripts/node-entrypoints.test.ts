// Every app that plain Node runs directly must load: workspace sources import
// each other without file extensions, which `tsc` output cannot satisfy under
// Node ESM, so these entrypoints ship esbuild bundles
// (scripts/bundle-node-app.mjs; the CLI through tsup). Each test builds its own
// bundle in a scratch directory under the app's `dist/` (so external packages
// resolve from the app) and starts it under plain `node` with a deliberately
// bad environment. It asserts the program's own startup message, never a
// module-resolution error. Requires the workspace dist (`pnpm build`, which
// typecheck and test already depend on through turbo).
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { bundleNodeApp } from "./bundle-node-app.mjs";
import { repoRoot } from "./guard-support";

const spawnLimitMs = 15_000;
const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories)
    rmSync(directory, { recursive: true, force: true });
});

function scratch(appDir: string): string {
  const parent = join(appDir, "dist");
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, ".entrypoint-test-"));
  scratchDirectories.push(directory);
  return directory;
}

const moduleResolutionFailure =
  /ERR_MODULE_NOT_FOUND|Cannot find (module|package)|ERR_UNSUPPORTED_DIR_IMPORT/;

interface Run {
  code: number | null;
  output: string;
}

// Runs `node <script>` with only PATH set; the child is killed at the limit or
// as soon as `until` matches (a server that started has nothing more to say).
function runNode(
  script: string,
  env: Record<string, string>,
  { until, args = [] }: { until?: RegExp; args?: string[] } = {},
): Promise<Run> {
  return new Promise((done) => {
    let output = "";
    const child: ChildProcess = spawn("node", [script, ...args], {
      env: { PATH: process.env["PATH"] ?? "", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stop = setTimeout(() => child.kill("SIGKILL"), spawnLimitMs);
    const collect = (chunk: Buffer) => {
      output += String(chunk);
      if (until?.test(output)) child.kill("SIGKILL");
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.once("close", (code) => {
      clearTimeout(stop);
      done({ code, output });
    });
  });
}

const timeout = spawnLimitMs * 3;

it(
  "the agent worker bundle starts under plain node and reports its own missing configuration",
  async () => {
    const appDir = join(repoRoot, "apps/agent-worker");
    const outfile = join(scratch(appDir), "main.js");
    await bundleNodeApp({ appDir, entry: "src/main.ts", outfile });
    const run = await runNode(outfile, {});
    expect(run.output).not.toMatch(moduleResolutionFailure);
    expect(run.output).toContain(
      "AGENT_PAYLOAD_SECRET is required by the agent worker.",
    );
    expect(run.code).toBe(1);
  },
  timeout,
);

it(
  "the terminal gateway bundle starts under plain node, refuses a bad port and serves on a free one",
  async () => {
    const appDir = join(repoRoot, "apps/terminal-gateway");
    const outfile = join(scratch(appDir), "index.js");
    await bundleNodeApp({ appDir, entry: "src/index.ts", outfile });
    const refused = await runNode(outfile, { TERMINAL_GATEWAY_PORT: "99999" });
    expect(refused.output).not.toMatch(moduleResolutionFailure);
    expect(refused.output).toContain("ERR_SOCKET_BAD_PORT");
    expect(refused.code).toBe(1);
    const served = await runNode(
      outfile,
      { TERMINAL_GATEWAY_PORT: "0" },
      { until: /gateway listening on ws:\/\/127\.0\.0\.1:\d+\/terminal/ },
    );
    expect(served.output).toMatch(
      /gateway listening on ws:\/\/127\.0\.0\.1:\d+/,
    );
  },
  timeout,
);

it(
  "the CLI bundle starts under plain node and prints its usage",
  async () => {
    const packageDir = join(repoRoot, "packages/interview-cli");
    const outDir = scratch(packageDir);
    execFileSync(
      "pnpm",
      ["exec", "tsup", "--out-dir", outDir, "--no-dts", "--no-sourcemap"],
      { cwd: packageDir, stdio: "pipe", timeout: spawnLimitMs * 2 },
    );
    const run = await runNode(join(outDir, "cli.js"), {}, { args: ["--help"] });
    expect(run.output).not.toMatch(moduleResolutionFailure);
    expect(run.output).toContain("Usage: interview-answers");
  },
  timeout,
);
