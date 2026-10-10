// The application-boundary tripwires (ADR-0042). Each rule in
// application-boundaries.ts is measured over the repository and judged against
// its one list in application-boundaries-debt.ts: a new violation fails, and so
// does a listed number that is no longer true, so the debt can only go down.
// To recompute every list from the current tree: pnpm boundaries:update
// (scripts/application-boundaries-update.test.ts; review the diff it makes).
import { describe, expect, it } from "vitest";
import {
  backendImportsInFrontend,
  type Counts,
  explain,
  type FileFacts,
  factsOf,
  handBuiltUi,
  judge,
  looksLikeSql,
  mixedResponsibilities,
  oversizedBackendModules,
  persistenceInTransport,
  type Repository,
  RULES,
  rawForms,
  scanRepository,
  schemaImportsInTransport,
  sqlOutsideRepositories,
  total,
} from "./application-boundaries";
import * as debt from "./application-boundaries-debt";

const repository = scanRepository();
const lists = debt as unknown as Record<string, Record<string, number>>;

describe("application boundaries: the repository", () => {
  it("prints today's count for every rule", () => {
    const report = RULES.map((rule) => {
      const counts = rule.measure(repository);
      return `(${rule.id}) ${rule.debt}: ${total(counts)} in ${counts.size} entries`;
    });
    process.stdout.write(
      `Application boundaries (ADR-0042)\n${report.join("\n")}\n`,
    );
    expect(repository.facts.size).toBeGreaterThan(300);
  });

  for (const rule of RULES) {
    const verdict = judge(
      rule.measure(repository),
      lists[rule.debt] ?? {},
      rule.slack,
    );
    it(`(${rule.id}) no new violation: ${rule.debt}`, () => {
      expect(verdict.added, explain(rule.rule, verdict.added)).toEqual([]);
    });
    it(`(${rule.id}) the listed debt only goes down: ${rule.debt}`, () => {
      expect(
        verdict.paid,
        explain(
          `${rule.debt} lists more than exists. Lower or delete these entries.`,
          verdict.paid,
        ),
      ).toEqual([]);
    });
  }

  it("every rule has its list, and no list is without a rule", () => {
    expect(Object.keys(lists).sort()).toEqual(
      RULES.map((rule) => rule.debt).sort(),
    );
  });
});

