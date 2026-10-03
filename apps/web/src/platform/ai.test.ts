// @vitest-environment node
import type { AiAccessContext } from "@omnitech/ai-contracts";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import { PostgresAgentJobRepository } from "@omnitech/platform-storage";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getPlatformDatabase } from "@omnitech/database";
import { createPlatformAiGateway, interviewAssistantBudget } from "./ai";

// Every variable the gateway reads, cleared so the developer's own shell
// never changes what a test sees.
const AI_ENVIRONMENT = [
  "AI_BASE_URL",
  "AI_MODEL",
  "AI_API_KEY",
  "AI_PROVIDER_ID",
  "AI_PROVIDER_LABEL",
  "AI_DEFAULT_PROVIDER_ID",
  "AI_TIMEOUT_MS",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_BASE_URL",
  "OPENAI_IMAGE_MODEL",
  "LM_STUDIO_MODEL",
  "LM_STUDIO_BASE_URL",
  "LM_STUDIO_API_KEY",
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ASSISTANT_CONTEXT_TOKENS",
  "FAL_API_KEY",
  "FAL_IMAGE_MODEL",
  "COMFYUI_WORKFLOW_JSON",
  "COMFYUI_IMAGE_MODEL",
  "COMFYUI_BASE_URL",
  "TOGETHER_AI_API_KEY",
  "TOGETHER_IMAGE_MODEL",
  "AGENT_PAYLOAD_SECRET",
  "CONNECTED_ACCOUNT_SECRET",
];

let pg: DisposablePostgres;
let tenantId: string;
let userId: string;
beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  const user = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.users (email, display_name) VALUES ('member@acme.test', 'Member') RETURNING id",
  );
  const tenant = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.tenants (slug, name) VALUES ('acme', 'Acme') RETURNING id",
  );
  userId = user.rows[0]!.id;
  tenantId = tenant.rows[0]!.id;
  // The gateway's agent port keeps jobs in the platform database.
  process.env["DATABASE_URL"] = pg.ownerUrl;
}, 60_000);
afterAll(async () => {
  await getPlatformDatabase()
    .close()
    .catch(() => undefined);
  await pg?.stop();
});

beforeEach(() => {
  for (const name of AI_ENVIRONMENT) vi.stubEnv(name, undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const context = (): AiAccessContext => ({
  tenantId,
  userId,
  productId: "omnitech.presentation",
  permissions: ["presentation.read"],
});
const imageRequest = (image: Record<string, unknown> = {}) => ({
  context: context(),
  profileId: "image-balanced",
  task: { type: "image-generation" as const, prompt: "A lighthouse", image },
});

// A provider's HTTP endpoint: each request is recorded and answered in turn.
function provider(...answers: Response[]) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return answers.shift() ?? new Response("{}", { status: 500 });
    }),
  );
  return requests;
}

describe("the assistant's context budget", () => {
  it("keeps a quarter of a local model's window for output", () => {
    expect(interviewAssistantBudget("http://127.0.0.1:1234/v1")).toEqual({
      contextTokens: 65_536,
      outputTokens: 8192,
      contextCharacters: Math.floor((65_536 - 8192) * 2.5),
    });
  });

  it("gives a hosted model a large window, or the one configured", () => {
    expect(interviewAssistantBudget("https://api.openai.com/v1")).toEqual({
      contextTokens: 131_072,
      outputTokens: 8192,
      contextCharacters: 100_000,
    });
    vi.stubEnv("ASSISTANT_CONTEXT_TOKENS", "16000");
    expect(interviewAssistantBudget()).toMatchObject({
      contextTokens: 16_000,
      outputTokens: 4000,
    });
  });
});

