import type { Execution, ModelInput } from "@omnitech/ai-engine";
import { createMemoryTrace } from "@omnitech/ai-engine/trace";
import { resolveAgentProfiles } from "@omnitech/platform-runtime/ai-config";
import {
  INTERVIEW_ANSWER_PROFILE,
  INTERVIEW_SESSION_DEVICE_PROFILE,
  INTERVIEW_SESSION_FAST_PROFILE,
} from "@omnitech/product-interview/session-worker";
import { describe, expect, it } from "vitest";
import {
  createSessionEngine,
  SESSION_AGENT_CLAUDE_PROFILE,
  SESSION_AGENT_CODEX_PROFILE,
  SESSION_AGENT_MIN_TURNS,
  SessionEngineConfigError,
} from "./session-engine";

const REMOTE = {
  AI_BASE_URL: "https://models.example.test/v1",
  AI_MODEL: "m",
  AI_API_KEY: "test-key",
};

// One call as the session puts it to the engine: who asks, with what
// permissions, and where it may be processed.
const execution = (
  permissions: string[],
  policy: "device-only" | "permitted-remote",
): Execution => ({
  scope: { tenantId: "t", actorId: "u", productId: "p" },
  permissions,
  signal: new AbortController().signal,
  policy,
  idempotencyKey: "session:task:1:assist:1",
});
const input = (
  profileId: string,
  schema?: ModelInput["schema"],
): ModelInput => ({
  profileId,
  messages: [{ role: "user", parts: [{ type: "text", text: "x" }] }],
  ...(schema === undefined ? {} : { schema }),
});

