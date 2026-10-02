import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ModelInput,
  ModelInfo,
  ModelPart,
  Scope,
} from "@omnitech-assistant/contracts";
import type { ModelSource } from "@omnitech-assistant/providers";
import type { AgentProfile } from "@omnitech/agent-runtime-contracts";
import {
  AgentPayloadStore,
  getPlatformDatabase,
  PostgresAgentJobRepository,
} from "@omnitech/platform-storage";

const PREFIX = "agent/";
// The `model = "…"` line of ~/.codex/config.toml, if there is one.
function codexConfiguredModel(): string | undefined {
  try {
    const config = readFileSync(
      join(
        process.env["CODEX_HOME"] ?? join(homedir(), ".codex"),
        "config.toml",
      ),
      "utf8",
    );
    return /^\s*model\s*=\s*"([^"]+)"/m.exec(config)?.[1];
  } catch {
    return undefined;
  }
}
const RUNTIMES = {
  "claude-code": {
    name: "Claude Code",
    // Sonnet answers coaching questions well and much faster than Opus;
    // CLAUDE_ASSISTANT_MODEL picks another. Documents keep their own model.
    model: () => process.env["CLAUDE_ASSISTANT_MODEL"] ?? "sonnet",
  },
  codex: {
    name: "Codex",
    // The model the person's Codex CLI uses: a ChatGPT sign-in only accepts
    // some models, and the CLI's own choice is one it accepts.
    model: () =>
      process.env["CODEX_ASSISTANT_MODEL"] ??
      codexConfiguredModel() ??
      "gpt-5.3-codex",
  },
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
 * Claude Code and Codex, signed in through their CLIs, as assistant models.
 * [SAFETY] Next.js never starts an agent: each turn is a bounded, read-only,
 * tool-less job that the isolated agent worker runs, and its text streams
 * back from the job's events. Stopping the reply cancels the job.
 */
export function createAgentModels(secret: string): ModelSource {
  const database = getPlatformDatabase();
  const jobs = new PostgresAgentJobRepository(database);
  const payloads = new AgentPayloadStore(database, secret);
  const models: ModelInfo[] = (Object.keys(RUNTIMES) as Runtime[]).map(
    (runtime) => ({
      id: `${PREFIX}${runtime}`,
      name: RUNTIMES[runtime].name,
      description: `Runs ${RUNTIMES[runtime].model()} through your ${RUNTIMES[runtime].name} login. Answers questions; can't propose changes to your pack.`,
      tags: [],
      strengths: ["reasoning", "writing", "coding"],
      vision: false,
      reasoning: true,
      tools: false,
      local: false,
    }),
  );
  return {
    catalog: {
      list: async () => ({
        models,
        provider: { name: "Agents · your CLI login", local: false },
      }),
    },
    port: {
      async *stream(scope: Scope, input: ModelInput, signal: AbortSignal) {
        const runtime = input.profileId.slice(PREFIX.length) as Runtime;
        if (!(runtime in RUNTIMES))
          throw new Error("Unknown agent model profile");
        const profile: AgentProfile = {
          id: `assistant-${runtime}`,
          runtime,
          model: RUNTIMES[runtime].model(),
          fallbackModels: [],
          // Short coaching replies: Codex thinks less and answers sooner.
          effort: runtime === "codex" ? "low" : "medium",
          tools: [],
          sandbox: "read-only",
          approvalPolicy: "never",
          sessionPersistence: false,
          maximumTurns: 1,
          timeoutMs: 300_000,
          maximumOutputBytes: 1_000_000,
          additionalDirectories: [],
          webSearch: false,
          ...(input.schema
            ? { outputSchema: input.schema as Record<string, unknown> }
            : {}),
        };
        const job = await jobs.create({
          tenantId: scope.tenantId,
          userId: scope.actorId,
          productId: scope.productId,
          profile,
          promptReference: await payloads.save(scope.tenantId, promptOf(input)),
        });
        // Follow the job's events until it finishes; cancel it if the turn stops.
        let after = 0;
        let streamed = false;
        try {
          for (;;) {
            signal.throwIfAborted();
            for (const { sequence, event } of await jobs.eventsAfter(
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
                      typeof output === "string"
                        ? output
                        : JSON.stringify(output),
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
          if (signal.aborted)
            await jobs.requestCancellation(scope.tenantId, job.id);
        }
      },
    },
  };
}
