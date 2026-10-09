// Test support for the Active Session end-to-end suites: the REAL processor,
// the REAL AI engine and the REAL session agent port, with a FAKE
// AgentRuntimeAdapter (claude-shaped or codex-shaped) and a FAKE direct-model
// provider, over the product's in-memory session world. No database, no
// provider, no network. Contents are synthetic and carry canaries so a suite
// can prove nothing leaks into traces or errors.
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentCapabilities,
  AgentEvent,
  AgentProfile,
  AgentRunRequest,
  AgentRuntimeAdapter,
} from "@omnitech/ai-engine";
import {
  createAiEngine,
  type ModelPort,
  type Profile,
} from "@omnitech/ai-engine";
import {
  createInterviewSessionPolicy,
  createMemorySessionWorld,
  createSessionProcessor,
  type SessionProcessorOptions,
  type SessionTraceEvent,
} from "@omnitech/product-interview/session-testing";
import {
  loadVerifiedScreenshot,
  type SnapshotRead,
} from "@omnitech/product-interview/session-worker";
import {
  createSessionAgentPort,
  type StandingVerdict,
} from "./session-agent-port";

export const AGENT_PROFILE_ID = "session-agent-under-test";
export const FAST_PROFILE_ID = "interview-session-fast";
export const ANSWERS_PROFILE_ID = "interview-answers";
export const DEVICE_PROFILE_ID = "interview-session-device";

// Synthetic content canaries: none may ever reach a trace, an error or a log.
export const CANARY = {
  spoken: "CANARY-SPOKEN-4f9c",
  typed: "CANARY-TYPED-7a21",
  code: "CANARY-CODE-b3d8",
  window: "CANARY-WINDOW-90e5",
};

// A header-valid PNG (signature, IHDR, IEND); enough for the loader, which
// reads the header only, and distinctive bytes to follow to the adapter.
export function fixturePng(width = 640, height = 480): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", Buffer.from("fixture-pixels-for-the-adapter")),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const agentProfile = (
  runtime: "claude-code" | "codex",
  maximumOutputBytes = 500_000,
): AgentProfile => ({
  id: `assistant-${runtime}`,
  version: 1,
  runtime,
  model: "fake",
  fallbackModels: [],
  effort: "low",
  tools: [],
  sandbox: "read-only",
  approvalPolicy: "never",
  sessionPersistence: false,
  maximumTurns: 1,
  timeoutMs: 30_000,
  maximumOutputBytes,
  additionalDirectories: [],
  webSearch: false,
});

// What each scripted stage answers. The assist answer for a screenshot names a
// coding problem; the solution is a closed, test-covered one.
export const CODING_BRIEF = {
  language: "typescript",
  restatement: "Implement a sliding window rate limiter.",
  constraints: ["a fixed number of requests per client in a sliding window"],
};
export const codingAssist = () => ({
  category: "coding",
  draft: "Restate the problem, then outline the approach.",
  claims: [],
  star: null,
  logistics: null,
  codingBrief: CODING_BRIEF,
});
export const plainAssist = (draft = "Ask which problem is meant.") => ({
  category: "other",
  draft,
  claims: [],
  star: null,
  logistics: null,
  codingBrief: null,
});
export const solution = (revision: number) => ({
  language: "typescript",
  code: `export const allow = () => ${revision}; // ${CANARY.code}`,
  testCode: 'it("t0", () => {});',
  coverage: [{ constraintIndex: 0, testName: "t0" }],
  escalation: "none",
  notes: "A map of timestamps per client.",
});
export const revisionOf = (prompt: string): number =>
  Number(/^REVISION: (\d+)$/m.exec(prompt)?.[1] ?? 0);
export const isSolve = (prompt: string) =>
  prompt.startsWith("TASK: solve_code");

export type Shape = "claude" | "codex";

