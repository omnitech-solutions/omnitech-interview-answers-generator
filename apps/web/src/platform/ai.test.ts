// @vitest-environment node
import type { Execution, InteractionRecord } from "@omnitech/ai-engine";
import { getPlatformDatabase } from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  grantApplicationRole,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import { PostgresAgentJobWorkerRepository } from "@omnitech/platform-storage/worker";
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

// The provider SDK clients are only constructed here, never called: the
// engine's own tests cover what its ports send through them.
vi.mock("openai", () => ({
  default: class {
    constructor(readonly options: unknown) {}
  },
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(readonly options: unknown) {}
  },
}));
// The product names its two profiles; its backend is not this test's subject.
vi.mock("@omnitech/product-interview/backend", () => ({
  INTERVIEW_ANSWER_PROFILE: "interview-answers",
  INTERVIEW_ASSISTANT_PROFILE: "interview-assistant",
}));
// The engine's own tables are another database; the trace is kept here.
const traced: InteractionRecord[] = [];
const keepTraceIn = vi.fn((_url: string) => ({
  write(record: InteractionRecord) {
    traced.push(record);
  },
}));
vi.mock("@omnitech/ai-engine", async (original) => ({
  ...(await original<typeof import("@omnitech/ai-engine")>()),
  keepTraceIn,
}));

const {
  createPlatformAiEngine,
  interviewAssistantBudget,
  interviewAssistantListing,
} = await import("./ai");

// Every variable the engine's composition reads, cleared so the developer's own shell
// never changes what a test sees.
const AI_ENVIRONMENT = [
  "AI_BASE_URL",
  "AI_MODEL",
  "AI_API_KEY",
  "AI_PROVIDER_ID",
  "AI_PROVIDER_LABEL",
  "AI_DEFAULT_PROVIDER_ID",
  "AI_TIMEOUT_MS",
  "AI_LOCALITY",
  "OPENAI_LOCALITY",
  "LM_STUDIO_LOCALITY",
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
  "AI_ENGINE_DATABASE_URL",
  "AI_ENGINE_CAPTURE",
];

let pg: DisposablePostgres;
let tenantId: string;
let userId: string;
beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await grantApplicationRole(pg.owner);
  const user = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.users (email, display_name) VALUES ('member@acme.test', 'Member') RETURNING id",
  );
  const tenant = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.tenants (slug, name) VALUES ('acme', 'Acme') RETURNING id",
  );
  userId = user.rows[0]!.id;
  tenantId = tenant.rows[0]!.id;
  // The engine's agent jobs are kept in the platform database.
  process.env["DATABASE_URL"] = pg.memberUrl;
}, 60_000);
afterAll(async () => {
  await getPlatformDatabase()
    .close()
    .catch(() => undefined);
  await pg?.stop();
});

