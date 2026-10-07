import {
  type AiAccessContext,
  type AiEvent,
  type AiExecution,
  type AiExecutionGateway,
  type AiExecutionRequest,
  AiPolicyRefusedError,
  type AiProcessingPolicy,
  type AiResumeRequest,
  type AiStructuredChatRequest,
  type AiTargetFilter,
  type AiTargetSummary,
  type ImageProviderAdapter,
  MAX_TASK_ATTACHMENTS,
  type ModelProviderAdapter,
} from "@omnitech/ai-contracts";
import { createLogger, type Logger } from "@omnitech/logging";
import type {
  ModelInfo,
  ModelPart,
  ModelPort,
  Scope,
} from "@omnitech-assistant/contracts";
import { scopeSchema } from "@omnitech-assistant/contracts";

/**
 * Where a profile's model runs, as its configuration declares it. Never
 * inferred from a URL or a provider name; missing or unknown is remote.
 */
export type AiLocality = "device" | "private-network" | "remote";

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
  // Declared locality (rule:declared-profile-locality). Absent is remote.
  locality?: AiLocality;
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
  // [SAFETY] A cancellation runs inside the caller's tenant: an execution id
  // alone never reaches across tenants.
  cancel(context: AiAccessContext, executionId: string): Promise<void>;
  resume(request: AiResumeRequest): AsyncIterable<AiEvent>;
  // Assistant turns on an agent runtime, as streamed model parts.
  streamStructured?(
    request: AiStructuredChatRequest,
    profile: AiProfile,
  ): AsyncIterable<ModelPart>;
}

export interface CreateAiExecutionGatewayOptions {
  // Where the gateway reports each call (profile, target, duration, outcome;
  // prompts and output only at trace with LOG_CONTENT=true). Default: a
  // logger named ai-gateway configured from the environment.
  logger?: Logger;
  profiles: readonly AiProfile[];
  models: readonly ModelProviderAdapter[];
  images: readonly ImageProviderAdapter[];
  agents: AgentExecutionPort;
  authorize(context: AiAccessContext, profile: AiProfile): Promise<boolean>;
}

// [SAFETY] Anything but an explicit permitted-remote, once a policy is given,
// is treated as device-only: an unrecognised policy fails closed.
const isDeviceOnly = (policy: AiProcessingPolicy | undefined) =>
  policy !== undefined && policy !== "permitted-remote";

// A profile runs on the device only when it declares so (rule:declared-
// profile-locality) and is not an agent runtime: agent jobs are never device.
const runsOnDevice = (profile: AiProfile) =>
  profile.family === "direct-model" && profile.locality === "device";

const permits = (policy: AiProcessingPolicy | undefined, profile: AiProfile) =>
  !isDeviceOnly(policy) || runsOnDevice(profile);

// A resume names no profile; the refusal names only the policy.
function refusedStream<T>(): AsyncIterable<AiEvent<T>> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        Promise.reject(new AiPolicyRefusedError(undefined, "device-only")),
    }),
  };
}

// Refuses with ids only; never a fallback to another profile or adapter.
function requirePolicy(
  policy: AiProcessingPolicy | undefined,
  profile: AiProfile,
): void {
  if (!permits(policy, profile))
    throw new AiPolicyRefusedError(profile.id, "device-only");
}