// A fake runtime adapter in the shape of one provider. It reads the staged
// image the way the real runtime would (by the path it was handed), so a
// suite sees exactly what reached the provider.
export function fakeAgentRuntime(
  shape: Shape,
  options: {
    imageInput?: boolean;
    answer?: (request: AgentRunRequest) => unknown | Promise<unknown>;
    // Holds every run until released, ending when the run is cancelled.
    hold?: { released: Promise<void> } | undefined;
  } = {},
) {
  const seen: Array<{
    request: AgentRunRequest;
    images: Buffer[];
    systemPrompt: string;
  }> = [];
  const cancelled: string[] = [];
  const capabilities: AgentCapabilities = {
    resume: false,
    structuredOutput: true,
    attachments: true,
    tools: false,
    imageInput: options.imageInput ?? true,
    toolless: true,
  };
  const runtime: AgentRuntimeAdapter = {
    runtime: shape === "claude" ? "claude-code" : "codex",
    capabilities,
    run(request) {
      return (async function* (): AsyncIterable<AgentEvent> {
        const images = await Promise.all(
          request.attachments.map((attachment) =>
            readFile(attachment.reference),
          ),
        );
        seen.push({
          request,
          images,
          systemPrompt: request.systemPrompt ?? "",
        });
        yield { type: "started", sessionId: "provider-session" };
        if (options.hold) {
          await new Promise<void>((resolve) => {
            void options.hold?.released.then(resolve);
            const timer = setInterval(() => {
              if (cancelled.includes(request.runId)) {
                clearInterval(timer);
                resolve();
              }
            }, 5);
          });
        }
        const output = await (options.answer ?? (() => codingAssist()))(
          request,
        );
        // Codex streams the agent message and parses it; Claude returns the
        // structured output directly. Both end in the same completed event.
        if (shape === "codex")
          yield { type: "text-delta", text: JSON.stringify(output) };
        yield {
          type: "usage",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        };
        yield {
          type: "completed",
          result: { sessionId: "provider-session", output },
        };
      })();
    },
    resume: () => (async function* () {})(),
    async cancel(runId) {
      cancelled.push(runId);
    },
  };
  return { runtime, seen, cancelled };
}

// One call as a scripted stage answer sees it, whichever provider served it:
// the profile asked for, the prompt, and the call's signal (a direct-model
// call only; the agent runtime is cancelled by run id).
export type StageRequest = {
  profileId: string;
  system: string;
  prompt: string;
  signal?: AbortSignal;
};