describe("the gateway with no model configured", () => {
  it("drafts locally and lists the draft model in the picker", async () => {
    const gateway = createPlatformAiGateway();
    const targets = await gateway.listAvailableTargets(context());
    expect(
      targets.find((target) => target.id === "document-fast"),
    ).toMatchObject({
      label: "Local draft (no AI service)",
      family: "direct-model",
    });
    const assistant = targets.find(
      (target) => target.id === "interview-assistant",
    );
    expect(assistant?.listing).toMatchObject({
      name: "Draft model",
      shortName: "Default",
      local: false,
      provider: { name: "Draft model", local: false },
    });
    // No catalogs and no agents without their configuration.
    expect(targets.map((target) => target.id)).not.toContain("agent/codex");

    const draft = await gateway.execute<{ title: string }>({
      context: context(),
      profileId: "document-fast",
      task: {
        type: "structured-generation",
        prompt: "Quarterly review",
        schema: { type: "object", properties: { title: { type: "string" } } },
      },
    });
    expect(draft.result.title).toBe("Quarterly review");
  });

  it("refuses a member without a product permission", async () => {
    const gateway = createPlatformAiGateway();
    expect(
      await gateway.listAvailableTargets({ ...context(), permissions: [] }),
    ).toEqual([]);
  });

  it("generates placeholder images without an image service", async () => {
    const image = await createPlatformAiGateway().execute<{
      providerId: string;
      assetReference: string;
      mimeType: string;
    }>(imageRequest());
    expect(image.result.providerId).toBe("fake-image");
    expect(image.result.assetReference).toMatch(/^data:image\/svg\+xml,/);
    expect(image.result.mimeType).toBe("image/svg+xml");
  });
});

describe("the gateway with a language model", () => {
  it("names a hosted model and its endpoint in the picker", async () => {
    vi.stubEnv("AI_BASE_URL", "https://models.example.com/v1");
    vi.stubEnv("AI_MODEL", "vendor/large-model");
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    const targets = await createPlatformAiGateway().listAvailableTargets(
      context(),
    );
    expect(targets.find((target) => target.id === "document-fast")?.label).toBe(
      "Fast",
    );
    expect(
      targets.find((target) => target.id === "document-quality")?.label,
    ).toBe("High quality");
    expect(
      targets.find((target) => target.id === "interview-assistant")?.listing,
    ).toMatchObject({
      name: "vendor/large-model",
      shortName: "large-model",
      tags: [],
      contextWindow: 131_072,
      local: false,
      provider: {
        name: "OpenAI",
        endpoint: "models.example.com",
        local: false,
      },
    });
  });

  it("offers LM Studio's other installed models beside the loaded one", async () => {
    vi.stubEnv("AI_BASE_URL", "http://127.0.0.1:1234/v1");
    vi.stubEnv("AI_MODEL", "qwen-loaded");
    const requests = provider(
      Response.json({
        models: [
          { type: "llm", key: "qwen-loaded", max_context_length: 65_536 },
          {
            type: "llm",
            key: "gemma",
            display_name: "Gemma",
            max_context_length: 65_536,
          },
        ],
      }),
    );
    const gateway = createPlatformAiGateway();
    const assistant = (await gateway.listAvailableTargets(context())).find(
      (target) => target.id === "interview-assistant",
    );
    expect(assistant?.listing).toMatchObject({
      tags: ["loaded"],
      local: true,
      contextWindow: 65_536,
    });

    const chat = await gateway.listAvailableTargets(context(), {
      taskType: "structured-chat",
    });
    expect(requests[0]?.url).toBe("http://127.0.0.1:1234/api/v1/models");
    // The configured model is offered once, as the assistant itself.
    expect(chat.map((target) => target.id)).toContain("lm-studio/gemma");
    expect(chat.map((target) => target.id)).not.toContain(
      "lm-studio/qwen-loaded",
    );
  });

  it("reaches LM Studio at its own address when the default model is hosted", async () => {
    vi.stubEnv("AI_BASE_URL", "https://models.example.com/v1");
    vi.stubEnv("AI_MODEL", "hosted");
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("LM_STUDIO_MODEL", "local-extra");
    vi.stubEnv("LM_STUDIO_BASE_URL", "http://127.0.0.1:4321/v1");
    const requests = provider(Response.json({ models: [] }));
    await createPlatformAiGateway().listAvailableTargets(context(), {
      taskType: "structured-chat",
    });
    expect(requests[0]?.url).toBe("http://127.0.0.1:4321/api/v1/models");
  });

  it("offers OpenRouter's free models when a key is configured", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", " router-key ");
    provider(
      Response.json({
        data: [
          {
            id: "vendor/free:free",
            name: "Free",
            pricing: { prompt: "0", completion: "0" },
            supported_parameters: ["tools"],
            context_length: 200_000,
          },
        ],
      }),
    );
    const chat = await createPlatformAiGateway().listAvailableTargets(
      context(),
      { taskType: "structured-chat" },
    );
    expect(chat.map((target) => target.id)).toContain(
      "openrouter/vendor/free:free",
    );
  });
});

