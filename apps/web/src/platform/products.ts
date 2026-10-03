import type { AiExecutionGateway } from "@omnitech/ai-contracts";
import { getPlatformDatabase } from "@omnitech/database";
import { createInterviewBackend } from "@omnitech/product-interview/backend";
import { createPresentationApi } from "@omnitech/product-presentation/backend";
import type { Hono } from "hono";
import { interviewAssistantBudget } from "./ai";
import { resolveDefaultLanguageModel } from "./ai-config";
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
  ai: AiExecutionGateway,
): readonly ProductBackend[] {
  const database = getPlatformDatabase();
  const language = resolveDefaultLanguageModel();
  const interview = createInterviewBackend({
    ai,
    database,
    runQueueConnectionString: process.env["DATABASE_URL"] ?? "",
    resolveContext: resolvePlatformContext,
    answersConfigured: language !== null,
    modelVersion: `${language?.model ?? "local"}:plain-text-tools`,
    contextCharacters: interviewAssistantBudget(language?.baseUrl)
      .contextCharacters,
    onDeviceModel: Boolean(process.env["NEXT_PUBLIC_ON_DEVICE_MODEL_SHA256"]),
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
        ai,
      }),
    },
  ];
}
