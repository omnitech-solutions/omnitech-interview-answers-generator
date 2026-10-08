// The assistance service through the REAL processor on a disposable PostgreSQL
// with a scripted fake gateway (the model is never reached): a response whose
// reference does not support its claim publishes nothing; a supported
// matrix-backed claim publishes with the pinned revision; logistics answers
// draw on candidate preferences only (and list what is missing when there are
// none); an unreadable context is a retryable failure; the pinned context is
// loaded once per run; and an oversize device prompt is refused, not cut.
import type { AiExecutionRequest } from "@omnitech/ai-contracts";
import { liveActionSchema } from "@omnitech/interview-contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEVICE_MAX_PROMPT_BYTES } from "./assist-stage";
import { type Fixture, startFixture } from "./live-session-fixture";
import {
  buildProcessor,
  type CollectedTrace,
  collectTraces,
  createFakeGateway,
  seedBriefingDraft,
  seedMatrixProfile,
  settle,
  startSessionForPerson,
} from "./processor-fixture";
import { answer, blockJson, refFor } from "./replay-evidence-fixture";
import { CANDIDATE_PREFERENCES } from "./replay-fixture-matrix";
import { HAZARD_FIXTURES } from "./replay-fixtures-hazards";
import { ActiveSessionRepository } from "./repository";
import { RECRUITER_SCREEN } from "./session-replay-fixtures";

// biome-ignore lint/suspicious/noExplicitAny: JSON read back from the code under test; each assertion names the fields it checks
type Json = any;

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

// ---- scripting the model from what its prompt actually carries ------------

const output = answer;

// ---- a world: a person, optionally a pinned profile and a linked draft ---

async function world(
  name: string,
  options: {
    profile?: boolean | { sha256: string };
    preferences?: string;
    policy?: "device-only" | "permitted-remote";
    gateway?: ReturnType<typeof createFakeGateway>;
    options?: { maxAttempts?: number };
    wrapStore?: Parameters<typeof buildProcessor>[1]["wrapStore"];
  } = {},
) {
  const person = await fx.provision(fx.tenantA, name);
  const profile = options.profile
    ? await seedMatrixProfile(
        fx,
        fx.tenantA,
        person.id,
        typeof options.profile === "object"
          ? { sha256: options.profile.sha256 }
          : {},
      )
    : undefined;
  const workspaceDraft =
    profile && options.preferences !== undefined
      ? await seedBriefingDraft(fx, fx.tenantA, person.id, profile, {
          candidatePreferences: options.preferences,
        })
      : undefined;
  const started = await startSessionForPerson(
    fx,
    repo,
    fx.tenantA,
    person,
    options.policy ?? "permitted-remote",
    {
      ...(profile ? { profile: { id: profile.id } } : {}),
      ...(workspaceDraft ? { workspaceDraft } : {}),
    },
  );
  const trace: CollectedTrace = collectTraces();
  const gateway = options.gateway ?? createFakeGateway();
  const processor = buildProcessor(fx, {
    workerId: `worker-${name}`,
    gateway,
    trace,
    ...(options.options ? { options: options.options } : {}),
    ...(options.wrapStore ? { wrapStore: options.wrapStore } : {}),
  });
  cleanups.push(async () => {
    await processor.close();
    await repo.controlSession(started.scope, started.sessionId, "end");
  });
  const actions = () => repo.listActions(started.scope, started.sessionId);
  return { ...started, profile, gateway, processor, trace, actions };
}

const opening = () => RECRUITER_SCREEN[0]?.segments ?? [];
const notice = () =>
  HAZARD_FIXTURES["hazard-7d-notice-and-compensation"]?.phases ?? [];

