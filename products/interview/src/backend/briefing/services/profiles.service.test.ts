import { expect, it } from "vitest";
import type {
  WorkspaceDatabasePort,
  WorkspaceTransaction,
} from "../../assistant/workspace";
import { matrixHash } from "../domain/profiles";
import { BriefingRepository } from "../repository";
import {
  getProfileRevision,
  importProfile,
  listAvailableProfiles,
  requireCurrentProfile,
  syncDefaultProfile,
} from "./profiles.service";

const scope = {
  tenantId: "tenant-a",
  actorId: "alice",
  productId: "omnitech.interview",
};
const matrix = {
  candidate: { name: "Synthetic Candidate" },
  roles: [
    {
      company: "Acme",
      title: "Engineer",
      proof_points: ["Mentored engineers"],
    },
  ],
};
function fixture(
  respond: (sql: string) => readonly Record<string, unknown>[] = () => [],
) {
  const events: string[] = [];
  const statements: { sql: string; values: readonly unknown[] | undefined }[] =
    [];
  const database: WorkspaceDatabasePort = {
    async tenantTransaction(tenantId, fn) {
      events.push(`begin:${tenantId}`);
      const tx: WorkspaceTransaction = {
        async query(sql, values) {
          statements.push({ sql, values });
          return sql.includes("pg_roles") ? [{ bypass: false }] : respond(sql);
        },
      };
      try {
        const result = await fn(tx);
        events.push("commit");
        return result;
      } catch (error) {
        events.push("rollback");
        throw error;
      }
    },
  };
  return {
    database,
    statements,
    events,
    writes: () => statements.filter(({ sql }) => /^(INSERT|UPDATE)/.test(sql)),
  };
}
it("imports one immutable revision under a scoped lock in one transaction", async () => {
  const f = fixture();
  const result = await importProfile(f.database, scope, {
    name: "Synthetic",
    profileId: "profile",
    matrix,
  });
  expect(result).toEqual({
    id: "profile",
    name: "Synthetic",
    revision: 1,
    sha256: matrixHash(matrix),
  });
  expect(f.events).toEqual(["begin:tenant-a", "commit"]);
  expect(f.statements.map(({ sql }) => sql.split(" ")[0])).toEqual([
    "select",
    "SELECT",
    "SELECT",
    "SELECT",
    "SELECT",
    "INSERT",
    "INSERT",
  ]);
  expect(f.statements[3]?.values).toEqual([
    JSON.stringify(["tenant-a", "alice", "omnitech.interview", "profiles"]),
  ]);
  expect(f.writes()[1]?.values).toEqual([
    "tenant-a",
    "alice",
    "omnitech.interview",
    "profile",
    1,
    "Synthetic",
    matrixHash(matrix),
    JSON.stringify(matrix),
  ]);
});
it("rejects stale updates before a write and leaves the transaction with a refusal", async () => {
  const f = fixture((sql) =>
    sql.startsWith("SELECT revision,")
      ? [{ revision: 3, revoked_at: null }]
      : [],
  );
  await expect(
    importProfile(f.database, scope, {
      name: "Synthetic",
      profileId: "profile",
      expectedRevision: 2,
      matrix,
    }),
  ).rejects.toMatchObject({ code: "revision-conflict" });
  expect(f.writes()).toEqual([]);
  expect(f.events).toEqual(["begin:tenant-a", "rollback"]);
});
it("updates the name before inserting the next immutable revision through the existing entrypoint", async () => {
  const f = fixture((sql) =>
    sql.startsWith("SELECT revision,")
      ? [{ revision: 3, revoked_at: null }]
      : [],
  );
  expect(
    (
      await new BriefingRepository(f.database).importProfile(scope, {
        name: "New name",
        profileId: "profile",
        expectedRevision: 3,
        matrix,
      })
    ).revision,
  ).toBe(4);
  expect(
    f.writes().map(({ sql }) => sql.split(" ").slice(0, 2).join(" ")),
  ).toEqual(["UPDATE interview.candidate_profiles", "INSERT INTO"]);
  expect(f.writes()[0]?.values).toEqual([
    "tenant-a",
    "alice",
    "omnitech.interview",
    "profile",
    "New name",
  ]);
});
it("does not read other profiles or write after finding a revoked local default", async () => {
  const f = fixture((sql) =>
    sql.startsWith("SELECT revision,")
      ? [{ revision: 2, revoked_at: "revoked" }]
      : [],
  );
  await syncDefaultProfile(f.database, scope, { name: "Default", matrix });
  expect(f.statements.at(-1)?.sql).toContain("FOR UPDATE");
  expect(f.writes()).toEqual([]);
});
it("does not seed over another profile or reapply known default content", async () => {
  const other = fixture((sql) =>
    sql.startsWith("SELECT id FROM") ? [{ id: "chosen" }] : [],
  );
  await syncDefaultProfile(other.database, scope, { name: "Default", matrix });
  expect(other.writes()).toEqual([]);
  const known = fixture((sql) =>
    sql.startsWith("SELECT revision,")
      ? [{ revision: 3, revoked_at: null }]
      : sql.startsWith("SELECT 1 AS found")
        ? [{ found: 1 }]
        : [],
  );
  await syncDefaultProfile(known.database, scope, { name: "Default", matrix });
  expect(known.writes()).toEqual([]);
  expect(known.statements.at(-1)?.values).toEqual([
    "tenant-a",
    "alice",
    "omnitech.interview",
    "local-experience-matrix",
    matrixHash(matrix),
  ]);
});
it("validates hashes and refuses historical evidence that is no longer current", async () => {
  const row = {
    id: "profile",
    name: "Synthetic",
    revision: 1,
    sha256: matrixHash(matrix),
    matrix,
  };
  const f = fixture((sql) =>
    sql.startsWith("SELECT r.id")
      ? [row]
      : sql.startsWith("SELECT id,name")
        ? [
            {
              id: "profile",
              name: "Synthetic",
              revision: 2,
              updated_at: new Date(0),
            },
          ]
        : [],
  );
  await expect(
    requireCurrentProfile(f.database, scope, "profile", 1),
  ).rejects.toMatchObject({ code: "evidence-revision-conflict" });
  expect(f.events).toEqual([
    "begin:tenant-a",
    "commit",
    "begin:tenant-a",
    "commit",
  ]);
  const corrupt = fixture((sql) =>
    sql.startsWith("SELECT r.id") ? [{ ...row, sha256: "wrong" }] : [],
  );
  await expect(
    getProfileRevision(corrupt.database, scope, "profile", 1),
  ).rejects.toMatchObject({ code: "evidence-hash-conflict" });
});
it("fails safely before listing when a local profile cannot be loaded", async () => {
  const f = fixture();
  await expect(
    listAvailableProfiles(
      {
        database: f.database,
        generate: async () => ({}),
        loadDefaultProfile: async () => {
          throw new Error("PRIVATE CONTENT");
        },
      },
      scope,
    ),
  ).rejects.toMatchObject({
    code: "default-profile-unavailable",
    message: "Product operation failed",
  });
  expect(f.events).toEqual([]);
});
