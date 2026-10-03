// Tenant context boundary (ADR-0005 Decision 4): only the `database` package
// sets the transaction-local tenant and actor settings that row-level
// security reads. Everything else enters a tenant through its public API
// (`withTenant`, `tenantTransaction`, `enterTenant`), so the rule for how a
// transaction is scoped lives in one place.
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
const setsTenantContext = /set_config\(\s*'app\.(tenant_id|actor_id)'/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return sourceFile.test(entry.name) ? [path] : [];
  });
}

it("sets app.tenant_id and app.actor_id only inside packages/database", () => {
  const offenders = scannedRoots
    .flatMap((root) => sourceFiles(join(repoRoot, root)))
    .map((path) => relative(repoRoot, path).split(sep).join("/"))
    .filter((path) => !path.startsWith("packages/database/"))
    .filter((path) => !testSupport.test(path))
    .filter((path) =>
      setsTenantContext.test(readFileSync(join(repoRoot, path), "utf8")),
    );
  expect(offenders).toEqual([]);
});