describe("unsupported references", () => {
  it("drops a claim whose reference exists but does not support it, publishes the draft without it, and traces no text", async () => {
    const CANARY = "CANARY-UNSUPPORTED-CLAIM";
    const gateway = createFakeGateway({
      result: (request) =>
        output({
          category: "experience-story",
          claims: [
            {
              kind: "matrix-backed",
              text: `Owned the Kubernetes platform ${CANARY}`,
              // The entry exists and is quoted verbatim: it is about mentoring.
              refs: [
                refFor(
                  request,
                  "APPROVED EXPERIENCE",
                  "/roles/0/responsibilities/1",
                ),
              ],
            },
          ],
        }),
    });
    const w = await world("svc-unsupported", { profile: true, gateway });
    for (const segment of opening()) await w.ingestor.ingest(segment);
    await settle(w.processor);

    const stored = await w.actions();
    expect(stored).toHaveLength(1);
    // The unsupported claim is dropped and the draft is published without it
    // (grounding never withholds a draft): the browser reads the draft and no
    // evidence chip.
    expect(stored[0]).toMatchObject({
      dispatchStatus: "succeeded",
      result: { draft: "A short spoken outline.", claims: [], sections: [] },
    });
    const changes = await repo.listActionChanges(w.scope, w.sessionId, {
      limit: 50,
    });
    const wire = JSON.stringify(changes.actions);
    // No draft, claim or quote text, and no path, reaches the stream.
    expect(wire).not.toContain(CANARY);
    expect(wire).not.toContain("Kubernetes");
    expect(wire).not.toContain("claims.0");
    const parsed = changes.actions.map((action) =>
      liveActionSchema.parse(JSON.parse(JSON.stringify(action))),
    );
    expect(parsed[0]?.result).toMatchObject({ claims: [] });
    // Settled: the same revision is not retried.
    expect(gateway.requests).toHaveLength(1);
    expect(
      w.trace.events.some((event) => event.event === "dispatch.published"),
    ).toBe(true);
    expect(
      w.trace.events.find((event) => event.event === "dispatch.suppressed"),
    ).toBeUndefined();
    expect(JSON.stringify(w.trace.events)).not.toContain(CANARY);
    expect(JSON.stringify(stored)).not.toContain(CANARY);
  }, 60_000);

  it("publishes a supported matrix-backed claim with the pinned revision", async () => {
    const gateway = createFakeGateway({
      result: (request) =>
        output({
          category: "experience-story",
          draft: "Lead with the migration and its staged cutover.",
          claims: [
            {
              kind: "matrix-backed",
              text: "Led the migration of the order service from a document database to PostgreSQL",
              refs: [
                refFor(
                  request,
                  "APPROVED EXPERIENCE",
                  "/roles/0/responsibilities/0",
                ),
              ],
            },
            {
              kind: "general-knowledge",
              text: "A staged cutover keeps rollback cheap.",
              refs: [],
            },
          ],
        }),
    });
    const w = await world("svc-supported", { profile: true, gateway });
    for (const segment of opening()) await w.ingestor.ingest(segment);
    await settle(w.processor);

    const [action] = await w.actions();
    expect(action).toMatchObject({ dispatchStatus: "succeeded" });
    const result = action?.result as Record<string, Json>;
    expect(result).toMatchObject({
      version: 1,
      stage: "draft-answer",
      category: "experience-story",
      pinned: {
        profileId: w.profile?.id,
        revision: 1,
        sha256: w.profile?.sha256,
      },
      contextRevisions: { profile: 1, draft: null },
      meta: {
        processingPolicy: "permitted-remote",
        category: "experience-story",
        claimCounts: {
          "matrix-backed": 1,
          "general-knowledge": 1,
          "preference-backed": 0,
          "suggested-interpretation": 0,
          "not-in-matrix": 0,
        },
      },
    });
    // The earlier readers' shape is kept: {kind, text} sections, from the claims.
    expect(result["sections"]).toEqual([
      expect.objectContaining({ kind: "matrix-backed" }),
      expect.objectContaining({ kind: "general-knowledge" }),
    ]);
    expect(result["claims"][0].refs[0]).toMatchObject({
      pointer: "/roles/0/responsibilities/0",
      revision: 1,
    });

    // The published trace carries counts and codes only.
    const published = w.trace.events.find(
      (event) => event.event === "dispatch.published",
    );
    expect(published?.detail).toMatchObject({
      category: "experience-story",
      claims: 2,
      matrixBacked: 1,
      generalKnowledge: 1,
      profileRevision: 1,
    });
    expect(JSON.stringify(w.trace.events)).not.toContain("Led the migration");
  }, 60_000);

  it("records a coding category and owes a second solve-code action for the same revision", async () => {
    const gateway = createFakeGateway({
      result: () =>
        output({
          category: "coding",
          draft: "Restate the problem, then outline the approach.",
          codingBrief: {
            language: "typescript",
            restatement: "Find the first non-repeating character.",
            constraints: ["O(n) time"],
          },
        }),
    });
    const w = await world("svc-coding", { gateway });
    for (const segment of opening()) await w.ingestor.ingest(segment);
    await settle(w.processor);
    const stored = await w.actions();
    expect(stored.map((action) => action.actionKind)).toEqual([
      "draft-answer",
      "solve-code",
    ]);
    expect(stored[0]?.result).toMatchObject({
      category: "coding",
      codingBrief: { language: "typescript" },
    });
    // This scripted model answers the solution call in the prose-draft shape,
    // which the closed solution schema refuses: nothing is published for it.
    expect(stored[1]).toMatchObject({
      taskRevision: stored[0]?.taskRevision,
      dispatchStatus: "suppressed",
      suppressionReason: "invalid_output",
      result: null,
    });
  }, 60_000);
});

