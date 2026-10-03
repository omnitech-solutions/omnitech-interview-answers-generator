// Package boundaries (ADR-0003, ADR-0004, ADR-0007): every workspace package
// declares exactly the workspace packages it imports, imports them only
// through their `exports` map, and imports only in an allowed direction.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoots = ["apps", "packages", "products"];
const ignoredDirectories = new Set(["node_modules", "dist", ".next", ".turbo"]);

type WorkspacePackage = {
  name: string;
  dir: string;
  exports: Record<string, unknown>;
  dependencies: Set<string>;
  devDependencies: Set<string>;
  hasBin: boolean;
  // tsup `noExternal` inlines these at build, so they are build-time only.
  bundled: string;
};

type WorkspaceImport = {
  file: string;
  line: number;
  specifier: string;
  isTest: boolean;
};

const contracts = new Set([
  "@omnitech/platform-contracts",
  "@omnitech/ai-contracts",
  "@omnitech/interview-contracts",
  "@omnitech/agent-runtime-contracts",
  "@omnitech/active-session-contracts",
]);
const agentRuntimes = new Set([
  "@omnitech/agent-runtime-claude",
  "@omnitech/agent-runtime-codex",
]);

const isApp = (pkg: WorkspacePackage) => pkg.dir.startsWith("apps/");
const isProduct = (pkg: WorkspacePackage) => pkg.dir.startsWith("products/");
const isLibrary = (pkg: WorkspacePackage) => pkg.dir.startsWith("packages/");
const isAdapter = (pkg: WorkspacePackage) =>
  /^@omnitech\/(ai-provider-|agent-runtime-)/.test(pkg.name) &&
  !contracts.has(pkg.name);

// The allowed-direction table: each row names a forbidden edge and why.
const directionRules: Array<{
  rule: string;
  forbids: (from: WorkspacePackage, to: WorkspacePackage) => boolean;
}> = [
  {
    // Apps are deployment shells that compose everything; nothing composes them.
    rule: "nothing imports an apps/* package",
    forbids: (_from, to) => isApp(to),
  },
  {
    // Products are verticals built on packages, never the reverse (ADR-0004).
    rule: "packages/* never import products/*",
    forbids: (from, to) => isLibrary(from) && isProduct(to),
  },
  {
    // Products stay independently removable verticals (ADR-0004).
    rule: "a product never imports another product",
    forbids: (from, to) => isProduct(from) && isProduct(to),
  },
  {
    // Only the isolated worker launches Codex or Claude Code (ADR-0007).
    rule: "only apps/agent-worker depends on an agent runtime",
    forbids: (from, to) =>
      agentRuntimes.has(to.name) && from.dir !== "apps/agent-worker",
  },
  {
    // Contracts are the stable framework-neutral bottom layer (ADR-0003).
    rule: "contract packages depend only on contract packages",
    forbids: (from, to) => contracts.has(from.name) && !contracts.has(to.name),
  },
  {
    // database owns connectivity; domain packages own schemas (ADR-0003).
    rule: "database depends on no workspace package",
    forbids: (from) => from.name === "@omnitech/database",
  },
  {
    // Adapters translate one provider SDK to a contract, nothing more (ADR-0007).
    rule: "provider and runtime adapters depend only on contract packages",
    forbids: (from, to) => isAdapter(from) && !contracts.has(to.name),
  },
];

