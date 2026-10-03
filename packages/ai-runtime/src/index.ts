import { scopeSchema } from "@omnitech-assistant/contracts";
import type {
  ModelInfo,
  ModelPart,
  ModelPort,
  Scope,
} from "@omnitech-assistant/contracts";
import type {
  AiAccessContext,
  AiEvent,
  AiExecution,
  AiExecutionGateway,
  AiExecutionRequest,
  AiResumeRequest,
  AiTargetFilter,
  AiTargetSummary,
  AiStructuredChatRequest,
  ImageProviderAdapter,
  ModelProviderAdapter,
} from "@omnitech/ai-contracts";

export interface AiProfile {
  id: string;
  label: string;
  family: "direct-model" | "agent-runtime";
  targetId: string;
  taskTypes: readonly string[];
  enabled: boolean;
  // How a model picker presents this profile's model.
  listing?: Omit<ModelInfo, "id">;
  // The target is a model catalog: the profile serves every model its
  // adapter lists whose id starts with `${id}/`.
  catalog?: boolean;
}

export interface AgentExecutionPort {
  execute(
    request: AiExecutionRequest,
    profile: AiProfile,
  ): Promise<AiExecution>;
  stream(
    request: AiExecutionRequest,
    profile: AiProfile,
  ): AsyncIterable<AiEvent>;
  cancel(executionId: string): Promise<void>;
  resume(request: AiResumeRequest): AsyncIterable<AiEvent>;
  // Assistant turns on an agent runtime, as streamed model parts.
  streamStructured?(
    request: AiStructuredChatRequest,
    profile: AiProfile,
  ): AsyncIterable<ModelPart>;
}

export interface CreateAiExecutionGatewayOptions {
  profiles: readonly AiProfile[];
  models: readonly ModelProviderAdapter[];
  images: readonly ImageProviderAdapter[];
  agents: AgentExecutionPort;
  authorize(context: AiAccessContext, profile: AiProfile): Promise<boolean>;
}

export function composeInstructions(parts: {
  platform: readonly string[];
  worker: readonly string[];
  product: readonly string[];
  tenant: readonly string[];
  task: string;
}): string {
  return [
    ...parts.platform,
    ...parts.worker,
    ...parts.product,
    ...parts.tenant,
    parts.task,
  ]
    .filter((value) => value.trim().length > 0)
    .join("\n\n");
}

