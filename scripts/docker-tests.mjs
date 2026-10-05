// Finds the test files that need a Docker daemon, so vitest.config.ts can run
// them as their own `docker` project (longer hook timeout, skippable with
// `pnpm test:no-docker`). A test is Docker-backed when it calls
// startDisposablePostgres, or imports, through relative paths, a non-test
// module that does (a shared fixture or world). Derived from the source, so
// nothing needs renaming or listing by hand.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignored = new Set(["node_modules", "dist", ".next", ".turbo", ".data"]);
// The fixture's own definition; tests elsewhere reach it by package name.
const definition = "packages/database/src/test-support/";

function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignored.has(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")
      ? [path]
      : [];
  });
}

const relativeImports = (text) =>
  [...text.matchAll(/(?:from\s+|import\(\s*)["'](\.[^"']+)["']/g)].map(
    (match) => match[1],
  );

function resolveImport(from, specifier) {
  const base = resolve(dirname(from), specifier.replace(/\.js$/, ""));
  return [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((file) =>
    existsSync(file),
  );
}

const isTest = (file) => /\.test\.tsx?$/.test(file);

/** Repository-relative paths (forward slashes) of Docker-backed test files. */
export function dockerBackedTests() {
  const files = ["apps", "packages", "products", "scripts"].flatMap((root) =>
    sources(join(repoRoot, root)),
  );
  const text = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));
  const backed = new Set(
    files.filter(
      (file) =>
        text.get(file).includes("startDisposablePostgres") &&
        !relative(repoRoot, file).split(sep).join("/").startsWith(definition),
    ),
  );
  // Modules that reach a Docker-backed module make their importers Docker-backed.
  let grew = true;
  while (grew) {
    grew = false;
    for (const file of files) {
      if (backed.has(file)) continue;
      const reaches = relativeImports(text.get(file)).some((specifier) => {
        const target = resolveImport(file, specifier);
        return target && backed.has(target) && !isTest(target);
      });
      if (reaches) {
        backed.add(file);
        grew = true;
      }
    }
  }
  return [...backed]
    .filter(isTest)
    .map((file) => relative(repoRoot, file).split(sep).join("/"))
    .sort();
}
