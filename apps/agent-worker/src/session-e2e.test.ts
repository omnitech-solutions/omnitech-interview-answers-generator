// The Active Session assistance path end to end (ADR-0016), without a
// database or a provider: the REAL processor, the REAL AiExecutionGateway and
// the REAL session agent port, with a FAKE runtime adapter in the shape of each
// provider (claude-code, codex) and a fake direct model for the text-only
// stages, over the product's in-memory session world. It shows the same
// answer, claim validation, cancel and publish behaviour on either provider, a
// screenshot reaching the runtime only through the verifying loader, and
// every refusal failing closed. A real provider, a real database and real
// pixels are outside what this can show (see the *.integration tests).
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AiPolicyRefusedError } from "@omnitech/ai-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sweepStagingBase } from "./session-agent-port.js";
import {
  AGENT_PROFILE_ID,
  ANSWERS_PROFILE_ID,
  CANARY,
  CODING_BRIEF,
  codingAssist,
  createHarness,
  DEVICE_PROFILE_ID,
  fixturePng,
  type Harness,
  isSolve,
  plainAssist,
  revisionOf,
  settle,
  solution,
  until,
} from "./session-e2e-support.js";

const harnesses: Harness[] = [];
const make = async (...args: Parameters<typeof createHarness>) => {
  const harness = await createHarness(...args);
  harnesses.push(harness);
  return harness;
};
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
  vi.restoreAllMocks();
});

const SHOT = [{ sourceId: "screen", eventId: "shot-1" }];
const QUESTION = `Could you solve the problem on my screen in TypeScript? ${CANARY.spoken}`;
const SOLVE_QUESTION =
  "Can you implement a rate limiter in TypeScript for a Node service that allows a fixed number of requests per client in a sliding window?";

const byTask = (h: Harness, taskId: string) =>
  h.world.actions.filter((action) => action.taskId === taskId);
const done = (h: Harness, taskId: string, kind: string, revision = 1) =>
  byTask(h, taskId).find(
    (a) => a.actionKind === kind && a.taskRevision === revision,
  );
const resultOf = (action: { result: unknown } | undefined) =>
  action?.result as Record<string, any>;

