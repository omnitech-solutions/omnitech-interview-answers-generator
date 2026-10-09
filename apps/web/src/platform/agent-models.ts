import {
  failure,
  type ModelCatalog,
  type ModelInfo,
  type ModelInput,
  type ModelPart,
  type ModelPort,
} from "@omnitech/ai-engine";
import type { Jobs } from "@omnitech/ai-engine/jobs";
import {
  type AgentProfile,
  toFailure,
  toUsage,
} from "@omnitech/ai-engine/providers/agents";

const RUNTIMES = {
  "claude-code": { name: "Claude Code" },
  codex: { name: "Codex" },
} as const;
type Runtime = keyof typeof RUNTIMES;

// The catalogue the agents are listed under: `agent/claude-code`, `agent/codex`.
export const AGENT_CATALOG = "agent";
const PREFIX = `${AGENT_CATALOG}/`;

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

// An agent may return its JSON fenced as Markdown; the engine validates what
// is inside.
export function unfenced(text: string): string {
  return /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text.trim())?.[1] ?? text;
}

// What the engine's `classify` reads: an error that already carries its failure.
const failed = (reason: ReturnType<typeof failure>) =>
  Object.assign(new Error(reason.reason), { failure: reason });

export interface AgentJobSourceOptions {
  jobs: Jobs;
  // The central agent profiles (platform-runtime/ai-config), by id.
  profiles: ReadonlyMap<string, AgentProfile>;
  // Keeps a prompt encrypted for the worker and returns its reference; the
  // job row never holds the prompt.
  savePrompt(tenantId: string, prompt: string): Promise<string>;
}

/**
 * Claude Code and Codex, signed in through their CLIs, as models of one
 * catalogue (`agent/claude-code`, `agent/codex`) and the port that runs them.
 * [SAFETY] Next.js never starts an agent: each call is a bounded, read-only,
 * tool-less job that the isolated agent worker runs, and its text streams
 * back from the job's events. Stopping the call cancels the job.
 */
export function createAgentJobSource(options: AgentJobSourceOptions): {
  catalog: ModelCatalog;
  port: ModelPort;
} {
  // The central agent profile each agent model runs under.
  const profileOf = (runtime: string) =>
    runtime in RUNTIMES
      ? options.profiles.get(`assistant-${runtime}`)
      : undefined;
  const models: ModelInfo[] = (Object.keys(RUNTIMES) as Runtime[]).map(
    (runtime) => ({
      id: `${PREFIX}${runtime}`,
      name: RUNTIMES[runtime].name,
      description: `Runs ${profileOf(runtime)?.model} through your ${RUNTIMES[runtime].name} login. Answers questions; can't propose changes to your pack.`,
      tags: [],
      strengths: ["reasoning", "writing", "coding"],
      vision: false,
      reasoning: true,
      tools: false,
      local: false,
      provider: { name: "Agents · your CLI login", local: false },
    }),
  );

  return {
    catalog: { list: async () => ({ models }) },
    port: {
      kind: "agent",
      model: (profileId) => profileOf(profileId.slice(PREFIX.length))?.model,
      async *stream(scope, input, signal): AsyncIterable<ModelPart> {
        const central = profileOf(input.profileId.slice(PREFIX.length));
        if (!central)
          throw failed(
            failure("invalid-request", "Unknown agent model profile"),
          );
        // The call's reply schema is the only per-run addition.
        const structured =
          typeof input.schema === "object" ? input.schema : undefined;
        const profile = structured
          ? {
              ...central,
              outputSchema: structured as Readonly<Record<string, unknown>>,
            }
          : central;
        signal.throwIfAborted();
        const submitted = await options.jobs.submit(
          {
            profile,
            promptReference: await options.savePrompt(
              scope.tenantId,
              promptOf(input),
            ),
          },
          { scope, signal },
        );
        if (!submitted.ok) throw failed(submitted.failure);
        const { jobId } = submitted.receipt;
        // Follow the job's events until it finishes; cancel it if the call stops.
        let text = "";
        let session: string | undefined;
        let finished = false;
        try {
          for await (const { event } of options.jobs.events(jobId, {
            scope,
            signal,
          })) {
            // A run reports its session on every start. A different session
            // means the job was reclaimed and began again; its text would join
            // the first run's, so this call fails instead.
            if (event.type === "started") {
              if (session !== undefined && event.sessionId !== session)
                throw failed(failure("unavailable", "The agent run restarted"));
              session = event.sessionId;
            } else if (event.type === "text-delta" && event.text) {
              text += event.text;
              // A structured reply is sent whole, once it is known.
              if (!structured) yield { type: "text", text: event.text };
            } else if (event.type === "usage") {
              yield { type: "usage", usage: toUsage(event.usage) };
            } else if (event.type === "completed") {
              finished = true;
              const { output, usage } = event.result;
              if (usage) yield { type: "usage", usage: toUsage(usage) };
              // The runtime's own structured result is its answer; otherwise
              // what streamed is, or the output when nothing streamed.
              const reply =
                structured && output !== null && typeof output === "object"
                  ? JSON.stringify(output)
                  : text ||
                    (typeof output === "string"
                      ? output
                      : output === undefined || output === null
                        ? ""
                        : JSON.stringify(output));
              const rest = structured ? unfenced(reply) : text ? "" : reply;
              if (rest) yield { type: "text", text: rest };
              return;
            } else if (event.type === "failed") {
              finished = true;
              throw failed(toFailure(event.error));
            }
          }
          signal.throwIfAborted();
          // The job settled with no closing event (cancelled or timed out).
          throw failed(
            failure("unavailable", "The agent ended without a result"),
          );
        } finally {
          // Whatever ends the call early, the job stops spending.
          if (!finished)
            await options.jobs.cancel(jobId, { scope }).catch(() => undefined);
        }
      },
    },
  };
}
