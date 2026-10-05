// RLS role guard (ADR-0005, ADR-0023): a superuser or BYPASSRLS role silently
// skips every row-level-security policy, even under FORCE. A database handle
// refuses to serve such a role unless it was created with the explicit
// `allowRlsBypass` opt-in, and this test keeps that opt-in confined:
//   (a) every use of `allowRlsBypass` is in a reasoned allowlist,
//   (b) no file hands the fixture's owner URL (the superuser) to app code, that
//       is to createPlatformDatabase, a DATABASE_URL, or the run queue,
//       except an allowlisted refusal proof,
//   (c) the fixture keeps `owner` as the only opted-in handle, and the refusal
//       message tells a test author to use memberUrl + grantApplicationRole.
// The lists are configuration with reasons, not suppressions: an entry that no
// longer matches anything fails the test.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it, vi } from "vitest";

// These guards parse much of the repository with the compiler API; on a busy
// machine that outlasts the 10 s default test timeout.
vi.setConfig({ testTimeout: 120_000 });

interface Allowance {
  file: string;
  reason: string;
}

const bypassOptIns: readonly Allowance[] = [
  {
    file: "packages/database/src/connection.ts",
    reason: "defines the opt-in and reads it when a handle is created",
  },
  {
    file: "packages/database/src/test-support/postgres.ts",
    reason:
      "the disposable-Postgres fixture's owner handle seeds and migrates as the bootstrap superuser",
  },
  {
    file: "packages/database/src/role-check.test.ts",
    reason: "proves an opted-in handle is served and unopted handles are not",
  },
];

const ownerUrlUses: readonly Allowance[] = [
  {
    file: "packages/database/src/test-support/postgres.ts",
    reason:
      "builds the owner handle, which opts in to bypass for seeding and migrations",
  },
  {
    file: "packages/database/src/connection.test.ts",
    reason:
      "proves a superuser handle without the opt-in is refused on every entry",
  },
  {
    file: "packages/database/src/with-tenant.test.ts",
    reason: "proves withTenant refuses a superuser handle without the opt-in",
  },
  {
    file: "apps/agent-worker/src/main.test.ts",
    reason: "proves the worker refuses to boot on a superuser DATABASE_URL",
  },
];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scannedRoots = ["apps", "packages", "products", "scripts"];
const ignoredDirectories = new Set(["node_modules", "dist", ".next", ".turbo"]);
const ownerUrlLike = /owner.*url/i;
const appConnectionNames = new Set([
  "DATABASE_URL",
  "runQueueConnectionString",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mts)$/.test(entry.name) && !entry.name.endsWith(".d.ts")
      ? [path]
      : [];
  });
}

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(
    "scanned.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function repoFiles(): Array<{ path: string; source: string }> {
  return scannedRoots.flatMap((root) =>
    sourceFiles(join(repoRoot, root)).map((absolute) => ({
      path: relative(repoRoot, absolute).split(sep).join("/"),
      source: readFileSync(absolute, "utf8"),
    })),
  );
}

function mentionsAllowRlsBypass(source: string): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === "allowRlsBypass") found = true;
    ts.forEachChild(node, visit);
  };
  visit(parse(source));
  return found;
}

function nameText(name: ts.PropertyName | ts.Expression): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name)
    ? name.text
    : undefined;
}

// Expressions that hand a URL to app code: createPlatformDatabase(...) args,
// `stubEnv("DATABASE_URL", x)`, `{ DATABASE_URL: x }` or
// `{ runQueueConnectionString: x }` properties, and `env["DATABASE_URL"] = x`.
// A superuser URL in one of them, directly or through a local variable.
function ownerUrlSinks(source: string): string[] {
  const file = parse(source);
  const tainted = new Set<string>();
  const carriesOwnerUrl = (node: ts.Node): boolean => {
    let found = false;
    const visit = (child: ts.Node) => {
      if (
        ts.isIdentifier(child) &&
        (ownerUrlLike.test(child.text) || tainted.has(child.text))
      )
        found = true;
      ts.forEachChild(child, visit);
    };
    visit(node);
    return found;
  };
  const sinks: string[] = [];
  const flag = (what: string, node: ts.Node) => {
    if (carriesOwnerUrl(node))
      sinks.push(
        `${what} (line ${file.getLineAndCharacterOfPosition(node.getStart()).line + 1})`,
      );
  };
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name) && carriesOwnerUrl(node.initializer))
        tainted.add(node.name.text);
    } else if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : "";
      if (callee === "createPlatformDatabase")
        for (const argument of node.arguments)
          flag("createPlatformDatabase", argument);
      const [name, value] = node.arguments;
      if (
        callee === "stubEnv" &&
        name &&
        value &&
        ts.isStringLiteralLike(name) &&
        appConnectionNames.has(name.text)
      )
        flag(`stubEnv ${name.text}`, value);
    } else if (ts.isPropertyAssignment(node)) {
      const name = nameText(node.name);
      if (name && appConnectionNames.has(name)) flag(name, node.initializer);
    } else if (ts.isShorthandPropertyAssignment(node)) {
      if (appConnectionNames.has(node.name.text))
        flag(node.name.text, node.name);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const target = node.left;
      const name = ts.isElementAccessExpression(target)
        ? nameText(target.argumentExpression)
        : ts.isPropertyAccessExpression(target)
          ? target.name.text
          : undefined;
      if (name && appConnectionNames.has(name))
        flag(`${name} assignment`, node.right);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return sinks;
}