describe("session agent port selection (ships disabled)", () => {
  const runtime = (id: "codex" | "claude-code") => ({
    runtime: id,
    capabilities: {
      resume: false,
      structuredOutput: true,
      attachments: true,
      tools: false,
    },
    run: async function* () {},
    resume: async function* () {},
    cancel: async () => {},
  });
  const runtimes = {
    codex: runtime("codex"),
    "claude-code": runtime("claude-code"),
  };

  it("keeps noAgents by default, and with runtimes but no flag", () => {
    const plain = createSessionEngine(REMOTE, { runtimes });
    expect(plain?.profileIds).not.toContain(SESSION_AGENT_CLAUDE_PROFILE);
    expect(plain?.agentStaging).toBeUndefined();
    const flagOnly = createSessionEngine({
      ...REMOTE,
      ACTIVE_SESSION_AGENT_PORT: "on",
    });
    expect(flagOnly?.profileIds).not.toContain(SESSION_AGENT_CODEX_PROFILE);
  });

  it("adds both agent profiles and the staging hooks only with the flag and runtimes", () => {
    const enabled = createSessionEngine(
      { ...REMOTE, ACTIVE_SESSION_AGENT_PORT: "on" },
      { runtimes },
    );
    expect(enabled?.profileIds).toEqual(
      expect.arrayContaining([
        SESSION_AGENT_CLAUDE_PROFILE,
        SESSION_AGENT_CODEX_PROFILE,
      ]),
    );
    expect(enabled?.agentStaging).toBeDefined();
  });

  it("serves the agent runner alone when no direct model is configured", () => {
    // No LM Studio, no API endpoint: the Claude Code runner is the whole engine.
    const alone = createSessionEngine(
      {
        ACTIVE_SESSION_AGENT_PORT: "on",
        ACTIVE_SESSION_AGENT_PROFILE: "claude",
      },
      { runtimes },
    );
    expect(alone?.visionProfileId).toBe(SESSION_AGENT_CLAUDE_PROFILE);
    expect(alone?.profileIds).toContain(SESSION_AGENT_CLAUDE_PROFILE);
    expect(alone?.agentStaging).toBeDefined();
    // Without the agent port there is still nothing to serve.
    expect(createSessionEngine({}, { runtimes })).toBeNull();
  });

  it("names the vision profile only when the host pinned a configured provider", () => {
    const env = { ...REMOTE, ACTIVE_SESSION_AGENT_PORT: "on" };
    expect(
      createSessionEngine(env, { runtimes })?.visionProfileId,
    ).toBeUndefined();
    expect(
      createSessionEngine(
        { ...env, ACTIVE_SESSION_AGENT_PROFILE: "claude" },
        { runtimes },
      )?.visionProfileId,
    ).toBe(SESSION_AGENT_CLAUDE_PROFILE);
    expect(
      createSessionEngine(
        { ...env, ACTIVE_SESSION_AGENT_PROFILE: "codex" },
        { runtimes },
      )?.visionProfileId,
    ).toBe(SESSION_AGENT_CODEX_PROFILE);
    // An unknown name, or the pin without the flag, selects nothing.
    expect(
      createSessionEngine(
        { ...env, ACTIVE_SESSION_AGENT_PROFILE: "other" },
        { runtimes },
      )?.visionProfileId,
    ).toBeUndefined();
    expect(
      createSessionEngine({
        ...REMOTE,
        ACTIVE_SESSION_AGENT_PROFILE: "claude",
      })?.visionProfileId,
    ).toBeUndefined();
  });

  it("gives a structured session answer enough turns for the structured-output step", async () => {
    let turns = 0;
    const recording = {
      ...runtime("claude-code"),
      capabilities: {
        ...runtime("claude-code").capabilities,
        toolless: true,
      },
      run: async function* (request: { profile: { maximumTurns: number } }) {
        turns = request.profile.maximumTurns;
        yield {
          type: "completed" as const,
          result: { sessionId: "s", output: {} },
        };
      },
    };
    const enabled = createSessionEngine(
      { ...REMOTE, ACTIVE_SESSION_AGENT_PORT: "on" },
      { runtimes: { ...runtimes, "claude-code": recording } },
    );
    const answered = await enabled?.engine.generate(
      input(SESSION_AGENT_CLAUDE_PROFILE, { type: "object" }),
      execution(["interview.read"], "permitted-remote"),
    );
    expect(answered).toMatchObject({ ok: true, value: {} });
    // The assistant profile allows one turn, which ends a tool-less structured
    // run with error_max_turns whenever the model writes text first.
    expect(turns).toBeGreaterThanOrEqual(SESSION_AGENT_MIN_TURNS);
  });

  it("declares its turn bound in the session profile and refuses a configured bound below the minimum", async () => {
    const seen: number[] = [];
    const recording = {
      ...runtime("claude-code"),
      capabilities: { ...runtime("claude-code").capabilities, toolless: true },
      run: async function* (request: { profile: { maximumTurns: number } }) {
        seen.push(request.profile.maximumTurns);
        yield {
          type: "completed" as const,
          result: { sessionId: "s", output: {} },
        };
      },
    };
    const run = async (extra: Record<string, string>) => {
      const session = createSessionEngine(
        { ...REMOTE, ACTIVE_SESSION_AGENT_PORT: "on", ...extra },
        { runtimes: { ...runtimes, "claude-code": recording } },
      );
      await session?.engine.generate(
        input(SESSION_AGENT_CLAUDE_PROFILE, { type: "object" }),
        execution(["interview.read"], "permitted-remote"),
      );
    };
    await run({});
    await run({ ACTIVE_SESSION_AGENT_MAX_TURNS: "9" });
    expect(seen).toEqual([SESSION_AGENT_MIN_TURNS, 9]);
    for (const bad of ["1", "5", "six", "6.5", "-6"]) {
      expect(() =>
        createSessionEngine(
          {
            ...REMOTE,
            ACTIVE_SESSION_AGENT_PORT: "on",
            ACTIVE_SESSION_AGENT_MAX_TURNS: bad,
          },
          { runtimes },
        ),
      ).toThrow(SessionEngineConfigError);
    }
  });

  it("refuses an agent profile for a device-only request", async () => {
    const enabled = createSessionEngine(
      { ...REMOTE, ACTIVE_SESSION_AGENT_PORT: "on" },
      { runtimes },
    );
    const refused = await enabled?.engine.generate(
      input(SESSION_AGENT_CLAUDE_PROFILE),
      execution(["interview.read"], "device-only"),
    );
    expect(refused).toMatchObject({
      ok: false,
      failure: { code: "refused", refusal: "policy" },
    });
    expect(refused?.ok === false && refused.failure.reason).toMatch(
      /device-only/,
    );
  });

  it("names the runtime and model of an agent profile, and nothing for a direct model", () => {
    const enabled = createSessionEngine(
      { ...REMOTE, ACTIVE_SESSION_AGENT_PORT: "on" },
      { runtimes },
    );
    expect(enabled?.answeredBy(SESSION_AGENT_CLAUDE_PROFILE)).toEqual({
      runtime: "claude-code",
      model: resolveAgentProfiles(REMOTE).get("assistant-claude-code")?.model,
    });
    expect(enabled?.answeredBy(INTERVIEW_SESSION_FAST_PROFILE)).toBeUndefined();
  });

  it("records a session call by ids alone: the profile, the agent kind, the call's key and no content", async () => {
    const kept = createMemoryTrace();
    const answering = {
      ...runtime("claude-code"),
      capabilities: { ...runtime("claude-code").capabilities, toolless: true },
      run: async function* () {
        yield {
          type: "completed" as const,
          result: { sessionId: "s", output: {} },
        };
      },
    };
    const session = createSessionEngine(
      { ...REMOTE, ACTIVE_SESSION_AGENT_PORT: "on" },
      {
        runtimes: { ...runtimes, "claude-code": answering },
        trace: { sink: kept, capture: "metadata" },
      },
    );
    await session?.engine.generate(
      input(SESSION_AGENT_CLAUDE_PROFILE, { type: "object" }),
      execution(["interview.read"], "permitted-remote"),
    );
    await session?.close();
    expect(kept.records).toHaveLength(1);
    expect(kept.records[0]).toMatchObject({
      profileId: SESSION_AGENT_CLAUDE_PROFILE,
      providerKind: "agent",
      idempotencyKey: "session:task:1:assist:1",
      scope: { tenantId: "t", actorId: "u", productId: "p" },
      outcome: "done",
    });
    expect(kept.records[0]?.messages).toBeUndefined();
    expect(kept.records[0]?.output).toBeUndefined();
  });
});