// [SAFETY] Attachments reach only an agent runtime and stay bounded. A
// direct-model or image profile refuses them: answering a screenshot question
// text-only would silently drop evidence the caller believes was seen.
function requireAttachmentsFit(
  request: AiExecutionRequest,
  profile: AiProfile,
): void {
  const count = request.task.attachments?.length ?? 0;
  if (count === 0) return;
  if (profile.family !== "agent-runtime")
    throw new Error("The profile does not accept attachments.");
  if (count > MAX_TASK_ATTACHMENTS)
    throw new Error("The request carries too many attachments.");
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
    // [SAFETY] First of two policy checks (rule:device-only-enforced-twice):
    // at resolution, before any adapter is touched. Each method checks again
    // immediately before dispatch.
    requirePolicy(request.processingPolicy, profile);
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
    requireAttachmentsFit(request, profile);
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

  // The call itself, after resolution: which port runs it.
  async function dispatch(
    request: AiExecutionRequest,
    profile: AiProfile,
  ): Promise<AiExecution> {
    let execution: AiExecution;
    if (profile.family === "agent-runtime") {
      requirePolicy(request.processingPolicy, profile);
      execution = await options.agents.execute(request, profile);
    } else if (request.task.type.startsWith("image-")) {
      const adapter = images.get(profile.targetId);
      if (!adapter)
        throw new Error("The configured image provider is unavailable.");
      requirePolicy(request.processingPolicy, profile);
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
      requirePolicy(request.processingPolicy, profile);
      execution = await adapter.execute(request);
    }
    return execution;
  }

  const log = options.logger ?? createLogger({ service: "ai-gateway" });
  // One event per call. Content (the task, the result) is attached only when
  // the logger is allowed to write it (rule 8: nothing by default).
  const report = (
    event: string,
    request: AiExecutionRequest,
    profile: AiProfile | null,
    startedAt: number,
    outcome: string,
    extra: Record<string, unknown> = {},
    content: Record<string, unknown> = {},
  ) =>
    log[outcome === "ok" ? "info" : "warn"](event, {
      taskType: request.task.type,
      profileId: profile?.id ?? request.profileId ?? null,
      family: profile?.family ?? null,
      targetId: profile?.targetId ?? null,
      durationMs: Date.now() - startedAt,
      outcome,
      ...extra,
      ...(log.config.content ? { content } : {}),
    });
  const message = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

  return {
    async *streamStructured(request: AiStructuredChatRequest) {
      request.signal?.throwIfAborted();
      const profile = await resolve({
        context: request.context,
        profileId: request.profileId,
        task: { type: "structured-chat", prompt: "" },
        ...(request.processingPolicy === undefined
          ? {}
          : { processingPolicy: request.processingPolicy }),
      });
      if (profile.family === "agent-runtime") {
        if (!options.agents.streamStructured)
          throw new Error("The profile cannot execute structured chat.");
        request.signal?.throwIfAborted();
        requirePolicy(request.processingPolicy, profile);
        yield* options.agents.streamStructured(request, profile);
        return;
      }
      const adapter = models.get(profile.targetId);
      if (!adapter?.streamStructured)
        throw new Error(
          "The configured provider cannot stream structured chat.",
        );
      request.signal?.throwIfAborted();
      requirePolicy(request.processingPolicy, profile);
      yield* adapter.streamStructured(request);
    },
    async execute<T>(request: AiExecutionRequest) {
      const startedAt = Date.now();
      let profile: AiProfile | null = null;
      try {
        profile = await resolve(request);
        const execution = await dispatch(request, profile);
        report(
          "ai.execute",
          request,
          profile,
          startedAt,
          "ok",
          {
            executionId: execution.executionId,
            ...(execution.usage ? { usage: execution.usage } : {}),
          },
          { task: request.task, execution },
        );
        return execution as AiExecution<T>;
      } catch (error) {
        report(
          "ai.execute",
          request,
          profile,
          startedAt,
          "error",
          { error: message(error) },
          { task: request.task },
        );
        throw error;
      }
    },
    async *stream<T>(request: AiExecutionRequest) {
      const startedAt = Date.now();
      const profile = await resolve(request);
      // [SAFETY] Second policy check, immediately before dispatch.
      requirePolicy(request.processingPolicy, profile);
      const source =
        profile.family === "agent-runtime"
          ? options.agents.stream(request, profile)
          : models.get(profile.targetId)?.stream(request);
      if (!source)
        throw new Error("The configured target cannot stream this task.");
      let events = 0;
      try {
        for await (const event of source) {
          events += 1;
          yield event as AiEvent<T>;
        }
        report(
          "ai.stream",
          request,
          profile,
          startedAt,
          "ok",
          { events },
          { task: request.task },
        );
      } catch (error) {
        report(
          "ai.stream",
          request,
          profile,
          startedAt,
          "error",
          { events, error: message(error) },
          { task: request.task },
        );
        throw error;
      }
    },
    cancel: (context, executionId) =>
      options.agents.cancel(context, executionId),
    // [SAFETY] Resume only ever reaches the agent port, and an agent job never
    // runs on the device: device-only refuses it before dispatch.
    resume: <T>(request: AiResumeRequest) =>
      isDeviceOnly(request.processingPolicy)
        ? refusedStream<T>()
        : (options.agents.resume(request) as AsyncIterable<AiEvent<T>>),
    async listAvailableTargets(context, filter?: AiTargetFilter) {
      const visible: AiTargetSummary[] = [];
      for (const profile of profiles.values()) {
        if (
          !profile.enabled ||
          (filter?.taskType && !profile.taskTypes.includes(filter.taskType)) ||
          // Catalogs list their models only for a task, never by default.
          (profile.catalog && !filter?.taskType) ||
          // A device-only listing offers device profiles only.
          !permits(filter?.processingPolicy, profile) ||
          !(await options.authorize(context, profile))
        )
          continue;
        if (!profile.catalog) {
          visible.push(summaryOf(profile));
          continue;
        }
        // [SAFETY] Second check, immediately before the catalog's adapter is
        // asked for its models.
        if (!permits(filter?.processingPolicy, profile)) continue;
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
