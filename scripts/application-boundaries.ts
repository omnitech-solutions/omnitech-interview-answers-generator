// Application boundaries (ADR-0042): the scanners behind the tripwires in
// application-boundaries.test.ts. Each rule is derived mechanically from source
// with the TypeScript compiler API; the debt each rule tolerates today is in
// application-boundaries-debt.ts and may only go down. Layers are recognised by
// what a path is called, never by a required directory structure:
//   repository  **/repositories/**, repository.ts, *-repository.ts,
//               *.repository.ts, a schema declaration (**/db/**, **/schema/**,
//               schema.ts) and packages/database/**
//   transport   api.ts, *-api.ts, routes.ts, router.ts, *.handler.ts,
//               **/handlers/** and a Next.js route.ts
//   frontend    products/*/src/frontend/**
//   UI          frontend plus apps/web
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import {
  importSites,
  isTestSupportPath,
  packageNameOf,
  repoRoot,
  sourcePattern,
  walk,
} from "./guard-support";

export const ADR = "ADR-0042";
export const ADR_PATH =
  "bionic/adrs/ADR-0042-application-boundaries-contracts-domain-services-r.md";
export const REFERENCE = "bionic/research/references/application-boundaries.md";
export const DEBT = "scripts/application-boundaries-debt.ts";

// ---------------------------------------------------------------------------
// Layers

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export const isRepositoryPath = (path: string): boolean =>
  path.startsWith("packages/database/") ||
  /\/repositories\//.test(path) ||
  /(^|[-./])repository\.ts$/.test(basename(path)) ||
  /\/(db|schema)\//.test(path) ||
  basename(path) === "schema.ts";

export const isTransportPath = (path: string): boolean =>
  /^(api|routes|router|route)\.ts$/.test(basename(path)) ||
  /-api\.ts$/.test(basename(path)) ||
  /\.handler\.ts$/.test(basename(path)) ||
  /\/handlers\//.test(path);

export const isFrontendPath = (path: string): boolean =>
  /^products\/[^/]+\/src\/frontend\//.test(path);

export const isUiPath = (path: string): boolean =>
  isFrontendPath(path) || path.startsWith("apps/web/");

/** A product's backend side: everything in a product that is not its frontend. */
export const isBackendModulePath = (path: string): boolean =>
  /^products\/[^/]+\/src\//.test(path) &&
  !isFrontendPath(path) &&
  path.endsWith(".ts");

/** Not shipped: tests, fixtures, kits, probes, stories and generated icons. */
export const isExempt = (path: string): boolean =>
  isTestSupportPath(path) ||
  /(-probe\.|\.stories\.|\/fixtures\/|\/icons\/generated)/.test(path);

// ---------------------------------------------------------------------------
// Facts of one file

export type Responsibility =
  | "transport"
  | "service"
  | "persistence"
  | "contracts"
  | "integration"
  | "presentation";

export interface UiFacts {
  /** Raw layout and text elements: div, span, section, p, headings, lists. */
  layout: number;
  className: number;
  style: number;
  cssImport: number;
  /** Raw input, select and textarea. */
  field: number;
  /** Raw form elements. */
  form: number;
}

export interface FileFacts {
  /** SQL text: `sql` templates, and strings or templates that hold a statement. */
  sql: number;
  /** Drizzle query-builder chains: select/insert/update/delete with a clause. */
  builder: number;
  /** withTenant, tenantTransaction and enterTenant calls. */
  tenantCalls: number;
  /** Imports of a table schema (a db/ or schema module). */
  schemaImports: number;
  /** Imports of backend internals or a database package. */
  backendImports: number;
  lines: number;
  responsibilities: Responsibility[];
  ui: UiFacts;
}

