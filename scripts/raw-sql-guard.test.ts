// Raw SQL guard (ADR-0005, data-access standard): the Drizzle query builder is
// the default for tenant-scoped repository code. Raw parameterised SQL, either
// a `pg` client `.query(...)` or a `tx.execute(sql...)` statement, is allowed
// only in the files listed here, each with a cap and the reason it is raw.
// The list is configuration, not suppression: a new file, or a count above its
// cap, fails the test. Lower a cap when a repository moves to the builder, and
// delete the entry when it reaches zero.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it, vi } from "vitest";

// These guards parse much of the repository with the compiler API; on a busy
// machine that outlasts the 10 s default test timeout.
vi.setConfig({ testTimeout: 120_000 });

interface RawSqlAllowance {
  file: string;
  maxCount: number;
  reason: string;
}

const legacy = "legacy raw repository, scheduled for builder migration";
const rawByDesign = (what: string) => `must stay raw: ${what}`;
const rows: Array<[file: string, maxCount: number, reason: string]> = [
  // Connectivity, migrations and settings: raw by construction.
  [
    "packages/database/src/connection.ts",
    7,
    rawByDesign(
      "pool, BEGIN/COMMIT/ROLLBACK, tenant set_config and the pg_roles role check",
    ),
  ],
  [
    "packages/database/src/migrate.ts",
    2,
    rawByDesign(
      "vendor assistant migration SQL and the worker policy DDL loop",
    ),
  ],
  [
    "packages/database/src/migration-check.ts",
    1,
    rawByDesign(
      "the drizzle.__drizzle_migrations history read; the table is the migrator's, not a schema this package declares",
    ),
  ],
  [
    "packages/database/src/with-tenant.ts",
    2,
    rawByDesign("set_config for tenant, actor and product settings"),
  ],
  [
    "products/interview/src/backend/documents/repository.ts",
    2,
    rawByDesign("set_config for the document catalog provisioner"),
  ],
  [
    "products/interview/src/backend/live-session/credential-lookup.ts",
    1,
    rawByDesign("set_config app.session_credential_hash"),
  ],
  [
    "products/interview/src/backend/live-session/session-claim.ts",
    7,
    rawByDesign(
      "set_config app.session_worker and the SKIP LOCKED claim over the undeclared active_session_claims view",
    ),
  ],
  [
    "products/interview/src/backend/live-session/session-purge.ts",
    19,
    rawByDesign(
      "set_config app.session_purge and the pg_constraint coverage query; the delete chains are legacy",
    ),
  ],
  [
    "packages/platform-storage/src/agent-job-worker-repository.ts",
    11,
    rawByDesign(
      "claim sweep and event-sequence CTEs with SKIP LOCKED; simple transitions are legacy",
    ),
  ],
  // Legacy raw repositories awaiting the builder (audit work packages 1-5).
  ...(
    [
      ["apps/web/src/platform/agent-api.ts", 9],
      ["apps/web/src/platform/api.ts", 1],
      ["packages/platform-api/src/router.ts", 3],
      ["packages/platform-storage/src/agent-job-repository.ts", 12],
      ["packages/platform-storage/src/bootstrap.ts", 5],
      ["packages/platform-storage/src/document-artifact-repository.ts", 13],
      ["packages/platform-storage/src/platform-repository.ts", 7],
      ["products/interview/src/backend/api.ts", 8],
      ["products/interview/src/backend/assistant/adapter.ts", 1],
      ["products/interview/src/backend/assistant/workspace.ts", 31],
      ["products/interview/src/backend/briefing/repository.ts", 17],
      ["products/interview/src/backend/briefs/api.ts", 4],
      ["products/interview/src/backend/documents/api.ts", 16],
      ["products/interview/src/backend/documents/context.ts", 3],
      ["products/interview/src/backend/interview-backend.ts", 3],
      ["products/interview/src/backend/live-session/capture-request.ts", 1],
      [
        "products/interview/src/backend/live-session/companion-capability.ts",
        2,
      ],
      ["products/interview/src/backend/live-session/fenced-writes.ts", 11],
      ["products/interview/src/backend/live-session/ingest.ts", 6],
      ["products/interview/src/backend/live-session/owner-capture.ts", 1],
      ["products/interview/src/backend/live-session/owner-input.ts", 2],
      ["products/interview/src/backend/live-session/repository.ts", 4],
      ["products/interview/src/backend/live-session/routes.ts", 5],
      ["products/interview/src/backend/live-session/session-drafts.ts", 1],
      ["products/interview/src/backend/live-session/status-transition.ts", 2],
      ["products/interview/src/backend/plan/repository.ts", 8],
      ["products/interview/src/backend/rehearsal/api.ts", 6],
      ["products/interview/src/backend/studio/host.ts", 1],
      ["products/presentation/src/backend/api.ts", 25],
      ["products/presentation/src/repositories/index.ts", 44],
    ] as const
  ).map(([file, count]): [string, number, string] => [file, count, legacy]),
];
const allowlist: readonly RawSqlAllowance[] = rows.map(
  ([file, maxCount, reason]) => ({ file, maxCount, reason }),
);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scannedRoots = ["apps", "packages", "products", "scripts"];
const ignoredDirectories = new Set([
  "node_modules",
  "dist",
  ".next",
  ".next-e2e",
  ".turbo",
  "drizzle",
]);
// Tests, fixtures and test-only worlds act as the owner or superuser on purpose.
const testSupport =
  /(\.test\.|-fixture\.|\/test-support\/|\/integration\/|\/testing\/|\/hardening\/world\.ts$)/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (
      ignoredDirectories.has(entry.name) ||
      entry.name.startsWith(".next-e2e")
    )
      return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mts)$/.test(entry.name) && !entry.name.endsWith(".d.ts")
      ? [path]
      : [];
  });
}

