import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import pg from "pg";
import { z } from "zod";
import {
  originSchema,
  productOperationFailure,
  type DatabasePort,
  type Transaction,
  type Scope,
  type ModelPort,
  type ModelInput,
} from "@omni-assistant/contracts";
import {
  createAssistantApp,
  createAssistantWorker,
  createAttachmentService,
  ApiError,
  type CoreDependencies,
} from "@omni-assistant/server";
import {
  RunRepository,
  PgBossRunQueue,
  assistantMigrationUrl,
} from "@omni-assistant/storage-postgres";
import {
  createInterviewAdapter,
  InterviewWorkspaceRepository,
  interviewRunVersions,
  interviewPatchJsonSchema,
  interviewDraftPatchSchema,
} from "@omnitech/product-interview/assistant";
import { DockerCodeRunner } from "@omnitech/code-runner";
import {
  createAiExecutionGateway,
  createGatewayModelPort,
} from "@omnitech/ai-runtime";
import { createOpenAiModelAdapter } from "@omnitech/ai-provider-openai";
// Explicit development-only composition. Production identity must be injected by
// a reviewed session adapter; a missing adapter never falls back to this identity.
if (
  process.env["NODE_ENV"] === "production" ||
  process.env["OMNI_ASSISTANT_LOCAL_DEV"] !== "1"
)
  throw new Error("Explicit non-production loopback launcher required");
const dbPort = Number(process.env["ASSISTANT_PG_PORT"]);
if (!Number.isInteger(dbPort) || dbPort < 1024)
  throw new Error("Task-owned PostgreSQL port required");
const config = {
  host: "127.0.0.1",
  port: dbPort,
  user: "fixture_owner",
  database: "postgres",
};
const admin = new pg.Pool(config),
  member = new pg.Pool({ ...config, user: "fixture_member" });
async function transaction<T>(
  pool: pg.Pool,
  tenant: string | undefined,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (tenant !== undefined)
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [
        tenant,
      ]);
    const result = await fn({
      query: async (sql, values) =>
        (await client.query(sql, values ? [...values] : undefined)).rows,
    });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
const database: DatabasePort = {
    tenantTransaction: (tenant, fn) => transaction(member, tenant, fn),
  },
  workerDatabase = {
    transaction: <T>(fn: (tx: Transaction) => Promise<T>) =>
      transaction(admin, undefined, fn),
  };