beforeEach(() => {
  traced.length = 0;
  keepTraceIn.mockClear();
  for (const name of AI_ENVIRONMENT) vi.stubEnv(name, undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// The member every call is made for. The listing takes the same object: the
// engine hands it to the host's authorisation as it is.
const asking = (permissions: readonly string[] = ["presentation.read"]) => ({
  scope: { tenantId, actorId: userId, productId: "omnitech.presentation" },
  permissions,
});
const execution = (signal = new AbortController().signal): Execution => ({
  ...asking(),
  signal,
});
const image = (request: { modelId?: string; aspectRatio?: string } = {}) =>
  createPlatformAiEngine().images.generate(
    { profileId: "image-balanced", prompt: "A lighthouse", ...request },
    execution(),
  );
const made = async (pending: ReturnType<typeof image>) => {
  const result = await pending;
  if (!result.ok) throw new Error(result.failure.detail);
  return result.image;
};
const refused = async (pending: ReturnType<typeof image>) => {
  const result = await pending;
  return result.ok ? undefined : result.failure;
};

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

// One streamed chat completion, as an OpenAI-compatible endpoint sends it.
const completion = (text: string) =>
  new Response(
    [
      {
        choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
      },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join("")
      .concat("data: [DONE]\n\n"),
    { headers: { "content-type": "text/event-stream" } },
  );

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

describe("the engine with no model configured", () => {
  it("declares no language profile, no catalogue, no agents and no jobs", async () => {
    const engine = createPlatformAiEngine();
    expect(
      (await engine.profiles(asking())).map((profile) => profile.id),
    ).toEqual(["image-balanced"]);
    expect(interviewAssistantListing()).toBeUndefined();
    expect(engine.jobs).toBeUndefined();
    const answer = await engine.generate(
      {
        profileId: "document-fast",
        messages: [{ role: "user", parts: [{ type: "text", text: "Hello" }] }],
      },
      execution(),
    );
    expect(answer).toMatchObject({
      ok: false,
      failure: { code: "invalid-request" },
    });
  });

  it("refuses a member without a product permission", async () => {
    const engine = createPlatformAiEngine();
    expect(await engine.profiles(asking([]))).toEqual([]);
    expect(
      await engine.images.generate(
        { profileId: "image-balanced", prompt: "A lighthouse" },
        { ...asking([]), signal: new AbortController().signal },
      ),
    ).toMatchObject({
      ok: false,
      failure: { code: "refused", refusal: "authorization" },
    });
  });

  it("generates placeholder images without an image service", async () => {
    const result = await made(image());
    expect(result.providerId).toBe("fake-image");
    expect(result.assetReference).toMatch(/^data:image\/svg\+xml,/);
    expect(result.mimeType).toBe("image/svg+xml");
  });
});

describe("the engine with a language model", () => {
  it("names a hosted model and its endpoint in the picker", async () => {
    vi.stubEnv("AI_BASE_URL", "https://models.example.com/v1");
    vi.stubEnv("AI_MODEL", "vendor/large-model");
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    const profiles = await createPlatformAiEngine().profiles(asking());
    expect(
      profiles.map(({ id, label, kind }) => ({ id, label, kind })),
    ).toEqual([
      { id: "document-fast", label: "Fast", kind: "model" },
      { id: "document-quality", label: "High quality", kind: "model" },
      {
        id: "interview-assistant",
        label: "Interview assistant",
        kind: "model",
      },
      { id: "interview-answers", label: "Interview answers", kind: "model" },
      { id: "image-balanced", label: "Balanced", kind: "image" },
    ]);
    // The hosted Anthropic model writes the high-quality documents.
    expect(
      profiles.find((profile) => profile.id === "document-quality"),
    ).toMatchObject({ provider: "anthropic-api", model: "claude-sonnet-5-5" });
    expect(
      profiles.find((profile) => profile.id === "document-fast"),
    ).toMatchObject({ provider: "openai", model: "vendor/large-model" });
    expect(interviewAssistantListing()).toMatchObject({
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

  it("sizes each profile's output on the one configured model", async () => {
    vi.stubEnv("AI_BASE_URL", "http://127.0.0.1:1234/v1");
    vi.stubEnv("AI_MODEL", "qwen-loaded");
    const requests = provider(completion("Hello"), completion("Hello"));
    const engine = createPlatformAiEngine();
    const say = (profileId: string) =>
      engine.generate(
        {
          profileId,
          messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
        },
        execution(),
      );
    expect(await say("interview-assistant")).toMatchObject({
      ok: true,
      value: "Hello",
    });
    await say("document-fast");
    expect(requests.map(({ url }) => url)).toEqual([
      "http://127.0.0.1:1234/v1/chat/completions",
      "http://127.0.0.1:1234/v1/chat/completions",
    ]);
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      model: "qwen-loaded",
      max_completion_tokens: 8192,
      temperature: 0.3,
    });
    const document = JSON.parse(String(requests[1]?.init?.body));
    expect(document).toMatchObject({
      model: "qwen-loaded",
      max_completion_tokens: 16_384,
    });
    expect(document).not.toHaveProperty("temperature");
  });

  // The engine waits out its backoff on its own clock, so this takes two seconds.
  it("tries a document call again while the local model is busy, and an assistant turn once", async () => {
    vi.stubEnv("AI_BASE_URL", "http://127.0.0.1:1234/v1");
    vi.stubEnv("AI_MODEL", "qwen-loaded");
    const requests = provider(
      new Response("{}", { status: 503 }),
      completion("Ready"),
      new Response("{}", { status: 503 }),
    );
    const engine = createPlatformAiEngine();
    const say = (profileId: string) =>
      engine.generate(
        {
          profileId,
          messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
        },
        execution(),
      );
    expect(await say("document-fast")).toMatchObject({
      ok: true,
      value: "Ready",
    });
    expect(requests).toHaveLength(2);
    expect(await say("interview-assistant")).toMatchObject({
      ok: false,
      failure: { code: "unavailable" },
    });
    expect(requests).toHaveLength(3);
  }, 15_000);

  it("lists only declared device profiles under a device-only policy", async () => {
    const listing = async (policy?: "device-only") =>
      (
        await createPlatformAiEngine().profiles({
          ...asking(),
          ...(policy ? { policy } : {}),
        })
      ).map((profile) => profile.id);
    provider(); // LM Studio's catalogue answers nothing
    vi.stubEnv("AI_BASE_URL", "http://127.0.0.1:1234/v1");
    vi.stubEnv("AI_MODEL", "qwen-loaded");
    // Loopback alone is not a declaration: nothing is device until declared.
    const undeclared = await listing("device-only");
    vi.stubEnv("AI_LOCALITY", "device");
    const declared = await listing("device-only");
    // Without a policy the listing is unchanged.
    const unrestricted = await listing();

    expect(undeclared).toEqual([]);
    expect(declared).toEqual([
      "document-fast",
      "document-quality",
      "interview-assistant",
      "interview-answers",
    ]);
    expect(unrestricted).toEqual([...declared, "image-balanced"]);
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
    expect(interviewAssistantListing()).toMatchObject({
      tags: ["loaded"],
      local: true,
      contextWindow: 65_536,
    });

    const profiles = await createPlatformAiEngine().profiles(asking());
    expect(requests[0]?.url).toBe("http://127.0.0.1:1234/api/v1/models");
    // The configured model is offered once, as the assistant itself.
    expect(profiles.map((profile) => profile.id)).not.toContain(
      "lm-studio/qwen-loaded",
    );
    // Each model names where it runs, so the picker can group them.
    expect(
      profiles.find((profile) => profile.id === "lm-studio/gemma"),
    ).toMatchObject({
      label: "Gemma",
      model: "gemma",
      listing: {
        id: "lm-studio/gemma",
        provider: {
          name: "LM Studio",
          endpoint: "127.0.0.1:1234",
          local: true,
        },
      },
    });
  });

  it("reaches LM Studio at its own address when the default model is hosted", async () => {
    vi.stubEnv("AI_BASE_URL", "https://models.example.com/v1");
    vi.stubEnv("AI_MODEL", "hosted");
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("LM_STUDIO_MODEL", "local-extra");
    vi.stubEnv("LM_STUDIO_BASE_URL", "http://127.0.0.1:4321/v1");
    const requests = provider(Response.json({ models: [] }));
    await createPlatformAiEngine().profiles(asking());
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
    const profiles = await createPlatformAiEngine().profiles(asking());
    expect(
      profiles.find((profile) => profile.id === "openrouter/vendor/free:free")
        ?.listing?.provider,
    ).toMatchObject({ name: "OpenRouter · free", local: false });
  });
});

describe("the interaction record", () => {
  const say = () =>
    createPlatformAiEngine().images.generate(
      { profileId: "image-balanced", prompt: "A lighthouse" },
      execution(),
    );

  it("is kept nowhere until the engine's database is named", async () => {
    await say();
    expect(keepTraceIn).not.toHaveBeenCalled();
    expect(traced).toEqual([]);
  });

  it("is kept without content by default", async () => {
    vi.stubEnv("AI_ENGINE_DATABASE_URL", "postgresql://engine@db/ai");
    await say();
    expect(keepTraceIn).toHaveBeenCalledWith("postgresql://engine@db/ai");
    expect(traced).toHaveLength(1);
    expect(traced[0]).toMatchObject({
      operation: "image",
      profileId: "image-balanced",
      outcome: "done",
      scope: { tenantId },
    });
    expect(JSON.stringify(traced[0])).not.toContain("lighthouse");
  });

  it("keeps the prompt only when AI_ENGINE_CAPTURE is full", async () => {
    vi.stubEnv("AI_ENGINE_DATABASE_URL", "postgresql://engine@db/ai");
    vi.stubEnv("AI_ENGINE_CAPTURE", "full");
    await say();
    expect(JSON.stringify(traced[0])).toContain("A lighthouse");
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
    const result = await made(
      image({ modelId: "fal-ai/custom", aspectRatio: "1:1" }),
    );
    expect(requests[0]?.url).toBe("https://fal.run/fal-ai/custom");
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: "Key fal-key",
    });
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      prompt: "A lighthouse",
      aspect_ratio: "1:1",
    });
    expect(result).toMatchObject({
      assetReference: "https://cdn.fal.test/image.jpg",
      mimeType: "image/jpeg",
      width: 1600,
      height: 900,
      providerId: "fal",
      modelId: "fal-ai/custom",
    });
  });

  it("reports FAL failures and missing images", async () => {
    vi.stubEnv("FAL_API_KEY", "fal-key");
    provider(
      new Response("{}", { status: 429 }),
      Response.json({ images: [] }),
      Response.json({ images: [{ url: "https://cdn.fal.test/a.png" }] }),
    );
    expect(await refused(image())).toMatchObject({
      code: "rate-limited",
      detail: "FAL returned HTTP 429.",
    });
    expect(await refused(image())).toMatchObject({
      code: "unavailable",
      detail: "FAL returned no image.",
    });
    expect((await made(image())).mimeType).toBe("image/png");
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
    const result = await made(image());
    expect(requests[0]?.url).toBe("http://comfy.test:8188/prompt");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      prompt: { "6": { inputs: { text: "A lighthouse" } } },
    });
    expect(requests[1]?.url).toBe("http://comfy.test:8188/history/p1");
    expect(result.providerId).toBe("comfyui");
    expect(result.assetReference).toBe(
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
      const pending = made(image());
      await vi.advanceTimersByTimeAsync(3_000);
      expect((await pending).assetReference).toBe(
        "http://127.0.0.1:8188/view?filename=a.png&subfolder=run&type=temp",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports ComfyUI configuration and queue failures", async () => {
    vi.stubEnv("COMFYUI_WORKFLOW_JSON", "not json");
    expect((await refused(image()))?.detail).toBe(
      "COMFYUI_WORKFLOW_JSON must be valid JSON.",
    );

    vi.stubEnv("COMFYUI_WORKFLOW_JSON", "{}");
    provider(new Response("{}", { status: 500 }), Response.json({}));
    expect((await refused(image()))?.detail).toBe("ComfyUI returned HTTP 500.");
    expect((await refused(image()))?.detail).toBe(
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
      const pending = refused(image());
      await vi.advanceTimersByTimeAsync(121_000);
      expect((await pending)?.detail).toBe(
        "ComfyUI image generation timed out.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs on Together AI with its default model", async () => {
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
    const result = await made(image());
    expect(requests[0]?.url).toBe(
      "https://api.together.xyz/v1/images/generations",
    );
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      model: "black-forest-labs/FLUX.1-schnell-Free",
      prompt: "A lighthouse",
      width: 1024,
      height: 1024,
    });
    expect(result.revisedPrompt).toBe("A lighthouse at dusk");
    expect(await refused(image())).toMatchObject({
      code: "unavailable",
      detail: "Together AI returned HTTP 503.",
    });
    expect((await refused(image()))?.detail).toBe(
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
    const wide = await made(image({ aspectRatio: "16:9" }));
    expect(requests[0]?.url).toBe(
      "https://openai.example.com/v1/images/generations",
    );
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      model: "gpt-image-1",
      size: "1536x1024",
    });
    expect(wide.assetReference).toBe("data:image/png;base64,aGVsbG8=");
    await made(image());
    expect(JSON.parse(String(requests[1]?.init?.body)).size).toBe("1024x1024");
  });
});

describe("agents", () => {
  const SECRET = "a-payload-secret-of-32-characters!";
  const latestJob = async () =>
    (
      await pg.owner.query<{ id: string; status: string; profile: unknown }>(
        "SELECT id, status, profile_snapshot AS profile FROM ai.agent_jobs ORDER BY created_at DESC, id LIMIT 1",
      )
    ).rows[0];
  const statusOf = async (jobId: string) =>
    (
      await pg.owner.query<{ status: string }>(
        "SELECT status FROM ai.agent_jobs WHERE id = $1",
        [jobId],
      )
    ).rows[0]?.status;
  // The job the call queued, once it exists.
  async function queuedAfter(before: string | undefined) {
    let job = await latestJob();
    while (!job || job.id === before) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      job = await latestJob();
    }
    return job;
  }
  const turnMessages = [
    { role: "system", parts: [{ type: "text", text: "Be brief." }] },
    { role: "user", parts: [{ type: "text", text: "What is a CTE?" }] },
  ] as const;

  // The agent worker is the boundary: the test plays it, writing events to
  // the job the turn queued.
  async function assistantTurn(
    events: object[],
    options: { schema?: object; signal?: AbortSignal } = {},
  ) {
    vi.stubEnv("AGENT_PAYLOAD_SECRET", SECRET);
    const before = (await latestJob())?.id;
    const turn = createPlatformAiEngine().stream(
      {
        profileId: "agent/claude-code",
        messages: turnMessages,
        ...(options.schema ? { schema: options.schema } : {}),
      } as never,
      execution(options.signal),
    );
    const parts: unknown[] = [];
    const reading = (async () => {
      for await (const part of turn) parts.push(part);
    })();
    const job = await queuedAfter(before);
    for (const event of events)
      await new PostgresAgentJobWorkerRepository(pg.owner).appendEvent(
        job.id,
        event as never,
      );
    return { parts, reading, job };
  }

  it("lists Claude Code and Codex when agents can run", async () => {
    vi.stubEnv("AGENT_PAYLOAD_SECRET", SECRET);
    const engine = createPlatformAiEngine();
    const agents = (await engine.profiles(asking())).filter(
      (profile) => profile.kind === "agent",
    );
    expect(agents.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "agent/claude-code", label: "Claude Code" },
      { id: "agent/codex", label: "Codex" },
    ]);
    expect(agents[0]?.listing?.description).toMatch(
      /^Runs .+ through your Claude Code login\./,
    );
    expect(engine.jobs).toBeDefined();
  });

  it("streams an assistant turn's text from the agent's job", async () => {
    const { parts, reading, job } = await assistantTurn([
      { type: "text-delta", text: "A common " },
      { type: "text-delta", text: "table expression." },
      { type: "completed", result: { output: "ignored" } },
    ]);
    await reading;
    expect(parts).toEqual([
      { type: "text", text: "A common " },
      { type: "text", text: "table expression." },
      expect.objectContaining({ type: "done" }),
    ]);
    expect(job.profile).toMatchObject({ id: "assistant-claude-code" });
  });

  it("sends a structured reply's output when nothing streamed", async () => {
    const { parts, reading, job } = await assistantTurn(
      [{ type: "completed", result: { output: { answer: 42 } } }],
      { schema: { type: "object" } },
    );
    await reading;
    expect(parts).toEqual([
      { type: "text", text: '{"answer":42}' },
      expect.objectContaining({ type: "done", value: { answer: 42 } }),
    ]);
    expect(job.profile).toMatchObject({ outputSchema: { type: "object" } });
  });

  it("generates structured values on an agent, with what the run reported it used", async () => {
    vi.stubEnv("AGENT_PAYLOAD_SECRET", SECRET);
    const before = (await latestJob())?.id;
    const schema = {
      type: "object",
      properties: { summary: { type: "string" } },
    };
    const generating = createPlatformAiEngine().generate(
      {
        profileId: "agent/claude-code",
        messages: [
          { role: "system", parts: [{ type: "text", text: "Return JSON." }] },
          { role: "user", parts: [{ type: "text", text: "{}" }] },
        ],
        schema,
      },
      execution(),
    );
    const job = await queuedAfter(before);
    const worker = new PostgresAgentJobWorkerRepository(pg.owner);
    await worker.appendEvent(job.id, {
      type: "usage",
      usage: {
        inputTokens: 2,
        outputTokens: 90,
        totalTokens: 92,
        costUsd: 0.11,
      },
    } as never);
    // The agent fenced its JSON as Markdown while it wrote.
    await worker.appendEvent(job.id, {
      type: "text-delta",
      text: '```json\n{"summary":"Ledger migrations."}\n```',
    } as never);
    await worker.appendEvent(job.id, {
      type: "completed",
      result: { output: '```json\n{"summary":"Ledger migrations."}\n```' },
    } as never);
    expect(await generating).toEqual({
      ok: true,
      value: { summary: "Ledger migrations." },
      usage: {
        status: "known",
        inputTokens: 2,
        outputTokens: 90,
        totalTokens: 92,
        cost: { status: "actual", amount: 0.11, currency: "USD" },
      },
    });
    expect(job.profile).toMatchObject({
      id: "assistant-claude-code",
      outputSchema: schema,
    });
  });

  it("reports a failed agent run", async () => {
    const { parts, reading } = await assistantTurn([
      {
        type: "failed",
        error: { code: "provider", message: "boom", retryable: false },
      },
    ]);
    await reading;
    expect(parts).toEqual([
      {
        type: "failed",
        failure: expect.objectContaining({ code: "unavailable" }),
      },
    ]);
  });

  it("fails a run that started twice and stops the job, instead of joining two runs", async () => {
    const { parts, reading, job } = await assistantTurn([
      { type: "started", sessionId: "first" },
      { type: "started", sessionId: "first" },
      { type: "text-delta", text: '{"a":' },
      { type: "started", sessionId: "second" },
    ]);
    await reading;
    expect(parts.at(-1)).toMatchObject({
      type: "failed",
      failure: { reason: "The agent run restarted" },
    });
    await vi.waitFor(async () =>
      expect(await statusOf(job.id)).toBe("cancelling"),
    );
  });

  it("cancels the job when the turn is stopped", async () => {
    const controller = new AbortController();
    const { parts, reading, job } = await assistantTurn([], {
      signal: controller.signal,
    });
    controller.abort();
    await reading;
    expect(parts).toEqual([{ type: "cancelled" }]);
    await vi.waitFor(async () =>
      expect(await statusOf(job.id)).toBe("cancelling"),
    );
  });
});
