import type { AiExecutionRequest } from "@omnitech/ai-contracts";
import {
  INTERVIEW_ANSWER_PROFILE,
  INTERVIEW_SESSION_DEVICE_PROFILE,
  INTERVIEW_SESSION_FAST_PROFILE,
} from "@omnitech/product-interview/session-worker";
import { describe, expect, it } from "vitest";
import {
  createSessionGateway,
  SESSION_AGENT_CLAUDE_PROFILE,
  SESSION_AGENT_CODEX_PROFILE,
  SESSION_AGENT_MIN_TURNS,
  SessionGatewayConfigError,
} from "./session-gateway";

const REMOTE = {
  AI_BASE_URL: "https://models.example.test/v1",
  AI_MODEL: "m",
  AI_API_KEY: "test-key",
};

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
    const plain = createSessionGateway(REMOTE, { runtimes });
    expect(plain?.profileIds).not.toContain(SESSION_AGENT_CLAUDE_PROFILE);
    expect(plain?.agentStaging).toBeUndefined();
    const flagOnly = createSessionGateway({
      ...REMOTE,
      ACTIVE_SESSION_AGENT_PORT: "on",
    });
    expect(flagOnly?.profileIds).not.toContain(SESSION_AGENT_CODEX_PROFILE);
  });

  it("adds both agent profiles and the staging hooks only with the flag and runtimes", () => {
    const enabled = createSessionGateway(
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

  it("names the vision profile only when the host pinned a configured provider", () => {
    const env = { ...REMOTE, ACTIVE_SESSION_AGENT_PORT: "on" };
    expect(
      createSessionGateway(env, { runtimes })?.visionProfileId,
    ).toBeUndefined();
    expect(
      createSessionGateway(
        { ...env, ACTIVE_SESSION_AGENT_PROFILE: "claude" },
        { runtimes },
      )?.visionProfileId,
    ).toBe(SESSION_AGENT_CLAUDE_PROFILE);
    expect(
      createSessionGateway(
        { ...env, ACTIVE_SESSION_AGENT_PROFILE: "codex" },
        { runtimes },
      )?.visionProfileId,
    ).toBe(SESSION_AGENT_CODEX_PROFILE);
    // An unknown name, or the pin without the flag, selects nothing.
    expect(
      createSessionGateway(
        { ...env, ACTIVE_SESSION_AGENT_PROFILE: "other" },
        { runtimes },
      )?.visionProfileId,
    ).toBeUndefined();
    expect(
      createSessionGateway({
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
    const enabled = createSessionGateway(
      { ...REMOTE, ACTIVE_SESSION_AGENT_PORT: "on" },
      { runtimes: { ...runtimes, "claude-code": recording } },
    );
    await enabled?.gateway.execute({
      context: {
        tenantId: "t",
        userId: "u",
        productId: "p",
        permissions: ["interview.read"],
      },
      profileId: SESSION_AGENT_CLAUDE_PROFILE,
      processingPolicy: "permitted-remote",
      task: {
        type: "structured-generation",
        prompt: "x",
        schema: { type: "object" },
      },
    });
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
      const gateway = createSessionGateway(
        { ...REMOTE, ACTIVE_SESSION_AGENT_PORT: "on", ...extra },
        { runtimes: { ...runtimes, "claude-code": recording } },
      );
      await gateway?.gateway.execute({
        context: {
          tenantId: "t",
          userId: "u",
          productId: "p",
          permissions: ["interview.read"],
        },
        profileId: SESSION_AGENT_CLAUDE_PROFILE,
        processingPolicy: "permitted-remote",
        task: {
          type: "structured-generation",
          prompt: "x",
          schema: { type: "object" },
        },
      });
    };
    await run({});
    await run({ ACTIVE_SESSION_AGENT_MAX_TURNS: "9" });
    expect(seen).toEqual([SESSION_AGENT_MIN_TURNS, 9]);
    for (const bad of ["1", "5", "six", "6.5", "-6"]) {
      expect(() =>
        createSessionGateway(
          {
            ...REMOTE,
            ACTIVE_SESSION_AGENT_PORT: "on",
            ACTIVE_SESSION_AGENT_MAX_TURNS: bad,
          },
          { runtimes },
        ),
      ).toThrow(SessionGatewayConfigError);
    }
  });

  it("refuses an agent profile for a device-only request", async () => {
    const enabled = createSessionGateway(
      { ...REMOTE, ACTIVE_SESSION_AGENT_PORT: "on" },
      { runtimes },
    );
    await expect(
      enabled?.gateway.execute({
        context: {
          tenantId: "t",
          userId: "u",
          productId: "p",
          permissions: ["interview.read"],
        },
        profileId: SESSION_AGENT_CLAUDE_PROFILE,
        processingPolicy: "device-only",
        task: { type: "structured-generation", prompt: "x" },
      }),
    ).rejects.toThrow(/device-only/);
  });
});

describe("session gateway composition", () => {
  it("is null when no language model is configured", () => {
    expect(createSessionGateway({})).toBeNull();
  });

  it("throws for an unusable model, which the worker turns into a disabled loop", () => {
    expect(() =>
      createSessionGateway({ ...REMOTE, AI_API_KEY: undefined }),
    ).toThrow();
  });

  it("serves the fast and code-solution profiles for a remote declaration", () => {
    expect(createSessionGateway(REMOTE)?.profileIds).toEqual([
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
      createSessionGateway({ ...loopback, AI_LOCALITY: "device" })?.profileIds,
    ).toEqual([
      INTERVIEW_SESSION_FAST_PROFILE,
      INTERVIEW_ANSWER_PROFILE,
      INTERVIEW_SESSION_DEVICE_PROFILE,
    ]);
    // Loopback without a declaration is not inferred to be device.
    expect(createSessionGateway(loopback)?.profileIds).toEqual([
      INTERVIEW_SESSION_FAST_PROFILE,
      INTERVIEW_ANSWER_PROFILE,
    ]);
    // A device declaration on a non-loopback URL is downgraded to remote.
    expect(
      createSessionGateway({ ...REMOTE, AI_LOCALITY: "device" })?.profileIds,
    ).toEqual([INTERVIEW_SESSION_FAST_PROFILE, INTERVIEW_ANSWER_PROFILE]);
  });

  const request = (
    permissions: string[],
    processingPolicy: "device-only" | "permitted-remote",
  ): AiExecutionRequest => ({
    context: { tenantId: "t", userId: "u", productId: "p", permissions },
    profileId: INTERVIEW_SESSION_FAST_PROFILE,
    task: {
      type: "structured-generation",
      system: "s",
      prompt: "p",
      schema: { type: "object" },
    },
    processingPolicy,
  });

  it("refuses a caller without interview.read", async () => {
    await expect(
      createSessionGateway(REMOTE)?.gateway.execute(
        request([], "permitted-remote"),
      ),
    ).rejects.toThrow();
  });

  it("refuses the code-solution profile for a device-only request even when the model is declared to run on the device", async () => {
    const device = {
      AI_BASE_URL: "http://127.0.0.1:1234/v1",
      AI_MODEL: "m",
      AI_LOCALITY: "device",
    };
    await expect(
      createSessionGateway(device)?.gateway.execute({
        ...request(["interview.read"], "device-only"),
        profileId: INTERVIEW_ANSWER_PROFILE,
      }),
    ).rejects.toMatchObject({ code: "policy-refused" });
  });

  it("refuses a device-only request on a non-device fast profile", async () => {
    await expect(
      createSessionGateway(REMOTE)?.gateway.execute(
        request(["interview.read"], "device-only"),
      ),
    ).rejects.toThrow();
  });
});
