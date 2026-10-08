// Relative module specifiers carry no file extension (tsconfig.base.json:
// moduleResolution "Bundler"). `./thing.js` for a `thing.ts` source is the
// Node16 habit that `tsc` copies verbatim into dist; here every consumer is a
// bundler (Next, vite, tsx, esbuild) and the apps Node runs directly ship a
// bundle (scripts/bundle-node-app.mjs, scripts/node-entrypoints.test.ts).
// The allowlist is configuration, not suppression: an entry needs a reason
// and fails once its file no longer offends.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { parse, repoPath, repoRoot, walk } from "./guard-support";

interface JsExtensionAllowance {
  file: string;
  reason: string;
}

const allowed: readonly JsExtensionAllowance[] = [];

const scannedRoots = ["apps", "packages", "products", "scripts", "e2e"];
const scannedRootFiles = ["vitest.config.ts", "vitest.package.config.ts"];
const typescriptSource = /\.(ts|tsx|mts)$/;

const mockMethods = new Set([
  "mock",
  "doMock",
  "unmock",
  "doUnmock",
  "importActual",
  "importMock",
  "requireActual",
  "requireMock",
  "setMock",
]);
const mockObjects = new Set(["vi", "vitest", "jest"]);

/**
 * Module-specifier string literals of imports, re-exports, `import()`,
 * `require()`, `import x = require()`, `typeof import()` and the vitest/jest
 * mock helpers. Strings used as runtime file paths (`new URL(..)`) are not
 * module specifiers and are not returned.
 */
function moduleSpecifiers(
  file: ts.SourceFile,
): Array<{ specifier: string; line: number }> {
  const sites: Array<{ specifier: string; line: number }> = [];
  const add = (literal: ts.Node | undefined) => {
    if (literal && ts.isStringLiteralLike(literal))
      sites.push({
        specifier: literal.text,
        line: file.getLineAndCharacterOfPosition(literal.getStart()).line + 1,
      });
  };
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    )
      add(node.moduleSpecifier);
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      add(node.moduleReference.expression);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      add(node.argument.literal);
    else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === "require") ||
        (ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          mockObjects.has(callee.expression.text) &&
          mockMethods.has(callee.name.text))
      )
        add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return sites;
}

/** True for `./x.js` / `../x.js` whose `x` is TypeScript source, not a JS file. */
function extensionForTypescriptSource(
  fromFile: string,
  specifier: string,
): boolean {
  if (!/^\.\.?\//.test(specifier) || !specifier.endsWith(".js")) return false;
  const base = resolve(
    dirname(join(repoRoot, fromFile)),
    specifier.slice(0, -3),
  );
  if (existsSync(`${base}.js`)) return false;
  return [".ts", ".tsx", ".mts", ".d.ts"].some((ext) =>
    existsSync(`${base}${ext}`),
  );
}

const files = [
  ...scannedRoots.flatMap((root) => walk(root, typescriptSource)),
  ...scannedRootFiles,
];

const offences = files.flatMap((file) =>
  moduleSpecifiers(parse(file))
    .filter(({ specifier }) => extensionForTypescriptSource(file, specifier))
    .map(({ specifier, line }) => ({ file, line, specifier })),
);

it("finds the sources it scans", () => {
  expect(files.length).toBeGreaterThan(500);
  expect(files).toContain("scripts/guard-support.ts");
});

it("sees every module-specifier form", () => {
  const source = ts.createSourceFile(
    "probe.ts",
    [
      'import a from "./a.js";',
      'import type { B } from "./b.js";',
      'export * from "./c.js";',
      'export { d } from "./d.js";',
      'const e = await import("./e.js");',
      'import f = require("./f.js");',
      'vi.mock("./g.js", () => ({}));',
      'await vi.importActual("./h.js");',
      'type I = typeof import("./i.js");',
      'const url = new URL("./not-a-module.js", import.meta.url);',
    ].join("\n"),
    ts.ScriptTarget.Latest,
    true,
  );
  expect(moduleSpecifiers(source).map(({ specifier }) => specifier)).toEqual([
    "./a.js",
    "./b.js",
    "./c.js",
    "./d.js",
    "./e.js",
    "./f.js",
    "./g.js",
    "./h.js",
    "./i.js",
  ]);
});

it("keeps relative imports of TypeScript sources extensionless", () => {
  const listed = (offence: { file: string }) =>
    allowed.some((entry) => entry.file === offence.file);
  expect(
    offences
      .filter((offence) => !listed(offence))
      .map(
        ({ file, line, specifier }) =>
          `${file}:${line} imports ${specifier}; drop the .js extension`,
      ),
    "Relative specifiers name the module without an extension (moduleResolution Bundler); plain-Node apps run a bundle",
  ).toEqual([]);
});

it("keeps the allowlist real", () => {
  for (const entry of allowed) {
    expect(entry.reason.length, entry.file).toBeGreaterThan(30);
    expect(
      offences.some((offence) => offence.file === entry.file),
      `${entry.file} no longer offends: delete the entry`,
    ).toBe(true);
    expect(repoPath(join(repoRoot, entry.file))).toBe(entry.file);
  }
});
