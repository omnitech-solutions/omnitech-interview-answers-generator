import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { repoRoot } from "./guard-support";

// bionic/arch/data-model.md is rendered by the project extractor wired in
// .bionic.yml (Crux has no Drizzle reader). This guard runs it with python3
// (stdlib only) on the real repository and checks it against the committed
// drizzle-kit snapshot, using Crux's own override contract.
const drizzle = join(repoRoot, "packages/database/drizzle");
const folder = readdirSync(drizzle)
  .filter(
    (name) =>
      name.startsWith("2") && existsSync(join(drizzle, name, "snapshot.json")),
  )
  .sort()
  .at(-1) as string;
const snapshotPath = `packages/database/drizzle/${folder}/snapshot.json`;
const snapshotBytes = readFileSync(join(repoRoot, snapshotPath));
const ddl = JSON.parse(snapshotBytes.toString("utf8")).ddl as {
  entityType: string;
  columns?: string[];
  schema?: string;
  table?: string;
  schemaTo?: string;
  tableTo?: string;
  columnsTo?: string[];
  name?: string;
}[];
const count = (type: string) => ddl.filter((e) => e.entityType === type);

const spec = /^ {2}data-model: (\S+):(\w+)$/m.exec(
  readFileSync(join(repoRoot, ".bionic.yml"), "utf8"),
);
const [, modulePath = "", functionName = ""] = spec ?? [];

const python = `
import importlib.util, inspect, json, sys
spec = importlib.util.spec_from_file_location("extractor", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
fn = getattr(module, sys.argv[2])
positional = [p for p in inspect.signature(fn).parameters.values()
              if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
first = fn(sys.argv[3], "bionic")
second = fn(sys.argv[3], "bionic")
print(json.dumps({"positional": len(positional), "first": first, "same": first == second}))
`;
const run = () =>
  JSON.parse(
    execFileSync(
      "python3",
      ["-c", python, join(repoRoot, modulePath), functionName, repoRoot],
      { encoding: "utf8" },
    ),
  ) as {
    positional: number;
    first: [string, Record<string, string>];
    same: boolean;
  };
const result = run();
const [markdown, sources] = result.first;

it(".bionic.yml wires data-model to an existing extractor with Crux's (root, docs_dir) signature", () => {
  expect(spec, "arch_extractors data-model entry").not.toBeNull();
  expect(existsSync(join(repoRoot, modulePath)), modulePath).toBe(true);
  expect(result.positional).toBe(2);
});

it("renders the Crux entity table with one row per snapshot column and table", () => {
  expect(markdown.startsWith("# Data model\n")).toBe(true);
  expect(markdown).toContain("| table | column | type |");
  const rows = markdown
    .split("\n")
    .filter((line) => /^\| \S+\.\S+ \| `/.test(line));
  expect(rows).toHaveLength(count("columns").length);
  expect(new Set(rows.map((row) => row.split(" | ")[0])).size).toBe(
    count("tables").length,
  );
  expect(markdown).toContain(`## Entities (${count("tables").length} tables)`);
});

it("lists every foreign key under Relations", () => {
  const relations = markdown.slice(markdown.indexOf("## Relations"));
  for (const fk of count("fks")) {
    const line = `- \`${fk.schema}.${fk.table}\` (${fk.columns?.join(", ")}) → \`${fk.schemaTo}.${fk.tableTo}\` (${fk.columnsTo?.join(", ")})`;
    expect(relations, fk.name).toContain(line);
  }
});

it("is byte-stable and hashes exactly the latest snapshot", () => {
  expect(result.same).toBe(true);
  expect(Object.keys(sources)).toEqual([snapshotPath]);
  expect(sources[snapshotPath]).toMatch(/^[0-9a-f]{64}$/);
  expect(sources[snapshotPath]).toBe(
    createHash("sha256").update(snapshotBytes).digest("hex"),
  );
});

// The committed arch pages must come from the extractor. Crux ignores it
// without CRUX_ARCH_ALLOW_OVERRIDES=1 and writes a stub, so fail loudly.
const flagHint =
  "arch/data-model.md is a stub although arch_extractors is configured: derive-arch was run without CRUX_ARCH_ALLOW_OVERRIDES=1. Re-run with `pnpm docs:arch`.";

it("committed arch/data-model.md is populated, not Crux's stub", () => {
  const page = readFileSync(
    join(repoRoot, "bionic/arch/data-model.md"),
    "utf8",
  );
  const stubbed =
    page.includes("no extractor for this stack") ||
    !/\n## Entities \(\d+ tables\)\n/.test(page) ||
    !page.includes("| table | column |");
  expect(stubbed, flagHint).toBe(false);

  const coverage = JSON.parse(
    readFileSync(join(repoRoot, "bionic/arch/_meta/coverage.json"), "utf8"),
  ) as {
    concerns: {
      concern: string;
      verdict: string;
      n_entities: number;
      inputs_found: string[];
    }[];
  };
  const entry = coverage.concerns.find((c) => c.concern === "data-model");
  expect(entry?.verdict, flagHint).toBe("populated");
  expect(entry?.inputs_found, flagHint).toContain(modulePath);
});

it("committed arch/data-model.md equals the freshly extracted markdown byte for byte", () => {
  const committed = readFileSync(
    join(repoRoot, "bionic/arch/data-model.md"),
    "utf8",
  );
  expect(
    committed === markdown,
    "bionic/arch/data-model.md is stale: the latest drizzle snapshot changed without regenerating it. Run `pnpm docs:arch` and commit the result.",
  ).toBe(true);
});

it("says why it wrote the stub when the snapshot is unreadable, never raising", () => {
  const root = mkdtempSync(join(tmpdir(), "arch-extractor-"));
  try {
    const dir = join(root, "packages/database/drizzle/2099_corrupt");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "snapshot.json"), "{ not json SECRET-CONTENT");
    const probe = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("extractor", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(json.dumps(getattr(module, sys.argv[2])(sys.argv[3], "bionic")))
`;
    const run = spawnSync(
      "python3",
      ["-c", probe, join(repoRoot, modulePath), functionName, root],
      { encoding: "utf8" },
    );
    expect(run.status).toBe(0);
    const [stub, stubSources] = JSON.parse(run.stdout) as [
      string,
      Record<string, string>,
    ];
    expect(stub).toContain("no extractor for this stack");
    expect(stubSources).toEqual({});
    expect(run.stderr).toContain("JSONDecodeError");
    expect(run.stderr).not.toContain("SECRET-CONTENT");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
