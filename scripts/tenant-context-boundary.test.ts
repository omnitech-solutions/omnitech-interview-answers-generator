// Tenant context boundary (ADR-0005 Decision 4): only the `database` package
// sets the transaction-local tenant and actor settings that row-level
// security reads. Everything else enters a tenant through its public API
// (`withTenant`, `tenantTransaction`, `enterTenant`), so the rule for how a
// transaction is scoped lives in one place. The cross-tenant worker settings
// are each set by exactly one owning file; a setting with two storage owners
// (the document catalog) names both.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scannedRoots = ["apps", "packages", "products", "scripts"];
const ignoredDirectories = new Set([
  "node_modules",
  "dist",
  ".next",
  ".next-e2e",
  ".turbo",
]);
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
  // private marker on an agent job (ADR-0012 Agent jobs).
  session_dispatch: "packages/platform-storage/src/agent-job-repository.ts",
  // The Active Session settings (ADR-0012): the worker's cross-tenant claim,
  // ingest's credential lookup and the purge's delete permission.
  session_worker:
    "products/interview/src/backend/live-session/session-claim.ts",
  session_credential_hash:
    "products/interview/src/backend/live-session/credential-lookup.ts",
  session_purge: "products/interview/src/backend/live-session/session-purge.ts",
  // ADR-0005 Decision 6 settings outside the worker family: the public share
  // lookup, the private agent payload read, and the built-in document catalog.
  share_token_hash: "products/presentation/src/repositories/index.ts",
  agent_payload_reference:
    "packages/platform-storage/src/agent-job-repository.ts",
  document_catalog_provisioner: [
    "packages/platform-storage/src/document-artifact-repository.ts",
    "products/interview/src/backend/documents/repository.ts",
  ],
} as const satisfies Record<string, string | readonly string[]>;
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
    if (
      ignoredDirectories.has(entry.name) ||
      entry.name.startsWith(".next-e2e")
    )
      return [];
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
  "sets app.%s only in its owning file(s)",
  (setting, owner) => {
    const setters = scannedSources().filter((path) =>
      setsSetting(setting).test(readFileSync(join(repoRoot, path), "utf8")),
    );
    expect(setters.sort()).toEqual([owner].flat().sort());
  },
);