// Counts `pg` `x.query(<statement>)` calls and Drizzle `x.execute(sql...)`
// statements. A relational `db.query.table.findMany()` is a property access,
// not a call to `.query(`, so builder code is never counted.
function countRawSql(source: string): number {
  const file = ts.createSourceFile(
    "scanned.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  let count = 0;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.arguments.length > 0
    ) {
      const method = node.expression.name.text;
      const first = node.arguments[0] as ts.Expression;
      if (method === "query") count += 1;
      if (method === "execute" && isSqlExpression(first)) count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
}

// `sql`...``, `sql.raw(...)`, `sql.join(...)`, or a call on `sql`.
function isSqlExpression(node: ts.Expression): boolean {
  if (ts.isTaggedTemplateExpression(node))
    return ts.isIdentifier(node.tag) && node.tag.text === "sql";
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression)
  )
    return (
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "sql"
    );
  return false;
}

function productionCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const root of scannedRoots) {
    for (const absolute of sourceFiles(join(repoRoot, root))) {
      const path = relative(repoRoot, absolute).split(sep).join("/");
      if (testSupport.test(path)) continue;
      const count = countRawSql(readFileSync(absolute, "utf8"));
      if (count > 0) counts.set(path, count);
    }
  }
  return counts;
}

it("recognises raw pg queries and sql statements but not builder calls", () => {
  expect(countRawSql('await client.query("SELECT 1");')).toBe(1);
  expect(countRawSql("await pool.query(`SELECT ${x}`, [1]);")).toBe(1);
  expect(countRawSql("await tx.execute(sql`select 1`);")).toBe(1);
  expect(countRawSql("await db.execute(sql.raw(text));")).toBe(1);
  expect(countRawSql("await db.select().from(users).where(eq(a, b));")).toBe(0);
  expect(countRawSql("await db.query.users.findMany();")).toBe(0);
});

it("allows raw SQL only in the allowlisted files, within their caps", () => {
  const caps = new Map(allowlist.map((entry) => [entry.file, entry.maxCount]));
  const violations = [...productionCounts()]
    .filter(([file, count]) => count > (caps.get(file) ?? 0))
    .map(
      ([file, count]) =>
        `${file}: ${count} raw SQL statements, ${caps.get(file) ?? 0} allowed`,
    );
  expect(
    violations,
    `Use the Drizzle query builder (see ADR-0005, data-access standard) or amend the allowlist in scripts/raw-sql-guard.test.ts with a reason:\n${violations.join("\n")}`,
  ).toEqual([]);
});

it("keeps every allowlist entry real, reasoned and tight", () => {
  const counts = productionCounts();
  for (const entry of allowlist) {
    expect(entry.reason.length, entry.file).toBeGreaterThan(20);
    expect(counts.get(entry.file) ?? 0, `${entry.file} cap is stale`).toBe(
      entry.maxCount,
    );
  }
});
