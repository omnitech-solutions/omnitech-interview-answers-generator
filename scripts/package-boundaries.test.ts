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

// rule:neutral-core-imports (ADR-0011): the session core imports only its own
// files and the contracts package, so interview policy cannot leak into it.
const neutralCoreDir = "products/interview/src/backend/live-session/core";
const neutralCoreRule = "rule:neutral-core-imports, ADR-0011";

const isApp = (pkg: WorkspacePackage) => pkg.dir.startsWith("apps/");
const isProduct = (pkg: WorkspacePackage) => pkg.dir.startsWith("products/");
const isLibrary = (pkg: WorkspacePackage) => pkg.dir.startsWith("packages/");
const isAdapter = (pkg: WorkspacePackage) =>
  /^@omnitech\/(ai-provider-|agent-runtime-)/.test(pkg.name) &&
  !contracts.has(pkg.name);

// The capture companion (ADR-0011, ADR-0012) consumes only the versioned wire
// contract. Its fixture subpath is the one thing a product's TESTS may import,
// so conformance tests can drive a real companion against the real backend.
const companionName = "@omnitech/capture-companion";
const companionFixture = `${companionName}/fixture`;
const companionDir = "apps/capture-companion";
const companionRule = "rule:versioned-wire-contract, ADR-0011";
const contractsName = "@omnitech/active-session-contracts";

// Where an import sits: the allowed-direction table needs to know whether it
// is test code and which specifier it names.
type ImportSite = { isTest: boolean; specifier: string };