// A fake direct-model provider for the text-only stages (the fast assistance
// profile and the coding solution profile). It records every call it served;
// none may carry an attachment, and one that does is refused.
export function fakeModel(
  options: {
    answer?: (request: StageRequest) => unknown;
    solve?: (request: StageRequest) => unknown | Promise<unknown>;
  } = {},
) {
  const requests: StageRequest[] = [];
  const port: ModelPort = {
    kind: "model",
    // Every stage reads the engine's stream (session-dispatch.ts): the answer
    // is written as text in two parts, exactly as a model writes the
    // structured-output JSON, and the engine reads the value from it.
    async *stream(_scope, input, signal) {
      const parts = (role: "system" | "user") =>
        input.messages
          .filter((message) => message.role === role)
          .flatMap((message) => message.parts);
      if (parts("user").some((part) => part.type !== "text"))
        throw new Error("The direct model takes text only.");
      const text = (role: "system" | "user") =>
        parts(role)
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("");
      const request: StageRequest = {
        profileId: input.profileId,
        system: text("system"),
        prompt: text("user"),
        signal,
      };
      requests.push(request);
      const result = isSolve(request.prompt)
        ? await (options.solve ?? ((r) => solution(revisionOf(r.prompt))))(
            request,
          )
        : (options.answer ?? (() => plainAssist()))(request);
      const written = JSON.stringify(result) ?? "";
      const half = Math.ceil(written.length / 2);
      yield { type: "text", text: written.slice(0, half) };
      yield { type: "text", text: written.slice(half) };
    },
  };
  return { port, requests };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;

export async function createHarness(
  options: {
    shape?: Shape;
    imageInput?: boolean;
    processingPolicy?: "device-only" | "permitted-remote";
    agentAnswer?: (request: AgentRunRequest) => unknown | Promise<unknown>;
    holdAgent?: { released: Promise<void> };
    modelAnswer?: (request: StageRequest) => unknown;
    modelSolve?: (request: StageRequest) => unknown | Promise<unknown>;
    // No vision profile configured on the processor.
    noVisionProfile?: boolean;
    // No attachment loader configured on the port.
    noLoader?: boolean;
    // Overrides the port's standing re-check (the world's own when it returns
    // undefined), to script a pause or a failed read during a capacity wait.
    standing?: () => StandingVerdict | undefined;
    processor?: Partial<SessionProcessorOptions>;
    // The stored snapshot rows the loader reads, keyed by "source/event".
    snapshots?: Map<string, Parameters<typeof storedSnapshot>[0]>;
  } = {},
) {
  const shape = options.shape ?? "claude";
  const world = createMemorySessionWorld({
    ...(options.processingPolicy
      ? { processingPolicy: options.processingPolicy }
      : {}),
  });
  const staging = await mkdtemp(join(tmpdir(), "session-e2e-"));
  const stagingBase = join(staging, "stage");
  // The pinned agent profile serves the assist and coding stages too (ADR-0016:
  // one pinned profile), so the scripted stage answers (`modelAnswer`,
  // `modelSolve`) apply to whichever profile the processor routes a stage to.
  // A screenshot task is classified as a coding problem unless scripted.
  const asRequest = (request: AgentRunRequest): StageRequest => ({
    profileId: AGENT_PROFILE_ID,
    system: request.systemPrompt ?? "",
    prompt: request.prompt,
  });
  const stageAnswer = (request: AgentRunRequest): unknown | Promise<unknown> =>
    isSolve(request.prompt)
      ? (options.modelSolve ?? ((r) => solution(revisionOf(r.prompt))))(
          asRequest(request),
        )
      : options.modelAnswer
        ? options.modelAnswer(asRequest(request))
        : request.attachments.length > 0
          ? codingAssist()
          : plainAssist();
  const agent = fakeAgentRuntime(shape, {
    ...(options.imageInput === undefined
      ? {}
      : { imageInput: options.imageInput }),
    answer: options.agentAnswer ?? stageAnswer,
    ...(options.holdAgent ? { hold: options.holdAgent } : {}),
  });
  const model = fakeModel({
    ...(options.modelAnswer ? { answer: options.modelAnswer } : {}),
    ...(options.modelSolve ? { solve: options.modelSolve } : {}),
  });

  // The real loader's verification over an in-memory read of the stored
  // snapshot rows (the SQL join itself is covered by the database suites).
  const stored = options.snapshots ?? new Map();
  const read: SnapshotRead = async (owner, ref) => {
    if (owner.tenantId !== world.scope.tenantId) return null;
    if (ref.sessionId !== world.sessionId) return null;
    if (world.state.status !== "active") return "session_closed";
    const row = stored.get(`${ref.sourceId}/${ref.eventId}`);
    return row ? storedSnapshot(row) : null;
  };

  const runtimeId = shape === "claude" ? "claude-code" : "codex";
  const port = createSessionAgentPort({
    runtimes: { [runtimeId]: agent.runtime },
    profiles: new Map([[AGENT_PROFILE_ID, agentProfile(runtimeId)]]),
    stagingBase,
    ...(options.noLoader
      ? {}
      : {
          attachmentSource: (owner, attachment, signal) =>
            loadVerifiedScreenshot(read, owner, attachment, signal),
        }),
    // After any capacity wait the session must still be active and remote.
    stillPermitted: (): StandingVerdict =>
      options.standing?.() ??
      (world.state.status !== "active"
        ? "not-active"
        : world.state.policy === "permitted-remote"),
  });

  const direct = (id: string, locality?: Profile["locality"]): Profile => ({
    id,
    label: id,
    provider: "model",
    kind: "model",
    ...(locality ? { locality } : {}),
  });
  const profiles: Profile[] = [
    direct(FAST_PROFILE_ID),
    direct(ANSWERS_PROFILE_ID),
    // Only a device-declared model may serve a device-only session.
    direct(DEVICE_PROFILE_ID, "device"),
    { id: AGENT_PROFILE_ID, label: "agent", provider: "agent", kind: "agent" },
  ];
  const engine = createAiEngine({
    profiles,
    providers: { model: model.port, agent: port },
    authorize: (execution) =>
      execution.permissions?.includes("interview.read")
        ? true
        : "The caller may not use interview profiles.",
  });

  const events: SessionTraceEvent[] = [];
  const runner = {
    runAll: async (input: { testCode: string }) => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
      tests: [...input.testCode.matchAll(/it\("(t\d+)"/g)].map((m) => ({
        name: String(m[1]),
        status: "passed" as const,
      })),
    }),
    checkSyntax: async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    }),
  };
  const runCalls: unknown[] = [];
  const codeRunner = {
    runAll: async (input: Parameters<typeof runner.runAll>[0]) => {
      runCalls.push(input);
      return runner.runAll(input);
    },
    checkSyntax: runner.checkSyntax,
  };

  let workers = 0;
  const processors: ReturnType<typeof createSessionProcessor>[] = [];
  function startProcessor(
    extra: Partial<SessionProcessorOptions> = {},
    afterPurge?: () => Promise<void>,
  ) {
    workers += 1;
    const workerId = `worker-${workers}`;
    const processor = createSessionProcessor(
      {
        claim: world.claimFor(workerId),
        store: world.store,
        engine,
        // Display metadata for an agent profile, as the worker's engine gives it.
        answeredBy: (profileId) =>
          profileId === AGENT_PROFILE_ID
            ? { runtime: runtimeId, model: agentProfile(runtimeId).model }
            : undefined,
        policy: createInterviewSessionPolicy(),
        clock: { nowMs: () => Date.now() },
        trace: { emit: (event) => void events.push(event) },
        codeRunner,
        ...(options.noVisionProfile
          ? {}
          : { visionProfileId: AGENT_PROFILE_ID }),
        afterPurge: afterPurge ?? (() => port.sweepIdle()),
      },
      {
        workerId,
        settleMs: 0,
        sweepEveryMs: 3_600_000,
        ...options.processor,
        ...extra,
      },
    );
    processors.push(processor);
    return processor;
  }

  const stagedEntries = () => readdir(stagingBase).catch(() => [] as string[]);

  return {
    shape,
    world,
    agent,
    model,
    engine,
    port,
    events,
    codeRunner,
    runCalls,
    stagingBase,
    stagedEntries,
    startProcessor,
    // The fixture snapshot, stored in the world and readable by the loader.
    addSnapshot(eventId: string, bytes = fixturePng(), sourceId = "screen") {
      stored.set(`${sourceId}/${eventId}`, { bytes });
      return world.snapshot({ eventId, sourceId });
    },
    async close() {
      for (const processor of processors) await processor.close();
      await rm(staging, { recursive: true, force: true });
    },
  };
}

// What the product's ingest would have stored for a snapshot of this image.
export function storedSnapshot(input: {
  bytes: Buffer;
  mediaType?: string;
  observationMediaType?: string;
  sha256?: string;
}) {
  return {
    bytes: input.bytes,
    artifactMediaType: input.mediaType ?? "image/png",
    observationMediaType: input.observationMediaType ?? "image/png",
    artifactSha256:
      input.sha256 ?? createHash("sha256").update(input.bytes).digest("hex"),
  };
}

const NEVER = new AbortController().signal;

// Ticks until the processor has no more work, letting dispatches finish.
export async function settle(
  processor: ReturnType<typeof createSessionProcessor>,
  maxTicks = 12,
): Promise<void> {
  for (let i = 0; i < maxTicks; i += 1) {
    const worked = await processor.tick(NEVER);
    await processor.idle();
    if (!worked) return;
  }
}

export async function until(
  condition: () => boolean,
  maxMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
