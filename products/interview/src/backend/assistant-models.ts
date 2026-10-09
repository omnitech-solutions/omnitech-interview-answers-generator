import type { AiEngine } from "@omnitech/ai-engine";
import type {
  ModelCatalog,
  ModelInfo,
  ModelPort,
  ModelRelay,
  Scope,
} from "@omnitech-assistant/contracts";
import { createRelayModelSource } from "@omnitech-assistant/server";
import { INTERVIEW_ASSISTANT_PROFILE } from "../assistant-profile";
import { manifest } from "../manifest";

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
 * profile of the engine: the assistant's own first, presented as the host
 * describes it, then the models of whatever catalogues the host configured
 * (LM Studio, OpenRouter, the agents). The on-device model is offered when
 * pinned.
 */
export function createAssistantModels(
  engine: AiEngine,
  relay: ModelRelay,
  onDevice: boolean,
  assistantListing?: Omit<ModelInfo, "id">,
  preferredModel = INTERVIEW_ASSISTANT_PROFILE,
): { catalog: ModelCatalog; port: ModelPort } {
  const relaySource = createRelayModelSource({ relay, models: [ON_DEVICE] });
  const catalog: ModelCatalog = {
    async list(scope: Scope) {
      // The member's permissions travel with the listing: the engine hands
      // this object to the host's authorisation as it is.
      const asking = { scope, permissions: PERMISSIONS };
      const profiles = await engine.profiles(asking);
      const listed = [
        // [GUARD] The assistant's own profile is offered only when the host
        // describes it and this member may use it.
        ...(assistantListing &&
        profiles.some(({ id }) => id === INTERVIEW_ASSISTANT_PROFILE)
          ? [{ id: INTERVIEW_ASSISTANT_PROFILE, ...assistantListing }]
          : []),
        ...profiles.flatMap(({ listing }) => (listing ? [listing] : [])),
      ].slice(0, MAX_MODELS - Number(onDevice));
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
      async *stream(scope, input, signal) {
        if (input.profileId === ON_DEVICE.id) {
          // [GUARD] A turn may not pick the on-device model the host never
          // offered.
          if (!onDevice)
            throw new Error("The on-device model is not enabled on this host.");
          yield* relaySource.port.stream(scope, input, signal);
          return;
        }
        for await (const part of engine.stream(input, {
          scope,
          permissions: PERMISSIONS,
          signal,
        })) {
          // The engine ends a stream with one terminal part; the assistant's
          // port ends by returning or throwing.
          if (part.type === "done") return;
          if (part.type === "cancelled")
            throw signal.reason ?? new Error("The turn was cancelled.");
          // The failure's code only: its detail can carry provider text.
          if (part.type === "failed")
            throw new Error(`The model call failed: ${part.failure.code}`);
          // Parts the assistant's contract does not know are the engine's own.
          if (
            part.type === "response" ||
            part.type === "attachment" ||
            part.type === "value"
          )
            continue;
          yield part;
        }
      },
    },
  };
}
