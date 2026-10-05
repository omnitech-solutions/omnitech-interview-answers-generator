// Hardening case 6 (PB-0002 slice 3): remote egress is blocked in device-only
// across the WHOLE question -> draft path, two ways at once:
//   - spy provider adapters behind the REAL gateway (a remote adapter that is
//     ever called fails the assertion), and
//   - a network-level guard (global fetch, http(s), TCP connect) that records
//     and refuses any destination other than loopback and the test database.
// The path is the real one: fixture companion -> real routes -> real
// processor -> real gateway -> stored draft -> the owner's own reads.
import type { ModelProviderAdapter } from "@omnitech/ai-contracts";
import {
  type AgentExecutionPort,
  type AiProfile,
  createAiExecutionGateway,
} from "@omnitech/ai-runtime";
import * as fixture from "@omnitech/capture-companion/fixture";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  INTERVIEW_SESSION_DEVICE_PROFILE,
  INTERVIEW_SESSION_FAST_PROFILE,
} from "../../../assistant-profile";
import { buildProcessor, collectTraces, settle } from "../processor-fixture";
import { ActiveSessionRepository } from "../repository";
import { CANNED_DRAFT, RECRUITER_SCREEN } from "../session-replay-fixtures";
import { type EgressGuard, installEgressGuard } from "./egress-guard";
import { startWorld, type World } from "./world";

let world: World<typeof fixture>;
let repo: ActiveSessionRepository;
let databaseHost = "localhost";
const cleanups: Array<() => Promise<void> | void> = [];
beforeAll(async () => {
  world = await startWorld(fixture);
  repo = new ActiveSessionRepository(world.fx.member);
  databaseHost = new URL(world.fx.pg.memberUrl).hostname;
}, 120_000);
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
afterAll(() => world?.stop());

const noAgents = {} as AgentExecutionPort;
const opening = RECRUITER_SCREEN[0]?.segments ?? [];

// One spy per target, recording each call that reaches it by target id.
function spyModel(targetId: string, calls: string[]): ModelProviderAdapter {
  return {
    providerId: targetId,
    modelId: targetId,
    capabilities: {
      streaming: false,
      structuredOutput: true,
      tools: false,
      vision: false,
      search: false,
    },
    async listModels() {
      return [];
    },
    async execute() {
      calls.push(targetId);
      return {
        executionId: `spy-${targetId}`,
        family: "direct-model",
        targetId,
        result: CANNED_DRAFT,
      };
    },
    async *stream() {
      calls.push(`${targetId}.stream`);
    },
    async *streamStructured() {
      calls.push(`${targetId}.streamStructured`);
    },
  };
}
const profile = (
  id: string,
  targetId: string,
  locality: AiProfile["locality"],
): AiProfile => ({
  id,
  label: id,
  family: "direct-model",
  targetId,
  taskTypes: ["structured-generation"],
  enabled: true,
  ...(locality === undefined ? {} : { locality }),
});

async function runPath(
  name: string,
  policy: "device-only" | "permitted-remote",
  deviceLocality: AiProfile["locality"],
  // Runs after the first segment is stored and before the worker looks at the
  // session: where a mid-session tightening lands.
  between: (
    owner: Awaited<ReturnType<typeof world.begin>>,
  ) => Promise<void> = async () => {},
) {
  const calls: string[] = [];
  const gateway = createAiExecutionGateway({
    profiles: [
      profile(INTERVIEW_SESSION_FAST_PROFILE, "remote-model", "remote"),
      profile(INTERVIEW_SESSION_DEVICE_PROFILE, "device-model", deviceLocality),
    ],
    models: [spyModel("remote-model", calls), spyModel("device-model", calls)],
    images: [],
    agents: noAgents,
    authorize: async () => true,
  });
  const owner = await world.begin(name, {
    processingPolicy: policy,
    captureSources: ["microphone", "application-audio"],
  });
  // Every companion request, by destination host.
  const companionHosts: string[] = [];
  const guard: EgressGuard = installEgressGuard([databaseHost]);
  cleanups.push(() => guard.uninstall());
  const run = world.companion(owner, {
    fetch: async (url: string, init: RequestInit) => {
      companionHosts.push(new URL(url).hostname);
      return await world.app.request(url, init);
    },
  });
  await run.open();
  for (const [index, segment] of opening.entries()) {
    await run.companion.observeTranscript({
      eventId: segment.eventId,
      source:
        segment.role === "interviewer" ? "application-audio" : "microphone",
      text: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
    });
    if (index === 0) await between(owner);
  }
  const trace = collectTraces();
  const processor = buildProcessor(world.fx, {
    workerId: `worker-egress-${name}`,
    gateway,
    trace,
  });
  cleanups.push(async () => {
    await processor.close();
    await repo.controlSession(owner.scope, owner.id, "end");
  });
  await settle(processor);
  // The owner reads it all back through the real routes.
  const model = await world.model(owner);
  guard.uninstall();
  return {
    calls,
    trace,
    guard,
    companionHosts,
    model,
    actions: await repo.listActions(owner.scope, owner.id),
  };
}

