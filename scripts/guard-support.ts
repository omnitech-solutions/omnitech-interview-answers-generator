// Shared walking and parsing for the guard tests in this directory. Each guard
// keeps its own allowlist and reasons; this file holds only file discovery and
// the TypeScript compiler API plumbing they all need.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { vi } from "vitest";

// These guards parse much of the repository with the compiler API; on a busy
// machine that outlasts the 10 s default test timeout.
vi.setConfig({ testTimeout: 120_000 });

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ignoredDirectories = new Set([
  "node_modules",
  "dist",
  ".next",
  ".next-e2e",
  ".turbo",
  "drizzle",
  ".data",
  ".build",
]);

/** A repository-relative path with forward slashes. */
export const repoPath = (absolute: string): string =>
  relative(repoRoot, absolute).split(sep).join("/");

/** Test code, fixtures and test-only kits: not shipped, not production source. */
export const isTestSupportPath = (path: string): boolean =>
  /(\.test\.|\.integration\.|-fixtures?\.|-kit\.|\/test-support\/|\/testing\/|\/integration\/|\/hardening\/world\.ts$|\/fake-api\.ts$|vitest\.setup\.ts$|\.config\.ts$)/.test(
    path,
  );

/**
 * A file a build tool writes next to its config and deletes a moment later
 * (tsup's `tsup.config.bundled_<id>.mjs`, vite's `vite.config.ts.timestamp-*`).
 * It is never source, and a guard that lists it can find it gone when it reads it.
 */
export const isTransientBuildFile = (name: string): boolean =>
  /\.bundled_[a-z0-9]+\.(mjs|cjs|js)$/.test(name) ||
  /\.timestamp-\d+-[a-f0-9]+\.(mjs|cjs|js)$/.test(name);

/** Every file under `directory` (repository-relative) whose name matches. */
export function walk(directory: string, pattern: RegExp): string[] {
  const root = join(repoRoot, directory);
  const visit = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (
        ignoredDirectories.has(entry.name) ||
        entry.name.startsWith(".next-e2e")
      )
        return [];
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return visit(path);
      return pattern.test(entry.name) &&
        !entry.name.endsWith(".d.ts") &&
        !isTransientBuildFile(entry.name)
        ? [repoPath(path)]
        : [];
    });
  return visit(root);
}

export const sourcePattern = /\.(ts|tsx|mts|mjs)$/;

export function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(join(repoRoot, path), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}

/** `@scope/name` or `name` of a bare import specifier. */
export function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

export interface ImportSite {
  specifier: string;
  line: number;
  typeOnly: boolean;
}

/** Static imports, `export ... from`, `import()` and `require()` specifiers. */
export function importSites(file: ts.SourceFile): ImportSite[] {
  const sites: ImportSite[] = [];
  const add = (node: ts.Node, specifier: string, typeOnly: boolean) =>
    sites.push({
      specifier,
      typeOnly,
      line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
    });
  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      add(
        node,
        node.moduleSpecifier.text,
        node.importClause?.isTypeOnly ?? false,
      );
    else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      add(node, node.moduleSpecifier.text, node.isTypeOnly);
    else if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0]!) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    )
      add(node, (node.arguments[0] as ts.StringLiteralLike).text, false);
    else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      add(node, node.argument.literal.text, true);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return sites;
}