await admin.query(await readFile(assistantMigrationUrl, "utf8"));
for (const file of [
  "0004_assistant_interview.sql",
  "0005_assistant_provenance.sql",
])
  await admin.query(
    await readFile(
      new URL(
        `../../../packages/platform-storage/migrations/${file}`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
await admin.query(
  "GRANT USAGE ON SCHEMA assistant,interview TO fixture_member; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA assistant,interview TO fixture_member",
);
const queue = new PgBossRunQueue({
  ...config,
  supervise: false,
  schedule: false,
});
await queue.start();
await admin.query(
  "GRANT USAGE ON SCHEMA pgboss TO fixture_member; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA pgboss TO fixture_member",
);
const scope: Scope = {
  tenantId: "local",
  actorId: "operator",
  productId: "interview",
};
const workspace = new InterviewWorkspaceRepository(database),
  runner = new DockerCodeRunner();
const mode = process.env["ASSISTANT_MODEL_MODE"] ?? "fixture";
if (!["fixture", "lm-studio"].includes(mode))
  throw new Error("Cloud models are disabled in local composition");
const modelId =
  process.env["ASSISTANT_MODEL_ID"] ?? "deterministic-local-fixture";
const inputs: ModelInput[] = [];
// The loaded context window decides how much history and output fit. LM Studio
// reports it for a loaded model; an unloaded one gets a conservative default.
async function loadedContextTokens(id: string): Promise<number | undefined> {
  try {
    const response = await fetch("http://127.0.0.1:1234/api/v0/models", {
      signal: AbortSignal.timeout(2000),
    });
    const body = (await response.json()) as {
      data?: { id: string; loaded_context_length?: number }[];
    };
    return body.data?.find((item) => item.id === id)?.loaded_context_length;
  } catch {
    return undefined;
  }
}
const contextTokens =
  mode === "lm-studio" ? await loadedContextTokens(modelId) : undefined;
// Reserve a quarter of the window (at most 4000 tokens) for the model's output;
// code and JSON average about 2.5 characters per token.
const outputTokens = Math.min(4000, Math.floor((contextTokens ?? 8192) / 4));
const contextChars = Number(
  process.env["ASSISTANT_CONTEXT_CHARS"] ??
    Math.floor(((contextTokens ?? 8192) - outputTokens) * 2.5),
);
const localAdapter = createOpenAiModelAdapter({
  id: "lm-studio",
  label: "Local LM Studio",
  model: modelId,
  baseUrl: "http://127.0.0.1:1234/v1",
  maxOutputTokens: outputTokens,
  // Low enough for factual answers and code, high enough to avoid parroting.
  temperature: 0.3,
});
const gateway = createAiExecutionGateway({
  profiles: [
    {
      id: "local-interview",
      label: "Local interview",
      family: "direct-model",
      targetId: "lm-studio",
      taskTypes: ["structured-chat"],
      enabled: true,
    },
  ],
  models: [localAdapter],
  images: [],
  workflows: [],
  agents: {
    async execute() {
      throw Error("Agents disabled");
    },
    async *stream() {
      throw Error("Agents disabled");
    },
    async cancel() {
      throw Error("Agents disabled");
    },
    async *resume() {
      throw Error("Agents disabled");
    },
  },
  authorize: async (context) =>
    context.tenantId === scope.tenantId &&
    context.userId === scope.actorId &&
    context.productId === "interview" &&
    context.permissions.includes("interview.generate"),
});
const native = createGatewayModelPort(gateway, async () => [
  "interview.generate",
]);
const sourceText =
  "Interview practice: demonstrate optimistic concurrency by comparing an expected revision before writing. Use a pure function and test both matching and stale revisions.";
const sourceHash = createHash("sha256").update(sourceText).digest("hex");
const source = {
  id: "practice-reference",
  revision: 1,
  text: sourceText,
  sha256: sourceHash,
  locator: "local://interview-practice",
  classification: "public" as const,
  audience: [scope.actorId],
  sourceKind: "technical-reference" as const,
};
try {
  await workspace.readEvidence(scope, source.id, 1);
} catch (error) {
  if (productOperationFailure(error)?.code !== "not-found") throw error;
  await workspace.putEvidence(scope, source);
}
const model: ModelPort = {
  async *stream(current, input, signal) {
    inputs.push(input);
    if (inputs.length > 10) inputs.shift();
    if (mode === "lm-studio") {
      yield* native.stream(current, input, signal);
      return;
    }
    // The fixture speaks the real protocol: plain text, and proposePatch as a
    // tool call whose result it then reads before answering.
    const answered = input.messages.at(-1)?.role === "tool";
    const user =
      input.messages
        .filter((item) => item.role === "user")
        .at(-1)
        ?.parts.map((part) => (part.type === "text" ? part.text : ""))
        .join("") ?? "";
    const memory = input.messages
      .flatMap((item) =>
        item.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text),
      )
      .join("\n");
    if (answered) {
      yield {
        type: "text",
        text: "Review the proposed answer before applying.",
      };
      return;
    }
    if (!/draft|propos|answer/i.test(user)) {
      yield {
        type: "text",
        text: `Remembered conversation: ${memory.match(/memory-[a-z0-9-]+/i)?.[0] ?? user}`,
      };
      return;
    }
    const explanation = "Compare the expected revision before writing.";
    const answer = {
      title: "Optimistic concurrency",
      language: "typescript",
      answerMarkdown: `## Question\n- **Optimistic concurrency**\n## Approach\n- ${explanation}\n## Complexity\n- **O(1)** time and space.\n## Edge cases\n- Reject a stale revision.\n## Talking points\n- Prevent lost updates.\n- Keep checks atomic.\n- Make conflicts visible.`,
      code: "// PROBLEM: Reject stale writes.\n// STRATEGY: Compare the expected revision.\n// COMPLEXITY: O(1).\nexport function solution(actual: number, expected: number) {\n // [GUARD] Preserve the revision invariant.\n if(actual !== expected) return false;\n // [DOMAIN] The caller can write atomically.\n return true;\n}",
      usageCode: "console.log(solution(2, 2));",
      testCode:
        'import { expect, it } from "vitest";\nit("accepts current revision", () => expect(solution(2, 2)).toBe(true));\nit("rejects stale revision", () => expect(solution(2, 1)).toBe(false));',
    };
    yield {
      type: "tool-call",
      id: `fixture-${inputs.length}`,
      name: "proposePatch",
      input: {
        answer,
        claims: [
          {
            field: "answerMarkdown",
            text: explanation,
            source: source.id,
            quote: sourceText,
          },
        ],
      },
    };
  },
};
const product = createInterviewAdapter(database, {
  runner,
  authorizeEvidence: async (current, item) =>
    item.audience.includes(current.actorId) &&
    item.classification !== "restricted",
  verifyTechnicalReference: async (_current, item) =>
    item.id === source.id && item.sha256 === sourceHash,
});
async function readable(current: Scope) {
  if (
    current.tenantId !== scope.tenantId ||
    current.actorId !== scope.actorId ||
    current.productId !== "interview"
  )
    return false;
  // Conservative revocation policy: any restricted latest source in this private
  // workspace denies derived drafts, saved versions, history, events and context.
  const rows = await workspace.transaction(current, (tx) =>
    tx.query(
      "SELECT classification,audience FROM (SELECT DISTINCT ON(id) id,classification,audience FROM interview.assistant_evidence WHERE tenant_id=$1 AND actor_id=$2 AND product_id=$3 ORDER BY id,revision DESC) latest",
      [current.tenantId, current.actorId, current.productId],
    ),
  );
  return rows.every(
    (row) =>
      row["classification"] !== "restricted" &&
      Array.isArray(row["audience"]) &&
      row["audience"].includes(current.actorId),
  );
}
const repository = new RunRepository(
  database,
  workerDatabase,
  queue,
  interviewRunVersions(
    mode === "lm-studio" ? `${modelId}:plain-text-tools` : modelId,
  ),
);
const core: CoreDependencies = {
  database,
  repository,
  model,
  products: new Map([["interview", product]]),
  patchSchemas: new Map([["interview", interviewPatchJsonSchema]]),
  authority: {
    isMember: async (current) =>
      current.tenantId === scope.tenantId &&
      current.actorId === scope.actorId &&
      current.productId === "interview",
    hasPermissions: readable,
    authorizeProfile: async (current, id) =>
      id === "local-interview" && (await readable(current)),
  },
};
const attachments = createAttachmentService(core, {
  async ingest(tx, current, input) {
    const evidence = {
      id: input.id,
      revision: 1,
      sha256: input.sha256,
      text: input.text,
      locator: `attachment://${input.id}`,
      classification: "confidential" as const,
      audience: [current.actorId],
      sourceKind: "candidate" as const,
    };
    await workspace.putEvidenceTransaction(tx, current, evidence);
    return evidence;
  },
  async resolve(tx, current, id) {
    const item = await workspace.readEvidenceTransaction(tx, current, id, 1);
    if (
      item.classification === "restricted" ||
      !item.audience.includes(current.actorId)
    )
      throw new ApiError("evidence-forbidden", 403);
    return item;
  },
});
core.resolveAttachmentEvidence = (current, ids, origin) =>
  attachments.resolve(current, ids, origin);
const app = new Hono();
app.onError((error, c) => {
  const failure = productOperationFailure(error);
  return c.json(
    {
      code:
        failure?.code ??
        (error instanceof ApiError ? error.code : "internal-error"),
      message: failure?.code ?? "operation-failed",
    },
    (failure?.statusCode ??
      (error instanceof ApiError ? error.status : 500)) as 400,
  );
});
app.use("/api/*", async (c, next) => {
  const origin = c.req.header("origin");
  const allowed = new Set(["http://127.0.0.1:5175", "http://127.0.0.1:8791"]);
  if (origin && !allowed.has(origin)) throw new ApiError("origin-denied", 403);
  if (
    (c.req.header("x-fixture-tenant") &&
      c.req.header("x-fixture-tenant") !== scope.tenantId) ||
    (c.req.header("x-fixture-actor") &&
      c.req.header("x-fixture-actor") !== scope.actorId)
  )
    throw new ApiError("forbidden", 403);
  if (!(await readable(scope))) throw new ApiError("evidence-forbidden", 403);
  await next();
});
app.route(
  "/api/assistant",
  createAssistantApp({
    ...core,
    attachments,
    resolveScope: async () => scope,
    allowedOrigins: new Set(["http://127.0.0.1:5175"]),
  }),
);
const path = "/api/interview/workspaces/:workspace/artifacts/:artifact";
const originFor = (c: Context) =>
  originSchema.parse({
    workspaceId: c.req.param("workspace"),
    artifactId: c.req.param("artifact"),
    artifactRevision: 0,
  });
app.get(path, async (c) => {
  const origin = originFor(c);
  try {
    return c.json(
      await workspace.read(scope, origin.workspaceId, origin.artifactId),
    );
  } catch (error) {
    if (productOperationFailure(error)?.code !== "not-found") throw error;
    return c.json(
      await workspace.create(scope, origin, {
        question: "New interview question",
        notes: "",
      }),
    );
  }
});
const editSchema = z.strictObject({
  origin: originSchema,
  patch: interviewDraftPatchSchema,
});
app.patch(path, async (c) => {
  const input = editSchema.parse(await c.req.json()),
    origin = originFor(c);
  if (
    input.origin.workspaceId !== origin.workspaceId ||
    input.origin.artifactId !== origin.artifactId
  )
    throw new ApiError("origin-conflict", 409);
  return c.json(await workspace.edit(scope, input.origin, input.patch));
});
const effectSchema = z.strictObject({
  origin: originSchema,
  requestId: z.string().min(1).max(256),
});
app.post(path + "/save", async (c) => {
  const input = effectSchema.parse(await c.req.json()),
    bound = originFor(c);
  if (
    input.origin.workspaceId !== bound.workspaceId ||
    input.origin.artifactId !== bound.artifactId
  )
    throw new ApiError("origin-conflict", 409);
  return c.json(await workspace.save(scope, input.origin, input.requestId));
});
app.post(path + "/run-code", async (c) => {
  const input = effectSchema.parse(await c.req.json()),
    bound = originFor(c);
  if (
    input.origin.workspaceId !== bound.workspaceId ||
    input.origin.artifactId !== bound.artifactId
  )
    throw new ApiError("origin-conflict", 409);
  const result = await product.runCode(scope, input, c.req.raw.signal);
  const effect = await workspace.transaction(scope, (tx) =>
    workspace.readEffectTransaction(tx, scope, "run-code", input.requestId),
  );
  return c.json({ ...result, ...(effect?.result as object) });
});
app.get("/api/v1/answers", async (c) => {
  const origin = {
    workspaceId: "interview",
    artifactId: c.req.query("artifact") ?? "main",
  };
  const records = await workspace.listAnswerRevisions(
    scope,
    origin.workspaceId,
    origin.artifactId,
  );
  return c.json(
    records.map((record) => ({
      ...record.value.answer,
      question: record.value.question,
      notes: record.value.notes,
      id: `${origin.artifactId}:${record.savedRevision}`,
      createdAt: record.createdAt,
      updatedAt: record.createdAt,
    })),
  );
});
app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    mode,
    modelId,
    identity: "explicit-loopback-development",
    protocol: "plain-text-and-tools",
    contextTokens: contextTokens ?? null,
    contextChars,
    outputTokens,
    pid: process.pid,
  }),
);
if (mode === "fixture")
  app.get("/api/test/model-inputs", (c) => c.json(inputs));
