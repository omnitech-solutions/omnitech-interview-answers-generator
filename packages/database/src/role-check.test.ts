import { beforeEach, describe, expect, it, vi } from "vitest";

// A scripted pool: the role lookup answers from `role`, every other statement
// is recorded. This pins the one shared check without a database.
const state = vi.hoisted(() => ({
  role: { bypass: false } as { bypass: unknown } | Error | undefined,
  statements: [] as string[],
}));

vi.mock("pg", () => {
  // drizzle sends a { text } object, pg callers a string
  const run = async (query: string | { text: string }) => {
    const text = typeof query === "string" ? query : query.text;
    state.statements.push(text);
    if (text.includes("from pg_roles")) {
      if (state.role instanceof Error) throw state.role;
      return { rows: state.role === undefined ? [] : [state.role] };
    }
    return { rows: [] };
  };
  class Pool {
    query = run;
    connect = async () => ({ query: run, release: () => undefined });
    end = async () => undefined;
  }
  return { default: { Pool } };
});

import {
  createPlatformDatabase,
  enterTenant,
  roleBypassesRowLevelSecurityMessage,
  verifyDatabaseRole,
} from "./connection";
import { withTenant } from "./with-tenant";

const tenantId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const url = "postgresql://unused";
const roleLookups = () =>
  state.statements.filter((text) => text.includes("from pg_roles")).length;
const served = () =>
  state.statements.filter((text) => !text.includes("from pg_roles"));

beforeEach(() => {
  state.role = { bypass: false };
  state.statements = [];
});

// Every public entry of a handle, as a thunk taking the handle.
const entries = {
  query: (db: ReturnType<typeof createPlatformDatabase>) =>
    db.query("SELECT 1"),
  transaction: (db: ReturnType<typeof createPlatformDatabase>) =>
    db.transaction(async () => "ok"),
  tenantTransaction: (db: ReturnType<typeof createPlatformDatabase>) =>
    db.tenantTransaction(tenantId, async () => "ok"),
  withTenant: (db: ReturnType<typeof createPlatformDatabase>) =>
    withTenant({ tenantId, actorId }, async () => "ok", { database: db }),
  verifyDatabaseRole: (db: ReturnType<typeof createPlatformDatabase>) =>
    verifyDatabaseRole(db),
} satisfies Record<
  string,
  (db: ReturnType<typeof createPlatformDatabase>) => Promise<unknown>
>;

describe("a handle whose role bypasses row-level security", () => {
  beforeEach(() => {
    state.role = { bypass: true };
  });

  it.each(Object.entries(entries))(
    "refuses %s before any statement runs",
    async (_name, enter) => {
      const db = createPlatformDatabase(url);
      await expect(enter(db)).rejects.toThrow(
        roleBypassesRowLevelSecurityMessage,
      );
      expect(served()).toEqual([]);
    },
  );

  it("refuses with one fixed message that carries no SQL, tenant or actor, and tells test authors what to use", async () => {
    const db = createPlatformDatabase(url);
    const errors = await Promise.all(
      Object.values(entries).map((enter) => enter(db).catch((e: Error) => e)),
    );
    for (const error of errors)
      expect((error as Error).message).toBe(
        roleBypassesRowLevelSecurityMessage,
      );
    expect(roleBypassesRowLevelSecurityMessage).not.toMatch(
      /select|pg_roles|set_config|[0-9a-f]{8}-/i,
    );
    expect(roleBypassesRowLevelSecurityMessage).toMatch(
      /memberUrl.*grantApplicationRole/,
    );
  });

  it("looks the role up once per handle", async () => {
    const db = createPlatformDatabase(url);
    await Promise.all(
      Object.values(entries).map((enter) => enter(db).catch(() => undefined)),
    );
    expect(roleLookups()).toBe(1);
  });

  it("serves an explicitly opted-in handle without a lookup", async () => {
    const db = createPlatformDatabase(url, { allowRlsBypass: true });
    for (const enter of Object.values(entries))
      await expect(enter(db)).resolves.not.toBeInstanceOf(Error);
    expect(roleLookups()).toBe(0);
  });

  it("still refuses enterTenant on the clients of an opted-in handle", async () => {
    const db = createPlatformDatabase(url, { allowRlsBypass: true });
    await expect(
      db.transaction((client) => enterTenant(client, { tenantId, actorId })),
    ).rejects.toThrow(roleBypassesRowLevelSecurityMessage);
    expect(state.statements.some((text) => text.includes("set_config"))).toBe(
      false,
    );
  });
});

describe("a handle whose role row-level security applies to", () => {
  it.each(Object.entries(entries))("serves %s", async (_name, enter) => {
    const db = createPlatformDatabase(url);
    await expect(enter(db)).resolves.not.toBeInstanceOf(Error);
  });

  it("looks the role up once per handle across all entries", async () => {
    const db = createPlatformDatabase(url);
    for (const enter of Object.values(entries)) await enter(db);
    expect(roleLookups()).toBe(1);
    expect(createPlatformDatabase(url)).not.toBe(db);
    await entries.query(createPlatformDatabase(url));
    expect(roleLookups()).toBe(2);
  });

  it("enters the tenant through tenantTransaction, enterTenant and withTenant", async () => {
    const db = createPlatformDatabase(url);
    await db.tenantTransaction(tenantId, async () => undefined);
    await db.transaction((client) => enterTenant(client, { tenantId }));
    await withTenant({ tenantId, actorId }, async () => undefined, {
      database: db,
    });
    expect(
      state.statements.filter((t) => t.includes("set_config")),
    ).toHaveLength(3);
  });

  it("retries a failed role lookup instead of caching the failure", async () => {
    const db = createPlatformDatabase(url);
    state.role = new Error("connection reset");
    await expect(entries.query(db)).rejects.toThrow("connection reset");
    state.role = { bypass: false };
    await expect(entries.tenantTransaction(db)).resolves.toBe("ok");
    expect(roleLookups()).toBe(2);
  });
});

describe("an unrecognised role lookup result", () => {
  it.each([
    ["no row", undefined],
    ["a null flag", { bypass: null }],
    ["a string flag", { bypass: "false" }],
    ["a missing flag", {}],
  ])("fails closed on %s", async (_label, role) => {
    state.role = role as never;
    const db = createPlatformDatabase(url);
    await expect(entries.query(db)).rejects.toThrow(
      roleBypassesRowLevelSecurityMessage,
    );
    expect(served()).toEqual([]);
  });
});