describe("image generation", () => {
  it("runs on FAL with the requested model and aspect ratio", async () => {
    vi.stubEnv("FAL_API_KEY", "fal-key");
    const requests = provider(
      Response.json({
        images: [
          {
            url: "https://cdn.fal.test/image.jpg",
            content_type: "image/jpeg",
            width: 1600,
            height: 900,
          },
        ],
      }),
    );
    const image = await createPlatformAiGateway().execute<{
      assetReference: string;
      width: number;
    }>(imageRequest({ modelId: "fal-ai/custom", aspectRatio: "1:1" }));
    expect(requests[0]?.url).toBe("https://fal.run/fal-ai/custom");
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: "Key fal-key",
    });
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      prompt: "A lighthouse",
      aspect_ratio: "1:1",
    });
    expect(image.result).toMatchObject({
      assetReference: "https://cdn.fal.test/image.jpg",
      mimeType: "image/jpeg",
      width: 1600,
      height: 900,
    });
  });

  it("reports FAL failures and missing images", async () => {
    vi.stubEnv("FAL_API_KEY", "fal-key");
    provider(
      new Response("{}", { status: 429 }),
      Response.json({ images: [] }),
      Response.json({ images: [{ url: "https://cdn.fal.test/a.png" }] }),
    );
    const gateway = createPlatformAiGateway();
    await expect(gateway.execute(imageRequest())).rejects.toThrow(
      "FAL returned 429.",
    );
    await expect(gateway.execute(imageRequest())).rejects.toThrow(
      "FAL returned no image.",
    );
    const image = await gateway.execute<{ mimeType: string }>(imageRequest());
    expect(image.result.mimeType).toBe("image/png");
  });

  it("queues a ComfyUI workflow and returns its first output", async () => {
    vi.stubEnv(
      "COMFYUI_WORKFLOW_JSON",
      JSON.stringify({ "6": { inputs: { text: "{{prompt}}" } } }),
    );
    vi.stubEnv("COMFYUI_BASE_URL", "http://comfy.test:8188/");
    const requests = provider(
      Response.json({ prompt_id: "p1" }),
      Response.json({
        p1: {
          outputs: { "9": { images: [{ filename: "out.png" }] } },
        },
      }),
    );
    const image = await createPlatformAiGateway().execute<{
      assetReference: string;
    }>(imageRequest());
    expect(requests[0]?.url).toBe("http://comfy.test:8188/prompt");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      prompt: { "6": { inputs: { text: "A lighthouse" } } },
    });
    expect(requests[1]?.url).toBe("http://comfy.test:8188/history/p1");
    expect(image.result.assetReference).toBe(
      "http://comfy.test:8188/view?filename=out.png&subfolder=&type=output",
    );
  });

  it("waits for ComfyUI to finish before reading the output", async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("COMFYUI_WORKFLOW_JSON", "{}");
      provider(
        Response.json({ prompt_id: "p2" }),
        new Response("{}", { status: 404 }),
        Response.json({ p2: {} }),
        Response.json({
          p2: {
            outputs: {
              "9": {
                images: [{ filename: "a.png", subfolder: "run", type: "temp" }],
              },
            },
          },
        }),
      );
      const pending = createPlatformAiGateway().execute<{
        assetReference: string;
      }>(imageRequest());
      await vi.advanceTimersByTimeAsync(3_000);
      expect((await pending).result.assetReference).toBe(
        "http://127.0.0.1:8188/view?filename=a.png&subfolder=run&type=temp",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports ComfyUI configuration and queue failures", async () => {
    vi.stubEnv("COMFYUI_WORKFLOW_JSON", "not json");
    await expect(
      createPlatformAiGateway().execute(imageRequest()),
    ).rejects.toThrow("COMFYUI_WORKFLOW_JSON must be valid JSON.");

    vi.stubEnv("COMFYUI_WORKFLOW_JSON", "{}");
    provider(new Response("{}", { status: 500 }), Response.json({}));
    const gateway = createPlatformAiGateway();
    await expect(gateway.execute(imageRequest())).rejects.toThrow(
      "ComfyUI returned 500.",
    );
    await expect(gateway.execute(imageRequest())).rejects.toThrow(
      "ComfyUI returned no prompt id.",
    );
  });

  it("gives up on ComfyUI after two minutes", async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("COMFYUI_WORKFLOW_JSON", "{}");
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) =>
          String(input).endsWith("/prompt")
            ? Response.json({ prompt_id: "slow" })
            : Response.json({}),
        ),
      );
      const pending = createPlatformAiGateway().execute(imageRequest());
      const failed = expect(pending).rejects.toThrow(
        "ComfyUI image generation timed out.",
      );
      await vi.advanceTimersByTimeAsync(121_000);
      await failed;
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs on Together AI with the requested size", async () => {
    vi.stubEnv("TOGETHER_AI_API_KEY", "together-key");
    const requests = provider(
      Response.json({
        data: [
          {
            url: "https://cdn.together.test/a.png",
            revised_prompt: "A lighthouse at dusk",
          },
        ],
      }),
      new Response("{}", { status: 503 }),
      Response.json({ data: [] }),
    );
    const gateway = createPlatformAiGateway();
    const image = await gateway.execute<{ revisedPrompt: string }>(
      imageRequest({ width: 512, height: 768 }),
    );
    expect(requests[0]?.url).toBe(
      "https://api.together.xyz/v1/images/generations",
    );
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      model: "black-forest-labs/FLUX.1-schnell-Free",
      prompt: "A lighthouse",
      width: 512,
      height: 768,
    });
    expect(image.result.revisedPrompt).toBe("A lighthouse at dusk");
    await expect(gateway.execute(imageRequest())).rejects.toThrow(
      "Together AI returned 503.",
    );
    await expect(gateway.execute(imageRequest())).rejects.toThrow(
      "Together AI returned no image.",
    );
  });

  it("runs on OpenAI Images and accepts inline image data", async () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("OPENAI_BASE_URL", "https://openai.example.com/v1/");
    const requests = provider(
      Response.json({ data: [{ b64_json: "aGVsbG8=" }] }),
      Response.json({ data: [{ url: "https://cdn.openai.test/b.png" }] }),
    );
    const gateway = createPlatformAiGateway();
    const wide = await gateway.execute<{ assetReference: string }>(
      imageRequest({ aspectRatio: "16:9" }),
    );
    expect(requests[0]?.url).toBe(
      "https://openai.example.com/v1/images/generations",
    );
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      model: "gpt-image-1",
      size: "1536x1024",
    });
    expect(wide.result.assetReference).toBe("data:image/png;base64,aGVsbG8=");
    await gateway.execute(imageRequest());
    expect(JSON.parse(String(requests[1]?.init?.body)).size).toBe("1024x1024");
  });
});