app.all("/api/v1/*", (c) =>
  c.json(
    {
      error: {
        code: "explicit-operation-required",
        message:
          "Use reviewed assistant proposals and explicit workspace actions.",
      },
    },
    501,
  ),
);
const ownedWorker = createAssistantWorker({
    ...core,
    budgets: { maxContextCharacters: contextChars },
  }),
  shutdown = new AbortController();
async function idle() {
  await new Promise<void>((resolve) => {
    const stop = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      shutdown.signal.removeEventListener("abort", stop);
      resolve();
    }, 100);
    shutdown.signal.addEventListener("abort", stop, { once: true });
  });
}
const workerLoop = (async () => {
  while (!shutdown.signal.aborted) {
    try {
      if (!(await ownedWorker.tick(shutdown.signal))) await idle();
    } catch (error) {
      if (!shutdown.signal.aborted) {
        console.error(
          JSON.stringify({
            workerError:
              productOperationFailure(error)?.code ?? "worker-failed",
          }),
        );
        await idle();
      }
    }
  }
})();
const server = serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: Number(process.env["ASSISTANT_API_PORT"] ?? 8791),
});
console.log(
  JSON.stringify({
    service: "interview-api",
    pid: process.pid,
    mode,
    modelId,
    host: "127.0.0.1",
  }),
);
async function close() {
  shutdown.abort();
  await workerLoop;
  await queue.stop();
  await member.end();
  await admin.end();
  server.close();
}
process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());
