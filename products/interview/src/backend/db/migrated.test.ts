import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  schemaDrift,
  startDisposablePostgres,
  tablesOf,
} from "@omnitech/database/test-support";
import { afterAll, beforeAll, expect, it } from "vitest";
import * as documents from "./documents";
import * as liveSession from "./live-session";
import * as domain from "./schema";
import * as studio from "./studio";

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
    ...tablesOf(liveSession),
  ];
  expect(tables).toHaveLength(32);
  expect(await schemaDrift(pg.owner, tables)).toEqual([]);
});
