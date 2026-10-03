// Tenant context boundary (ADR-0005 Decision 4): only the `database` package
// sets the transaction-local tenant and actor settings that row-level
// security reads. Everything else enters a tenant through its public API
// (`withTenant`, `tenantTransaction`, `enterTenant`), so the rule for how a
// transaction is scoped lives in one place. The cross-tenant worker settings
// are each set by exactly one owning file.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scannedRoots = ["apps", "packages", "products", "scripts"];
const ignoredDirectories = new Set(["node_modules", "dist", ".next", ".turbo"]);
const sourceFile = /\.(ts|tsx|mts|js|mjs)$/;
// Tests and their fixtures stand in for the database package on purpose.
const testSupport = /(\.test\.|-fixture\.|\/test-support\/|\/integration\/)/;
// set_config('app.tenant_id' …) in any quote style, or a SET [LOCAL]
// app.tenant_id / app.actor_id statement (= or TO, so prose never matches).
const setsTenantContext =
  /set_config\(\s*["'`]app\.(tenant_id|actor_id)["'`]|\bset\s+(local\s+)?app\.(tenant_id|actor_id)\s*(=|to\b)/i;
// The settings that admit a worker across tenants, and the one file that may
// set each: the agent worker's repository and the interview run queue.
const workerSettings = {
  agent_worker: "packages/platform-storage/src/agent-job-worker-repository.ts",
  run_worker: "products/interview/src/backend/interview-backend.ts",
  // The session dispatch path: the one job-creation function that may set the
  // private marker on an agent job (ADR-0011 Agent jobs).
  session_dispatch: "packages/platform-storage/src/agent-job-repository.ts",
} as const;
const setsSetting = (name: string) =>
  new RegExp(
    `set_config\\(\\s*["'\`]app\\.${name}["'\`]|\\bset\\s+(local\\s+)?app\\.${name}\\s*(=|to\\b)`,
    "i",
  );

function scannedSources(): string[] {
  return scannedRoots
    .flatMap((root) => sourceFiles(join(repoRoot, root)))
    .map((path) => relative(repoRoot, path).split(sep).join("/"))
    .filter((path) => !testSupport.test(path));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return sourceFile.test(entry.name) ? [path] : [];
  });
}

it("sets app.tenant_id and app.actor_id only inside packages/database", () => {
  const offenders = scannedSources()
    .filter((path) => !path.startsWith("packages/database/"))
    .filter((path) =>
      setsTenantContext.test(readFileSync(join(repoRoot, path), "utf8")),
    );
  expect(offenders).toEqual([]);
});

it("recognises every way of setting the tenant context", () => {
  for (const statement of [
    "SELECT set_config('app.tenant_id', $1, true)",
    'SELECT set_config("app.tenant_id", $1, true)',
    "SELECT set_config(`app.actor_id`, $1, true)",
    "SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000000'",
    "set app.actor_id to 'x'",
  ])
    expect(setsTenantContext.test(statement), statement).toBe(true);
  for (const reading of [
    "current_setting('app.tenant_id')",
    "// its transactions set app.tenant_id, and",
  ])
    expect(setsTenantContext.test(reading), reading).toBe(false);
});

it.each(Object.entries(workerSettings))(
  "sets app.%s only in its one owning file",
  (setting, owner) => {
    const setters = scannedSources().filter((path) =>
      setsSetting(setting).test(readFileSync(join(repoRoot, path), "utf8")),
    );
    expect(setters).toEqual([owner]);
  },
);
