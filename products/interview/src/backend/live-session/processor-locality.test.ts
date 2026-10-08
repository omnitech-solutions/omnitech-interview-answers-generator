// Device-only locality through the real processor and the REAL gateway with
// spy provider adapters (rule:device-only-enforced-twice,
// rule:unlisted-stage-refused): a device-only session reaches only a profile
// the environment declared device-local; a remote or undeclared profile is
// refused with no call to any adapter and no fallback to the remote profile,
// and the refusal is traced by id and code only. A permitted-remote session
// uses the fast profile as before.
import type { ModelProviderAdapter } from "@omnitech/ai-contracts";
import {
  type AgentExecutionPort,
  type AiProfile,
  createAiExecutionGateway,
} from "@omnitech/ai-runtime";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  INTERVIEW_SESSION_DEVICE_PROFILE,
  INTERVIEW_SESSION_FAST_PROFILE,
} from "../../assistant-profile";
import { type Fixture, startFixture } from "./live-session-fixture";
import {
  buildProcessor,
  collectTraces,
  NEVER_ABORTED,
  settle,
  startSessionFor,
} from "./processor-fixture";
import { ActiveSessionRepository } from "./repository";
import { CANNED_DRAFT, RECRUITER_SCREEN } from "./session-replay-fixtures";

let fx: Fixture;
let repo: ActiveSessionRepository;
const cleanups: Array<() => Promise<void>> = [];
beforeAll(async () => {
  fx = await startFixture();
  repo = new ActiveSessionRepository(fx.member);
}, 120_000);
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
afterAll(() => fx.stop());

// No agent runtime and no image provider exist in these sessions' gateway; a
// call reaching either would be a locality or routing failure.
const noAgents = {} as AgentExecutionPort;

const opening = () => RECRUITER_SCREEN[0]?.segments ?? [];

// One spy adapter per target: the calls that reach it, by target id.
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
    // The draft-answer stage streams (session-dispatch.ts): the canned draft
    // is written as text, then completed; the spy records the stream and the
    // execute it goes through.
    async *stream(request) {
      calls.push(`${targetId}.stream`);
      const execution = await this.execute(request);
      yield { type: "text-delta", text: JSON.stringify(execution.result) };
      yield { type: "completed", result: execution.result };
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

async function run(
  name: string,
  policy: "device-only" | "permitted-remote",
  deviceLocality: AiProfile["locality"],
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
  const world = await startSessionFor(fx, repo, fx.tenantA, name, policy);
  for (const segment of opening()) await world.ingestor.ingest(segment);
  const trace = collectTraces();
  const processor = buildProcessor(fx, {
    workerId: `worker-${name}`,
    gateway,
    trace,
  });
  cleanups.push(async () => {
    await processor.close();
    await repo.controlSession(world.scope, world.sessionId, "end");
  });
  await settle(processor);
  const action = (await repo.listActions(world.scope, world.sessionId))[0];
  return { calls, trace, action };
}

describe("device-only sessions through the real gateway", () => {
  it.each([
    ["a profile declared remote", "remote"],
    ["a profile declaring nothing", undefined],
    ["a profile declared private-network", "private-network"],
  ] as const)(
    "refuse %s: no adapter is called and the fast profile is not a fallback",
    async (_label, locality) => {
      const { calls, trace, action } = await run(
        `loc-refuse-${String(locality)}`,
        "device-only",
        locality,
      );
      expect(calls).toEqual([]);
      expect(action).toMatchObject({
        dispatchStatus: "suppressed",
        result: null,
      });
      const refusal = trace.events.find((e) => e.event === "dispatch.refused");
      expect(refusal).toMatchObject({
        outcome: "policy-refused",
        profileId: INTERVIEW_SESSION_DEVICE_PROFILE,
      });
      // A refusal carries ids and a code, never the captured text.
      expect(JSON.stringify(trace.events)).not.toContain(
        opening()[0]?.text ?? "x",
      );
    },
  );

  it("run on a device-declared profile and call only the device adapter", async () => {
    const { calls, action } = await run("loc-device", "device-only", "device");
    expect(calls).toEqual(["device-model.stream", "device-model"]);
    expect(action).toMatchObject({ dispatchStatus: "succeeded" });
    expect(action?.result).toMatchObject({
      meta: {
        profileId: INTERVIEW_SESSION_DEVICE_PROFILE,
        processingPolicy: "device-only",
      },
    });
  });

  it("leave a permitted-remote session on the fast profile", async () => {
    const { calls, action } = await run(
      "loc-remote",
      "permitted-remote",
      "device",
    );
    expect(calls).toEqual(["remote-model.stream", "remote-model"]);
    expect(action).toMatchObject({ dispatchStatus: "succeeded" });
  });
});

describe("tightening locality mid-session", () => {
  it("makes the next dispatch use the device policy, read from the row just before the call", async () => {
    const calls: string[] = [];
    const gateway = createAiExecutionGateway({
      profiles: [
        profile(INTERVIEW_SESSION_FAST_PROFILE, "remote-model", "remote"),
        profile(INTERVIEW_SESSION_DEVICE_PROFILE, "device-model", "device"),
      ],
      models: [
        spyModel("remote-model", calls),
        spyModel("device-model", calls),
      ],
      images: [],
      agents: noAgents,
      authorize: async () => true,
    });
    const world = await startSessionFor(fx, repo, fx.tenantA, "loc-tighten");
    const processor = buildProcessor(fx, {
      workerId: "worker-loc-tighten",
      gateway,
    });
    cleanups.push(async () => {
      await processor.close();
      await repo.controlSession(world.scope, world.sessionId, "end");
    });
    await processor.tick(NEVER_ABORTED);
    // Tighten before any text arrives: the first dispatch must already be
    // device-only.
    await repo.tightenProcessingPolicy(
      world.scope,
      world.sessionId,
      "device-only",
    );
    for (const segment of opening()) await world.ingestor.ingest(segment);
    await settle(processor);
    expect(calls).toEqual(["device-model.stream", "device-model"]);
  });
});
