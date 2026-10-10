import type { AiEngine } from "@omnitech/ai-engine";
import { getPlatformDatabase, type PlatformDatabase } from "@omnitech/database";
import { resolveDefaultLanguageModel } from "@omnitech/platform-runtime/ai-config";
import { createInterviewBackend } from "@omnitech/product-interview/backend";
import { createPresentationApi } from "@omnitech/product-presentation/backend";
import type { Hono } from "hono";
import {
  interviewAssistantBudget,
  interviewAssistantListing,
  platformPreparedStore,
} from "./ai";
import { resolvePlatformContext } from "./context";
import { hostSettings } from "./settings";

/** A registered product's backend: its router and any in-process worker. */
export interface ProductBackend {
  mountPath: string;
  app: Pick<Hono, "fetch">;
  runWorker?: (signal: AbortSignal) => Promise<void>;
}

/** The platform services a product's backend is built from. */
interface PlatformServices {
  engine: AiEngine;
  database: PlatformDatabase;
  resolveContext: typeof resolvePlatformContext;
  settings: ReturnType<typeof hostSettings> & { databaseUrl: string };
}

function interviewBackend(services: PlatformServices): ProductBackend {
  const { settings } = services;
  const language = resolveDefaultLanguageModel();
  const assistantListing = interviewAssistantListing();
  const interview = createInterviewBackend({
    engine: services.engine,
    database: services.database,
    runQueueConnectionString: settings.databaseUrl,
    resolveContext: services.resolveContext,
    answersConfigured: language !== null,
    modelVersion: `${language?.model ?? "local"}:plain-text-tools`,
    contextCharacters: interviewAssistantBudget(language?.baseUrl)
      .contextCharacters,
    // How the picker presents the assistant's own profile; absent with no
    // language model, when that profile does not exist.
    ...(assistantListing ? { assistantListing } : {}),
    onDeviceModel: settings.onDeviceModel,
    ...(settings.assistantDefaultModel
      ? { assistantDefaultModel: settings.assistantDefaultModel }
      : {}),
    // Prepared context packs are read from the store the engine keeps them
    // in (ai.ts).
    packStore: platformPreparedStore().store,
    // The profile an application's context pack is prepared with; absent,
    // the product's default (the agent the assistant runs on).
    ...(settings.packProfile ? { packProfile: settings.packProfile } : {}),
    localDefaultProfile: settings.localDevelopment,
  });
  return { mountPath: "/", app: interview.app, runWorker: interview.runWorker };
}

function presentationBackend(services: PlatformServices): ProductBackend {
  return {
    mountPath: "/api",
    app: createPresentationApi({
      database: services.database,
      resolveContext: services.resolveContext,
      engine: services.engine,
    }),
  };
}

// Build-time registration of the product backends, in mounting order. Adding
// a product to the shell is a row here and a row in registry.ts.
const PRODUCT_BACKENDS: readonly ((
  services: PlatformServices,
) => ProductBackend)[] = [interviewBackend, presentationBackend];

/**
 * Every registered product's backend, given the platform services it needs.
 * The shell mounts the routers and starts the workers; what each product
 * does with the services stays inside the product.
 */
export function createProductBackends(
  engine: AiEngine,
): readonly ProductBackend[] {
  const settings = hostSettings();
  // [GUARD] The interview run queue opens its own connection; without one
  // it would fail later and less clearly.
  const { databaseUrl } = settings;
  if (!databaseUrl)
    throw new Error("DATABASE_URL is required for the interview run queue.");
  const services: PlatformServices = {
    engine,
    database: getPlatformDatabase(),
    resolveContext: resolvePlatformContext,
    settings: { ...settings, databaseUrl },
  };
  return PRODUCT_BACKENDS.map((create) => create(services));
}