describe("what the model says it could not see", () => {
  it("is stored with the published draft, sanitised, and reaches the browser feed as display metadata", async () => {
    const kept = [
      { kind: "examples" },
      { kind: "constraints", note: "the limits are cut off" },
    ];
    const gateway = createFakeGateway({
      result: () =>
        output({
          category: "coding",
          draft: "Restate the problem, then outline the approach.",
          codingBrief: {
            language: "typescript",
            restatement: "Find the first non-repeating character.",
            constraints: [],
          },
          missingContext: [kept[0], { kind: "bogus" }, kept[1]],
        }),
    });
    const w = await world("svc-missing-context", { gateway });
    for (const segment of opening()) await w.ingestor.ingest(segment);
    await settle(w.processor);
    const stored = await w.actions();
    const draft = stored.find((action) => action.actionKind === "draft-answer");
    expect(draft?.result).toMatchObject({ missingContext: kept });
    const changes = await repo.listActionChanges(w.scope, w.sessionId, {
      limit: 50,
    });
    const onWire = changes.actions.find(
      (action) => action.actionKind === "draft-answer",
    );
    expect(
      liveActionSchema.parse(JSON.parse(JSON.stringify(onWire))),
    ).toMatchObject({ missingContext: kept });
    // Nothing branches on it: the same revision still owes its solution.
    expect(stored.map((action) => action.actionKind)).toContain("solve-code");
  }, 60_000);
});

