import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  schemaDrift,
  startDisposablePostgres,
  tablesOf,
} from "@omnitech/database/test-support";
import { afterAll, beforeAll, expect, it } from "vitest";
import * as domain from "./schema.js";
import * as studio from "./studio.js";
import * as documents from "./documents.js";

let pg: DisposablePostgres;
beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
}, 30_000);
afterAll(async () => pg?.stop());

it("declares Interview Studio's and the domain's tables exactly as the migrations create them", async () => {
  const tables = [
    ...tablesOf(studio),
    ...tablesOf(domain),
    ...tablesOf(documents),
  ];
  expect(tables).toHaveLength(26);
  expect(await schemaDrift(pg.owner, tables)).toEqual([]);
});
