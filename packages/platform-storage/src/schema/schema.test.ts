import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  schemaDrift,
  startDisposablePostgres,
  tablesOf,
} from "@omnitech/database/test-support";
import { afterAll, beforeAll, expect, it } from "vitest";
import * as ai from "./ai";
import * as platform from "./platform";

let pg: DisposablePostgres;
beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
}, 30_000);
afterAll(async () => pg?.stop());

it("declares the platform and AI tables exactly as the migrations create them", async () => {
  const tables = [...tablesOf(platform), ...tablesOf(ai)];
  expect(tables).toHaveLength(21);
  expect(await schemaDrift(pg.owner, tables)).toEqual([]);
});