describe("agent jobs", () => {
  const jobs = () => new PostgresAgentJobRepository(pg.owner);
  const latestJob = async () =>
    (
      await pg.owner.query<{ id: string; status: string; profile: unknown }>(
        "SELECT id, status, profile_snapshot AS profile FROM ai.agent_jobs ORDER BY created_at DESC, id LIMIT 1",
      )
    ).rows[0];

  it("queues an agent job for the worker and cancels it on request", async () => {
    vi.stubEnv("AGENT_PAYLOAD_SECRET", "a-payload-secret-of-32-characters!");
    const gateway = createPlatformAiGateway();
    const execution = await gateway.execute<{ jobId: string; status: string }>({
      context: context(),
      profileId: "presentation-editor",
      task: { type: "agent-job", prompt: "Tighten slide three." },
    });
    expect(execution).toMatchObject({
      family: "agent-runtime",
      targetId: "claude-code",
      result: { status: "queued" },
    });
    expect((await latestJob())?.id).toBe(execution.result.jobId);

    await gateway.cancel(execution.executionId);
    expect((await latestJob())?.status).toBe("cancelling");
    // An unknown job has nothing to cancel.
    await gateway.cancel("00000000-0000-4000-8000-0000000000ff");
  });

  it("streams a queued job as started and completed", async () => {
    vi.stubEnv(
      "CONNECTED_ACCOUNT_SECRET",
      "a-payload-secret-of-32-characters!",
    );
    const events = [];
    for await (const event of createPlatformAiGateway().stream({
      context: context(),
      profileId: "presentation-editor",
      task: { type: "agent-job", prompt: "Draft speaker notes." },
    }))
      events.push(event.type);
    expect(events).toEqual(["started", "completed"]);
  });

  it("refuses agent jobs without a payload secret, and resumes none", async () => {
    const gateway = createPlatformAiGateway();
    await expect(
      gateway.execute({
        context: context(),
        profileId: "presentation-editor",
        task: { type: "agent-job", prompt: "Anything" },
      }),
    ).rejects.toThrow("AGENT_PAYLOAD_SECRET is not configured.");
    const resumed = gateway.resume({
      context: context(),
      executionId: "job",
      input: "Continue",
    });
    await expect(resumed[Symbol.asyncIterator]().next()).rejects.toThrow(
      "Resume requires an existing agent session job.",
    );
  });

  it("lists Claude Code and Codex for the assistant when agents can run", async () => {
    vi.stubEnv("AGENT_PAYLOAD_SECRET", "a-payload-secret-of-32-characters!");
    const targets = await createPlatformAiGateway().listAvailableTargets(
      context(),
    );
    const agents = targets.filter((target) => target.id.startsWith("agent/"));
    expect(agents.map((target) => target.listing?.name)).toEqual([
      "Claude Code",
      "Codex",
    ]);
    expect(agents[0]?.listing?.description).toMatch(
      /^Runs .+ through your Claude Code login\./,
    );
  });

  // The agent worker is the boundary: the test plays it, writing events to
  // the job the turn queued.
  async function assistantTurn(
    events: object[],
    options: { schema?: object; signal?: AbortSignal } = {},
  ) {
    vi.stubEnv("AGENT_PAYLOAD_SECRET", "a-payload-secret-of-32-characters!");
    const before = (await latestJob())?.id;
    const turn = createPlatformAiGateway().streamStructured({
      context: context(),
      profileId: "agent/claude-code",
      messages: [
        { role: "system", parts: [{ type: "text", text: "Be brief." }] },
        { role: "user", parts: [{ type: "text", text: "What is a CTE?" }] },
        { role: "assistant", parts: [] },
      ],
      ...(options.schema ? { schema: options.schema } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    } as never);
    const parts: unknown[] = [];
    const reading = (async () => {
      for await (const part of turn) parts.push(part);
    })();
    let job = await latestJob();
    while (!job || job.id === before) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      job = await latestJob();
    }
    for (const event of events)
      await jobs().appendEvent(job.id, event as never);
    return { parts, reading, job };
  }

  it("streams an assistant turn's text from the agent's job", async () => {
    const { parts, reading, job } = await assistantTurn([
      { type: "text-delta", text: "A common " },
      { type: "text-delta", text: "table expression." },
      { type: "completed", result: { output: "ignored" } },
    ]);
    await reading;
    expect(parts.slice(0, 2)).toEqual([
      { type: "text", text: "A common " },
      { type: "text", text: "table expression." },
    ]);
    expect(parts[2]).toMatchObject({
      type: "usage",
      usage: { status: "unavailable" },
    });
    expect(job.profile).toMatchObject({ id: "assistant-claude-code" });
  });

  it("sends a structured reply's output when nothing streamed", async () => {
    const { parts, reading, job } = await assistantTurn(
      [{ type: "completed", result: { output: { answer: 42 } } }],
      { schema: { type: "object" } },
    );
    await reading;
    expect(parts[0]).toEqual({ type: "text", text: '{"answer":42}' });
    expect(job.profile).toMatchObject({ outputSchema: { type: "object" } });
  });

  it("reports a failed agent run", async () => {
    const { reading } = await assistantTurn([
      { type: "failed", error: { code: "agent-crashed", message: "boom" } },
    ]);
    await expect(reading).rejects.toThrow("Agent run failed: agent-crashed");
  });

  it("cancels the job when the turn is stopped", async () => {
    const controller = new AbortController();
    const { reading, job } = await assistantTurn([], {
      signal: controller.signal,
    });
    controller.abort();
    await expect(reading).rejects.toThrow();
    expect(
      (
        await pg.owner.query<{ status: string }>(
          "SELECT status FROM ai.agent_jobs WHERE id = $1",
          [job.id],
        )
      ).rows[0]?.status,
    ).toBe("cancelling");
  });
});
