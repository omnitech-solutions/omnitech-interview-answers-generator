// Where prepared context is kept (ADR-0041): the store a host gives the AI
// engine as `prepared`, so a context pack a model prepared once is read by
// every later request, and re-prepared only where a source changed.
//
// PROBLEM: the web server prepares a pack and the agent worker's live coach
// reads it, in two processes. STRATEGY: one decision, made from the
// environment, for both. With `AI_ENGINE_DATABASE_URL` (the engine's own
// database, the one that holds the record of calls) packs are kept there, in
// the engine's `prepared_context` table, and any process reads them. With
// none they are kept in this process's memory: a pack lasts until the
// process ends and is seen only by the process that prepared it.
// The Studio's own database gains no table for this.
import {
  type ConnectedEngineStore,
  connectEngineStore,
  type Prepared,
  type PreparedStore,
} from "@omnitech/ai-engine";

type Environment = Readonly<Record<string, string | undefined>>;
export const ENGINE_DATABASE_ENV = "AI_ENGINE_DATABASE_URL";

// [DOMAIN] What a model that prepares a pack can hold, declared for every
// profile a host offers for it, so the engine cuts a source to fit. Claude
// Code and Codex read a whole posting or transcript in one call.
export const AGENT_WINDOW = Object.freeze({
  contextTokens: 200_000,
  outputTokens: 16_000,
});

// Packs kept for the life of this process.
export function createMemoryPreparedStore(): PreparedStore {
  const whole = new Map<string, Prepared>();
  const named = new Map<string, Prepared>();
  const at = (scope: { tenantId: string; productId: string }, key: string) =>
    `${scope.tenantId}\n${scope.productId}\n${key}`;
  const wanted = (prepared: Pick<Prepared, "recipe" | "sources">) =>
    JSON.stringify([
      prepared.recipe.id,
      prepared.recipe.version,
      prepared.sources.map(({ id, revision }) => [id, revision]),
    ]);
  return {
    get: async (scope, asked) => whole.get(at(scope, wanted(asked))),
    put: async (scope, prepared) => {
      whole.set(at(scope, wanted(prepared)), prepared);
    },
    load: async (scope, name) =>
      named.get(at(scope, `${name.recipeId}\n${name.key}`)),
    save: async (scope, name, prepared) => {
      named.set(at(scope, `${name.recipeId}\n${name.key}`), prepared);
    },
  };
}

export type KeptPacks = {
  store: PreparedStore;
  // Where packs are kept: the engine's database, or this process's memory.
  kept: "database" | "memory";
  // Ends the connection packs are kept through (nothing, for memory).
  close(): Promise<void>;
};

// The store for this environment. The engine's database is opened by the
// first read or write, never by building the store.
export function enginePreparedStore(
  env: Environment = process.env,
  connect: (url: string) => Promise<ConnectedEngineStore> = connectEngineStore,
): KeptPacks {
  const url = env[ENGINE_DATABASE_ENV]?.trim();
  if (!url)
    return {
      store: createMemoryPreparedStore(),
      kept: "memory",
      close: async () => undefined,
    };
  let connected: Promise<ConnectedEngineStore> | undefined;
  const prepared = async () => {
    connected ??= connect(url);
    return (await connected).store.prepared;
  };
  return {
    kept: "database",
    // [SAFETY] A store that fails costs the saving, never the result: the
    // engine catches a read or a write that throws and does the work again.
    store: {
      get: async (scope, wanted) => (await prepared()).get(scope, wanted),
      put: async (scope, value) => (await prepared()).put(scope, value),
      load: async (scope, name) => (await prepared()).load?.(scope, name),
      save: async (scope, name, value) =>
        (await prepared()).save?.(scope, name, value),
    },
    close: async () => {
      if (connected) await (await connected).close().catch(() => undefined);
    },
  };
}