export function createAiExecutionGateway(
  options: CreateAiExecutionGatewayOptions,
): AiExecutionGateway {
  const profiles = new Map(
    options.profiles.map((profile) => [profile.id, profile]),
  );
  const models = new Map(
    options.models.map((adapter) => [adapter.providerId, adapter]),
  );
  const images = new Map(
    options.images.map((adapter) => [adapter.providerId, adapter]),
  );

  // The models a catalog profile offers now; a failed listing offers none.
  async function catalogModels(
    profile: AiProfile,
    context: AiAccessContext,
  ): Promise<readonly ModelInfo[]> {
    const listed = await models
      .get(profile.targetId)
      ?.listModels?.(context)
      .catch(() => []);
    return (listed ?? []).filter((model) =>
      model.id.startsWith(`${profile.id}/`),
    );
  }

  async function resolve(request: AiExecutionRequest): Promise<AiProfile> {
    const unavailable = () =>
      new Error("The requested AI profile is unavailable for this task.");
    // A structured-chat id `<catalog>/<model>` names a model of a catalog
    // profile when no profile has that exact id.
    const id = request.profileId ?? "";
    const catalog =
      !profiles.has(id) && request.task.type === "structured-chat"
        ? profiles.get(id.split("/")[0] ?? "")
        : undefined;
    const profile = catalog?.catalog ? catalog : profiles.get(id);
    if (
      !profile?.enabled ||
      (profile.catalog && profile !== catalog) ||
      !profile.taskTypes.includes(request.task.type)
    ) {
      throw unavailable();
    }
    if (!(await options.authorize(request.context, profile))) {
      throw new Error(
        "The current tenant is not authorized for this AI profile.",
      );
    }
    // [SAFETY] Only a model the catalog lists now may run, so a key limited
    // to free models never reaches an unlisted (paid) one.
    if (
      profile.catalog &&
      !(await catalogModels(profile, request.context)).some(
        (model) => model.id === id,
      )
    ) {
      throw unavailable();
    }
    return profile;
  }

  // A profile's own target summary, as listed before catalogs existed.
  function summaryOf(profile: AiProfile): AiTargetSummary {
    const modelId = models.get(profile.targetId)?.modelId;
    return {
      id: profile.id,
      label: profile.label,
      ...(modelId === undefined ? {} : { modelId }),
      family: profile.family,
      kind: profile.taskTypes.some((type) => type.startsWith("image-"))
        ? "image"
        : "language",
      capabilities: [...profile.taskTypes],
      ...(profile.listing
        ? { listing: { id: profile.id, ...profile.listing } }
        : {}),
    };
  }

  return {
    async *streamStructured(request: AiStructuredChatRequest) {
      request.signal?.throwIfAborted();
      const profile = await resolve({
        context: request.context,
        profileId: request.profileId,
        task: { type: "structured-chat", prompt: "" },
      });
      if (profile.family === "agent-runtime") {
        if (!options.agents.streamStructured)
          throw new Error("The profile cannot execute structured chat.");
        request.signal?.throwIfAborted();
        yield* options.agents.streamStructured(request, profile);
        return;
      }
      const adapter = models.get(profile.targetId);
      if (!adapter?.streamStructured)
        throw new Error(
          "The configured provider cannot stream structured chat.",
        );
      request.signal?.throwIfAborted();
      yield* adapter.streamStructured(request);
    },
    async execute<T>(request: AiExecutionRequest) {
      const profile = await resolve(request);
      let execution: AiExecution;
      if (profile.family === "agent-runtime") {
        execution = await options.agents.execute(request, profile);
      } else if (request.task.type.startsWith("image-")) {
        const adapter = images.get(profile.targetId);
        if (!adapter)
          throw new Error("The configured image provider is unavailable.");
        const result =
          request.task.type === "image-editing" && adapter.edit
            ? await adapter.edit(request)
            : await adapter.generate(request);
        execution = {
          executionId: crypto.randomUUID(),
          family: "direct-model",
          targetId: adapter.providerId,
          result,
        };
      } else {
        const adapter = models.get(profile.targetId);
        if (!adapter)
          throw new Error("The configured model provider is unavailable.");
        execution = await adapter.execute(request);
      }
      return execution as AiExecution<T>;
    },
    async *stream<T>(request: AiExecutionRequest) {
      const profile = await resolve(request);
      const source =
        profile.family === "agent-runtime"
          ? options.agents.stream(request, profile)
          : models.get(profile.targetId)?.stream(request);
      if (!source)
        throw new Error("The configured target cannot stream this task.");
      for await (const event of source) yield event as AiEvent<T>;
    },
    cancel: (executionId) => options.agents.cancel(executionId),
    resume: <T>(request: AiResumeRequest) =>
      options.agents.resume(request) as AsyncIterable<AiEvent<T>>,
    async listAvailableTargets(context, filter?: AiTargetFilter) {
      const visible: AiTargetSummary[] = [];
      for (const profile of profiles.values()) {
        if (
          !profile.enabled ||
          (filter?.taskType && !profile.taskTypes.includes(filter.taskType)) ||
          // Catalogs list their models only for a task, never by default.
          (profile.catalog && !filter?.taskType) ||
          !(await options.authorize(context, profile))
        )
          continue;
        if (!profile.catalog) {
          visible.push(summaryOf(profile));
          continue;
        }
        for (const model of await catalogModels(profile, context))
          visible.push({
            id: model.id,
            label: model.name,
            modelId: model.id.slice(profile.id.length + 1),
            family: profile.family,
            kind: "language",
            capabilities: [...profile.taskTypes],
            listing: model,
          });
      }
      return visible;
    },
  };
}

/** Connect the portable port only through the host's authorization boundary. */
export function createGatewayModelPort(
  gateway: AiExecutionGateway,
  permissions: (scope: Scope) => Promise<readonly string[]>,
): ModelPort {
  return {
    async *stream(scope, input, signal) {
      scopeSchema.parse(scope);
      signal.throwIfAborted();
      const context = {
        tenantId: scope.tenantId,
        userId: scope.actorId,
        productId: scope.productId,
        permissions: await permissions(scope),
      };
      signal.throwIfAborted();
      yield* gateway.streamStructured({ ...input, context, signal });
    },
  };
}
