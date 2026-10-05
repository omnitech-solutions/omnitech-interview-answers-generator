// Declared versus imported dependencies (L1 arch, L6 audit): every external
// package a workspace imports must be declared in its own package.json, and
// production code may not lean on a devDependency. Unused declared
// dependencies are reported as a table, not failed: removing one is a
// per-package judgement (a runtime plugin, a CLI a script shells out to).
// Workspace-to-workspace edges are covered by package-boundaries.test.ts; this
// test covers everything else. The allowlist is configuration with a written
// reason, and an entry that no longer matches fails the test as stale.
import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  importSites,
  isTestSupportPath,
  packageNameOf,
  parse,
  repoRoot,
  sourcePattern,
  walk,
} from "./guard-support";

interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface Workspace {
  dir: string;
  manifest: Manifest;
  files: string[];
  // tsup inlines these packages at build, so a devDependency is enough.
  bundled: string;
}

interface Allowance {
  dir: string;
  dependency: string;
  reason: string;
}

// Imports that resolve without a package.json entry in the importing
// workspace. Each says why; none may go stale.
const allowlist: readonly Allowance[] = [
  {
    dir: ".",
    dependency: "@omnitech/agent-runtime-contracts",
    reason:
      "scripts/benchmark-document-groups.ts is a manual benchmark run through tsx from the repository root; it reaches workspace sources directly and ships nowhere",
  },
  {
    dir: ".",
    dependency: "@omnitech/ai-contracts",
    reason:
      "scripts/benchmark-document-groups.ts is a manual benchmark run through tsx from the repository root; it reaches workspace sources directly and ships nowhere",
  },
  {
    dir: "products/interview",
    dependency: "pg",
    reason:
      "workspace-fixture.ts (a test-only fixture) loads the pg Pool through the pnpm-hoisted copy that @omnitech/database owns; declaring pg in the product would add a dependency the product's production code never uses",
  },
];

const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(repoRoot, dir, "package.json"), "utf8"));
}

function workspaces(): Workspace[] {
  const dirs = ["."];
  for (const root of ["apps", "packages", "products", "e2e"]) {
    for (const file of walk(root, /^package\.json$/)) {
      if (file.split("/").length === 3)
        dirs.push(file.replace(/\/package\.json$/, ""));
    }
  }
  return dirs.map((dir) => {
    const prefix = dir === "." ? "" : `${dir}/`;
    const files =
      dir === "."
        ? walk("scripts", sourcePattern)
        : walk(dir, sourcePattern).filter((file) => file.startsWith(prefix));
    const tsup = join(repoRoot, dir, "tsup.config.ts");
    return {
      dir,
      manifest: readManifest(dir),
      files,
      bundled: existsSync(tsup) ? readFileSync(tsup, "utf8") : "",
    };
  });
}

// `@/...` is apps/web's tsconfig path alias, not a package.
const isExternal = (specifier: string) =>
  !specifier.startsWith(".") &&
  !specifier.startsWith("/") &&
  !specifier.startsWith("@/") &&
  !builtins.has(specifier) &&
  !specifier.startsWith("node:") &&
  !specifier.startsWith("bun:");

interface Use {
  dependency: string;
  site: string;
  production: boolean;
}

function usesOf(workspace: Workspace): Use[] {
  return workspace.files.flatMap((file) => {
    if (existsSync(join(repoRoot, file)) === false) return [];
    // The repository root holds tooling only; a package's scripts/ folder is
    // build-time, not shipped runtime.
    const production =
      workspace.dir !== "." &&
      // A browser-test package ships nothing: all of it is test support.
      !workspace.dir.startsWith("e2e/") &&
      !isTestSupportPath(file) &&
      !/\/scripts\//.test(file);
    return importSites(parse(file))
      .filter((site) => isExternal(site.specifier))
      .map((site) => {
        const dependency = packageNameOf(site.specifier);
        return {
          dependency,
          site: `${file}:${site.line}`,
          production:
            production &&
            !site.typeOnly &&
            !workspace.bundled.includes(`"${dependency}"`),
        };
      });
  });
}

