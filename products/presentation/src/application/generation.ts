// The generation use cases: ask the engine as the member, check what came
// back, and keep what the product stores. No HTTP and no SQL here.
import {
  type AiEngine,
  type Execution,
  executionFromHeaders,
  type ModelMessage,
} from "@omnitech/ai-engine";
import type { PlatformContext } from "@omnitech/platform-contracts";
import {
  AiFailureError,
  OUTLINE_REPLY,
  type OutlineRequest,
  outlinePrompt,
  SLIDE_REPLY,
  validateImageAssetReference,
} from "../domain/generation";
import type { TenantContext } from "../domain/index";
import type { PresentationService } from "./index";

const PRODUCT_ID = "omnitech.presentation";

function userMessage(prompt: string): ModelMessage {
  return { role: "user", parts: [{ type: "text", text: prompt }] };
}

// [DOMAIN] Who is asking: the member in the tenant, with the permissions the
// engine's policy reads, bound to this request's own cancellation and trace.
export function executionFor(
  request: Pick<Request, "signal" | "headers">,
  access: PlatformContext,
): Execution {
  return {
    scope: {
      tenantId: access.tenant.id,
      actorId: access.user.id,
      productId: PRODUCT_ID,
    },
    permissions: access.permissions,
    signal: request.signal,
    ...executionFromHeaders(request.headers),
  };
}

export async function generateOutline(
  engine: AiEngine,
  input: OutlineRequest & { profileId: string },
  execution: Execution,
): Promise<unknown> {
  const generated = await engine.generate(
    {
      profileId: input.profileId,
      messages: [userMessage(outlinePrompt(input))],
      schema: OUTLINE_REPLY,
    },
    execution,
  );
  if (!generated.ok) throw new AiFailureError(generated.failure.code);
  return generated.value;
}

export async function generateSlide(
  engine: AiEngine,
  input: { prompt: string; profileId: string },
  execution: Execution,
): Promise<unknown> {
  const generated = await engine.generate(
    {
      profileId: input.profileId,
      messages: [userMessage(input.prompt)],
      schema: SLIDE_REPLY,
    },
    execution,
  );
  if (!generated.ok) throw new AiFailureError(generated.failure.code);
  return generated.value;
}

export async function generateImage(
  engine: AiEngine,
  service: PresentationService,
  tenant: TenantContext,
  input: {
    prompt: string;
    profileId: string;
    aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | undefined;
    modelId?: string | undefined;
  },
  asked: Execution,
): Promise<string> {
  // [DOMAIN] The image is made under a trace the request names, or one made
  // here, so the stored image can point at the engine's record of making it.
  const execution = {
    ...asked,
    traceId: asked.traceId ?? crypto.randomUUID().replaceAll("-", ""),
  };
  const generated = await engine.images.generate(
    {
      profileId: input.profileId,
      prompt: input.prompt,
      ...(input.aspectRatio === undefined
        ? {}
        : { aspectRatio: input.aspectRatio }),
      ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
    },
    execution,
  );
  if (!generated.ok) throw new AiFailureError(generated.failure.code);
  const { image } = generated;
  // The engine's image port has already refused an address on this machine
  // from any provider that is not declared local; what is checked here is
  // only that the reference is one this product can show.
  validateImageAssetReference(image.assetReference, true);
  return service.recordGeneratedImage(tenant, {
    assetReference: image.assetReference,
    promptReference: `run:${execution.traceId}`,
    providerId: image.providerId,
    modelId: image.modelId,
    metadata: image.provenance,
  });
}

/** An image the member supplied: stored as their own, never a provider's. */
export async function uploadImage(
  service: PresentationService,
  tenant: TenantContext,
  input: {
    assetReference: string;
    mimeType: string;
    metadata: Readonly<Record<string, unknown>>;
  },
): Promise<string> {
  validateImageAssetReference(input.assetReference);
  return service.recordGeneratedImage(tenant, {
    assetReference: input.assetReference,
    promptReference: "upload",
    providerId: "upload",
    modelId: "user-upload",
    metadata: { ...input.metadata, mimeType: input.mimeType },
  });
}
