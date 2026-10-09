import type { AiEngine } from "@omnitech/ai-engine";
import { getPlatformDatabase } from "@omnitech/database";
import { resolveDefaultLanguageModel } from "@omnitech/platform-runtime/ai-config";
import { createInterviewBackend } from "@omnitech/product-interview/backend";
import { createPresentationApi } from "@omnitech/product-presentation/backend";
import type { Hono } from "hono";
import { interviewAssistantBudget, interviewAssistantListing } from "./ai";
import { resolvePlatformContext } from "./context";

/** A registered product's backend: its router and any in-process worker. */
export interface ProductBackend {
  mountPath: string;
  app: Pick<Hono, "fetch">;
  runWorker?: (signal: AbortSignal) => Promise<void>;
}

/**
 * Every registered product's backend, given the platform services it needs.
 * The shell mounts the routers and starts the workers; what each product
 * does with the services stays inside the product.
 */
export function createProductBackends(
  engine: AiEngine,
): readonly ProductBackend[] {
  // [GUARD] The interview run queue opens its own connection; without one
  // it would fail later and less clearly.
  const runQueueConnectionString = process.env["DATABASE_URL"];
  if (!runQueueConnectionString)
    throw new Error("DATABASE_URL is required for the interview run queue.");
  const database = getPlatformDatabase();
  const language = resolveDefaultLanguageModel();
  const assistantListing = interviewAssistantListing();
  const interview = createInterviewBackend({
    engine,
    database,
    runQueueConnectionString,
    resolveContext: resolvePlatformContext,
    answersConfigured: language !== null,
    modelVersion: `${language?.model ?? "local"}:plain-text-tools`,
    contextCharacters: interviewAssistantBudget(language?.baseUrl)
      .contextCharacters,
    // How the picker presents the assistant's own profile; absent with no
    // language model, when that profile does not exist.
    ...(assistantListing ? { assistantListing } : {}),
    onDeviceModel: Boolean(process.env["NEXT_PUBLIC_ON_DEVICE_MODEL_SHA256"]),
    ...(process.env["INTERVIEW_ASSISTANT_DEFAULT_MODEL"]
      ? {
          assistantDefaultModel:
            process.env["INTERVIEW_ASSISTANT_DEFAULT_MODEL"],
        }
      : {}),
    localDefaultProfile:
      process.env["NODE_ENV"] !== "production" &&
      process.env["FAKE_AUTH_ENABLED"] === "true",
  });
  return [
    { mountPath: "/", app: interview.app, runWorker: interview.runWorker },
    {
      mountPath: "/api",
      app: createPresentationApi({
        database,
        resolveContext: resolvePlatformContext,
        engine,
      }),
    },
  ];
}
