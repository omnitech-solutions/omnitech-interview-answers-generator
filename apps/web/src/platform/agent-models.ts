import type { ModelInput, ModelPart } from "@omnitech-assistant/contracts";
import type { AiStructuredChatRequest } from "@omnitech/ai-contracts";
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
    taskTypes: ["structured-chat"],
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
        if (event.type === "text-delta" && event.text) {
          streamed = true;
          yield { type: "text", text: event.text } as ModelPart;
        } else if (event.type === "completed") {
          const output = event.result.output;
          if (!streamed && output !== undefined)
            yield {
              type: "text",
              text:
                typeof output === "string" ? output : JSON.stringify(output),
            } as ModelPart;
          yield unavailable;
          return;
        } else if (event.type === "failed") {
          throw new Error(`Agent run failed: ${event.error.code}`);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    if (signal.aborted) {
      await jobs.requestCancellation(tenantId, request.context.userId, job.id);
    }
  }
}