const LAYOUT_TAGS = new Set([
  "div",
  "span",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "nav",
  "aside",
  "p",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);
const FIELD_TAGS = new Set(["input", "select", "textarea"]);
const TENANT_CALLS = new Set([
  "withTenant",
  "tenantTransaction",
  "enterTenant",
]);
const BUILDER_ROOTS = new Set([
  "select",
  "selectDistinct",
  "selectDistinctOn",
  "insert",
  "update",
  "delete",
]);
const BUILDER_CLAUSES = new Set([
  "from",
  "values",
  "set",
  "where",
  "returning",
  "onConflictDoUpdate",
  "onConflictDoNothing",
]);
/** Packages a frontend may never import: persistence and its drivers. */
const DATABASE_PACKAGES = new Set([
  "@omnitech/database",
  "@omnitech/platform-storage",
  "@omnitech/interview-storage",
  "drizzle-orm",
  "drizzle-kit",
  "pg",
  "postgres",
]);

// A statement, not prose: the shape of the first clause, anywhere SQL is
// written as text rather than through the `sql` tag.
const SQL_TEXT =
  /^\s*(select\s[\s\S]*\sfrom\s+[\w."]+|select\s+(set_config|pg_|count\(|1\b|exists\b|now\(\))|insert\s+into\s|update\s+[\w."]+\s+set\s|delete\s+from\s|with\s+[\w"]+\s+as\s*\(|(create|alter|drop)\s+(table|index|policy|schema|view|role|type|extension|or\s+replace)\b|truncate\s|lock\s+table\s|(begin|commit|rollback)\s*;?\s*$|set\s+(local\s+)?(role|search_path)\b)/i;

// "Select a file from your computer" is prose: a select needs a sign of SQL.
const SELECT_FROM = /^\s*select\s[\s\S]*\sfrom\s/i;
const SQL_SIGN =
  /\$\d|\*|=|\(|\b(where|join|limit|order by|group by)\b|[a-z]_[a-z]|\w\.\w/i;

export const looksLikeSql = (text: string): boolean =>
  SQL_TEXT.test(text) && (!SELECT_FROM.test(text) || SQL_SIGN.test(text));

function resolveRelative(from: string, specifier: string): string {
  const parts = from.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  return parts.join("/");
}

const isSchemaModule = (resolved: string): boolean =>
  /\/(db|schema)(\/|$)/.test(resolved) || /(^|[-/.])schemas?$/.test(resolved);

const isSqlTag = (node: ts.Node): node is ts.TaggedTemplateExpression =>
  ts.isTaggedTemplateExpression(node) &&
  ((ts.isIdentifier(node.tag) && node.tag.text === "sql") ||
    (ts.isPropertyAccessExpression(node.tag) &&
      ts.isIdentifier(node.tag.expression) &&
      node.tag.expression.text === "sql"));

const calleeName = (node: ts.CallExpression): string | undefined =>
  ts.isIdentifier(node.expression)
    ? node.expression.text
    : ts.isPropertyAccessExpression(node.expression)
      ? node.expression.name.text
      : undefined;

/** Everything the rules need from one file. `path` decides nothing here. */
export function factsOf(path: string, source: string): FileFacts {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const facts: FileFacts = {
    sql: 0,
    builder: 0,
    tenantCalls: 0,
    schemaImports: 0,
    backendImports: 0,
    lines: source.split("\n").length,
    responsibilities: [],
    ui: { layout: 0, className: 0, style: 0, cssImport: 0, field: 0, form: 0 },
  };
  let jsx = false;
  let zodObjects = 0;
  let fetchCalls = 0;
  const valueImports = new Set<string>();

  for (const site of importSites(file)) {
    const { specifier } = site;
    if (/\.css$/.test(specifier)) facts.ui.cssImport += 1;
    if (specifier.startsWith(".")) {
      const resolved = resolveRelative(path, specifier);
      if (isSchemaModule(resolved)) facts.schemaImports += 1;
      if (/\/src\/backend(\/|$)|\/repositories(\/|$)/.test(resolved))
        facts.backendImports += 1;
    } else {
      const name = packageNameOf(specifier);
      if (!site.typeOnly) valueImports.add(name).add(specifier);
      if (DATABASE_PACKAGES.has(name)) facts.backendImports += 1;
      if (/\/(db|schema)$/.test(specifier)) facts.schemaImports += 1;
      if (/^@omnitech\/product-[^/]+\/backend/.test(specifier))
        facts.backendImports += 1;
    }
  }

  const visit = (node: ts.Node, insideSql: boolean) => {
    let inSql = insideSql;
    if (isSqlTag(node)) {
      if (!insideSql) facts.sql += 1;
      inSql = true;
    } else if (
      !insideSql &&
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateExpression(node)) &&
      !ts.isImportDeclaration(node.parent) &&
      looksLikeSql(
        ts.isTemplateExpression(node) ? node.getText().slice(1, -1) : node.text,
      )
    ) {
      facts.sql += 1;
      inSql = true;
    } else if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name && TENANT_CALLS.has(name)) facts.tenantCalls += 1;
      if (name === "fetch" && ts.isIdentifier(node.expression)) fetchCalls += 1;
      if (
        name === "object" &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "z"
      )
        zodObjects += 1;
      // `.select().from(...)`, `.insert(t).values(...)`, `.update(t).set(...)`,
      // `.delete(t).where(...)`: a builder root that carries a clause.
      if (
        name &&
        BUILDER_CLAUSES.has(name) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isCallExpression(node.expression.expression) &&
        ts.isPropertyAccessExpression(node.expression.expression.expression) &&
        BUILDER_ROOTS.has(node.expression.expression.expression.name.text)
      )
        facts.builder += 1;
    } else if (
      ts.isJsxOpeningElement(node) ||
      ts.isJsxSelfClosingElement(node)
    ) {
      jsx = true;
      if (ts.isIdentifier(node.tagName)) {
        const tag = node.tagName.text;
        if (LAYOUT_TAGS.has(tag)) facts.ui.layout += 1;
        if (FIELD_TAGS.has(tag)) facts.ui.field += 1;
        if (tag === "form") facts.ui.form += 1;
      }
    } else if (ts.isJsxFragment(node)) {
      jsx = true;
    } else if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
      if (node.name.text === "className") facts.ui.className += 1;
      if (node.name.text === "style") facts.ui.style += 1;
    }
    ts.forEachChild(node, (child) => visit(child, inSql));
  };
  visit(file, false);

  const has = (...names: string[]) =>
    [...valueImports].some((name) => names.includes(name));
  if (
    has("hono", "next/server") ||
    [...valueImports].some((name) => name.startsWith("hono/"))
  )
    facts.responsibilities.push("transport");
  if (facts.tenantCalls > 0) facts.responsibilities.push("service");
  if (facts.sql + facts.builder > 0) facts.responsibilities.push("persistence");
  if (zodObjects > 0) facts.responsibilities.push("contracts");
  if (has("@omnitech/ai-engine") || fetchCalls > 0)
    facts.responsibilities.push("integration");
  if (jsx) facts.responsibilities.push("presentation");
  return facts;
}

