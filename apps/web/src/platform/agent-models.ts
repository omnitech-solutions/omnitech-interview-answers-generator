import type { ModelInput, ModelPart } from "@omnitech-assistant/contracts";
import type {
  AiExecutionRequest,
  AiStructuredChatRequest,
  AiUsage,
} from "@omnitech/ai-contracts";
import type { AiProfile } from "@omnitech/ai-runtime";
import {
  AgentPayloadStore,
  PostgresAgentJobRepository,
} from "@omnitech/platform-storage";
import type { getPlatformDatabase } from "@omnitech/database";
import { resolveAgentProfiles } from "@omnitech/ai-runtime/config";

// The central agent profile each assistant agent model runs under.
const profileOf = (runtime: Runtime) =>
  resolveAgentProfiles().get(`assistant-${runtime}`);

const RUNTIMES = {
  "claude-code": { name: "Claude Code" },
  codex: { name: "Codex" },
} as const;
type Runtime = keyof typeof RUNTIMES;

// The turn as one prompt: the assistant's rules and pack, then the
// conversation, then what to answer. Tools are not offered to agents.
function promptOf(input: ModelInput): string {
  const text = (parts: ModelInput["messages"][number]["parts"]) =>
    parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim();
  const system = input.messages
    .filter((message) => message.role === "system")
    .map((message) => text(message.parts))
    .join("\n\n");
  const turns = input.messages
    .filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .map(
      (message) =>
        `${message.role === "user" ? "User" : "Assistant"}: ${text(message.parts)}`,
    )
    .filter((line) => !line.endsWith(": "));
  return [
    system,
    "Conversation so far:",
    turns.join("\n\n"),
    input.schema
      ? `Reply with only JSON that matches this schema:\n${JSON.stringify(input.schema)}`
      : "Reply to the user's last message. You cannot use tools here; answer from the context above.",
  ].join("\n\n");
}

const unavailable = {
  type: "usage",
  usage: {
    status: "unavailable",
    reason: "Agent runs do not report tokens here",
    cost: { status: "unavailable", reason: "Billed to your CLI subscription" },
  },
} as unknown as ModelPart;

/**
 * Claude Code and Codex, signed in through their CLIs, as gateway profiles
 * the assistant's picker lists (`agent/claude-code`, `agent/codex`).
 */
export function agentAssistantProfiles(): AiProfile[] {
  return (Object.keys(RUNTIMES) as Runtime[]).map((runtime) => ({
    id: `agent/${runtime}`,
    label: RUNTIMES[runtime].name,
    family: "agent-runtime",
    targetId: runtime,
    // Document generation runs on the same profiles the assistant picks.
    taskTypes: ["structured-chat", "structured-generation"],
    enabled: true,
    listing: {
      name: RUNTIMES[runtime].name,
      description: `Runs ${profileOf(runtime)?.model} through your ${RUNTIMES[runtime].name} login. Answers questions; can't propose changes to your pack.`,
      tags: [],
      strengths: ["reasoning", "writing", "coding"],
      vision: false,
      reasoning: true,
      tools: false,
      local: false,
      provider: { name: "Agents · your CLI login", local: false },
    },
  }));
}

/**
 * One assistant turn on an agent profile, as streamed model parts.
 * [SAFETY] Next.js never starts an agent: each turn is a bounded, read-only,
 * tool-less job that the isolated agent worker runs, and its text streams
 * back from the job's events. Stopping the reply cancels the job.
 */
export async function* streamAgentTurn(
  database: ReturnType<typeof getPlatformDatabase>,
  secret: string,
  request: AiStructuredChatRequest,
  gatewayProfile: AiProfile,
  onUsage?: (usage: AiUsage) => void,
): AsyncIterable<ModelPart> {
  const runtime = gatewayProfile.targetId as Runtime;
  const central = runtime in RUNTIMES ? profileOf(runtime) : undefined;
  if (!central) throw new Error("Unknown agent model profile");
  // The turn's reply schema is the only per-run addition.
  const profile = request.schema
    ? { ...central, outputSchema: request.schema as Record<string, unknown> }
    : central;
  const signal = request.signal ?? new AbortController().signal;
  const jobs = new PostgresAgentJobRepository(database);
  const payloads = new AgentPayloadStore(database, secret);
  const { tenantId } = request.context;
  const job = await jobs.create({
    tenantId,
    userId: request.context.userId,
    productId: request.context.productId,
    profile,
    promptReference: await payloads.save(tenantId, promptOf(request)),
  });
  // Follow the job's events until it finishes; cancel it if the turn stops.
  let after = 0;
  let streamed = false;
  let session: string | undefined;
  let finished = false;
  try {
    for (;;) {
      signal.throwIfAborted();
      for (const { sequence, event } of await jobs.eventsAfter(
        tenantId,
        request.context.userId,
        job.id,
        after,
      )) {
        after = sequence;
        // A run reports its session on every start. A different session means
        // the job was reclaimed and began again; its text would join the first
        // run's, so this try fails instead.
        if (event.type === "started") {
          if (session !== undefined && event.sessionId !== session)
            throw new Error("Agent run restarted");
          session = event.sessionId;
        }
        if (event.type === "text-delta" && event.text) {
          streamed = true;
          yield { type: "text", text: event.text } as ModelPart;
        } else if (event.type === "usage") {
          onUsage?.(event.usage as AiUsage);
        } else if (event.type === "completed") {
          const output = event.result.output;
          if (!streamed && output !== undefined)
            yield {
              type: "text",
              text:
                typeof output === "string" ? output : JSON.stringify(output),
            } as ModelPart;
          finished = true;
          yield unavailable;
          return;
        } else if (event.type === "failed") {
          finished = true;
          throw new Error(`Agent run failed: ${event.error.code}`);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    // Whatever ends the turn early, the job stops spending.
    if (!finished)
      await jobs.requestCancellation(tenantId, request.context.userId, job.id);
  }
}

/**
 * A structured generation (a document's field values) on an agent profile:
 * the same bounded, tool-less worker job as an assistant turn, awaited to its
 * JSON output. [SAFETY] The caller still validates the output against its own
 * contract; nothing here trusts the model's keys.
 */
export async function runAgentStructured(
  database: ReturnType<typeof getPlatformDatabase>,
  secret: string,
  request: AiExecutionRequest,
  gatewayProfile: AiProfile,
): Promise<{ result: unknown; usage?: AiUsage }> {
  const { task } = request;
  if (task.type !== "structured-generation" || !task.schema)
    throw new Error("Agent profiles run structured generation with a schema.");
  const text = (value: string) => [{ type: "text" as const, text: value }];
  let output = "";
  let usage: AiUsage | undefined;
  for await (const part of streamAgentTurn(
    database,
    secret,
    {
      context: request.context,
      profileId: gatewayProfile.id,
      messages: [
        ...(task.system
          ? [{ role: "system" as const, parts: text(task.system) }]
          : []),
        { role: "user" as const, parts: text(task.prompt) },
      ],
      schema: task.schema,
      ...(request.signal ? { signal: request.signal } : {}),
    } as AiStructuredChatRequest,
    gatewayProfile,
    (reported) => {
      usage = reported;
    },
  )) {
    if (part.type === "text") output += part.text;
  }
  return { result: structuredOutput(output), ...(usage ? { usage } : {}) };
}

// The agent returns the schema's object, possibly fenced as Markdown.
export function structuredOutput(text: string): unknown {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text.trim());
  try {
    return JSON.parse(fenced?.[1] ?? text);
  } catch {
    throw new Error("The agent did not return structured JSON.");
  }
}