// A fixture that breaks each rule must be reported against an empty list.
describe("application boundaries: each tripwire trips", () => {
  const world = (files: Record<string, string>, css: string[] = []) => {
    const facts = new Map<string, FileFacts>();
    for (const [path, source] of Object.entries(files))
      facts.set(path, factsOf(path, source));
    return { facts, stylesheets: css } satisfies Repository;
  };
  const trips = (counts: Counts) => judge(counts, {}).added;
  const SERVICE = "products/demo/src/backend/orders/order.service.ts";
  const ROUTE = "products/demo/src/backend/orders/routes.ts";
  const REPOSITORY = "products/demo/src/backend/orders/repository.ts";
  const SCREEN = "products/demo/src/frontend/orders/order-screen.tsx";

  it("(a) SQL in a service or a route, as a template or as a string", () => {
    const tagged =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text for the scanner, with a template inside it
      "await tx.execute(sql`select id from orders where id = ${id}`);";
    const text =
      'await client.query("UPDATE orders SET paid = true WHERE id = $1", [id]);';
    expect(
      trips(
        sqlOutsideRepositories(world({ [SERVICE]: tagged, [ROUTE]: text })),
      ),
    ).toEqual([`${SERVICE}: 1 (not listed)`, `${ROUTE}: 1 (not listed)`]);
    // The same statements are where they belong in a repository.
    expect(
      trips(sqlOutsideRepositories(world({ [REPOSITORY]: tagged + text }))),
    ).toEqual([]);
    expect(looksLikeSql("Select a file from your computer.")).toBe(false);
    expect(looksLikeSql("Select a template")).toBe(false);
    expect(looksLikeSql("select set_config('app.tenant', $1, true)")).toBe(
      true,
    );
  });

  it("(b) the query builder or a tenant transaction in a route or a screen", () => {
    const route =
      "app.get('/orders', (c) => withTenant(scope, (db) => db.select().from(orders).where(eq(orders.id, id))));";
    expect(trips(persistenceInTransport(world({ [ROUTE]: route })))).toEqual([
      `${ROUTE}: 2 (not listed)`,
    ]);
    expect(
      trips(
        persistenceInTransport(
          world({ [SCREEN]: "await db.insert(orders).values(row);" }),
        ),
      ),
    ).toEqual([`${SCREEN}: 1 (not listed)`]);
    // A service may open the transaction; a Map is not a query builder.
    expect(
      trips(
        persistenceInTransport(
          world({
            [SERVICE]: route,
            [ROUTE]: "seen.delete(id); hash.update(text).digest('hex');",
          }),
        ),
      ),
    ).toEqual([]);
  });

  it("(c) a route importing a table schema", () => {
    expect(
      trips(
        schemaImportsInTransport(
          world({ [ROUTE]: 'import { orders } from "../db/schema";' }),
        ),
      ),
    ).toEqual([`${ROUTE}: 1 (not listed)`]);
    expect(
      trips(
        schemaImportsInTransport(
          world({ [REPOSITORY]: 'import { orders } from "../db/schema";' }),
        ),
      ),
    ).toEqual([]);
  });

  it("(d) a frontend importing backend internals or the database", () => {
    const source =
      'import { loadOrder } from "../../backend/orders/repository";\nimport { withTenant } from "@omnitech/database";';
    expect(
      trips(backendImportsInFrontend(world({ [SCREEN]: source }))),
    ).toEqual([`${SCREEN}: 2 (not listed)`]);
  });

  it("(e) a new backend module over the size limit, and a file mixing three responsibilities", () => {
    const long = Array.from({ length: 401 }, (_, i) => `const v${i} = ${i};`);
    expect(
      trips(oversizedBackendModules(world({ [SERVICE]: long.join("\n") }))),
    ).toEqual([`${SERVICE}: 401 (not listed)`]);
    const mixed = [
      'import { Hono } from "hono";',
      "const body = z.object({ id: z.string() });",
      "app.post('/orders', (c) => tenantTransaction(pool, scope, (tx) => tx.execute(sql`delete from orders`)));",
    ].join("\n");
    expect(trips(mixedResponsibilities(world({ [ROUTE]: mixed })))).toEqual([
      `${ROUTE}: 4 (not listed)`,
    ]);
    // A listed ceiling within ten percent of the real size is not stale.
    const sizes = oversizedBackendModules(
      world({ [SERVICE]: long.join("\n") }),
    );
    expect(judge(sizes, { [SERVICE]: 440 }, 0.1).paid).toEqual([]);
    expect(judge(sizes, { [SERVICE]: 600 }, 0.1).paid).toHaveLength(1);
  });

  it("(f) hand-built UI: raw layout, className, inline style, CSS, raw fields", () => {
    const source = [
      'import "./orders.css";',
      'export const Orders = () => <div className="orders" style={{ gap: 4 }}><input /><Button /></div>;',
    ].join("\n");
    const bucket = "products/demo/src/frontend/orders/";
    expect(
      trips(handBuiltUi(world({ [SCREEN]: source }, [`${bucket}orders.css`]))),
    ).toEqual(
      ["className", "cssImport", "field", "layout", "style", "stylesheet"].map(
        (metric) => `${bucket} ${metric}: 1 (not listed)`,
      ),
    );
  });

  it("(g) a raw form instead of DynamicForm", () => {
    expect(
      trips(
        rawForms(
          world({ [SCREEN]: "export const F = () => <form><Input /></form>;" }),
        ),
      ),
    ).toEqual([`${SCREEN}: 1 (not listed)`]);
    expect(
      trips(
        rawForms(
          world({
            [SCREEN]:
              "export const F = () => <DynamicForm schema={schema} uiSchema={ui} />;",
          }),
        ),
      ),
    ).toEqual([]);
  });

  it("a paid-off entry fails until it is lowered or deleted", () => {
    const counts: Counts = new Map([["a.ts", 2]]);
    expect(judge(counts, { "a.ts": 3, "b.ts": 1 }).paid).toEqual([
      "a.ts: listed 3, now 2: lower it",
      "b.ts: listed 1, now clean: delete the entry",
    ]);
    expect(explain("the rule", ["x"])).toContain("ADR-0042");
    expect(explain("the rule", ["x"])).toContain(
      "bionic/research/references/application-boundaries.md",
    );
  });
});