// ---------------------------------------------------------------------------
// The repository

export interface Repository {
  facts: Map<string, FileFacts>;
  stylesheets: string[];
}

export function scanRepository(): Repository {
  const facts = new Map<string, FileFacts>();
  for (const root of ["apps", "packages", "products"])
    for (const path of walk(root, sourcePattern)) {
      if (isExempt(path) || !/\.tsx?$/.test(path)) continue;
      const absolute = join(repoRoot, path);
      // Another worker may delete a file between the listing and the read.
      if (!existsSync(absolute)) continue;
      facts.set(path, factsOf(path, readFileSync(absolute, "utf8")));
    }
  const stylesheets = ["products", "apps/web"]
    .flatMap((root) => walk(root, /\.css$/))
    .filter(isUiPath);
  return { facts, stylesheets };
}

// ---------------------------------------------------------------------------
// The rules: each yields "key -> count" for what breaks it today

export type Counts = Map<string, number>;

const collect = (
  repository: Repository,
  include: (path: string) => boolean,
  count: (facts: FileFacts) => number,
): Counts => {
  const counts: Counts = new Map();
  for (const [path, facts] of repository.facts) {
    if (!include(path)) continue;
    const n = count(facts);
    if (n > 0) counts.set(path, n);
  }
  return counts;
};

