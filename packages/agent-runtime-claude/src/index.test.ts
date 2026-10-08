import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentEvent,
  AgentProfile,
  AgentRunRequest,
} from "@omnitech/agent-runtime-contracts";
import { AGENT_IMAGE_MAX_BYTES } from "@omnitech/agent-runtime-contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// What the SDK was last given, and what a scenario makes it emit.
const seen: {
  user?: { message: { content: unknown } };
  options?: Record<string, unknown>;
  queries: number;
} = { queries: 0 };
let scenario: "text" | "tool-use" | "structured" | "max-turns" | "odd-subtype" =
  "text";

// What a run streams as text before the SDK stops it without a success, and a
// hold that keeps the result back until the run is interrupted.
let written: string[] = [];
let held: { wait: Promise<void>; release: () => void } | undefined;

const toolStart = (name: string) => ({
  type: "stream_event",
  session_id: "s1",
  event: {
    type: "content_block_start",
    content_block: { type: "tool_use", name },
  },
});

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (params: {
    prompt: AsyncIterable<{ message: { content: unknown } }>;
    options: Record<string, unknown>;
  }) =>
    Object.assign(
      (async function* () {
        seen.queries += 1;
        seen.options = params.options;
        // Streaming input: take the first user message, as the real SDK does.
        for await (const user of params.prompt) {
          seen.user = user;
          break;
        }
        if (scenario === "max-turns" || scenario === "odd-subtype") {
          yield { type: "system", session_id: "s1" };
          for (const text of written)
            yield {
              type: "stream_event",
              session_id: "s1",
              event: {
                type: "content_block_delta",
                delta: { type: "text_delta", text },
              },
            };
          await held?.wait;
          yield {
            type: "result",
            subtype:
              scenario === "max-turns" ? "error_max_turns" : "error_novel_case",
            session_id: "s1",
            usage: { input_tokens: 1, output_tokens: 1 },
            total_cost_usd: 0,
          };
          return;
        }
        if (scenario === "tool-use") {
          yield toolStart("Bash");
          throw new Error("must not be consumed past a refused tool");
        }
        if (scenario === "structured") {
          // The SDK's synthetic tool_use that carries a json_schema answer; its
          // input streams as input_json_delta fragments.
          yield { type: "system", session_id: "s1" };
          yield toolStart("StructuredOutput");
          for (const partial_json of ['{"a"', ":1}"])
            yield {
              type: "stream_event",
              session_id: "s1",
              event: {
                type: "content_block_delta",
                delta: { type: "input_json_delta", partial_json },
              },
            };
          yield {
            type: "assistant",
            session_id: "s1",
            message: {
              content: [
                { type: "tool_use", name: "StructuredOutput", input: { a: 1 } },
              ],
              usage: { input_tokens: 3, output_tokens: 2 },
            },
          };
          yield {
            type: "result",
            subtype: "success",
            session_id: "s1",
            result: "",
            structured_output: { a: 1 },
            usage: { input_tokens: 3, output_tokens: 2 },
            total_cost_usd: 0.01,
            num_turns: 1,
            duration_api_ms: 1234,
          };
          return;
        }
        yield { type: "system", session_id: "s1" };
        for (const text of ["Hel", "lo"])
          yield {
            type: "stream_event",
            session_id: "s1",
            event: {
              type: "content_block_delta",
              delta: { type: "text_delta", text },
            },
          };
        yield {
          type: "assistant",
          session_id: "s1",
          message: { content: [{ type: "text", text: "Hello" }] },
        };
        yield {
          type: "result",
          subtype: "success",
          session_id: "s1",
          result: "Hello",
          usage: { input_tokens: 3, output_tokens: 2 },
          total_cost_usd: 0,
          num_turns: 1,
          duration_api_ms: 1234,
        };
      })(),
      {
        close: () => {},
        // An interrupted CLI ends its turn with a result; the short wait lets
        // the adapter read that result before the cancel goes on.
        interrupt: async () => {
          if (!held) return;
          held.release();
          await new Promise((resolve) => setTimeout(resolve, 25));
        },
      },
    ),
}));