describe.each(["claude", "codex"] as const)(
  "transcript plus Analyze latest capture (%s-shaped runtime)",
  (shape) => {
    it("sends the screenshot to the runtime as untrusted evidence, then codes, runs the tests and publishes", async () => {
      const h = await make({ shape });
      h.world.transcript({ eventId: "q1", text: QUESTION });
      h.addSnapshot("shot-1");
      const processor = h.startProcessor();
      await settle(processor);
      // The spoken question alone was answered text-only, by the pinned agent
      // profile (one pinned profile for the whole session): no image, no
      // direct-model call.
      expect(h.agent.seen).toHaveLength(1);
      expect(h.agent.seen[0]?.images).toEqual([]);
      expect(h.agent.seen[0]?.request.toolless).toBe(true);
      expect(h.model.requests).toHaveLength(0);

      // The owner asks for the latest capture to be analysed.
      h.world.ownerInput("r-1", { operation: "analyze", snapshots: SHOT });
      await settle(processor);

      // The image reached the runtime: the staged bytes it read are the
      // fixture's, tool-less, with the screenshot framed as untrusted evidence.
      expect(h.agent.seen).toHaveLength(3);
      const call = h.agent.seen.find((seen) => seen.images.length > 0);
      expect(call?.images[0]?.equals(fixturePng())).toBe(true);
      expect(call?.request.toolless).toBe(true);
      expect(call?.systemPrompt).toContain("untrusted evidence");
      expect(call?.request.prompt).toContain("COUNT: 1");
      expect(call?.request.prompt).not.toContain("fixture-pixels");
      // Staged files are gone once the attempt settled.
      expect(await h.stagedEntries()).toEqual([]);
      // The code stage reached the same pinned runtime, text-only and
      // tool-less: no image, and no direct-model call at any stage.
      const solve = h.agent.seen.find((seen) => isSolve(seen.request.prompt));
      expect(solve?.images).toEqual([]);
      expect(solve?.request.attachments).toEqual([]);
      expect(solve?.request.toolless).toBe(true);
      expect(h.model.requests).toHaveLength(0);

      // The one structured call classified and answered; its coding brief drove
      // the existing coding path through the runner to a fenced publish.
      const taskId = "task-i.r-1";
      const assist = done(h, taskId, "draft-answer");
      expect(assist?.dispatchStatus).toBe("succeeded");
      expect(resultOf(assist)["category"]).toBe("coding");
      expect(resultOf(assist)["codingBrief"]).toMatchObject({
        restatement: CODING_BRIEF.restatement,
      });
      const code = done(h, taskId, "solve-code");
      expect(code?.dispatchStatus).toBe("succeeded");
      expect(resultOf(code)["states"]).toMatchObject({
        generated: true,
        testsPassed: true,
      });
      expect(resultOf(code)["code"]).toContain(CANARY.code);
      expect(h.runCalls).toHaveLength(1);
      // The task's provenance names the owner input and the exact snapshot.
      expect(assist?.sourceEventIds).toEqual([
        "input/r-1",
        `snap/${h.world.sessionId}/screen/shot-1`,
      ]);
      // Exactly one published answer and one published solution for the task.
      expect(
        byTask(h, taskId).filter((a) => a.dispatchStatus === "succeeded"),
      ).toHaveLength(2);
    });

    it("answers a typed follow-up on the task it targets, without a transcript segment", async () => {
      const h = await make({ shape });
      h.world.transcript({ eventId: "q1", text: QUESTION });
      const processor = h.startProcessor();
      await settle(processor);
      const spokenTask = h.world.actions[0]?.taskId as string;
      h.world.ownerInput("r-2", {
        operation: "follow-up",
        text: `and the cost? ${CANARY.typed}`,
        target: { taskId: spokenTask, revision: 1 },
        snapshots: [],
      });
      await settle(processor);
      const second = done(h, spokenTask, "draft-answer", 2);
      expect(second?.dispatchStatus).toBe("succeeded");
      expect(second?.sourceEventIds).toContain("input/r-2");
      // The typed text reached the model as captured data, labelled as the owner's.
      const last = h.agent.seen.at(-1);
      expect(last?.request.prompt).toContain(CANARY.typed);
      // The earlier revision's answer is kept, not rewritten.
      expect(done(h, spokenTask, "draft-answer", 1)?.dispatchStatus).toBe(
        "succeeded",
      );
      // The transcript view holds only the spoken segment.
      expect(
        h.world.observations.filter((o) => o.kind === "transcript.final"),
      ).toHaveLength(1);
    });

    it("never publishes a second time after a restart (replay)", async () => {
      const h = await make({ shape });
      h.world.transcript({ eventId: "q1", text: QUESTION });
      h.addSnapshot("shot-1");
      const first = h.startProcessor();
      await settle(first);
      const spokenTask = h.world.actions[0]?.taskId as string;
      h.world.ownerInput("r-1", { operation: "analyze", snapshots: SHOT });
      h.world.ownerInput("r-2", {
        operation: "follow-up",
        text: "and the cost?",
        target: { taskId: spokenTask, revision: 1 },
        snapshots: [],
      });
      await settle(first);
      const before = {
        agent: h.agent.seen.length,
        model: h.model.requests.length,
        actions: h.world.actions.length,
        published: h.world.actions
          .filter((a) => a.dispatchStatus === "succeeded")
          .map((a) => `${a.taskId}:${a.taskRevision}:${a.actionKind}`)
          .sort(),
      };
      expect(before.published.length).toBeGreaterThanOrEqual(4);

      // The first worker is gone; a new one claims at a higher fence and
      // replays every stored observation from the start.
      await first.close();
      const second = h.startProcessor();
      await settle(second);
      expect(h.agent.seen).toHaveLength(before.agent);
      expect(h.model.requests).toHaveLength(before.model);
      expect(h.world.actions).toHaveLength(before.actions);
      expect(
        h.world.actions
          .filter((a) => a.dispatchStatus === "succeeded")
          .map((a) => `${a.taskId}:${a.taskRevision}:${a.actionKind}`)
          .sort(),
      ).toEqual(before.published);
      // The rebuilt run did not re-open or re-revise any task.
      const tasks = second.snapshot(h.world.sessionId)?.tasks ?? [];
      expect(tasks.find((t) => t.taskId === spokenTask)?.revision).toBe(2);
      expect(tasks.find((t) => t.taskId === "task-i.r-1")?.revision).toBe(1);
    });
  },
);