/** (a) SQL text outside a repository, the database package and schemas. */
export const sqlOutsideRepositories = (repository: Repository): Counts =>
  collect(
    repository,
    (path) => !isRepositoryPath(path),
    (facts) => facts.sql,
  );

/** (b) Query builder or a tenant transaction in transport or frontend code. */
export const persistenceInTransport = (repository: Repository): Counts =>
  collect(
    repository,
    (path) =>
      (isTransportPath(path) || isFrontendPath(path)) &&
      !isRepositoryPath(path),
    (facts) => facts.builder + facts.tenantCalls,
  );

/** (c) A route module importing a table schema. */
export const schemaImportsInTransport = (repository: Repository): Counts =>
  collect(repository, isTransportPath, (facts) => facts.schemaImports);

/** (d) A product frontend importing backend internals or a database package. */
export const backendImportsInFrontend = (repository: Repository): Counts =>
  collect(repository, isFrontendPath, (facts) => facts.backendImports);

export const MAX_BACKEND_LINES = 400;

/** (e) Backend modules over the size limit: path -> lines. */
export const oversizedBackendModules = (repository: Repository): Counts =>
  collect(
    repository,
    // A schema declaration is one table after another, not a use case.
    (path) => isBackendModulePath(path) && !/\/(db|schema)\//.test(path),
    (facts) => (facts.lines > MAX_BACKEND_LINES ? facts.lines : 0),
  );

export const MAX_RESPONSIBILITIES = 2;

/** (e) Files mixing three or more responsibilities: path -> how many. */
export const mixedResponsibilities = (repository: Repository): Counts =>
  collect(
    repository,
    (path) => /^(products|packages)\//.test(path) || isUiPath(path),
    (facts) =>
      facts.responsibilities.length > MAX_RESPONSIBILITIES
        ? facts.responsibilities.length
        : 0,
  );

export const UI_METRICS = [
  "layout",
  "className",
  "style",
  "cssImport",
  "field",
  "stylesheet",
] as const;
export type UiMetric = (typeof UI_METRICS)[number];

/** The directory a UI file is counted under (a screen, not a file). */
export function uiBucket(path: string): string {
  const parts = path.split("/").slice(0, -1);
  const depth = path.startsWith("apps/web/") ? 3 : 6;
  return `${parts.slice(0, depth).join("/")}/`;
}

/** (f) Hand-built UI per screen directory: "bucket metric" -> count. */
export function handBuiltUi(repository: Repository): Counts {
  const counts: Counts = new Map();
  const add = (path: string, metric: UiMetric, n: number) => {
    if (n === 0) return;
    const key = `${uiBucket(path)} ${metric}`;
    counts.set(key, (counts.get(key) ?? 0) + n);
  };
  for (const [path, facts] of repository.facts) {
    if (!isUiPath(path)) continue;
    add(path, "layout", facts.ui.layout);
    add(path, "className", facts.ui.className);
    add(path, "style", facts.ui.style);
    add(path, "cssImport", facts.ui.cssImport);
    add(path, "field", facts.ui.field);
  }
  for (const path of repository.stylesheets) add(path, "stylesheet", 1);
  return counts;
}

/** (g) Raw forms: a form is declared as data and rendered by DynamicForm. */
export const rawForms = (repository: Repository): Counts =>
  collect(repository, isUiPath, (facts) => facts.ui.form);

// ---------------------------------------------------------------------------
// The ratchet