const { createClaudeRuntimeAdapter } = await import("./index");

const profile: AgentProfile = {
  id: "p",
  version: 1,
  runtime: "claude-code",
  model: "sonnet",
  fallbackModels: [],
  effort: "medium",
  tools: [],
  sandbox: "read-only",
  approvalPolicy: "never",
  sessionPersistence: false,
  maximumTurns: 1,
  timeoutMs: 1000,
  maximumOutputBytes: 1000,
  additionalDirectories: [],
  webSearch: false,
};

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "claude-stage-"));
  await mkdir(join(root, "stage"));
  await writeFile(join(root, "stage", "shot.png"), Buffer.from("PNGDATA"));
  await writeFile(
    join(root, "stage", "big.png"),
    Buffer.alloc(AGENT_IMAGE_MAX_BYTES + 1),
  );
  await writeFile(join(root, "outside.png"), Buffer.from("OUT"));
  await symlink(join(root, "outside.png"), join(root, "stage", "link.png"));
});
afterAll(async () => rm(root, { recursive: true, force: true }));

const run = async (
  overrides: Partial<AgentRunRequest> = {},
  adapter = createClaudeRuntimeAdapter(),
) => {
  const events: AgentEvent[] = [];
  for await (const event of adapter.run({
    runId: "r1",
    profile,
    prompt: "Hi",
    workingDirectory: "/tmp",
    additionalDirectories: [],
    attachments: [],
    timeoutMs: 1000,
    ...overrides,
  }))
    events.push(event);
  return events;
};

const image = (reference: string) => ({
  id: "a",
  kind: "image" as const,
  name: "shot.png",
  reference,
  mimeType: "image/png",
});

describe("Claude runtime", () => {
  it("streams text as it is written and does not repeat it from the finished message", async () => {
    scenario = "text";
    const events = await run();
    expect(events.filter((event) => event.type === "text-delta")).toEqual([
      { type: "text-delta", text: "Hel" },
      { type: "text-delta", text: "lo" },
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      result: { output: "Hello" },
    });
  });
});