describe("package boundaries", () => {
  const packages = readWorkspacePackages();
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));

  it("finds the workspace packages", () => {
    expect(byName.has("@omnitech/database")).toBe(true);
    expect(byName.has("@omnitech/interview-web")).toBe(true);
  });

  it("declares exactly the workspace packages each package imports", () => {
    const violations: string[] = [];
    for (const pkg of packages) {
      const imported = new Set<string>();
      for (const found of workspaceImports(pkg, byName)) {
        const target = packageNameOf(found.specifier);
        if (found.specifier.startsWith(".") || target === pkg.name) continue;
        imported.add(target);
        const declared =
          pkg.dependencies.has(target) ||
          (pkg.devDependencies.has(target) &&
            (found.isTest || pkg.bundled.includes(`"${target}"`)));
        if (!declared) {
          violations.push(
            `${pkg.name}: ${found.file}:${found.line} imports ${target} without declaring it in ${found.isTest ? "dependencies or devDependencies" : "dependencies"} [declared = imported]`,
          );
        }
      }
      for (const target of [...pkg.dependencies, ...pkg.devDependencies]) {
        if (byName.has(target) && !imported.has(target)) {
          violations.push(
            `${pkg.name}: ${pkg.dir}/package.json declares ${target} but nothing imports it [declared = imported]`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("has no library package that nothing imports", () => {
    // A library with no importer is dead code; a package with a bin is a tool.
    const imported = new Set(
      packages.flatMap((pkg) =>
        workspaceImports(pkg, byName)
          .map((found) => packageNameOf(found.specifier))
          .filter((target) => target !== pkg.name),
      ),
    );
    const orphans = packages
      .filter((pkg) => isLibrary(pkg) && !pkg.hasBin && !imported.has(pkg.name))
      .map(
        (pkg) =>
          `${pkg.name}: ${pkg.dir}/package.json is imported by no workspace package [no orphan libraries]`,
      );
    expect(orphans).toEqual([]);
  });

  it("imports other packages only through their exports map", () => {
    const violations: string[] = [];
    for (const pkg of packages) {
      for (const found of workspaceImports(pkg, byName)) {
        if (found.specifier.startsWith(".")) {
          violations.push(
            `${pkg.name}: ${found.file}:${found.line} imports ${found.specifier}, a relative path out of its package [public entrypoints only]`,
          );
          continue;
        }
        const target = byName.get(packageNameOf(found.specifier));
        const subpath = `.${found.specifier.slice(packageNameOf(found.specifier).length)}`;
        if (target && !(subpath in target.exports)) {
          violations.push(
            `${pkg.name}: ${found.file}:${found.line} imports ${found.specifier}, which ${target.name} does not export [public entrypoints only]`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("lets only apps/agent-worker reach the cross-tenant worker repository", () => {
    // The worker repository reads and advances any tenant's job (ADR-0007),
    // so its entrypoint is separate and only the isolated worker imports it.
    const storage = byName.get("@omnitech/platform-storage");
    expect(storage?.exports).toHaveProperty("./worker");
    const importers = new Set(
      packages
        .filter((pkg) =>
          workspaceImports(pkg, byName).some(
            (found) =>
              found.specifier === "@omnitech/platform-storage/worker" &&
              !found.isTest,
          ),
        )
        .map((pkg) => pkg.dir),
    );
    expect([...importers]).toEqual(["apps/agent-worker"]);
  });

  it("imports only in an allowed direction", () => {
    const violations: string[] = [];
    for (const pkg of packages) {
      for (const found of workspaceImports(pkg, byName)) {
        const target = byName.get(packageNameOf(found.specifier));
        if (!target || target === pkg) continue;
        for (const { rule, forbids } of directionRules) {
          if (forbids(pkg, target)) {
            violations.push(
              `${pkg.name}: ${found.file}:${found.line} imports ${target.name} [${rule}]`,
            );
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

function readWorkspacePackages(): WorkspacePackage[] {
  return workspaceRoots.flatMap((root) =>
    readdirSync(join(repoRoot, root))
      .map((name) => `${root}/${name}`)
      .filter((dir) => existsSync(join(repoRoot, dir, "package.json")))
      .map((dir) => {
        const manifest = JSON.parse(
          readFileSync(join(repoRoot, dir, "package.json"), "utf8"),
        );
        const tsup = join(repoRoot, dir, "tsup.config.ts");
        return {
          name: manifest.name,
          dir,
          exports: manifest.exports ?? {},
          dependencies: new Set(Object.keys(manifest.dependencies ?? {})),
          devDependencies: new Set(Object.keys(manifest.devDependencies ?? {})),
          hasBin: manifest.bin !== undefined,
          bundled: existsSync(tsup) ? readFileSync(tsup, "utf8") : "",
        };
      }),
  );
}

const importCache = new Map<string, WorkspaceImport[]>();

// Workspace imports are bare specifiers naming a workspace package, or
// relative paths that resolve outside the importing package's directory.
function workspaceImports(
  pkg: WorkspacePackage,
  byName: Map<string, WorkspacePackage>,
): WorkspaceImport[] {
  const cached = importCache.get(pkg.dir);
  if (cached) return cached;
  const packageRoot = join(repoRoot, pkg.dir);
  const found: WorkspaceImport[] = [];
  const specifierPattern =
    /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;
  for (const file of sourceFiles(packageRoot)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(specifierPattern)) {
      const specifier = match[1] ?? "";
      const escapes =
        specifier.startsWith(".") &&
        !`${resolve(dirname(file), specifier)}${sep}`.startsWith(
          `${packageRoot}${sep}`,
        );
      if (!escapes && !byName.has(packageNameOf(specifier))) continue;
      found.push({
        file: relative(repoRoot, file),
        line: source.slice(0, match.index).split("\n").length,
        specifier,
        isTest: /\.test\.tsx?$|vitest\.setup\.ts$/.test(file),
      });
    }
  }
  importCache.set(pkg.dir, found);
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")
      ? [path]
      : [];
  });
}

function packageNameOf(specifier: string): string {
  const [scope, name] = specifier.split("/");
  return specifier.startsWith("@") ? `${scope}/${name}` : (scope ?? "");
}