export interface Verdict {
  /** Not listed, or above its listed number: a new violation. */
  added: string[];
  /** Listed above what exists: the debt was paid, lower or delete the entry. */
  paid: string[];
}

/**
 * `slack` is for sizes only: a listed ceiling may sit that fraction above the
 * real size before it is stale, so an unrelated edit does not fail the gate.
 */
export function judge(
  actual: Counts,
  allowed: Readonly<Record<string, number>>,
  slack = 0,
): Verdict {
  const verdict: Verdict = { added: [], paid: [] };
  for (const [key, count] of actual) {
    const max = allowed[key] ?? 0;
    if (count > max)
      verdict.added.push(
        max === 0
          ? `${key}: ${count} (not listed)`
          : `${key}: ${count}, listed ${max}`,
      );
  }
  for (const [key, max] of Object.entries(allowed)) {
    const count = actual.get(key) ?? 0;
    if (count < Math.floor(max * (1 - slack)))
      verdict.paid.push(
        count === 0
          ? `${key}: listed ${max}, now clean: delete the entry`
          : `${key}: listed ${max}, now ${count}: lower it`,
      );
  }
  verdict.added.sort();
  verdict.paid.sort();
  return verdict;
}

export const total = (counts: Counts): number =>
  [...counts.values()].reduce((sum, n) => sum + n, 0);

/** What a failing tripwire prints: the rule, the decision and where to read. */
export const explain = (rule: string, lines: string[]): string =>
  [
    `Application boundaries (${ADR}): ${rule}`,
    `Decision: ${ADR_PATH}`,
    `How to fix it: ${REFERENCE}`,
    `The listed debt (may only go down): ${DEBT}`,
    ...lines.map((line) => `  ${line}`),
  ].join("\n");

export interface Rule {
  /** The letter the brief and the reference page use. */
  id: string;
  /** The export of application-boundaries-debt.ts that lists today's debt. */
  debt: string;
  rule: string;
  /** The comment above the rule's list in the debt file. */
  note: string;
  measure: (repository: Repository) => Counts;
  /** Sizes only: how far a listed ceiling may sit above the real size. */
  slack?: number;
}