describe("the pinned profile and the session's standing", () => {
  it("keeps a device-only session on the direct device model: no agent runtime at any stage", async () => {
    const h = await make({ processingPolicy: "device-only" });
    h.world.transcript({ eventId: "q1", text: QUESTION });
    await settle(h.startProcessor());
    expect(h.agent.seen).toHaveLength(0);
    expect(h.model.requests.length).toBeGreaterThan(0);
    expect(
      h.model.requests.every((r) => r.profileId === DEVICE_PROFILE_ID),
    ).toBe(true);
    expect(h.world.actions.some((a) => a.dispatchStatus === "succeeded")).toBe(
      true,
    );
  });

  it("answers a task again after a pause or failed read seen during the capacity wait, and never after a real denial", async () => {
    const verdicts = [
      ["not-active", "suppressed", "session_not_active", true],
      ["read-failed", "failed", null, true],
      [false, "suppressed", "policy_refused", false],
    ] as const;
    for (const [verdict, status, reason, retried] of verdicts) {
      let first = true;
      const h = await make({
        standing: () => {
          if (!first) return undefined;
          first = false;
          return verdict;
        },
      });
      h.world.transcript({ eventId: "q1", text: QUESTION });
      await settle(h.startProcessor());
      const rows = h.world.actions.filter(
        (a) => a.actionKind === "draft-answer",
      );
      expect(rows[0]).toMatchObject({
        dispatchStatus: status,
        suppressionReason: reason,
      });
      // The first attempt never reached a provider.
      expect(h.model.requests).toHaveLength(0);
      expect(rows.some((a) => a.dispatchStatus === "succeeded")).toBe(retried);
    }
  });

  it("answers on the device profile when a refusal was only the session tightening before the abort fired", async () => {
    let first = true;
    const h = await make({
      standing: () => {
        if (!first) return undefined;
        first = false;
        h.world.tighten();
        return false;
      },
    });
    h.world.transcript({ eventId: "q1", text: QUESTION });
    await settle(h.startProcessor());
    const rows = h.world.actions.filter((a) => a.actionKind === "draft-answer");
    expect(rows[0]).toMatchObject({
      dispatchStatus: "suppressed",
      suppressionReason: "policy_changed",
    });
    expect(rows.at(-1)?.dispatchStatus).toBe("succeeded");
    expect(h.model.requests.map((r) => r.profileId)).toEqual([
      DEVICE_PROFILE_ID,
    ]);
    expect(h.agent.seen).toHaveLength(0);
  });

  it("cancels an in-flight remote attempt when the session tightens to device-only, then answers on the device", async () => {
    const never = new Promise<void>(() => {});
    const h = await make({ holdAgent: { released: never } });
    h.world.transcript({ eventId: "q1", text: QUESTION });
    const processor = h.startProcessor();
    await processor.tick(new AbortController().signal);
    await until(() => h.agent.seen.length === 1);
    expect(h.agent.cancelled).toEqual([]);

    h.world.tighten();
    // One pass aborts the slot; once its dispatch has settled, later passes
    // re-dispatch the task under the device policy.
    await processor.tick(new AbortController().signal);
    await processor.idle();
    await settle(processor);
    // The remote attempt was cancelled, not left to run and then be refused.
    expect(h.agent.cancelled).toHaveLength(1);
    const rows = h.world.actions.filter((a) => a.actionKind === "draft-answer");
    expect(rows[0]?.dispatchStatus).toBe("failed");
    // The same task was answered under the device policy, by the device model.
    expect(rows.at(-1)?.dispatchStatus).toBe("succeeded");
    expect(h.model.requests.map((r) => r.profileId)).toEqual([
      DEVICE_PROFILE_ID,
    ]);
    expect(h.agent.seen).toHaveLength(1);
  });
});