const entryFile = "packages/database/src/connection.ts";
const fixtureFile = "packages/database/src/test-support/postgres.ts";

it("recognises opt-ins and owner URLs handed to app code, and nothing else", () => {
  expect(
    mentionsAllowRlsBypass(
      "createPlatformDatabase(u, { allowRlsBypass: true })",
    ),
  ).toBe(true);
  expect(mentionsAllowRlsBypass('const note = "allowRlsBypass";')).toBe(false);
  expect(ownerUrlSinks("createPlatformDatabase(pg.ownerUrl);")).toHaveLength(1);
  expect(
    ownerUrlSinks("const url = pg.ownerUrl; createPlatformDatabase(url);"),
  ).toHaveLength(1);
  expect(
    ownerUrlSinks('vi.stubEnv("DATABASE_URL", server.ownerUrl);'),
  ).toHaveLength(1);
  expect(ownerUrlSinks("run({ DATABASE_URL: pg.ownerUrl });")).toHaveLength(1);
  expect(
    ownerUrlSinks("backend({ runQueueConnectionString: pg.ownerUrl });"),
  ).toHaveLength(1);
  expect(
    ownerUrlSinks('process.env["DATABASE_URL"] = pg.ownerUrl;'),
  ).toHaveLength(1);
  expect(ownerUrlSinks("createPlatformDatabase(pg.memberUrl);")).toHaveLength(
    0,
  );
  expect(ownerUrlSinks("const owner = new URL(pg.ownerUrl);")).toHaveLength(0);
  expect(ownerUrlSinks('vi.stubEnv("OTHER", pg.ownerUrl);')).toHaveLength(0);
});

it("confines allowRlsBypass to the allowlisted files", () => {
  const using = repoFiles()
    .filter(({ source }) => mentionsAllowRlsBypass(source))
    .map(({ path }) => path);
  const allowed = new Set(bypassOptIns.map(({ file }) => file));
  const violations = using.filter((path) => !allowed.has(path));
  expect(
    violations,
    `allowRlsBypass opts a handle out of the row-level-security role check. Use a NOSUPERUSER role (memberUrl + grantApplicationRole) or add the file with a reason to scripts/rls-role-guard.test.ts:\n${violations.join("\n")}`,
  ).toEqual([]);
  for (const entry of bypassOptIns) {
    expect(entry.reason.length, entry.file).toBeGreaterThan(20);
    expect(using, `${entry.file} allowlist entry is stale`).toContain(
      entry.file,
    );
  }
});

it("never hands the superuser URL to app code outside the allowlisted refusal proofs", () => {
  const found = new Map(
    repoFiles()
      .map(({ path, source }): [string, string[]] => [
        path,
        ownerUrlSinks(source),
      ])
      .filter(([, sinks]) => sinks.length > 0),
  );
  const allowed = new Set(ownerUrlUses.map(({ file }) => file));
  const violations = [...found]
    .filter(([path]) => !allowed.has(path))
    .map(([path, sinks]) => `${path}: ${sinks.join(", ")}`);
  expect(
    violations,
    `Run app code as the NOSUPERUSER fixture_member: pass pg.memberUrl after grantApplicationRole(pg.owner). Keep the owner for seeding and migrations only:\n${violations.join("\n")}`,
  ).toEqual([]);
  for (const entry of ownerUrlUses) {
    expect(entry.reason.length, entry.file).toBeGreaterThan(20);
    expect(
      [...found.keys()],
      `${entry.file} allowlist entry is stale`,
    ).toContain(entry.file);
  }
});

it("keeps the fixture's owner opted in and the refusal message pointing at memberUrl", () => {
  const fixture = readFileSync(join(repoRoot, fixtureFile), "utf8");
  expect(fixture).toMatch(
    /owner = createPlatformDatabase\(ownerUrl, \{ allowRlsBypass: true \}\)/,
  );
  expect(fixture).toMatch(/export async function grantApplicationRole/);
  // The refusal message is one string constant in the entry module.
  let message: string | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "roleBypassesRowLevelSecurityMessage" &&
      node.initializer &&
      ts.isStringLiteralLike(node.initializer)
    )
      message = node.initializer.text;
    ts.forEachChild(node, visit);
  };
  visit(parse(readFileSync(join(repoRoot, entryFile), "utf8")));
  expect(message).toMatch(/memberUrl/);
  expect(message).toMatch(/grantApplicationRole/);
});