export const RULES: readonly Rule[] = [
  {
    id: "a",
    debt: "sqlOutsideRepositories",
    note: "SQL text outside a repository, a schema declaration and packages/database: path -> statements. Each is a statement to move into a repository method (ADR-0042 point 1). ADR-0023 still decides which of them may stay raw there.",
    rule: "SQL text (a `sql` template or a statement in a string) appears only in a repository module, a schema declaration and packages/database. Move the statement into a repository method and call it from a service.",
    measure: sqlOutsideRepositories,
  },
  {
    id: "b",
    debt: "persistenceInTransport",
    note: "Query-builder chains and tenant transactions inside a route, a handler or a frontend file: path -> sites. The route delegates; the service owns the transaction (points 2 and 3).",
    rule: "A route or handler (and any frontend file) holds no Drizzle query-builder chain and opens no tenant transaction (withTenant, tenantTransaction, enterTenant). The route parses, authorises and delegates to one service call; the service owns the transaction.",
    measure: persistenceInTransport,
  },
  {
    id: "c",
    debt: "schemaImportsInTransport",
    note: "Route modules that import a table schema: path -> imports (point 2).",
    rule: "A route or handler imports no table schema (a db/ or schema module). It speaks contracts; only a repository knows the tables.",
    measure: schemaImportsInTransport,
  },
  {
    id: "d",
    debt: "backendImportsInFrontend",
    note: "Product frontend files importing backend internals or a database package: path -> imports (point 7).",
    rule: "A product frontend imports no backend internals and no database package. It reaches the backend through its typed API client and shares shapes through a contracts package.",
    measure: backendImportsInFrontend,
  },
  {
    id: "e-size",
    debt: "oversizedBackendModules",
    note: "Backend modules over 400 lines: path -> a ceiling on its lines (its size when listed, rounded up to 25). A file may not grow past its ceiling; a ceiling more than ten percent above the real size is stale and must be lowered; under 400 lines the entry is deleted (point 8).",
    rule: `A backend module stays at or under ${MAX_BACKEND_LINES} lines. Split it by responsibility (repository, domain, service, thin route), never by line count.`,
    measure: oversizedBackendModules,
    slack: 0.1,
  },
  {
    id: "e-mixed",
    debt: "mixedResponsibilities",
    note: "Files mixing three or more of transport, service, persistence, contracts, integration and presentation: path -> how many (point 8).",
    rule: `No file mixes more than ${MAX_RESPONSIBILITIES} of: transport (hono, next/server), service (a tenant transaction), persistence (SQL or the builder), contracts (zod schemas), integration (the AI engine, fetch) and presentation (JSX).`,
    measure: mixedResponsibilities,
  },
  {
    id: "f",
    debt: "handBuiltUi",
    note: 'Hand-built UI per screen directory of the product frontends and apps/web: "directory metric" -> count, where the metric is a raw layout element, a className, an inline style, a CSS import, a stylesheet file or a raw input/select/textarea (point 7). The audit behind it is bionic/briefs/BRIEF-web-app-on-the-ui-library-only.md. Raw buttons, dialogs and tables stay with scripts/ui-migration-audit.ts.',
    rule: "Product frontends and apps/web are composed from UI library parts: no new raw layout element, className, inline style, stylesheet, CSS import or raw input/select/textarea. Extend the library (an option before a variant), then compose.",
    measure: handBuiltUi,
  },
  {
    id: "g",
    debt: "rawForms",
    note: "Raw <form> elements: path -> count. A form is declared as data and rendered by DynamicForm; a server action with no visible field is the one kind expected to stay (point 7).",
    rule: "A form is declared as data and rendered by the library's DynamicForm. A new raw <form> fails.",
    measure: rawForms,
  },
];

const DEBT_HEADER = `// The debt the application-boundary tripwires tolerate today (ADR-0042), one
// list per rule of scripts/application-boundaries.ts. Configuration, not
// suppression: scripts/application-boundaries.test.ts fails on anything that is
// not listed or is above its number, and also on a number above what exists,
// so each list can only shrink. When a refactor pays debt, lower the number in
// the same change; when a file is clean, delete its entry. Never raise a number
// to make a change pass: move the code to its layer instead
// (bionic/research/references/application-boundaries.md).
// Recompute every list from the current tree (at integration, or after a
// refactor; review the diff: a number that rose is a new violation):
//   pnpm boundaries:update
// GENERATED by that command; the comments come from RULES.

type Debt = Readonly<Record<string, number>>;
`;

const wrap = (text: string): string => {
  const lines: string[] = [];
  let line = "//";
  for (const word of text.split(" ")) {
    if (line.length + word.length + 1 > 80) {
      lines.push(line);
      line = "//";
    }
    line += ` ${word}`;
  }
  return [...lines, line].join("\n");
};

/** The whole debt file for the tree as it is now. */
export function renderDebtFile(repository: Repository): string {
  const lists = RULES.map((rule) => {
    const counts = rule.measure(repository);
    // A size is listed as a ceiling with a little room, not to the line.
    if (rule.slack)
      for (const [key, lines] of counts)
        counts.set(key, Math.ceil(lines / 25) * 25);
    return `${wrap(`(${rule.id}) ${rule.note}`)}\n${renderDebt(rule.debt, counts)}`;
  });
  return `${[DEBT_HEADER, ...lists].join("\n")}\n`;
}

/** The debt lists as source, for pasting into application-boundaries-debt.ts. */
export function renderDebt(name: string, counts: Counts): string {
  const rows = [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `  ${JSON.stringify(key)}: ${count},`);
  return rows.length === 0
    ? `export const ${name}: Debt = {};`
    : `export const ${name}: Debt = {\n${rows.join("\n")}\n};`;
}