describe("screenshots fail closed", () => {
  it("refuses a runtime without image input: nothing published, nothing staged, never text-only", async () => {
    const h = await make({ imageInput: false });
    h.addSnapshot("shot-1");
    h.world.ownerInput("r-1", { operation: "analyze", snapshots: SHOT });
    await settle(h.startProcessor());
    const assist = done(h, "task-i.r-1", "draft-answer");
    expect(assist).toMatchObject({
      dispatchStatus: "suppressed",
      suppressionReason: "vision_refused",
    });
    expect(h.agent.seen).toHaveLength(0);
    expect(h.model.requests).toHaveLength(0);
    expect(
      h.world.actions.filter((a) => a.dispatchStatus === "succeeded"),
    ).toHaveLength(0);
    expect(await h.stagedEntries()).toEqual([]);
  });

  it("refuses with no vision profile configured, without calling any model", async () => {
    const h = await make({ noVisionProfile: true });
    h.addSnapshot("shot-1");
    h.world.ownerInput("r-1", { operation: "analyze", snapshots: SHOT });
    await settle(h.startProcessor());
    expect(done(h, "task-i.r-1", "draft-answer")).toMatchObject({
      dispatchStatus: "suppressed",
      suppressionReason: "vision_unavailable",
    });
    expect(h.agent.seen).toHaveLength(0);
    expect(h.model.requests).toHaveLength(0);
  });

  it("refuses when the port has no verifying loader", async () => {
    const h = await make({ noLoader: true });
    h.addSnapshot("shot-1");
    h.world.ownerInput("r-1", { operation: "analyze", snapshots: SHOT });
    await settle(h.startProcessor());
    expect(done(h, "task-i.r-1", "draft-answer")).toMatchObject({
      dispatchStatus: "suppressed",
      suppressionReason: "vision_refused",
    });
    expect(h.agent.seen).toHaveLength(0);
  });

  it("refuses a snapshot the loader cannot verify (digest, media type, size)", async () => {
    const png = fixturePng();
    const cases: Array<[string, Parameters<typeof createHarness>[0]]> = [
      [
        "digest",
        {
          snapshots: new Map([
            ["screen/shot-1", { bytes: png, sha256: "0".repeat(64) }],
          ]),
        },
      ],
      [
        "media type",
        {
          snapshots: new Map([
            [
              "screen/shot-1",
              { bytes: png, observationMediaType: "image/jpeg" },
            ],
          ]),
        },
      ],
      [
        "dimensions",
        {
          snapshots: new Map([
            ["screen/shot-1", { bytes: fixturePng(20_000, 20_000) }],
          ]),
        },
      ],
    ];
    for (const [, options] of cases) {
      const h = await make(options);
      h.world.snapshot({ eventId: "shot-1" });
      h.world.ownerInput("r-1", { operation: "analyze", snapshots: SHOT });
      await settle(h.startProcessor());
      expect(done(h, "task-i.r-1", "draft-answer")).toMatchObject({
        dispatchStatus: "suppressed",
        suppressionReason: "vision_refused",
      });
      expect(h.agent.seen).toHaveLength(0);
    }
  });

  it("refuses in a device-only session, and the gateway itself refuses an agent profile there", async () => {
    const h = await make({ processingPolicy: "device-only" });
    h.addSnapshot("shot-1");
    h.world.ownerInput("r-1", { operation: "analyze", snapshots: SHOT });
    await settle(h.startProcessor());
    expect(done(h, "task-i.r-1", "draft-answer")).toMatchObject({
      dispatchStatus: "suppressed",
      suppressionReason: "vision_device_only",
    });
    expect(h.agent.seen).toHaveLength(0);
    expect(h.model.requests).toHaveLength(0);
    // Even a direct request cannot reach the runtime with a device-only policy.
    await expect(
      h.gateway.execute({
        context: {
          tenantId: h.world.scope.tenantId,
          userId: h.world.scope.actorId,
          productId: "omnitech.interview",
          permissions: ["interview.read"],
        },
        profileId: AGENT_PROFILE_ID,
        processingPolicy: "device-only",
        task: { type: "structured-generation", prompt: "x" },
      }),
    ).rejects.toBeInstanceOf(AiPolicyRefusedError);
    expect(h.agent.seen).toHaveLength(0);
  });
});