const declaredIn = (manifest: Manifest, name: string) => ({
  runtime:
    name in (manifest.dependencies ?? {}) ||
    name in (manifest.peerDependencies ?? {}) ||
    name in (manifest.optionalDependencies ?? {}),
  any:
    name in (manifest.dependencies ?? {}) ||
    name in (manifest.devDependencies ?? {}) ||
    name in (manifest.peerDependencies ?? {}) ||
    name in (manifest.optionalDependencies ?? {}),
});

// Tools that run by name (a script, a vitest environment, a git hook), never by import.
const usedByName = new Set([
  "typescript",
  "tsx",
  "jsdom",
  "turbo",
  "lefthook",
  "@biomejs/biome",
  "@vitest/coverage-v8",
]);

const all = workspaces();
const allowed = (dir: string, dependency: string) =>
  allowlist.find(
    (entry) => entry.dir === dir && entry.dependency === dependency,
  );

function violations(): Array<{
  dir: string;
  dependency: string;
  message: string;
}> {
  const found: Array<{ dir: string; dependency: string; message: string }> = [];
  for (const workspace of all) {
    const reported = new Set<string>();
    for (const use of usesOf(workspace)) {
      if (use.dependency === workspace.manifest.name) continue;
      // @types/* packages stand in for the untyped package they describe.
      const declared = declaredIn(workspace.manifest, use.dependency);
      const missing = !declared.any;
      const devOnly = use.production && !declared.runtime;
      if (!missing && !devOnly) continue;
      const key = `${use.dependency}:${missing ? "missing" : "dev"}`;
      if (reported.has(key)) continue;
      reported.add(key);
      found.push({
        dir: workspace.dir,
        dependency: use.dependency,
        message: `${workspace.dir}/package.json: ${use.site} imports ${use.dependency}, ${missing ? "which it does not declare" : "which it declares only as a devDependency but production code imports it"}`,
      });
    }
  }
  return found;
}

it("finds the workspaces it scans", () => {
  const dirs = all.map((workspace) => workspace.dir);
  expect(dirs).toContain(".");
  expect(dirs).toContain("apps/web");
  expect(dirs).toContain("products/interview");
  expect(dirs).toContain("packages/database");
  expect(all.every((workspace) => workspace.files.length > 0)).toBe(true);
});

it("declares every external package a workspace imports", () => {
  const unexplained = violations().filter(
    (found) => !allowed(found.dir, found.dependency),
  );
  expect(
    unexplained.map((found) => found.message),
    "Declare the dependency in that workspace's package.json (use the pnpm catalog where one exists), or add an allowlist entry with a reason in scripts/dependency-declarations.test.ts",
  ).toEqual([]);
});

it("keeps every allowlist entry real and reasoned", () => {
  const live = violations();
  for (const entry of allowlist) {
    expect(entry.reason.length, entry.dependency).toBeGreaterThan(40);
    expect(
      live.some(
        (found) =>
          found.dir === entry.dir && found.dependency === entry.dependency,
      ),
      `${entry.dir}: allowlist entry for ${entry.dependency} is stale`,
    ).toBe(true);
  }
});

it("reports declared dependencies that nothing imports", () => {
  const rows = all.flatMap((workspace) => {
    const imported = new Set(usesOf(workspace).map((use) => use.dependency));
    const declared = [
      ...Object.keys(workspace.manifest.dependencies ?? {}),
      ...Object.keys(workspace.manifest.devDependencies ?? {}),
    ].filter(
      (name) =>
        !imported.has(name) &&
        !usedByName.has(name) &&
        !name.startsWith("@types/") &&
        !name.startsWith("@omnitech/"),
    );
    return declared.length === 0
      ? []
      : [{ workspace: workspace.dir, unused: declared.sort().join(", ") }];
  });
  // Informational: font, CSS and plugin packages are used by name in config.
  console.info(
    `Declared but not imported (review, not a failure):\n${rows.map((row) => `  ${row.workspace}: ${row.unused}`).join("\n")}`,
  );
  expect(rows).toBeInstanceOf(Array);
});
