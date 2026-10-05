import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { expectedMigrations } from "./migration-names";

const folder = fileURLToPath(new URL("../drizzle", import.meta.url));

it("embeds exactly the migration folders", () => {
  const folders = readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  expect(
    expectedMigrations,
    "src/migration-names.ts is stale against packages/database/drizzle: run `pnpm --filter @omnitech/database run db:names`",
  ).toEqual(folders);
});
