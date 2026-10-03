import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  schemaDrift,
  startDisposablePostgres,
  tablesOf,
} from "@omnitech/database/test-support";
import { afterAll, beforeAll, expect, it } from "vitest";
import * as presentation from "./schema.js";

let pg: DisposablePostgres;
beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
}, 30_000);
afterAll(async () => pg?.stop());

it("declares the presentation tables exactly as the migrations create them", async () => {
  const tables = tablesOf(presentation);
  expect(tables).toHaveLength(16);
  expect(await schemaDrift(pg.owner, tables)).toEqual([]);
});