// The allowed-direction table: each row names a forbidden edge and why.
const directionRules: Array<{
  rule: string;
  forbids: (
    from: WorkspacePackage,
    to: WorkspacePackage,
    site: ImportSite,
  ) => boolean;
}> = [
  {
    // Apps are deployment shells that compose everything; nothing composes them.
    // The one narrow exception: product TEST files may import the companion's
    // fixture subpath (declared as a devDependency).
    rule: "nothing imports an apps/* package",
    forbids: (from, to, site) =>
      isApp(to) &&
      !(
        site.isTest &&
        isProduct(from) &&
        to.name === companionName &&
        site.specifier === companionFixture
      ),
  },
  {
    // The companion holds no database or provider credentials, so it can
    // depend on nothing but the wire contract (rule:versioned-wire-contract).
    rule: "apps/capture-companion depends only on active-session-contracts",
    forbids: (from, to) =>
      from.dir === companionDir && to.name !== contractsName,
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
          if (
            forbids(pkg, target, {
              isTest: found.isTest,
              specifier: found.specifier,
            })
          ) {
            violations.push(
              `${pkg.name}: ${found.file}:${found.line} imports ${target.name} [${rule}]`,
            );
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps the neutral session core importing only its own files and the contracts", () => {
    const coreRoot = join(repoRoot, neutralCoreDir);
    const violations: string[] = [];
    for (const file of sourceFiles(coreRoot)) {
      const source = readFileSync(file, "utf8");
      const isTest = /\.test\.ts$/.test(file);
      for (const issue of neutralCoreViolations(
        source,
        relative(coreRoot, dirname(file)),
        isTest,
      )) {
        violations.push(
          `${relative(repoRoot, file)}:${issue.line} imports ${issue.specifier} [${neutralCoreRule}: ${neutralCoreDir} may import only relative paths inside itself and @omnitech/active-session-contracts]`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it("detects a neutral-core import that leaves the directory", () => {
    const source = [
      'import { a } from "./ok";',
      'import type { C } from "@omnitech/active-session-contracts";',
      'import { z } from "zod";',
      'import { fs } from "node:fs";',
      'import { x } from "../sibling";',
      'import { y } from "@omnitech/interview-contracts";',
      'const lazy = await import("drizzle-orm");',
      'import { it } from "vitest";',
    ].join("\n");
    expect(
      neutralCoreViolations(source, "", false).map((v) => v.specifier),
    ).toEqual([
      "zod",
      "node:fs",
      "../sibling",
      "@omnitech/interview-contracts",
      "drizzle-orm",
      "vitest",
    ]);
    // Tests may additionally import vitest, and nothing else.
    const testViolations = neutralCoreViolations(source, "", true);
    expect(testViolations.map((v) => v.specifier)).not.toContain("vitest");
    expect(testViolations).toHaveLength(5);
    // A subdirectory file may climb back up inside the directory only.
    expect(neutralCoreViolations('import "../a";', "sub", false)).toEqual([]);
    expect(
      neutralCoreViolations('import "../../a";', "sub", false),
    ).toHaveLength(1);
  });

  it("keeps the capture companion's TypeScript importing only the wire contract and node built-ins", () => {
    const srcRoot = join(repoRoot, companionDir, "src");
    const violations: string[] = [];
    for (const file of sourceFiles(srcRoot)) {
      const isTest = /\.test\.ts$/.test(file);
      for (const issue of companionImportViolations(
        readFileSync(file, "utf8"),
        relative(srcRoot, dirname(file)),
        isTest,
      )) {
        violations.push(
          `${relative(repoRoot, file)}:${issue.line} imports ${issue.specifier} [${companionRule}: ${companionDir}/src may import only its own files, node: built-ins and ${contractsName}]`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it("detects a companion import of anything but the contract and node built-ins", () => {
    const source = [
      'import { a } from "./ok";',
      'import { fs } from "node:fs";',
      'import type { C } from "@omnitech/active-session-contracts";',
      'import { z } from "zod";',
      'import { db } from "@omnitech/database";',
      'import { p } from "@omnitech/product-interview";',
      'import { x } from "../outside";',
      'const lazy = await import("fs");',
      'import { it } from "vitest";',
    ].join("\n");
    expect(
      companionImportViolations(source, "", false).map((v) => v.specifier),
    ).toEqual([
      "zod",
      "@omnitech/database",
      "@omnitech/product-interview",
      "../outside",
      "fs",
      "vitest",
    ]);
    expect(
      companionImportViolations(source, "", true).map((v) => v.specifier),
    ).not.toContain("vitest");
  });

  it("lets only a product's test files import the companion's fixture subpath", () => {
    const apps = packages.find((pkg) => pkg.dir === companionDir);
    const interview = packages.find(
      (pkg) => pkg.name === "@omnitech/product-interview",
    );
    expect(apps?.exports).toHaveProperty("./fixture");
    const rule = directionRules.find((row) =>
      row.rule.startsWith("nothing imports"),
    );
    if (!apps || !interview || !rule) throw new Error("fixture missing");
    const at = (isTest: boolean, specifier: string) => ({ isTest, specifier });
    expect(rule.forbids(interview, apps, at(true, companionFixture))).toBe(
      false,
    );
    // Production code, the root entrypoint and other importers stay refused.
    expect(rule.forbids(interview, apps, at(false, companionFixture))).toBe(
      true,
    );
    expect(rule.forbids(interview, apps, at(true, companionName))).toBe(true);
    const web = packages.find((pkg) => pkg.dir === "apps/web");
    if (!web) throw new Error("web missing");
    expect(rule.forbids(web, apps, at(true, companionFixture))).toBe(true);
    const library = packages.find((pkg) => pkg.dir.startsWith("packages/"));
    if (!library) throw new Error("library missing");
    expect(rule.forbids(library, apps, at(true, companionFixture))).toBe(true);
    // And the other apps are never importable, even from product tests.
    const worker = packages.find((pkg) => pkg.dir === "apps/agent-worker");
    if (!worker) throw new Error("worker missing");
    expect(
      rule.forbids(interview, worker, at(true, "@omnitech/agent-worker")),
    ).toBe(true);
  });
});

describe("the macOS companion's Swift sources", () => {
  const macosRoot = join(repoRoot, companionDir, "macos");
  // Absent until the Swift package exists; then every rule below applies.
  // Package.swift is SwiftPM's manifest (it imports PackageDescription), not
  // companion code.
  const files = (existsSync(macosRoot) ? swiftFiles(macosRoot) : []).filter(
    (file) => !file.endsWith(`${sep}Package.swift`),
  );
  // Tests may name the forbidden words to assert their absence; only shipped
  // code (Sources/) is scanned for them.
  const shipped = files.filter((file) => file.includes(`${sep}Sources${sep}`));
  const ownModules = existsSync(macosRoot)
    ? swiftOwnModules(macosRoot)
    : new Set<string>();

  it("imports only system frameworks the companion needs and its own modules", () => {
    const violations = files.flatMap((file) =>
      swiftImportViolations(readFileSync(file, "utf8"), ownModules).map(
        (issue) =>
          `${relative(repoRoot, file)}:${issue.line} imports ${issue.module} [ADR-0012/declared-profile-locality: only ${[...SWIFT_ALLOWED_IMPORTS].join(", ")} and the package's own modules]`,
      ),
    );
    expect(violations).toEqual([]);
  });

  it("names no database or provider credential in shipped code", () => {
    const violations = shipped.flatMap((file) =>
      swiftCredentialWords(readFileSync(file, "utf8")).map(
        (issue) =>
          `${relative(repoRoot, file)}:${issue.line} mentions ${issue.word} [ADR-0011/credential-storage: the companion holds no database or provider credentials]`,
      ),
    );
    expect(violations).toEqual([]);
  });

  it("does not log from CaptureCore", () => {
    const violations = files
      .filter((file) => file.includes(`${sep}CaptureCore${sep}`))
      .flatMap((file) =>
        swiftLoggingCalls(readFileSync(file, "utf8")).map(
          (issue) =>
            `${relative(repoRoot, file)}:${issue.line} calls ${issue.call} [ADR-0012/id-only-traces: CaptureCore never logs]`,
        ),
      );
    expect(violations).toEqual([]);
  });

  it("detects disallowed imports, credential words and logging calls", () => {
    const own = new Set(["CaptureCore", "capture_companion"]);
    const source = [
      "import Foundation",
      "@preconcurrency import Security",
      "@testable import CaptureCore",
      "import ScreenCaptureKit",
      "import Network",
      "import struct Foundation.Data",
      "import PostgresNIO",
      'let a = "DATABASE_URL"',
      "let b = openai_key // OPENAI",
      "// the api key is never stored",
      'print("x")',
      'NSLog("x")',
      "let l = Logger(subsystem: s, category: c)",
      'os_log("x")',
      "let blueprint = 1",
    ].join("\n");
    expect(swiftImportViolations(source, own).map((v) => v.module)).toEqual([
      "Network",
      "PostgresNIO",
    ]);
    expect(
      swiftCredentialWords(source).map((v) => v.word.toLowerCase()),
    ).toEqual(["postgres", "database_url", "openai", "openai", "api key"]);
    expect(swiftLoggingCalls(source).map((v) => v.call)).toEqual([
      "print(",
      "NSLog(",
      "Logger(",
      "os_log(",
    ]);
  });
});

// Shared by the neutral core and the companion: relative imports must stay
// inside `root`, and a bare specifier must pass `allowsBare`. Pure over a
// source string so each detector itself can be tested.
function scopedImportViolations(
  source: string,
  relativeDir: string,
  allowsBare: (specifier: string) => boolean,
): Array<{ line: number; specifier: string }> {
  const pattern =
    /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;
  const found: Array<{ line: number; specifier: string }> = [];
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? "";
    const line = source.slice(0, match.index).split("\n").length;
    const insideRoot = (): boolean => {
      const target = resolve("/root", relativeDir, specifier);
      return target === "/root" || target.startsWith("/root/");
    };
    const allowed = specifier.startsWith(".")
      ? insideRoot()
      : allowsBare(specifier);
    if (!allowed) found.push({ line, specifier });
  }
  return found;
}

// `relativeDir` is the file's directory relative to the core directory ("" at
// its root).
function neutralCoreViolations(
  source: string,
  relativeDir: string,
  isTest: boolean,
): Array<{ line: number; specifier: string }> {
  return scopedImportViolations(
    source,
    relativeDir,
    (specifier) =>
      specifier === contractsName || (isTest && specifier === "vitest"),
  );
}

function companionImportViolations(
  source: string,
  relativeDir: string,
  isTest: boolean,
): Array<{ line: number; specifier: string }> {
  return scopedImportViolations(
    source,
    relativeDir,
    (specifier) =>
      specifier === contractsName ||
      specifier.startsWith("node:") ||
      (isTest && specifier === "vitest"),
  );
}

// System frameworks the companion may import (ScreenCaptureKit, Speech and
// the rest of its capture path); anything else, notably a network or database
// library, is a boundary change that needs a decision.
const SWIFT_ALLOWED_IMPORTS = new Set([
  "Foundation",
  "AppKit",
  "Security",
  "ScreenCaptureKit",
  "Speech",
  "AVFoundation",
  "CoreMedia",
  "CoreImage",
  "CoreGraphics",
  "ImageIO",
  "UniformTypeIdentifiers",
  "Dispatch",
  "os",
  "CryptoKit",
]);

function swiftFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".build" || entry.name === ".swiftpm") return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return swiftFiles(path);
    return entry.name.endsWith(".swift") ? [path] : [];
  });
}

// The package's own modules: one per directory under Sources/ and Tests/
// (SwiftPM turns a hyphen in a target name into an underscore).
function swiftOwnModules(macosRoot: string): Set<string> {
  const modules = new Set<string>();
  for (const parent of ["Sources", "Tests"]) {
    const dir = join(macosRoot, parent);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) modules.add(entry.name.replaceAll("-", "_"));
    }
  }
  return modules;
}

function swiftImportViolations(
  source: string,
  ownModules: ReadonlySet<string>,
): Array<{ line: number; module: string }> {
  const found: Array<{ line: number; module: string }> = [];
  const pattern =
    /^\s*(?:@\w+(?:\([^)]*\))?\s+)*import\s+(?:(?:typealias|struct|class|enum|protocol|let|var|func)\s+)?([A-Za-z_]\w*)/gm;
  for (const match of source.matchAll(pattern)) {
    const module = match[1] ?? "";
    if (!SWIFT_ALLOWED_IMPORTS.has(module) && !ownModules.has(module)) {
      found.push({
        line: source.slice(0, match.index).split("\n").length,
        module,
      });
    }
  }
  return found;
}

function swiftCredentialWords(
  source: string,
): Array<{ line: number; word: string }> {
  const found: Array<{ line: number; word: string }> = [];
  const pattern = /DATABASE_URL|postgres|OPENAI|ANTHROPIC|api[ _-]?key/gi;
  for (const match of source.matchAll(pattern)) {
    found.push({
      line: source.slice(0, match.index).split("\n").length,
      word: match[0],
    });
  }
  return found;
}

function swiftLoggingCalls(
  source: string,
): Array<{ line: number; call: string }> {
  const found: Array<{ line: number; call: string }> = [];
  for (const [index, line] of source.split("\n").entries()) {
    // A comment may mention a call; only code can make one.
    const code = line.replace(/\/\/.*$/, "");
    for (const match of code.matchAll(/\b(print|NSLog|Logger|os_log)\s*\(/g)) {
      found.push({ line: index + 1, call: `${match[1]}(` });
    }
  }
  return found;
}

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