describe("device-only: no remote call anywhere on the question -> draft path", () => {
  it("drafts through the device adapter alone, with nothing leaving the machine", async () => {
    const result = await runPath("egress-device", "device-only", "device");
    expect(result.calls).toEqual(["device-model"]);
    expect(
      result.actions.some((action) => action.dispatchStatus === "succeeded"),
    ).toBe(true);
    expect(result.model.stats.answersPublished).toBeGreaterThan(0);
    expect(result.guard.blocked).toEqual([]);
    // The companion spoke only to Studio.
    expect(new Set(result.companionHosts)).toEqual(new Set(["studio.test"]));
  }, 60_000);

  it.each([
    ["a profile declared remote", "remote"],
    ["a profile declaring nothing", undefined],
  ] as const)(
    "refuses %s: no adapter is called, no fallback to the fast profile, no draft",
    async (_label, locality) => {
      const result = await runPath(
        `egress-refuse-${String(locality)}`,
        "device-only",
        locality,
      );
      expect(result.calls).toEqual([]);
      expect(result.guard.blocked).toEqual([]);
      expect(result.actions.every((action) => action.result === null)).toBe(
        true,
      );
      expect(result.model.stats.answersPublished).toBe(0);
      expect(
        result.trace.events.find((event) => event.event === "dispatch.refused"),
      ).toMatchObject({ outcome: "policy-refused" });
    },
    60_000,
  );

  it("holds when the owner tightens to device-only through the real route mid-session", async () => {
    const result = await runPath(
      "egress-tighten",
      "permitted-remote",
      "device",
      async (owner) => {
        world.as(owner.person);
        const tightened = await world.send(`/${owner.id}/policy`, {
          processingPolicy: "device-only",
        });
        expect(tightened.status).toBe(200);
      },
    );
    expect(result.calls).toEqual(["device-model"]);
    expect(result.guard.blocked).toEqual([]);
  }, 60_000);
});

describe("controls: the checks can fail", () => {
  it("lets a permitted-remote session reach the remote adapter, so the spy is live", async () => {
    const result = await runPath(
      "egress-control-remote",
      "permitted-remote",
      "device",
    );
    expect(result.calls).toEqual(["remote-model"]);
  }, 60_000);

  it("records and refuses a real egress attempt (fetch, http and TCP)", async () => {
    const guard = installEgressGuard([databaseHost]);
    try {
      await expect(fetch("https://remote.example.invalid/x")).rejects.toThrow(
        /egress blocked/,
      );
    } catch {
      // fetch may throw synchronously through the guard
    }
    const http = await import("node:http");
    expect(() => http.request("http://remote.example.invalid/x")).toThrow(
      /egress blocked/,
    );
    const net = await import("node:net");
    expect(() => net.connect(443, "203.0.113.7")).toThrow(/egress blocked/);
    // Loopback is allowed and recorded as such: the guard is not blind.
    const server = net.createServer().listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as { port: number };
    const socket = net.connect(port, "127.0.0.1");
    await new Promise((resolve) => socket.once("connect", resolve));
    socket.destroy();
    server.close();
    guard.uninstall();
    expect(guard.allowed).toContain("tcp 127.0.0.1");
    expect(guard.blocked).toEqual([
      "fetch remote.example.invalid",
      "http.request remote.example.invalid",
      "tcp 203.0.113.7",
    ]);
  });
});
