// Where prepared context is kept, decided from the environment: the engine's
// database when one is named, this process's memory otherwise. No database is
// opened here: the connection is a stub that records what was asked of it.
import type {
  ConnectedEngineStore,
  Prepared,
  PreparedStore,
} from "@omnitech/ai-engine";
import { describe, expect, it, vi } from "vitest";
import {
  AGENT_WINDOW,
  createMemoryPreparedStore,
  ENGINE_DATABASE_ENV,
  enginePreparedStore,
} from "./ai-packs";

const SCOPE = { tenantId: "tenant-a", productId: "interview" };
const NAME = { key: "application:1:member", recipeId: "interview-context" };
const pack = (version: string, revision = "1"): Prepared => ({
  recipe: { id: "interview-context", version },
  sources: [{ id: "posting:1", revision }],
  records: [],
  rejected: [],
});

describe("packs kept in memory", () => {
  it("keeps a named pack per tenant, product, recipe and name, and replaces it", async () => {
    const store = createMemoryPreparedStore();
    expect(await store.load?.(SCOPE, NAME)).toBeUndefined();
    await store.save?.(SCOPE, NAME, pack("3"));
    expect(await store.load?.(SCOPE, NAME)).toEqual(pack("3"));
    await store.save?.(SCOPE, NAME, pack("3", "2"));
    expect((await store.load?.(SCOPE, NAME))?.sources[0]?.revision).toBe("2");
    // Another member's name, another tenant, another product, another recipe.
    expect(
      await store.load?.(SCOPE, { ...NAME, key: "application:1:other" }),
    ).toBeUndefined();
    expect(
      await store.load?.({ ...SCOPE, tenantId: "tenant-b" }, NAME),
    ).toBeUndefined();
    expect(
      await store.load?.({ ...SCOPE, productId: "presentation" }, NAME),
    ).toBeUndefined();
    expect(
      await store.load?.(SCOPE, { ...NAME, recipeId: "other" }),
    ).toBeUndefined();
  });

  it("keeps a whole result against exactly its recipe version and source revisions", async () => {
    const store = createMemoryPreparedStore();
    await store.put(SCOPE, pack("3"));
    expect(await store.get(SCOPE, pack("3"))).toEqual(pack("3"));
    expect(await store.get(SCOPE, pack("4"))).toBeUndefined();
    expect(await store.get(SCOPE, pack("3", "2"))).toBeUndefined();
    expect(
      await store.get({ ...SCOPE, tenantId: "tenant-b" }, pack("3")),
    ).toBeUndefined();
  });

  it("is one store per call: two stores share nothing", async () => {
    const [one, other] = [
      createMemoryPreparedStore(),
      createMemoryPreparedStore(),
    ];
    await one.save?.(SCOPE, NAME, pack("3"));
    expect(await other.load?.(SCOPE, NAME)).toBeUndefined();
  });
});

describe("the store for an environment", () => {
  it("is this process's memory when no engine database is named", async () => {
    const connect = vi.fn();
    for (const env of [{}, { [ENGINE_DATABASE_ENV]: "  " }]) {
      const kept = enginePreparedStore(env, connect);
      expect(kept.kept).toBe("memory");
      await kept.store.save?.(SCOPE, NAME, pack("3"));
      expect(await kept.store.load?.(SCOPE, NAME)).toEqual(pack("3"));
      await kept.close();
    }
    expect(connect).not.toHaveBeenCalled();
  });

  it("is the engine's database when one is named, opened by the first use and once", async () => {
    const inner = createMemoryPreparedStore();
    const close = vi.fn(async () => undefined);
    const connect = vi.fn(
      async () =>
        ({
          store: { prepared: inner },
          ready: async () => true,
          close,
        }) as unknown as ConnectedEngineStore,
    );
    const kept = enginePreparedStore(
      { [ENGINE_DATABASE_ENV]: " postgres://engine " },
      connect,
    );
    expect(kept.kept).toBe("database");
    // Building the store opens nothing.
    expect(connect).not.toHaveBeenCalled();
    await kept.store.save?.(SCOPE, NAME, pack("3"));
    expect(await kept.store.load?.(SCOPE, NAME)).toEqual(pack("3"));
    await kept.store.put(SCOPE, pack("3"));
    expect(await kept.store.get(SCOPE, pack("3"))).toEqual(pack("3"));
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith("postgres://engine");
    expect(await inner.load?.(SCOPE, NAME)).toEqual(pack("3"));
    await kept.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes nothing when nothing was opened, and survives a close that fails", async () => {
    const connect = vi.fn(
      async () =>
        ({
          store: { prepared: createMemoryPreparedStore() },
          ready: async () => true,
          close: async () => {
            throw new Error("gone");
          },
        }) as unknown as ConnectedEngineStore,
    );
    const unopened = enginePreparedStore(
      { [ENGINE_DATABASE_ENV]: "postgres://engine" },
      connect,
    );
    await unopened.close();
    expect(connect).not.toHaveBeenCalled();
    const opened = enginePreparedStore(
      { [ENGINE_DATABASE_ENV]: "postgres://engine" },
      connect,
    );
    await opened.store.load?.(SCOPE, NAME);
    await expect(opened.close()).resolves.toBeUndefined();
  });

  // The engine catches a store that throws; this store must let it.
  it("lets a database that cannot be opened fail the read, for the engine to catch", async () => {
    const kept = enginePreparedStore(
      { [ENGINE_DATABASE_ENV]: "postgres://engine" },
      async () => {
        throw new Error("no driver");
      },
    );
    await expect(kept.store.load?.(SCOPE, NAME)).rejects.toThrow("no driver");
  });

  it("answers a store with no named packs as nothing kept", async () => {
    const whole: PreparedStore = {
      get: async () => undefined,
      put: async () => undefined,
    };
    const kept = enginePreparedStore(
      { [ENGINE_DATABASE_ENV]: "postgres://engine" },
      async () =>
        ({
          store: { prepared: whole },
          ready: async () => true,
          close: async () => undefined,
        }) as unknown as ConnectedEngineStore,
    );
    expect(await kept.store.load?.(SCOPE, NAME)).toBeUndefined();
    await expect(
      kept.store.save?.(SCOPE, NAME, pack("3")),
    ).resolves.toBeUndefined();
  });
});

describe("what an agent that prepares can hold", () => {
  it("is a large window: a whole posting or transcript in one call", () => {
    expect(AGENT_WINDOW).toEqual({
      contextTokens: 200_000,
      outputTokens: 16_000,
    });
  });
});