describe("hazard 7d: notice period and compensation", () => {
  // The scripted model answers from preferences when its prompt carries them
  // and lists the field as missing when it does not.
  const noticeAnswer = (request: AiExecutionRequest) => {
    const preferences = blockJson(request.task.prompt, "CANDIDATE PREFERENCES");
    const isNotice = /notice/i.test(
      request.task.prompt.split("END CAPTURED")[0] ?? "",
    );
    const field = isNotice ? "notice-period" : "compensation";
    const pointer = isNotice
      ? "/context/candidatePreferences/0"
      : "/context/candidatePreferences/1";
    if (preferences.length === 0)
      return output({
        category: "logistics",
        draft: `Ask the candidate to supply their ${field}.`,
        logistics: { found: [], missing: [field] },
      });
    return output({
      category: "logistics",
      draft: isNotice
        ? "Give the notice period from your stated preference."
        : "Say you are open to a market range and would discuss it later.",
      claims: [
        {
          kind: "preference-backed",
          text: isNotice
            ? "Notice period is two weeks."
            : "Open to a range in line with market for the level.",
          refs: [refFor(request, "CANDIDATE PREFERENCES", pointer)],
        },
      ],
      logistics: { found: [{ field, claimIndex: 0 }], missing: [] },
    });
  };
  const askBoth = async (w: Awaited<ReturnType<typeof world>>) => {
    for (const phase of notice())
      for (const segment of phase.segments) await w.ingestor.ingest(segment);
    await settle(w.processor, 12);
  };

  it("draws notice period and compensation from the approved preferences when present", async () => {
    const gateway = createFakeGateway({ result: noticeAnswer });
    const w = await world("svc-7d-present", {
      profile: true,
      preferences: CANDIDATE_PREFERENCES,
      gateway,
    });
    await askBoth(w);

    const stored = await w.actions();
    expect(stored.map((action) => action.dispatchStatus)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    const [first, second] = stored.map(
      (action) => action.result as Record<string, Json>,
    );
    expect(first?.["category"]).toBe("logistics");
    expect(first?.["logistics"]).toEqual({
      found: [{ field: "notice-period", claimIndex: 0 }],
      missing: ["work-arrangement"],
    });
    expect(first?.["claims"][0].kind).toBe("preference-backed");
    expect(second?.["logistics"].found[0].field).toBe("compensation");
    expect(first?.["contextRevisions"].draft).toBe(4);
  }, 60_000);

  it("lists the fields as missing and states no figure when there are no preferences", async () => {
    const gateway = createFakeGateway({ result: noticeAnswer });
    const w = await world("svc-7d-absent", { profile: true, gateway });
    await askBoth(w);

    const stored = await w.actions();
    expect(stored.map((action) => action.dispatchStatus)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    const results = stored.map(
      (action) => action.result as Record<string, Json>,
    );
    expect(results[0]?.["logistics"]).toEqual({
      found: [],
      missing: ["notice-period", "compensation", "work-arrangement"],
    });
    expect(results[1]?.["logistics"]).toEqual({
      found: [],
      missing: ["notice-period", "compensation", "work-arrangement"],
    });
    for (const result of results) {
      expect(result["claims"]).toEqual([]);
      expect(`${result["draft"]}`).not.toMatch(/\d/);
    }
  }, 60_000);

  it("publishes nothing when the model invents a figure without preferences", async () => {
    const gateway = createFakeGateway({
      result: () =>
        output({
          category: "logistics",
          draft: "Say the notice period is 4 weeks.",
          claims: [
            {
              kind: "suggested-interpretation",
              text: "The notice period is 4 weeks.",
              refs: [],
            },
          ],
          logistics: { found: [], missing: [] },
        }),
    });
    const w = await world("svc-7d-invented", { profile: true, gateway });
    for (const segment of notice()[0]?.segments ?? [])
      await w.ingestor.ingest(segment);
    await settle(w.processor);
    expect(await w.actions()).toEqual([
      expect.objectContaining({
        dispatchStatus: "suppressed",
        suppressionReason: "invalid_output",
        // Withheld: the claim and the draft's text appear nowhere in the record.
        result: {
          withheld: {
            rejectedClaimCount: 1,
            codes: expect.arrayContaining(["ungrounded_logistics_figure"]),
          },
        },
      }),
    ]);
  }, 60_000);
});

describe("the pinned context", () => {
  it("is loaded once per run, however many tasks are answered", async () => {
    let loads = 0;
    const w = await world("svc-once", {
      profile: true,
      preferences: CANDIDATE_PREFERENCES,
      wrapStore: (store) => ({
        ...store,
        loadContext: (scope, sessionId) => {
          loads += 1;
          return store.loadContext(scope, sessionId);
        },
      }),
    });
    for (const phase of notice())
      for (const segment of phase.segments) await w.ingestor.ingest(segment);
    await settle(w.processor, 12);
    expect((await w.actions()).length).toBe(2);
    expect(loads).toBe(1);
  }, 60_000);

  it("is a retryable failure when it cannot be read or verified, with an id-only trace and no model call", async () => {
    const gateway = createFakeGateway();
    const w = await world("svc-unavailable", {
      // The recorded digest no longer matches the matrix.
      profile: { sha256: "d".repeat(64) },
      gateway,
      options: { maxAttempts: 2 },
    });
    for (const segment of opening()) await w.ingestor.ingest(segment);
    await settle(w.processor, 12);

    expect(gateway.requests).toHaveLength(0);
    const stored = await w.actions();
    expect(
      stored.map((action) => [action.attempt, action.dispatchStatus]),
    ).toEqual([
      [1, "failed"],
      [2, "failed"],
    ]);
    const failures = w.trace.events.filter(
      (event) => event.event === "dispatch.failed",
    );
    expect(failures.map((event) => event.outcome)).toEqual([
      "context_unavailable",
      "context_unavailable",
    ]);
    expect(JSON.stringify(w.trace.events)).not.toContain("Example Corp");
  }, 60_000);
});

describe("the device window", () => {
  it("refuses an oversize device prompt as prompt_too_large: settled, never truncated, no model call", async () => {
    const gateway = createFakeGateway();
    const w = await world("svc-device-big", {
      profile: true,
      policy: "device-only",
      gateway,
    });
    // Three-byte characters: the question alone outgrows the device window.
    const question = `${"字".repeat(3_990)}?`;
    await w.ingestor.ingest({
      eventId: "big-1",
      role: "interviewer",
      startMs: 0,
      endMs: 2_000,
      text: question,
    });
    await settle(w.processor, 12);

    expect(gateway.requests).toHaveLength(0);
    expect(await w.actions()).toEqual([
      expect.objectContaining({
        dispatchStatus: "suppressed",
        suppressionReason: "prompt_too_large",
        result: null,
      }),
    ]);
    const refusal = w.trace.events.find(
      (event) => event.outcome === "prompt_too_large",
    );
    expect(refusal?.byteCounts.input).toBeGreaterThan(DEVICE_MAX_PROMPT_BYTES);
    expect(JSON.stringify(w.trace.events)).not.toContain("字");
  }, 60_000);
});
