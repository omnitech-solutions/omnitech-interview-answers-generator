import type { AiExecutionGateway } from "@omnitech/ai-contracts";
import { createGatewayModelPort } from "@omnitech/ai-runtime";
import type {
  ModelCatalog,
  ModelInfo,
  ModelPort,
  ModelRelay,
  Scope,
} from "@omnitech-assistant/contracts";
import { createRelayModelSource } from "@omnitech-assistant/server";
import { INTERVIEW_ASSISTANT_PROFILE } from "../assistant-profile.js";
import { manifest } from "../manifest.js";

const PERMISSIONS = manifest.permissions;
// The most models one picker listing may hold.
const MAX_MODELS = 64;

// The on-device (WebGPU) model: the server relays each call to the open tab.
const ON_DEVICE: ModelInfo = {
  id: "on-device",
  name: "Qwen3 4B (on this device)",
  shortName: "On this device",
  description:
    "Runs in this browser on your graphics card; nothing is sent to a model provider. The first message downloads the model (about 2 GB).",
  tags: ["on-device"],
  strengths: ["privacy", "short questions"],
  provider: { name: "This device", local: true },
  vision: false,
  reasoning: false,
  contextWindow: 8_192,
  local: true,
};

/**
 * The models the interview assistant offers in its picker, and the port that
 * runs whichever one a turn asks for. Every model but the on-device one is a
 * gateway target for structured chat, so it runs through the gateway: the
 * assistant's own profile first, then whatever catalogs and
 * agents the host configured. The on-device model is offered when pinned.
 */
export function createAssistantModels(
  ai: AiExecutionGateway,
  relay: ModelRelay,
  onDevice: boolean,
  preferredModel = INTERVIEW_ASSISTANT_PROFILE,
): { catalog: ModelCatalog; port: ModelPort } {
  const gatewayPort = createGatewayModelPort(ai, async () => PERMISSIONS);
  const relaySource = createRelayModelSource({ relay, models: [ON_DEVICE] });
  const catalog: ModelCatalog = {
    async list(scope: Scope) {
      const targets = await ai.listAvailableTargets(
        {
          tenantId: scope.tenantId,
          userId: scope.actorId,
          productId: scope.productId,
          permissions: PERMISSIONS,
        },
        { taskType: "structured-chat" },
      );
      const listed = targets
        .flatMap(({ listing }) => (listing ? [listing] : []))
        .slice(0, MAX_MODELS - Number(onDevice));
      const defaultModel = listed.some(({ id }) => id === preferredModel)
        ? preferredModel
        : INTERVIEW_ASSISTANT_PROFILE;
      const models = listed.map((listing) =>
        listing.id === defaultModel
          ? { ...listing, tags: ["default", ...listing.tags] }
          : listing,
      );
      if (onDevice) models.push(ON_DEVICE);
      return {
        models,
        defaultModel,
      };
    },
  };
  return {
    catalog,
    port: {
      stream: (scope, input, signal) =>
        input.profileId !== ON_DEVICE.id
          ? gatewayPort.stream(scope, input, signal)
          : onDevice
            ? relaySource.port.stream(scope, input, signal)
            : // [GUARD] A turn may not pick the on-device model the host
              // never offered.
              (async function* () {
                throw new Error(
                  "The on-device model is not enabled on this host.",
                );
              })(),
    },
  };
}
