// The three Active Session settings are each set by one small owning module.
// A fake client records the statements, so no database is needed here; the
// security suite (db/live-session-security.test.ts) runs them for real.
import type { DatabaseClient, PlatformDatabase } from "@omnitech/database";
import { expect, it } from "vitest";
import { withCredentialLookup } from "./credential-lookup";
import { asSessionWorker, CLAIM_COLUMNS, CLAIM_SELECT } from "./session-claim";
import { asSessionPurge } from "./session-purge";

function fakeDatabase() {
  const statements: { text: string; values: unknown[] | undefined }[] = [];
  const client: DatabaseClient = {
    query: (async (text: string, values?: unknown[]) => {
      // The database package's own role check asks who the role is; a normal
      // role answers, and that lookup is not one of the module's statements.
      if (text.includes("from pg_roles"))
        return {
          rows: [{ bypass: false }],
          rowCount: 1,
          command: "",
          oid: 0,
          fields: [],
        };
      statements.push({ text, values });
      return { rows: [], rowCount: 0, command: "", oid: 0, fields: [] };
    }) as DatabaseClient["query"],
  };
  const database = {
    transaction: async <R>(work: (c: DatabaseClient) => Promise<R>) =>
      work(client),
    tenantTransaction: async <R>(
      tenantId: string,
      work: (c: DatabaseClient) => Promise<R>,
    ) => {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [
        tenantId,
      ]);
      return work(client);
    },
  } as unknown as PlatformDatabase;
  return { database, statements };
}

it("sets the claim setting before the work and returns the work's result", async () => {
  const { database, statements } = fakeDatabase();
  const result = await asSessionWorker(database, async (client) => {
    await client.query("SELECT 1");
    return "claimed";
  });
  expect(result).toBe("claimed");
  expect(statements.map((s) => s.text)).toEqual([
    "SELECT set_config('app.session_worker', 'on', true)",
    "SELECT 1",
  ]);
});

it("projects the claim from the view without the credential hash", () => {
  expect(CLAIM_COLUMNS).toContain("tenant_id");
  expect(CLAIM_COLUMNS).toContain("owner_user_id");
  expect(CLAIM_COLUMNS).toContain("id");
  for (const hidden of [
    "credential_hash",
    "sources",
    "interview_id",
    "candidacy_id",
    "profile_id",
    "rehearsal_run_id",
  ])
    expect(CLAIM_COLUMNS as readonly string[]).not.toContain(hidden);
  expect(CLAIM_SELECT).toMatch(/FROM interview\.active_session_claims$/);
  expect(CLAIM_SELECT).not.toMatch(/credential_hash|\*/);
});

it("sets the credential hash in the route's tenant, as a bound parameter", async () => {
  const { database, statements } = fakeDatabase();
  await withCredentialLookup(
    database,
    { tenantId: "tenant-1", credentialHash: "hash-1" },
    async (client) => {
      await client.query("SELECT 1");
    },
  );
  expect(statements).toEqual([
    {
      text: "SELECT set_config('app.tenant_id', $1, true)",
      values: ["tenant-1"],
    },
    {
      text: "SELECT set_config('app.session_credential_hash', $1, true)",
      values: ["hash-1"],
    },
    { text: "SELECT 1", values: undefined },
  ]);
});

it("opens the purge in the owner's actor scope with the purge setting on", async () => {
  const { database, statements } = fakeDatabase();
  await asSessionPurge(
    database,
    { tenantId: "tenant-1", ownerUserId: "owner-1" },
    async (client) => {
      await client.query("SELECT 1");
    },
  );
  expect(statements.map((s) => s.text)).toEqual([
    "SELECT set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true)",
    // Product-scoped tables (the Workspace draft purger) need the product too.
    "SELECT set_config('app.product_id', $1, true)",
    "SELECT set_config('app.session_purge', 'on', true)",
    "SELECT 1",
  ]);
  expect(statements[0]?.values).toEqual(["tenant-1", "owner-1"]);
  expect(statements[1]?.values).toEqual(["omnitech.interview"]);
});