describe("session engine composition", () => {
  it("is null when no language model is configured", () => {
    expect(createSessionEngine({})).toBeNull();
  });

  // DEFECT in apps/agent-worker/src/session-engine.ts (createSessionEngine):
  // the OpenAI client is built with `apiKey: language.apiKey ?? "not-needed"`
  // for any base URL. The deleted ai-provider-openai adapter refused a keyless
  // endpoint that was not loopback (chat-completions.ts: `if (!endpoint.apiKey)
  // loopbackChatURL(endpoint.baseUrl)`), so a remote model with no key threw
  // here at start-up. Now it starts and every call is sent with a placeholder
  // key.
  it("throws for an unusable model, which the worker turns into a disabled loop", () => {
    expect(() =>
      createSessionEngine({ ...REMOTE, AI_API_KEY: undefined }),
    ).toThrow();
  });

  it("serves the fast and code-solution profiles for a remote declaration", () => {
    expect(createSessionEngine(REMOTE)?.profileIds).toEqual([
      INTERVIEW_SESSION_FAST_PROFILE,
      INTERVIEW_ANSWER_PROFILE,
    ]);
  });

  it("adds the device profile only for a device-declared loopback model", () => {
    const loopback = {
      AI_BASE_URL: "http://127.0.0.1:1234/v1",
      AI_MODEL: "m",
    };
    expect(
      createSessionEngine({ ...loopback, AI_LOCALITY: "device" })?.profileIds,
    ).toEqual([
      INTERVIEW_SESSION_FAST_PROFILE,
      INTERVIEW_ANSWER_PROFILE,
      INTERVIEW_SESSION_DEVICE_PROFILE,
    ]);
    // Loopback without a declaration is not inferred to be device.
    expect(createSessionEngine(loopback)?.profileIds).toEqual([
      INTERVIEW_SESSION_FAST_PROFILE,
      INTERVIEW_ANSWER_PROFILE,
    ]);
    // A device declaration on a non-loopback URL is downgraded to remote.
    expect(
      createSessionEngine({ ...REMOTE, AI_LOCALITY: "device" })?.profileIds,
    ).toEqual([INTERVIEW_SESSION_FAST_PROFILE, INTERVIEW_ANSWER_PROFILE]);
  });

  const schema = { type: "object" } as const;

  it("refuses a caller without interview.read", async () => {
    expect(
      await createSessionEngine(REMOTE)?.engine.generate(
        input(INTERVIEW_SESSION_FAST_PROFILE, schema),
        execution([], "permitted-remote"),
      ),
    ).toMatchObject({
      ok: false,
      failure: { code: "refused", refusal: "authorization" },
    });
  });

  it("refuses the code-solution profile for a device-only request even when the model is declared to run on the device", async () => {
    const device = {
      AI_BASE_URL: "http://127.0.0.1:1234/v1",
      AI_MODEL: "m",
      AI_LOCALITY: "device",
    };
    expect(
      await createSessionEngine(device)?.engine.generate(
        input(INTERVIEW_ANSWER_PROFILE, schema),
        execution(["interview.read"], "device-only"),
      ),
    ).toMatchObject({
      ok: false,
      failure: { code: "refused", refusal: "policy" },
    });
  });

  it("refuses a device-only request on a non-device fast profile", async () => {
    expect(
      await createSessionEngine(REMOTE)?.engine.generate(
        input(INTERVIEW_SESSION_FAST_PROFILE, schema),
        execution(["interview.read"], "device-only"),
      ),
    ).toMatchObject({
      ok: false,
      failure: { code: "refused", refusal: "policy" },
    });
  });
});
