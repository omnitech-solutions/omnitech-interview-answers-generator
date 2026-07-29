import type {
  AiAccessContext,
  AiEvent,
  AiExecution,
  AiExecutionGateway,
  AiExecutionRequest,
  AiResumeRequest,
  AiTargetSummary,
  ImageProviderAdapter,
  ModelProviderAdapter,
  WorkflowEngine,
} from "@omnitech/ai-contracts";

export interface AiProfile {
  id: string;
  label: string;
  family: "direct-model" | "workflow" | "agent-runtime";
  targetId: string;
  taskTypes: readonly string[];
  enabled: boolean;
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
}

export interface CreateAiExecutionGatewayOptions {
  profiles: readonly AiProfile[];
  models: readonly ModelProviderAdapter[];
  images: readonly ImageProviderAdapter[];
  workflows: readonly WorkflowEngine[];
  agents: AgentExecutionPort;
  authorize(context: AiAccessContext, profile: AiProfile): Promise<boolean>;
}

export function composeInstructions(parts: {
  platform: readonly string[];
  worker: readonly string[];
  product: readonly string[];
  tenant: readonly string[];
  workflow: readonly string[];
  task: string;
}): string {
  return [
    ...parts.platform,
    ...parts.worker,
    ...parts.product,
    ...parts.tenant,
    ...parts.workflow,
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
  const workflows = new Map<string, WorkflowEngine>(
    options.workflows.map((engine) => [engine.engine, engine]),
  );

  async function resolve(request: AiExecutionRequest): Promise<AiProfile> {
    const profile = request.profileId
      ? profiles.get(request.profileId)
      : undefined;
    if (!profile?.enabled || !profile.taskTypes.includes(request.task.type)) {
      throw new Error("The requested AI profile is unavailable for this task.");
    }
    if (!(await options.authorize(request.context, profile))) {
      throw new Error(
        "The current tenant is not authorized for this AI profile.",
      );
    }
    return profile;
  }

  return {
    async execute<T>(request: AiExecutionRequest) {
      const profile = await resolve(request);
      let execution: AiExecution;
      if (profile.family === "agent-runtime") {
        execution = await options.agents.execute(request, profile);
      } else if (profile.family === "workflow") {
        const engine = workflows.get(profile.targetId);
        if (!engine)
          throw new Error("The configured workflow engine is unavailable.");
        execution = await engine.execute(request);
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
          : profile.family === "workflow"
            ? workflows.get(profile.targetId)?.stream(request)
            : models.get(profile.targetId)?.stream(request);
      if (!source)
        throw new Error("The configured target cannot stream this task.");
      for await (const event of source) yield event as AiEvent<T>;
    },
    cancel: (executionId) => options.agents.cancel(executionId),
    resume: <T>(request: AiResumeRequest) =>
      options.agents.resume(request) as AsyncIterable<AiEvent<T>>,
    async listAvailableTargets(context) {
      const visible: AiTargetSummary[] = [];
      for (const profile of profiles.values()) {
        if (!profile.enabled || !(await options.authorize(context, profile)))
          continue;
        visible.push({
          id: profile.id,
          label: profile.label,
          family: profile.family,
          kind: profile.taskTypes.some((type) => type.startsWith("image-"))
            ? "image"
            : "language",
          capabilities: [...profile.taskTypes],
        });
      }
      return visible;
    },
  };
}
