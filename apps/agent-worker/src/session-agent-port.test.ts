import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentCapabilities,
  AgentEvent,
  AgentProfile,
  AgentRunRequest,
  AgentRuntimeAdapter,
} from "@omnitech/agent-runtime-contracts";
import type { AiExecutionRequest } from "@omnitech/ai-contracts";
import type { AiProfile } from "@omnitech/ai-runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSessionAgentPort,
  SessionAgentError,
  type SessionAgentPortOptions,
  type StandingVerdict,
} from "./session-agent-port";

const agentProfile: AgentProfile = {
  id: "assistant",
  version: 1,
  runtime: "claude-code",
  model: "m",
  fallbackModels: [],
  effort: "low",
  tools: [],
  sandbox: "read-only",
  approvalPolicy: "never",
  sessionPersistence: false,
  maximumTurns: 1,
  timeoutMs: 5_000,
  maximumOutputBytes: 1_000,
  additionalDirectories: [],
  webSearch: false,
};

const aiProfile: AiProfile = {
  id: "session-agent",
  label: "Session agent",
  family: "agent-runtime",
  targetId: "claude-code",
  taskTypes: ["structured-generation"],
  enabled: true,
};

const FULL: AgentCapabilities = {
  resume: false,
  structuredOutput: true,
  attachments: true,
  tools: false,
  imageInput: true,
  toolless: true,
};

type Script = (
  request: AgentRunRequest,
  seen: AgentRunRequest[],
) => AsyncIterable<AgentEvent>;

function fakeRuntime(script: Script, capabilities: AgentCapabilities = FULL) {
  const seen: AgentRunRequest[] = [];
  const cancelled: string[] = [];
  const runtime: AgentRuntimeAdapter = {
    runtime: "claude-code",
    capabilities,
    run: (request) => {
      seen.push(request);
      return script(request, seen);
    },
    resume: () => (async function* () {})(),
    async cancel(runId) {
      cancelled.push(runId);
    },
  };
  return { runtime, seen, cancelled };
}

const completes: Script = async function* () {
  yield { type: "started", sessionId: "provider-session" };
  yield { type: "text-delta", text: "ok" };
  yield { type: "completed", result: { sessionId: "s", output: { a: 1 } } };
};

const context = {
  tenantId: "t1",
  userId: "u1",
  productId: "p",
  permissions: [],
};

function task(overrides: Partial<AiExecutionRequest["task"]> = {}) {
  return {
    context,
    task: { type: "structured-generation", prompt: "q", ...overrides },
  } as AiExecutionRequest;
}

const png = (id = "obs-1") => ({
  id,
  kind: "image" as const,
  name: "original-name.png",
  reference: id,
  mimeType: "image/png",
});

let base: string;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "session-port-"));
});
afterEach(async () => rm(base, { recursive: true, force: true }));

function port(
  runtime: AgentRuntimeAdapter,
  extra: Partial<SessionAgentPortOptions> = {},
) {
  return createSessionAgentPort({
    runtimes: { "claude-code": runtime },
    profiles: new Map([[aiProfile.id, agentProfile]]),
    stagingBase: join(base, "staging"),
    attachmentSource: async () => Buffer.from("IMG"),
    ...extra,
  });
}

const staged = async () =>
  readdir(join(base, "staging")).catch(() => [] as string[]);

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as SessionAgentError;
  }
  throw new Error("expected a rejection");
}

