import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { expect, it } from "vitest";
import {
  briefingLinks,
  candidacies,
  companies,
  domainTables,
  exerciseAttempts,
  exercises,
  interviewParticipants,
  interviews,
  memberPeople,
  people,
} from "./schema.js";

const dialect = new PgDialect();
const render = (query: SQL | undefined) =>
  query ? dialect.sqlToQuery(query).sql : undefined;

it("lists every tenant-owned table, excluding the shared exercise catalog", () => {
  expect(domainTables).toHaveLength(8);
  for (const table of [
    companies,
    people,
    memberPeople,
    candidacies,
    interviews,
    interviewParticipants,
    briefingLinks,
    exerciseAttempts,
  ]) {
    expect(domainTables).toContain(table);
  }
  expect(domainTables).not.toContain(exercises as never);
});

it("enables RLS with a policy whose WITH CHECK equals its USING on every domain table", () => {
  for (const table of domainTables) {
    const config = getTableConfig(table);
    expect(config.enableRLS, config.name).toBe(true);
    expect(
      config.policies.some((policy) => {
        const using = render(policy.using);
        return using !== undefined && render(policy.withCheck) === using;
      }),
      config.name,
    ).toBe(true);
  }
});

const builtSchema = fileURLToPath(
  new URL("../../../dist/backend/db/schema.js", import.meta.url),
);

// Native Node ESM (as the agent worker loads it) must evaluate the module.
it.skipIf(!existsSync(builtSchema))(
  "loads the built schema under native Node ESM",
  () => {
    const output = execFileSync(
      "node",
      [
        "--input-type=module",
        "-e",
        "import(process.argv[1]).then(m => process.stdout.write(String(m.domainTables.length)))",
        "--",
        builtSchema,
      ],
      { encoding: "utf8" },
    );
    expect(output).toBe("8");
  },
);