describe("a spoken correction during code generation", () => {
  it("is answered at once, and the stale coding output can never publish", async () => {
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = await make({
      modelAnswer: (request) => ({
        ...codingAssist(),
        codingBrief: {
          ...CODING_BRIEF,
          constraints:
            revisionOf(request.task.prompt) === 1
              ? CODING_BRIEF.constraints
              : [
                  ...CODING_BRIEF.constraints,
                  "a small burst above the limit is allowed",
                ],
        },
      }),
      // Every solution call is held until released; a cancelled one rejects.
      modelSolve: (request) =>
        new Promise((resolve, reject) => {
          void released.then(() =>
            resolve({
              ...solution(revisionOf(request.task.prompt)),
              coverage: [{ constraintIndex: 0, testName: "t0" }],
            }),
          );
          request.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    });
    h.world.transcript({ eventId: "q1", text: SOLVE_QUESTION });
    const processor = h.startProcessor();
    // Tick until the coding call for revision 1 is in flight (it is held).
    await until(() => {
      void processor.tick(new AbortController().signal);
      return h.agent.seen.some((seen) => isSolve(seen.request.prompt));
    });
    // Coding for revision 1 is in flight. The interviewer corrects the task.
    h.world.transcript({
      eventId: "c1",
      speaker: "candidate",
      source: "microphone",
      text: "I will keep a map from client id to a list of timestamps.",
    });
    h.world.transcript({
      eventId: "q2",
      text: "Now handle bursts, so allow a small burst above the limit for a client.",
    });
    const task = h.world.actions[0]?.taskId as string;
    await until(() => {
      void processor.tick(new AbortController().signal);
      return done(h, task, "draft-answer", 2)?.dispatchStatus === "succeeded";
    });
    // The new revision's answer was published while the old coding still ran
    // (the gate is still closed): it never waited behind it.
    expect(done(h, task, "draft-answer", 2)?.dispatchStatus).toBe("succeeded");
    // The superseded revision's coding was cancelled, so it is already failed.
    expect(done(h, task, "solve-code", 1)?.dispatchStatus).toBe("failed");

    release();
    await settle(processor);
    await processor.idle();
    // The stale revision's solution was never published; revision 2's was.
    expect(done(h, task, "solve-code", 1)?.dispatchStatus).toBe("failed");
    expect(done(h, task, "solve-code", 2)?.dispatchStatus).toBe("succeeded");
    expect(resultOf(done(h, task, "solve-code", 2))["code"]).toContain("=> 2");
    expect(
      h.world.actions.some(
        (a) =>
          a.actionKind === "solve-code" &&
          a.taskRevision === 1 &&
          a.dispatchStatus === "succeeded",
      ),
    ).toBe(false);
  });
});

describe("purge and end", () => {
  it("ending the session aborts an in-flight screenshot attempt and removes its staged image", async () => {
    const never = new Promise<void>(() => {});
    const h = await make({ holdAgent: { released: never } });
    h.addSnapshot("shot-1");
    h.world.ownerInput("r-1", { operation: "analyze", snapshots: SHOT });
    const processor = h.startProcessor();
    await processor.tick(new AbortController().signal);
    await until(() => h.agent.seen.length === 1);
    expect((await h.stagedEntries()).length).toBe(1);
    h.world.status("ended");
    await settle(processor);
    expect(await h.stagedEntries()).toEqual([]);
    expect(
      h.world.actions.filter((a) => a.dispatchStatus === "succeeded"),
    ).toHaveLength(0);
  });

  it("a purge deletes owner inputs and removes staged leftovers", async () => {
    const h = await make();
    h.addSnapshot("shot-1");
    h.world.ownerInput("r-1", { operation: "analyze", snapshots: SHOT });
    const processor = h.startProcessor({ sweepEveryMs: 0 });
    await settle(processor);
    // A crash left a staged image behind.
    await mkdir(join(h.stagingBase, "attempt-stale", "stage"), {
      recursive: true,
    });
    await writeFile(
      join(h.stagingBase, "attempt-stale", "stage", "x.png"),
      "old",
    );
    h.world.status("ended");
    await settle(processor);
    expect(h.world.purges.purges).toBe(1);
    expect(h.world.observations).toHaveLength(0);
    expect(h.world.actions).toHaveLength(0);
    expect(await h.stagedEntries()).toEqual([]);
  });

  it("purges with no model configured: a sweep-only worker calls no model", async () => {
    const h = await make();
    h.addSnapshot("shot-1");
    h.world.ownerInput("r-1", { operation: "analyze", snapshots: SHOT });
    // The sweep-only worker never ran a port, so the private base is made here.
    await mkdir(h.stagingBase, { mode: 0o700 });
    await mkdir(join(h.stagingBase, "attempt-stale", "stage"), {
      recursive: true,
    });
    await writeFile(
      join(h.stagingBase, "attempt-stale", "stage", "x.png"),
      "old",
    );
    h.world.status("ended");
    const sweeper = h.startProcessor({ sweepOnly: true, sweepEveryMs: 0 }, () =>
      sweepStagingBase(h.stagingBase),
    );
    await settle(sweeper);
    expect(h.world.purges.purges).toBe(1);
    expect(h.world.observations).toHaveLength(0);
    expect(await h.stagedEntries()).toEqual([]);
    expect(h.agent.seen).toHaveLength(0);
    expect(h.model.requests).toHaveLength(0);
  });
});

describe("no content leaves through traces, errors or logs", () => {
  it("keeps every canary out of the trace, the console and typed errors", async () => {
    const logged: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
    const h = await make({ imageInput: true });
    h.world.transcript({ eventId: "q1", text: QUESTION });
    h.addSnapshot("shot-1");
    h.world.ownerInput("r-1", { operation: "analyze", snapshots: SHOT });
    h.world.ownerInput("r-2", {
      operation: "follow-up",
      text: `and the cost? ${CANARY.typed}`,
      snapshots: [],
    });
    await settle(h.startProcessor());
    // Work really happened (the canaries were in play)...
    expect(h.world.actions.some((a) => a.dispatchStatus === "succeeded")).toBe(
      true,
    );
    expect(JSON.stringify(h.world.actions)).toContain(CANARY.code);
    // ...and none of it reached a trace event or a log line.
    const traces = JSON.stringify(h.events);
    for (const canary of Object.values(CANARY)) {
      expect(traces).not.toContain(canary);
      expect(logged.join("\n")).not.toContain(canary);
    }
    // A refusal's typed error names a code, never the prompt or an attachment.
    const refused = await make({ imageInput: false });
    const error = await refused.port
      .execute(
        {
          context: {
            tenantId: refused.world.scope.tenantId,
            userId: refused.world.scope.actorId,
            productId: "omnitech.interview",
            permissions: ["interview.read"],
          },
          task: {
            type: "structured-generation",
            prompt: `prompt ${CANARY.spoken}`,
            attachments: [
              {
                id: `snap/x/${CANARY.window}/y`,
                kind: "image",
                name: `${CANARY.window}.png`,
                reference: `snap/x/${CANARY.window}/y`,
                mimeType: "image/png",
              },
            ],
          },
        },
        {
          id: AGENT_PROFILE_ID,
          label: "agent",
          family: "agent-runtime",
          targetId: "claude-code",
          taskTypes: ["structured-generation"],
          enabled: true,
        },
      )
      .catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    const text = `${(error as Error).message} ${JSON.stringify(error)}`;
    for (const canary of Object.values(CANARY))
      expect(text).not.toContain(canary);
    expect(ANSWERS_PROFILE_ID).toBeTruthy();
    expect(plainAssist().category).toBe("other");
  });
});