describe("session agent port", () => {
  it("runs a tool-less attempt and leaves the Claude sign-in environment alone", async () => {
    const { runtime, seen } = fakeRuntime(completes);
    const execution = await port(runtime).execute(task(), aiProfile);

    expect(execution).toMatchObject({
      family: "agent-runtime",
      targetId: "claude-code",
      result: { a: 1 },
    });
    expect(seen[0]).toMatchObject({ toolless: true, attachments: [] });
    // HOME and the Claude config dir are the worker's allowlisted ones, so the
    // local sign-in works; isolation is tools:[] and no persisted session.
    expect(seen[0]?.environment).toBeUndefined();
    expect(await staged()).toEqual([]);
  });

  it("reports the profile's runtime and model as display metadata", async () => {
    const { runtime } = fakeRuntime(completes);
    const execution = await port(runtime).execute(task(), aiProfile);

    expect(execution.generatedBy).toEqual({
      runtime: agentProfile.runtime,
      model: agentProfile.model,
    });
  });

  describe("Codex per-attempt home", () => {
    const codexProfile: AgentProfile = {
      ...agentProfile,
      runtime: "codex",
    };
    const codexPort = (runtime: AgentRuntimeAdapter, authFile: string) =>
      port(runtime, {
        runtimes: { codex: runtime },
        profiles: new Map([[aiProfile.id, codexProfile]]),
        codexAuthFile: authFile,
      });

    it("holds only a 0600 copy of the sign-in file, removed when the attempt ends", async () => {
      const authFile = join(base, "auth.json");
      await writeFile(authFile, '{"token":"t"}');
      await writeFile(join(base, "config.toml"), "x");
      let inside: { mode: number; text: string; entries: string[] } | undefined;
      const { runtime, seen } = fakeRuntime(async function* (request) {
        const home = request.environment?.["CODEX_HOME"] ?? "";
        inside = {
          mode: (await stat(join(home, "auth.json"))).mode & 0o777,
          text: await readFile(join(home, "auth.json"), "utf8"),
          entries: await readdir(home),
        };
        yield* completes(request, []);
      });
      await codexPort(runtime, authFile).execute(task(), aiProfile);

      expect(inside).toEqual({
        mode: 0o600,
        text: '{"token":"t"}',
        entries: ["auth.json"],
      });
      // Only CODEX_HOME is set: the worker's HOME and others are untouched.
      expect(Object.keys(seen[0]?.environment ?? {})).toEqual(["CODEX_HOME"]);
      expect(await staged()).toEqual([]);
    });

    it("runs without a copy when no sign-in file exists", async () => {
      const { runtime, seen } = fakeRuntime(completes);
      await codexPort(runtime, join(base, "absent.json")).execute(
        task(),
        aiProfile,
      );
      expect(seen[0]?.environment?.["CODEX_HOME"]).toBeTruthy();
      expect(await staged()).toEqual([]);
    });
  });

  it("refuses attachments on a runtime without image input, never text-only", async () => {
    const { runtime, seen } = fakeRuntime(completes, {
      ...FULL,
      imageInput: false,
    });
    const error = await rejection(
      port(runtime).execute(task({ attachments: [png()] }), aiProfile),
    );
    expect(error).toBeInstanceOf(SessionAgentError);
    expect(error.sessionCode).toBe("vision-unsupported");
    expect(seen).toEqual([]);
    expect(await staged()).toEqual([]);
  });

  it("refuses attachments when no loader is configured, and a runtime that cannot prove tool-less use", async () => {
    const { runtime } = fakeRuntime(completes);
    expect(
      (
        await rejection(
          createSessionAgentPort({
            runtimes: { "claude-code": runtime },
            profiles: new Map([[aiProfile.id, agentProfile]]),
            stagingBase: join(base, "staging"),
          }).execute(task({ attachments: [png()] }), aiProfile),
        )
      ).sessionCode,
    ).toBe("attachment-refused");
    const unproven = fakeRuntime(completes, { ...FULL, toolless: false });
    expect(
      (await rejection(port(unproven.runtime).execute(task(), aiProfile)))
        .sessionCode,
    ).toBe("toolless-unsupported");
    // A profile that grants tools is refused too.
    expect(
      (
        await rejection(
          createSessionAgentPort({
            runtimes: { "claude-code": runtime },
            profiles: new Map([
              [aiProfile.id, { ...agentProfile, tools: ["Read"] }],
            ]),
            stagingBase: join(base, "staging"),
          }).execute(task(), aiProfile),
        )
      ).sessionCode,
    ).toBe("toolless-unsupported");
  });

  it("stages frozen images privately and removes them when the attempt succeeds", async () => {
    let during: { mode: number; files: string[] } | undefined;
    const { runtime, seen } = fakeRuntime(async function* (request) {
      const root = request.attachmentRoot ?? "";
      during = {
        mode: (await stat(root)).mode & 0o777,
        files: await readdir(root),
      };
      yield { type: "completed", result: { sessionId: "s", output: "x" } };
    });

    await port(runtime).execute(
      task({ attachments: [png("a"), png("b")] }),
      aiProfile,
    );

    expect(during?.mode).toBe(0o700);
    expect(during?.files.sort()).toEqual(["image-0.png", "image-1.png"]);
    // The model sees staged references and neutral names, never the original.
    const attachments = seen[0]?.attachments ?? [];
    expect(attachments.map((a) => a.name)).toEqual([
      "image-0.png",
      "image-1.png",
    ]);
    expect(
      attachments[0]?.reference.startsWith(seen[0]?.attachmentRoot ?? "!"),
    ).toBe(true);
    expect(await staged()).toEqual([]);
  });

  it("removes staged files when the provider fails, and when the stream is abandoned", async () => {
    const failing = fakeRuntime(async function* () {
      yield {
        type: "failed",
        error: {
          code: "provider",
          message: "SECRET provider text",
          retryable: false,
        },
      };
    });
    await rejection(
      port(failing.runtime).execute(task({ attachments: [png()] }), aiProfile),
    );
    expect(await staged()).toEqual([]);

    const hanging = fakeRuntime(async function* () {
      yield { type: "text-delta", text: "partial" };
      await new Promise(() => undefined);
    });
    const iterator = port(hanging.runtime)
      .stream(task({ attachments: [png()] }), aiProfile)
      [Symbol.asyncIterator]();
    await iterator.next(); // started
    await iterator.next(); // text-delta
    expect((await staged()).length).toBe(1);
    await iterator.return?.();
    expect(await staged()).toEqual([]);
  });

  it("sweeps leftovers at startup and purges in-flight attempts on demand", async () => {
    const root = join(base, "staging");
    await mkdir(root, { mode: 0o700 });
    await mkdir(join(root, "attempt-stale", "stage"), { recursive: true });
    await writeFile(join(root, "attempt-stale", "stage", "x.png"), "old");
    const { runtime } = fakeRuntime(async function* () {
      yield { type: "text-delta", text: "partial" };
      await new Promise(() => undefined);
    });
    const subject = port(runtime);
    await subject.sweep();
    expect(await staged()).toEqual([]);

    const events: string[] = [];
    const running = (async () => {
      for await (const event of subject.stream(
        task({ attachments: [png()] }),
        aiProfile,
      ))
        events.push(event.type);
    })();
    while (!events.includes("text-delta"))
      await new Promise((resolve) => setTimeout(resolve, 5));
    await subject.purge();
    await running;
    expect(events.at(-1)).toBe("failed");
    expect(await staged()).toEqual([]);
  });

  it("reports only typed codes, never provider text, paths or names", async () => {
    const failing = fakeRuntime(async function* () {
      yield {
        type: "failed",
        error: {
          code: "provider",
          message: "SECRET /Users/me/shot.png original-name.png",
          retryable: false,
        },
      };
    });
    const error = await rejection(
      port(failing.runtime).execute(task(), aiProfile),
    );
    expect(error.sessionCode).toBe("provider");
    expect(JSON.stringify([error.message, error.failure])).not.toMatch(
      /SECRET|shot|original/,
    );

    const events: AgentEvent[] = [];
    for await (const event of port(failing.runtime).stream(task(), aiProfile))
      events.push(event as AgentEvent);
    expect(JSON.stringify(events)).not.toMatch(/SECRET|shot|original/);
    expect(events.at(-1)).toMatchObject({
      type: "failed",
      error: { code: "provider", retryable: false },
    });
  });

  it("maps adapter refusals and fails a tool-started event typed, cancelling the attempt", async () => {
    const tool = fakeRuntime(async function* () {
      yield { type: "tool-started", tool: "command" };
      yield { type: "completed", result: { sessionId: "s", output: "x" } };
    });
    const error = await rejection(
      port(tool.runtime).execute(task(), aiProfile),
    );
    expect(error.sessionCode).toBe("tool-refused");
    expect(tool.cancelled).toHaveLength(1);

    const refused = fakeRuntime(async function* () {
      yield {
        type: "failed",
        error: {
          code: "policy-refused",
          message: "An attachment was refused.",
          reason: "attachment_refused",
          retryable: false,
        },
      };
    });
    expect(
      (await rejection(port(refused.runtime).execute(task(), aiProfile)))
        .sessionCode,
    ).toBe("attachment-refused");

    // The typed reason decides, never the wording: the same text with no reason
    // is a plain policy refusal.
    const worded = fakeRuntime(async function* () {
      yield {
        type: "failed",
        error: {
          code: "policy-refused",
          message: "An attachment was refused.",
          retryable: false,
        },
      };
    });
    expect(
      (await rejection(port(worded.runtime).execute(task(), aiProfile)))
        .sessionCode,
    ).toBe("policy-refused");
  });

  it("carries the adapter's typed reason on the error and the failed event, with no suffix in any message", async () => {
    const ended = fakeRuntime(async function* () {
      yield {
        type: "failed",
        error: {
          code: "provider",
          // Looks like the old suffix and the old subtype wording: neither is parsed.
          message: "Claude ended with error_max_turns. [reason: tool_refused]",
          reason: "error_max_turns",
          retryable: false,
        },
      };
    });
    const error = await rejection(
      port(ended.runtime).execute(task(), aiProfile),
    );
    expect(error.sessionCode).toBe("provider");
    expect(error.reason).toBe("error_max_turns");
    expect(error.failure).toMatchObject({ reason: "error_max_turns" });
    expect(error.message).not.toContain("reason");

    const events: AgentEvent[] = [];
    for await (const event of port(ended.runtime).stream(task(), aiProfile))
      events.push(event as AgentEvent);
    const failed = events.at(-1);
    expect(failed).toMatchObject({
      type: "failed",
      error: { code: "provider", reason: "error_max_turns" },
    });
    expect(JSON.stringify(failed)).not.toContain("[reason");

    // A message that merely looks like a reason is not one.
    const lookalike = fakeRuntime(async function* () {
      yield {
        type: "failed",
        error: {
          code: "provider",
          message: "Claude ended with error_max_turns.",
          retryable: false,
        },
      };
    });
    expect(
      (await rejection(port(lookalike.runtime).execute(task(), aiProfile)))
        .reason,
    ).toBeUndefined();
  });

  it("bounds output and attempt time", async () => {
    const big = fakeRuntime(async function* () {
      yield { type: "text-delta", text: "x".repeat(2_000) };
      yield { type: "completed", result: { sessionId: "s", output: "x" } };
    });
    expect(
      (await rejection(port(big.runtime).execute(task(), aiProfile)))
        .sessionCode,
    ).toBe("output-too-large");

    const slow = fakeRuntime(async function* () {
      await new Promise(() => undefined);
    });
    const quick = createSessionAgentPort({
      runtimes: { "claude-code": slow.runtime },
      profiles: new Map([[aiProfile.id, { ...agentProfile, timeoutMs: 20 }]]),
      stagingBase: join(base, "staging"),
    });
    // The fake never ends on its own: cancelling must end the attempt.
    const error = await Promise.race([
      rejection(quick.execute(task(), aiProfile)),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("never settled")), 500),
      ),
    ]).catch((caught: Error) => caught);
    expect(slow.cancelled).toHaveLength(1);
    expect(error).toBeInstanceOf(Error);
  });

  it("re-checks standing after a capacity wait and refuses before touching a provider", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { runtime, seen } = fakeRuntime(async function* () {
      await gate;
      yield { type: "completed", result: { sessionId: "s", output: "x" } };
    });
    let permitted = true;
    const subject = port(runtime, {
      maxSessionAttempts: 1,
      stillPermitted: () => permitted,
    });
    const first = subject.execute(task(), aiProfile);
    while (seen.length === 0)
      await new Promise((resolve) => setTimeout(resolve, 5));
    const second = rejection(subject.execute(task(), aiProfile));
    // The session tightens while the second attempt waits for capacity.
    permitted = false;
    release();
    await first;
    expect((await second).sessionCode).toBe("policy-refused");
    expect(seen).toHaveLength(1);
  });

  it("admits live work first but never starves background work", async () => {
    const order: string[] = [];
    const gates: Array<() => void> = [];
    const { runtime } = fakeRuntime(async function* (request) {
      order.push(request.prompt);
      await new Promise<void>((resolve) => gates.push(resolve));
      yield { type: "completed", result: { sessionId: "s", output: "x" } };
    });
    const subject = port(runtime, {
      maxSessionAttempts: 1,
      maxLiveStreak: 2,
      isBackground: (request) => request.task.prompt.startsWith("bg"),
    });
    const settled = [
      subject.execute(task({ prompt: "holder" }), aiProfile),
      subject.execute(task({ prompt: "bg-1" }), aiProfile),
      subject.execute(task({ prompt: "live-1" }), aiProfile),
      subject.execute(task({ prompt: "live-2" }), aiProfile),
      subject.execute(task({ prompt: "live-3" }), aiProfile),
    ];
    const finishNext = async () => {
      while (gates.length === 0)
        await new Promise((resolve) => setTimeout(resolve, 5));
      gates.shift()?.();
    };
    for (let i = 0; i < settled.length; i += 1) await finishNext();
    await Promise.all(settled);

    // Live jumps the earlier background request, but only two in a row.
    expect(order).toEqual(["holder", "live-1", "live-2", "bg-1", "live-3"]);
  });

  it("cancels only inside the caller's tenant and when a waiting attempt is aborted", async () => {
    const { runtime, seen, cancelled } = fakeRuntime(async function* () {
      await new Promise(() => undefined);
    });
    const subject = port(runtime, { maxSessionAttempts: 1 });
    const events: AgentEvent[] = [];
    let executionId = "";
    const running = (async () => {
      for await (const event of subject.stream(task(), aiProfile)) {
        if (event.type === "started") executionId = event.executionId;
        events.push(event as AgentEvent);
      }
    })();
    while (seen.length === 0)
      await new Promise((resolve) => setTimeout(resolve, 5));

    await subject.cancel({ ...context, tenantId: "other" }, executionId);
    expect(cancelled).toEqual([]);
    await subject.cancel(context, executionId);
    // The fake never ends on its own; the abort ends the attempt typed.
    await Promise.race([running, new Promise((r) => setTimeout(r, 50))]);
    expect(cancelled).toEqual([executionId]);

    const waiting = new AbortController();
    const queued = rejection(
      subject.execute({ ...task(), signal: waiting.signal }, aiProfile),
    );
    waiting.abort();
    expect((await queued).sessionCode).toBe("cancelled");
  });

  it("is unavailable for a profile without an agent mapping and cannot resume", async () => {
    const { runtime } = fakeRuntime(completes);
    const subject = port(runtime);
    expect(
      (
        await rejection(
          subject.execute(task(), { ...aiProfile, id: "unmapped" }),
        )
      ).sessionCode,
    ).toBe("profile-unavailable");
    const events: unknown[] = [];
    for await (const event of subject.resume({
      context,
      executionId: "x",
      input: "i",
    }))
      events.push(event);
    expect(events).toMatchObject([{ type: "failed" }]);
  });
  it("rejects an already-aborted call as cancelled and leaves capacity usable", async () => {
    const { runtime, seen } = fakeRuntime(completes);
    const subject = port(runtime, { maxSessionAttempts: 1 });
    const aborted = new AbortController();
    aborted.abort();
    const error = await Promise.race([
      rejection(
        subject.execute({ ...task(), signal: aborted.signal }, aiProfile),
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("never settled")), 500),
      ),
    ]);
    expect(error.sessionCode).toBe("cancelled");
    expect(seen).toEqual([]);
    // The single slot was never taken: the next attempt runs.
    expect((await subject.execute(task(), aiProfile)).result).toEqual({ a: 1 });
  });

  it("types a paused session and a failed standing read as retryable, a denial as final", async () => {
    const { runtime, seen } = fakeRuntime(completes);
    const verdicts: Array<[StandingVerdict, string, boolean]> = [
      ["not-active", "session-not-active", true],
      ["read-failed", "read-failed", true],
      [false, "policy-refused", false],
    ];
    for (const [verdict, code, retryable] of verdicts) {
      const error = await rejection(
        port(runtime, { stillPermitted: () => verdict }).execute(
          task(),
          aiProfile,
        ),
      );
      expect(error.sessionCode).toBe(code);
      expect(error.retryable).toBe(retryable);
    }
    expect(seen).toEqual([]);
  });

  it("types the loader's closed-session and failed-read errors as retryable, other refusals as final", async () => {
    const { runtime, seen } = fakeRuntime(completes);
    const cases: Array<[string, string, boolean]> = [
      ["session_closed", "session-not-active", true],
      ["read_failed", "read-failed", true],
      ["aborted", "cancelled", false],
      ["digest_mismatch", "attachment-refused", false],
    ];
    for (const [loaderCode, code, retryable] of cases) {
      const error = await rejection(
        port(runtime, {
          attachmentSource: async () => {
            throw Object.assign(new Error("x"), { code: loaderCode });
          },
        }).execute(task({ attachments: [png()] }), aiProfile),
      );
      expect(error.sessionCode).toBe(code);
      expect(error.retryable).toBe(retryable);
    }
    expect(seen).toEqual([]);
  });

  it("refuses a staging base that is a planted link, and never touches its target", async () => {
    const victim = join(base, "victim");
    await mkdir(victim);
    await writeFile(join(victim, "keep.txt"), "keep");
    await symlink(victim, join(base, "staging"));
    const { runtime, seen } = fakeRuntime(completes);
    const subject = port(runtime);
    expect(
      (await rejection(subject.execute(task(), aiProfile))).sessionCode,
    ).toBe("profile-unavailable");
    await expect(subject.sweep()).rejects.toBeInstanceOf(SessionAgentError);
    await expect(subject.sweepIdle()).rejects.toBeInstanceOf(SessionAgentError);
    expect(seen).toEqual([]);
    expect(await readdir(victim)).toEqual(["keep.txt"]);
  });
});