describe("Claude runtime session path", () => {
  it("advertises the image input and tool-less operation its fixtures prove", () => {
    expect(createClaudeRuntimeAdapter().capabilities).toMatchObject({
      imageInput: true,
      toolless: true,
    });
  });

  it("forwards a staged image as an SDK image content block, tool-less and unpersisted", async () => {
    scenario = "text";
    const events = await run({
      attachments: [image(join(root, "stage", "shot.png"))],
      attachmentRoot: join(root, "stage"),
      toolless: true,
    });
    expect(events.at(-1)?.type).toBe("completed");
    expect(seen.user?.message.content).toEqual([
      { type: "text", text: "Hi" },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: Buffer.from("PNGDATA").toString("base64"),
        },
      },
    ]);
    expect(seen.options).toMatchObject({
      tools: [],
      allowedTools: [],
      persistSession: false,
      settingSources: [],
    });
  });

  it.each([
    ["outside the root", "../outside.png"],
    ["a symlink", "link.png"],
    ["oversize", "big.png"],
    ["missing", "missing.png"],
  ])(
    "refuses an attachment that is %s, typed, without reaching the SDK",
    async (name, file) => {
      scenario = "text";
      const before = seen.queries;
      const reference =
        name === "outside the root"
          ? join(root, "outside.png")
          : join(root, "stage", file);
      expect(file).toBeTruthy();
      const events = await run({
        attachments: [image(reference)],
        attachmentRoot: join(root, "stage"),
      });
      expect(events).toEqual([
        {
          type: "failed",
          error: {
            code: "policy-refused",
            message: "An attachment was refused.",
            reason: "attachment_refused",
            retryable: false,
          },
        },
      ]);
      expect(seen.queries).toBe(before);
    },
  );

  it("refuses attachments when no staging root is named", async () => {
    const events = await run({
      attachments: [image(join(root, "stage", "shot.png"))],
    });
    expect(events).toMatchObject([
      { type: "failed", error: { code: "policy-refused" } },
    ]);
  });

  it("merges a per-attempt environment over the adapter's own", async () => {
    scenario = "text";
    await run(
      { environment: { HOME: "/ephemeral" } },
      createClaudeRuntimeAdapter({ environment: { A: "1", HOME: "/x" } }),
    );
    expect(seen.options?.["env"]).toEqual({ A: "1", HOME: "/ephemeral" });
  });

  it("turns a tool request on a tool-less run into a typed failure", async () => {
    scenario = "tool-use";
    const events = await run({ toolless: true });
    scenario = "text";
    expect(events).toEqual([
      {
        type: "failed",
        error: {
          code: "policy-refused",
          message: "A tool-less request attempted to use a tool.",
          reason: "tool_refused",
          retryable: false,
        },
      },
    ]);
  });

  it("carries the SDK's result subtype as a typed reason, and none for a subtype outside the vocabulary", async () => {
    scenario = "max-turns";
    const known = await run({ toolless: true });
    scenario = "odd-subtype";
    const odd = await run({ toolless: true });
    scenario = "text";
    expect(known.at(-1)).toMatchObject({
      type: "failed",
      error: {
        code: "provider",
        message: "Claude ended with error_max_turns.",
        reason: "error_max_turns",
      },
    });
    const unknown = odd.at(-1);
    expect(unknown).toMatchObject({ type: "failed" });
    expect(unknown).not.toHaveProperty("error.reason");
  });

  it("completes a run stopped on max turns with the whole object it wrote out", async () => {
    scenario = "max-turns";
    const outcomes: Record<string, AgentEvent | undefined> = {};
    for (const [name, parts] of [
      ["object", ['{"title":"Cach', 'ing","points":["a","b"]}']],
      ["padded", ['\n  {"title":"Caching","points":["a","b"]}  \n']],
      [
        "fenced",
        ["```json\n", '{"title":"Caching",', '"points":["a","b"]}', "\n```"],
      ],
      ["bare fence", ['```\n{"title":"Caching","points":["a","b"]}\n```\n']],
    ] as const) {
      written = [...parts];
      const events = await run({
        toolless: true,
        outputSchema: { type: "object" },
      });
      expect(
        events.some((event) => event.type === "failed"),
        name,
      ).toBe(false);
      // The answer was streamed as it was written, before the run ended.
      expect(
        events.filter((event) => event.type === "text-delta"),
        name,
      ).toHaveLength(parts.length);
      outcomes[name] = events.at(-1);
    }
    written = [];
    scenario = "text";
    for (const name of ["object", "padded", "fenced", "bare fence"])
      expect(outcomes[name], name).toEqual({
        type: "completed",
        result: {
          sessionId: "s1",
          output: { title: "Caching", points: ["a", "b"] },
        },
      });
  });

  it("still fails a run stopped on max turns that wrote anything but one whole object", async () => {
    scenario = "max-turns";
    const outcomes: [string, AgentEvent | undefined][] = [];
    for (const [name, parts] of [
      ["nothing", []],
      ["prose", ["Here is the brief you asked for."]],
      ["cut short", ['{"title":"Caching","points":["a"']],
      ["a list", ['[{"title":"Caching"}]']],
      ["a string", ['"Caching"']],
      ["an object after prose", ['Here it is: {"title":"Caching"}']],
    ] as const) {
      written = [...parts];
      outcomes.push([name, (await run({ toolless: true })).at(-1)]);
    }
    // Any other way of ending fails, whatever was written.
    scenario = "odd-subtype";
    written = ['{"title":"Caching"}'];
    const odd = (await run({ toolless: true })).at(-1);
    written = [];
    scenario = "text";
    for (const [name, outcome] of outcomes)
      expect(outcome, name).toEqual({
        type: "failed",
        error: {
          code: "provider",
          message: "Claude ended with error_max_turns.",
          reason: "error_max_turns",
          retryable: false,
        },
      });
    expect(odd).toEqual({
      type: "failed",
      error: {
        code: "provider",
        message: "Claude ended with error_novel_case.",
        retryable: false,
      },
    });
  });

  it("reports a cancelled run as cancelled, even with a whole object written", async () => {
    scenario = "max-turns";
    written = ['{"title":"Caching"}'];
    let release = () => {};
    held = {
      wait: new Promise<void>((resolve) => {
        release = resolve;
      }),
      release: () => release(),
    };
    const adapter = createClaudeRuntimeAdapter();
    const events: AgentEvent[] = [];
    try {
      for await (const event of adapter.run({
        runId: "r-cancel",
        profile,
        prompt: "Hi",
        workingDirectory: "/tmp",
        additionalDirectories: [],
        attachments: [],
        timeoutMs: 1000,
        toolless: true,
      })) {
        events.push(event);
        // The answer is written out; the run is cancelled before it ends.
        if (event.type === "text-delta") void adapter.cancel?.("r-cancel");
      }
    } finally {
      held = undefined;
      written = [];
      scenario = "text";
    }
    expect(events.some((event) => event.type === "completed")).toBe(false);
    expect(events.at(-1)).toEqual({
      type: "failed",
      error: {
        code: "cancelled",
        message: "Claude ended with error_max_turns.",
        reason: "error_max_turns",
        retryable: false,
      },
    });
  });

  it("allows the synthetic StructuredOutput tool_use and completes with its output", async () => {
    scenario = "structured";
    const events = await run({
      toolless: true,
      outputSchema: { type: "object" },
    });
    scenario = "text";
    expect(events.some((event) => event.type === "failed")).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      result: { output: { a: 1 } },
    });
  });

  it("streams the structured answer's JSON as text while it is written", async () => {
    scenario = "structured";
    const events = await run({
      toolless: true,
      outputSchema: { type: "object" },
    });
    scenario = "text";
    expect(events.filter((event) => event.type === "text-delta")).toEqual([
      { type: "text-delta", text: '{"a"' },
      { type: "text-delta", text: ":1}" },
    ]);
  });

  it("reports the usage of the one turn a structured run completes on", async () => {
    // The run completes at the StructuredOutput tool call, before the SDK's
    // closing result message, so the usage is the assistant message's own:
    // one turn, its tokens, and no cost or API time (those arrive only with
    // the result the run no longer waits for).
    scenario = "structured";
    const events = await run({
      toolless: true,
      outputSchema: { type: "object" },
    });
    scenario = "text";
    expect(events.find((event) => event.type === "usage")).toEqual({
      type: "usage",
      usage: {
        inputTokens: 3,
        outputTokens: 2,
        totalTokens: 5,
        turns: 1,
      },
    });
  });

  it("reports turns and API time with the usage of a text run", async () => {
    scenario = "text";
    const events = await run({ toolless: true });
    expect(events.find((event) => event.type === "usage")).toEqual({
      type: "usage",
      usage: {
        inputTokens: 3,
        outputTokens: 2,
        totalTokens: 5,
        costUsd: 0,
        turns: 1,
        apiMs: 1234,
      },
    });
  });

  it("passes the profile's effort to the SDK, never the SDK's default", async () => {
    scenario = "text";
    await run({ profile: { ...profile, effort: "low" } });
    expect(seen.options).toMatchObject({ effort: "low", model: "sonnet" });
  });

  it("never pools a tool-less run: a persistent profile still gets a fresh query per request and cannot be resumed", async () => {
    scenario = "text";
    const adapter = createClaudeRuntimeAdapter();
    const persistent = { ...profile, sessionPersistence: true };
    const before = seen.queries;
    await run({ profile: persistent, toolless: true }, adapter);
    await run({ profile: persistent, toolless: true }, adapter);
    expect(seen.queries).toBe(before + 2);
    const resumed: AgentEvent[] = [];
    for await (const event of adapter.resume({
      runId: "r1",
      sessionId: "s1",
      prompt: "again",
      profile: persistent,
      workingDirectory: "/tmp",
    }))
      resumed.push(event);
    // A new query was needed: nothing from the tool-less runs was retained.
    expect(seen.queries).toBe(before + 3);
  });
});
