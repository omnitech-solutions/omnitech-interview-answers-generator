// E-A2 and E-A3: the synthetic replay sets driven through the REAL processor on
// a disposable PostgreSQL (real ingest, replay, core, fenced writes, claim
// verification) with a scripted fake engine. The model is never reached; its
// replies are closed-schema answers keyed by the question text the prompt
// actually carries, so each grounding hazard gets the response a model would
// plausibly give. The pinned profile is the synthetic matrix; notice period and
// compensation preferences arrive through a linked briefing draft.
//
// Each case is a named `it`; every set also records one stdout line of counts
// only (no spoken text, no draft text).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { INTERVIEW_ANSWER_PROFILE } from "../../assistant-profile";
import { LEAVING_REASON_PLACEHOLDER } from "./claims";
import {
  fakeRunner,
  isSolutionRequest,
  RESTATEMENT,
  revisionOf,
  solutionFor,
} from "./coding-fixture";
import {
  type AnyRow,
  type Fixture,
  startFixture,
} from "./live-session-fixture";
import {
  buildProcessor,
  type CollectedTrace,
  collectTraces,
  createFakeEngine,
  type FakeEngine,
  NEVER_ABORTED,
  type SessionAsk,
  seedBriefingDraft,
  seedMatrixProfile,
  settle,
  startSessionForPerson,
} from "./processor-fixture";
import type { SessionProcessorPorts } from "./processor-ports";
import {
  agentJobCount,
  answer,
  capturedText,
  protectedTableDigests,
  refFor,
} from "./replay-evidence-fixture";
import {
  ABSENT_FRAMEWORK,
  CANDIDATE_PREFERENCES,
  CANDIDATE_PREFERENCES_NONE,
} from "./replay-fixture-matrix";
import { ALL_REPLAY_SETS } from "./replay-fixture-sets";
import { LIVE_CODING_EXPECT } from "./replay-fixtures-coding";
import {
  HAZARD_FIXTURES,
  type ReplayFixtureSet,
} from "./replay-fixtures-hazards";
import { MANAGER_FIXTURE } from "./replay-fixtures-manager";
import { ActiveSessionRepository } from "./repository";
import { createDatabaseStorePort } from "./session-ports";
import type { ReplayPhase } from "./session-replay-fixtures";
import type { SessionCodeRunner } from "./session-run";

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

// ---- a world: a person, the pinned synthetic matrix, optional preferences ---

type WorldOptions = {
  // Pin the synthetic matrix as the session's profile.
  profile?: boolean;
  // Link a briefing draft carrying these candidate preferences (the one
  // approved source of notice period and compensation).
  preferences?: string;
  engine?: FakeEngine;
  codeRunner?: SessionCodeRunner;
};

async function world(name: string, options: WorldOptions = {}) {
  const person = await fx.provision(fx.tenantA, name);
  const profile = options.profile
    ? await seedMatrixProfile(fx, fx.tenantA, person.id)
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
    "permitted-remote",
    {
      ...(profile ? { profile: { id: profile.id } } : {}),
      ...(workspaceDraft ? { workspaceDraft } : {}),
    },
  );
  const trace: CollectedTrace = collectTraces();
  const engine = options.engine ?? createFakeEngine();
  const processor = buildProcessor(fx, {
    workerId: `worker-${name}`,
    engine,
    trace,
    ...(options.codeRunner ? { codeRunner: options.codeRunner } : {}),
  });
  cleanups.push(async () => {
    engine.releaseAll();
    await processor.close();
    await repo.controlSession(started.scope, started.sessionId, "end");
  });
  const actions = () => repo.listActions(started.scope, started.sessionId);
  return { ...started, profile, engine, processor, trace, actions };
}
type World = Awaited<ReturnType<typeof world>>;

// Streams a set through the real ingest path one segment at a time, letting
// the processor settle after each (a live call: an answer is produced as soon
// as the question's utterance is complete, then a follow-up revises it).
async function replay(w: World, phases: readonly ReplayPhase[]) {
  for (const phase of phases)
    for (const segment of phase.segments) {
      await w.ingestor.ingest(segment);
      await settle(w.processor);
    }
}
const segmentsOf = (set: { phases: readonly ReplayPhase[] }) =>
  set.phases.flatMap((phase) => phase.segments);

const hazard = (name: keyof typeof HAZARD_FIXTURES): ReplayFixtureSet => {
  const set = HAZARD_FIXTURES[name];
  if (!set) throw new Error(`no fixture ${String(name)}`);
  return set;
};

// The result of the highest revision of each task that published one.
async function currentResults(w: World) {
  const byTask = new Map<string, AnyRow>();
  for (const action of await w.actions())
    if (action.actionKind === "draft-answer" && action.result !== null)
      byTask.set(action.taskId, action.result);
  return byTask;
}

// Counts only: nothing here is spoken text or a draft.
async function report(
  setName: string,
  w: World,
  set: { phases: readonly ReplayPhase[] },
) {
  const stored = await w.actions();
  const snapshot = w.processor.snapshot(w.sessionId);
  process.stdout.write(
    `REPLAY ${JSON.stringify({
      set: setName,
      segments: segmentsOf(set).length,
      tasks: snapshot?.tasks.length ?? 0,
      finalRevisions: snapshot?.tasks.map((task) => task.revision) ?? [],
      deferred: snapshot?.deferred.length ?? 0,
      modelCalls: w.engine.requests.length,
      published: stored.filter((action) => action.result !== null).length,
      rejected: stored.filter(
        (action) => action.suppressionReason === "invalid_output",
      ).length,
    })}\n`,
  );
}

// ---- E-A1/E-A2: every set, one logical task per question --------------------

describe("every replay set through the real processor", () => {
  const sets = Object.entries(ALL_REPLAY_SETS).filter(
    (entry): entry is [string, ReplayFixtureSet] => "expect" in entry[1],
  );
  it.each(sets)(
    "%s: opens the tasks and revisions the fixture states and no call for an inert segment",
    async (name, set) => {
      const w = await world(`evidence-${name}`.slice(0, 40));
      await replay(w, set.phases);

      const snapshot = w.processor.snapshot(w.sessionId);
      expect(snapshot?.tasks.map((task) => task.revision)).toEqual([
        ...set.expect.revisions,
      ]);
      expect(snapshot?.tasks).toHaveLength(set.expect.opensTasks);
      expect(snapshot?.deferred).toHaveLength(set.expect.deferredTopics);
      // Only the latest revision of each task is current; the rest outdated.
      for (const task of snapshot?.tasks ?? []) {
        expect(task.standing[task.revision]).toBe("current");
        for (let revision = 1; revision < task.revision; revision += 1)
          expect(task.standing[revision]).toBe("outdated");
      }
      // A call is made only for a task revision: one engine request per
      // recorded action, and none of them carries an inert segment.
      const stored = await w.actions();
      expect(w.engine.requests).toHaveLength(stored.length);
      const inert = new Set(set.expect.inertEventIds);
      const inertTexts = segmentsOf(set)
        .filter((segment) => inert.has(segment.eventId))
        .map((segment) => segment.text);
      for (const request of w.engine.requests)
        for (const text of inertTexts)
          expect(capturedText(request)).not.toContain(text);
      await report(name, w, set);
    },
    120_000,
  );
});

// ---- (a) backchannel and monologue only ---------------------------------------

describe("(a) backchannel and monologue only", () => {
  it("opens no task and makes no engine call", async () => {
    const set = hazard("backchannel-and-monologue-only");
    const w = await world("evidence-a");
    await replay(w, set.phases);
    const snapshot = w.processor.snapshot(w.sessionId);
    expect(snapshot?.tasks).toEqual([]);
    expect(snapshot?.deferred).toEqual([]);
    expect(w.engine.requests).toHaveLength(0);
    expect(await w.actions()).toEqual([]);
    await report("backchannel-and-monologue-only", w, set);
  }, 60_000);
});

// ---- (b) compound question, part two, deferred topic -------------------------

describe("(b) one logical task per question", () => {
  it("raises the compound question's task to revision 2 on part two and answers each revision once", async () => {
    const set = hazard("compound-question-with-part-two");
    const w = await world("evidence-b1");
    await replay(w, set.phases);

    expect(w.processor.snapshot(w.sessionId)?.tasks).toEqual([
      {
        taskId: expect.any(String),
        revision: 2,
        standing: { 1: "outdated", 2: "current" },
      },
    ]);
    const stored = await w.actions();
    expect(
      stored.map((action) => [
        action.taskRevision,
        action.actionKind,
        action.dispatchStatus,
      ]),
    ).toEqual([
      [1, "draft-answer", "succeeded"],
      [2, "draft-answer", "succeeded"],
    ]);
    // The candidate's long answer between the two utterances revised nothing.
    expect(w.engine.requests).toHaveLength(2);
    await report("compound-question-with-part-two", w, set);
  }, 60_000);

  it("keeps a deferred topic in task state and opens no task for it", async () => {
    const set = hazard("deferred-topic");
    const w = await world("evidence-b2");
    await replay(w, set.phases);
    const snapshot = w.processor.snapshot(w.sessionId);
    expect(snapshot?.deferred).toHaveLength(1);
    expect(snapshot?.tasks.map((task) => task.revision)).toEqual([1]);
    expect(w.engine.requests).toHaveLength(1);
    await report("deferred-topic", w, set);
  }, 60_000);
});

// ---- (c) ASR correction ---------------------------------------------------------

describe("(c) an ASR correction supersedes", () => {
  it("marks the answer built on the earlier segment stale, never edits it, and answers the corrected text", async () => {
    const set = hazard("asr-error-and-correction");
    const w = await world("evidence-c");
    const [first, second, correction] =
      set.phases[0]?.segments ?? ([] as never[]);
    if (!first || !second || !correction) throw new Error("fixture shape");

    await w.ingestor.ingest(first);
    await settle(w.processor);
    const before = (await w.actions())[0];
    expect(before?.dispatchStatus).toBe("succeeded");
    await w.ingestor.ingest(second);
    await settle(w.processor);
    await w.ingestor.ingest(correction);
    await settle(w.processor);

    const task = w.processor.snapshot(w.sessionId)?.tasks[0];
    expect(task?.revision).toBe(2);
    expect(task?.standing).toEqual({ 1: "outdated", 2: "current" });
    // Stale, not edited: the earlier action is exactly as it was published.
    const after = await w.actions();
    expect(after[0]).toMatchObject({
      taskRevision: 1,
      dispatchStatus: "succeeded",
      result: before?.result,
    });
    expect(after[1]).toMatchObject({
      taskRevision: 2,
      dispatchStatus: "succeeded",
    });
    // The corrected question reaches the model; the misheard words do not.
    const revisionTwo = w.engine.requests[1] as SessionAsk;
    expect(capturedText(revisionTwo)).toContain("npm audit");
    expect(capturedText(revisionTwo)).not.toContain("and PM audit");

    // The other two corrections of the set behave the same way.
    for (const phase of set.phases.slice(1))
      for (const segment of phase.segments) {
        await w.ingestor.ingest(segment);
        await settle(w.processor);
      }
    expect(
      w.processor
        .snapshot(w.sessionId)
        ?.tasks.map((t) => [t.revision, t.standing]),
    ).toEqual(
      [1, 2, 3].map(() => [2, { 1: "outdated", 2: "current" }] as const),
    );
    await report("asr-error-and-correction", w, set);
  }, 90_000);
});

// ---- (d) hazard 7a: a framework the matrix lacks ------------------------------

describe("(d) hazard 7a: an affirmation the approved matrix lacks", () => {
  const set = hazard("hazard-7a-unsupported-framework");

  it("labels the framework claim not-in-matrix, publishes the section and leaves the matrix as it was", async () => {
    const engine = createFakeEngine({
      result: (request) =>
        answer({
          category: "experience-story",
          draft: `Say you have not used ${ABSENT_FRAMEWORK} hands-on; offer the Node and React work instead.`,
          claims: [
            {
              kind: "not-in-matrix",
              text: `Hands-on ${ABSENT_FRAMEWORK} experience is not in the approved experience.`,
              refs: [],
            },
            {
              kind: "matrix-backed",
              text: "Built a React dashboard and the Node API behind it",
              refs: [
                refFor(
                  request,
                  "APPROVED EXPERIENCE",
                  "/roles/1/responsibilities/0",
                ),
              ],
            },
          ],
        }),
    });
    const w = await world("evidence-d1", { profile: true, engine });
    const before = await protectedTableDigests(fx);
    await replay(w, set.phases);

    const [stored] = await w.actions();
    expect(stored).toMatchObject({ dispatchStatus: "succeeded" });
    const result = stored?.result as AnyRow;
    expect(result.sections).toEqual([
      expect.objectContaining({ kind: "not-in-matrix" }),
      expect.objectContaining({ kind: "matrix-backed" }),
    ]);
    expect(result.meta.claimCounts["not-in-matrix"]).toBe(1);
    // Labelled and never promoted: the approved matrix and every catalogue
    // table are byte for byte what they were, and the framework is not in it.
    expect(await protectedTableDigests(fx)).toEqual(before);
    const matrix = await fx.owner.query(
      "SELECT matrix::text AS m FROM interview.candidate_profile_revisions WHERE id=$1",
      [w.profile?.id],
    );
    expect(matrix.rows[0].m).not.toContain(ABSENT_FRAMEWORK);
    await report("hazard-7a-unsupported-framework", w, set);
  }, 60_000);

  it("drops the same claim stated as matrix-backed with a real but unsupporting reference and publishes the draft without it", async () => {
    const engine = createFakeEngine({
      result: (request) =>
        answer({
          category: "experience-story",
          draft: `Say you used ${ABSENT_FRAMEWORK} in the last projects.`,
          claims: [
            {
              kind: "matrix-backed",
              text: `Used ${ABSENT_FRAMEWORK} in the last two or three projects`,
              // A real entry, quoted verbatim, that says nothing about it.
              refs: [
                refFor(
                  request,
                  "APPROVED EXPERIENCE",
                  "/roles/0/technologies/0",
                ),
              ],
            },
          ],
        }),
    });
    const w = await world("evidence-d2", { profile: true, engine });
    const before = await protectedTableDigests(fx);
    await replay(w, set.phases);

    const stored = await w.actions();
    expect(stored).toHaveLength(1);
    // The unsupported claim is dropped and the spoken draft is published
    // without it (grounding never withholds a draft): no evidence chip ever
    // presents the absent framework as matrix-backed.
    expect(stored[0]).toMatchObject({
      dispatchStatus: "succeeded",
      result: { claims: [], sections: [] },
    });
    expect((stored[0]?.result as { claims: unknown[] } | null)?.claims).toEqual(
      [],
    );
    expect(JSON.stringify(w.trace.events)).not.toContain(ABSENT_FRAMEWORK);
    expect(await protectedTableDigests(fx)).toEqual(before);
  }, 60_000);
});

// ---- (e) hazard 7b: a metric stated aloud ---------------------------------------

describe("(e) hazard 7b: a spoken metric is not a fact", () => {
  const set = hazard("hazard-7b-unsupported-metric");
  const SPOKEN = "70 percent";

  const rejectedAs = async (name: string, claim: Record<string, unknown>) => {
    const engine = createFakeEngine({
      result: (request) =>
        answer({
          category: "experience-story",
          draft: "Describe the performance project and what was measured.",
          claims: [
            typeof claim["refs"] === "function"
              ? {
                  ...claim,
                  refs: (claim["refs"] as (request: unknown) => unknown)(
                    request,
                  ),
                }
              : claim,
          ],
        }),
    });
    const w = await world(name, { profile: true, engine });
    await replay(w, set.phases);
    const stored = await w.actions();
    expect(stored).toHaveLength(1);
    // The claim carrying the spoken figure is dropped; the draft (which says
    // no figure) is published without it, and no trace repeats the figure.
    expect(stored[0]).toMatchObject({
      dispatchStatus: "succeeded",
      result: {
        claims: [],
        draft: "Describe the performance project and what was measured.",
      },
    });
    expect(JSON.stringify(w.trace.events)).not.toContain(SPOKEN);
    return JSON.stringify(stored[0]?.result);
  };

  it("drops the spoken figure stated as fact in every claim kind that can carry it", async () => {
    expect(
      await rejectedAs("evidence-e1", {
        kind: "matrix-backed",
        text: `Cut the order query p95 latency by ${SPOKEN}`,
        refs: (request: SessionAsk) => [
          refFor(request, "APPROVED EXPERIENCE", "/roles/0/metrics/0/label"),
        ],
      }),
    ).not.toContain(SPOKEN);
    expect(
      await rejectedAs("evidence-e2", {
        kind: "suggested-interpretation",
        text: `We cut the processing cost by ${SPOKEN}`,
        refs: [],
      }),
    ).not.toContain(SPOKEN);
    expect(
      await rejectedAs("evidence-e3", {
        kind: "not-in-matrix",
        text: `Processing cost fell by ${SPOKEN}`,
        refs: [],
      }),
    ).not.toContain(SPOKEN);
  }, 120_000);

  it("accepts the matrix's own metric, with its label and value cited", async () => {
    const engine = createFakeEngine({
      result: (request) =>
        answer({
          category: "experience-story",
          draft: "Lead with the migration and the measured latency change.",
          claims: [
            {
              kind: "matrix-backed",
              text: "Order query p95 latency was 40% lower after the PostgreSQL migration",
              refs: [
                refFor(
                  request,
                  "APPROVED EXPERIENCE",
                  "/roles/0/metrics/0/label",
                ),
                refFor(
                  request,
                  "APPROVED EXPERIENCE",
                  "/roles/0/metrics/0/value",
                ),
              ],
            },
          ],
        }),
    });
    const w = await world("evidence-e4", { profile: true, engine });
    await replay(w, set.phases);
    const [stored] = await w.actions();
    expect(stored).toMatchObject({ dispatchStatus: "succeeded" });
    expect((stored!.result as AnyRow).meta.claimCounts["matrix-backed"]).toBe(
      1,
    );
    await report("hazard-7b-unsupported-metric", w, set);
  }, 60_000);
});

// ---- (f) hazard 7c: leaving the current and a previous role ---------------------

describe("(f) hazard 7c: leaving a role", () => {
  const set = hazard("hazard-7c-leaving-roles");

  it("backs employer and dates with the matrix and leaves the reason as a placeholder", async () => {
    const engine = createFakeEngine({
      result: (request) =>
        answer({
          category: "leaving-role",
          draft: `Name the roles and dates only. ${LEAVING_REASON_PLACEHOLDER}`,
          claims: [
            {
              kind: "matrix-backed",
              text: "Worked at Example Corp as a Senior software engineer from 2021 to present",
              refs: [
                refFor(request, "APPROVED EXPERIENCE", "/roles/0/company"),
                refFor(request, "APPROVED EXPERIENCE", "/roles/0/title"),
                refFor(request, "APPROVED EXPERIENCE", "/roles/0/period"),
              ],
            },
            {
              kind: "suggested-interpretation",
              text: LEAVING_REASON_PLACEHOLDER,
              refs: [],
            },
          ],
        }),
    });
    const w = await world("evidence-f1", { profile: true, engine });
    await replay(w, set.phases);
    const [stored] = await w.actions();
    expect(stored).toMatchObject({ dispatchStatus: "succeeded" });
    const result = stored?.result as AnyRow;
    expect(result.category).toBe("leaving-role");
    expect(result.draft).toContain(LEAVING_REASON_PLACEHOLDER);
    // Employer and dates are matrix-backed; the only other claim is the
    // placeholder, never a generated reason.
    expect(
      result.claims.map((claim: AnyRow) => [claim.kind, claim.text]),
    ).toEqual([
      ["matrix-backed", expect.stringContaining("Example Corp")],
      ["suggested-interpretation", LEAVING_REASON_PLACEHOLDER],
    ]);
    await report("hazard-7c-leaving-roles", w, set);
  }, 60_000);

  it("drops a disparaging sentence and a generated reason: the published draft keeps only the placeholder, with no claims", async () => {
    const disparaging = createFakeEngine({
      result: () =>
        answer({
          category: "leaving-role",
          draft: `My last manager was incompetent. ${LEAVING_REASON_PLACEHOLDER}`,
          claims: [
            {
              kind: "suggested-interpretation",
              text: "My last manager was incompetent and the team was a mess",
              refs: [],
            },
          ],
        }),
    });
    const w = await world("evidence-f2", {
      profile: true,
      engine: disparaging,
    });
    await replay(w, set.phases);
    const stored = await w.actions();
    expect(stored).toHaveLength(1);
    // The disparaging sentence is subtracted from the draft and its claim is
    // dropped; what is published is the placeholder alone.
    expect(stored[0]).toMatchObject({
      dispatchStatus: "succeeded",
      result: { claims: [] },
    });
    const published = stored[0]?.result as AnyRow;
    expect(published.draft).toContain(LEAVING_REASON_PLACEHOLDER);
    expect(published.draft).not.toContain("incompetent");
    expect(JSON.stringify(stored)).not.toContain("incompetent");
    expect(JSON.stringify(w.trace.events)).not.toContain("incompetent");

    const invented = createFakeEngine({
      result: () =>
        answer({
          category: "leaving-role",
          draft: `Say you wanted growth. ${LEAVING_REASON_PLACEHOLDER}`,
          claims: [
            {
              kind: "suggested-interpretation",
              text: "Wanted more growth and a new challenge",
              refs: [],
            },
          ],
        }),
    });
    const second = await world("evidence-f3", {
      profile: true,
      engine: invented,
    });
    await replay(second, set.phases);
    const [invent] = await second.actions();
    expect(invent).toMatchObject({
      dispatchStatus: "succeeded",
      result: { claims: [] },
    });
    const draft = (invent?.result as AnyRow | undefined)?.draft as string;
    expect(draft).toContain(LEAVING_REASON_PLACEHOLDER);
    expect(draft).not.toContain("growth");
  }, 90_000);
});

// ---- (g) hazard 7d: notice period and compensation -------------------------------

describe("(g) hazard 7d: logistics drawn only from approved preferences", () => {
  const set = hazard("hazard-7d-notice-and-compensation");
  const isNotice = (request: SessionAsk) =>
    /notice/i.test(capturedText(request));

  // The scripted model answers from the preferences its prompt carries.
  const faithful = (request: SessionAsk) => {
    const field = isNotice(request) ? "notice-period" : "compensation";
    const pointer = isNotice(request)
      ? "/context/candidatePreferences/0"
      : "/context/candidatePreferences/1";
    const present = request.prompt.includes(pointer);
    if (!present)
      return answer({
        category: "logistics",
        draft: `Ask the candidate to supply their ${field}.`,
        logistics: { found: [], missing: [field] },
      });
    return answer({
      category: "logistics",
      draft: isNotice(request)
        ? "Give the notice period from your stated preference."
        : "Say you are open to a market range and would discuss it later.",
      claims: [
        {
          kind: "preference-backed",
          text: isNotice(request)
            ? "Notice period is two weeks."
            : "Open to a range in line with market for the level.",
          refs: [refFor(request, "CANDIDATE PREFERENCES", pointer)],
        },
      ],
      logistics: { found: [{ field, claimIndex: 0 }], missing: [] },
    });
  };

  it("draws both fields only from the linked draft's candidate preferences", async () => {
    const w = await world("evidence-g1", {
      profile: true,
      preferences: CANDIDATE_PREFERENCES,
      engine: createFakeEngine({ result: faithful }),
    });
    await replay(w, set.phases);
    const results = [...(await currentResults(w)).values()];
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.category).toBe("logistics");
      expect(result.logistics.missing).toEqual(["work-arrangement"]);
      for (const claim of result.claims) {
        expect(claim.kind).toBe("preference-backed");
        for (const ref of claim.refs)
          expect(ref.pointer).toMatch(/^\/context\/candidatePreferences\//);
      }
    }
    // The preferences carry no amount, and neither does either draft.
    expect(results.map((result) => result.logistics.found[0].field)).toEqual([
      "notice-period",
      "compensation",
    ]);
    await report("hazard-7d-notice-and-compensation", w, set);
  }, 60_000);

  it("lists notice period and compensation as missing when no preferences are supplied", async () => {
    const w = await world("evidence-g2", {
      profile: true,
      preferences: CANDIDATE_PREFERENCES_NONE,
      engine: createFakeEngine({ result: faithful }),
    });
    await replay(w, set.phases);
    const results = [...(await currentResults(w)).values()];
    expect(results.map((result) => result.logistics)).toEqual([
      {
        found: [],
        missing: ["notice-period", "compensation", "work-arrangement"],
      },
      {
        found: [],
        missing: ["notice-period", "compensation", "work-arrangement"],
      },
    ]);
    for (const result of results) {
      expect(result.claims).toEqual([]);
      expect(`${result.draft}`).not.toMatch(/\d/);
    }
  }, 60_000);

  it("rejects a generated figure, with or without preferences", async () => {
    const generated = createFakeEngine({
      result: () =>
        answer({
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
    const absent = await world("evidence-g3", {
      profile: true,
      preferences: CANDIDATE_PREFERENCES_NONE,
      engine: generated,
    });
    await replay(absent, set.phases.slice(0, 1));
    expect((await absent.actions())[0]).toMatchObject({
      dispatchStatus: "suppressed",
      suppressionReason: "invalid_output",
      result: {
        withheld: expect.objectContaining({ codes: expect.any(Array) }),
      },
    });

    // With preferences, a figure the preference does not state is no better.
    const altered = createFakeEngine({
      result: (request) =>
        answer({
          category: "logistics",
          draft: "Say the notice period is 4 weeks.",
          claims: [
            {
              kind: "preference-backed",
              text: "Notice period is 4 weeks.",
              refs: [
                refFor(
                  request,
                  "CANDIDATE PREFERENCES",
                  "/context/candidatePreferences/0",
                ),
              ],
            },
          ],
          logistics: {
            found: [{ field: "notice-period", claimIndex: 0 }],
            missing: [],
          },
        }),
    });
    const present = await world("evidence-g4", {
      profile: true,
      preferences: CANDIDATE_PREFERENCES,
      engine: altered,
    });
    await replay(present, set.phases.slice(0, 1));
    const [stored] = await present.actions();
    expect(stored).toMatchObject({
      dispatchStatus: "suppressed",
      suppressionReason: "invalid_output",
      result: {
        withheld: expect.objectContaining({ codes: expect.any(Array) }),
      },
    });
    expect(
      present.trace.events.find(
        (event) => event.event === "dispatch.suppressed",
      )?.detail?.["firstViolation"],
    ).toBe("claims.0.refs.0:unsupported_reference");
  }, 90_000);
});

// ---- (h) engineering-manager set: leadership STAR, distinct from technical -----

describe("(h) engineering-manager set", () => {
  const TECHNICAL = "How does a staged cutover differ from a big bang switch?";

  // Leadership answers built only from what the matrix holds; a theme the
  // matrix does not cover has every STAR element listed as missing.
  const star = (
    request: SessionAsk,
    claims: Array<{ text: string; pointers: string[] }>,
    elements: Partial<
      Record<"situation" | "task" | "action" | "result", [string, number]>
    >,
  ) => {
    const empty = { text: "", claimIndexes: [] as number[] };
    const names = ["situation", "task", "action", "result"] as const;
    return answer({
      category: "leadership-behavioural",
      draft: "Walk through the story in order, using only the cited facts.",
      claims: claims.map((claim) => ({
        kind: "matrix-backed",
        text: claim.text,
        refs: claim.pointers.map((pointer) =>
          refFor(request, "APPROVED EXPERIENCE", pointer),
        ),
      })),
      star: {
        ...Object.fromEntries(
          names.map((name) => {
            const element = elements[name];
            return [
              name,
              element
                ? { text: element[0], claimIndexes: [element[1]] }
                : empty,
            ];
          }),
        ),
        missing: names.filter((name) => !elements[name]),
      },
    });
  };
  const managerModel = (request: SessionAsk) => {
    const spoken = capturedText(request);
    if (spoken.includes(TECHNICAL))
      return answer({
        category: "technical-concept",
        draft: "Contrast the two: risk spread over steps against one switch.",
        claims: [
          {
            kind: "general-knowledge",
            text: "A staged cutover spreads risk over several small steps and keeps rollback cheap.",
            refs: [],
          },
        ],
      });
    if (/migrat|technical direction/i.test(spoken))
      return star(
        request,
        [
          {
            text: "Led the migration of the order service from a document database to PostgreSQL",
            pointers: ["/roles/0/responsibilities/0"],
          },
          {
            text: "Ran the migration retrospective and shared the runbook",
            pointers: ["/roles/0/leadership_signals/1"],
          },
          {
            text: "Order query p95 latency was 40% lower after the PostgreSQL migration",
            pointers: ["/roles/0/metrics/0/label", "/roles/0/metrics/0/value"],
          },
        ],
        {
          situation: ["The order service moved off a document database", 0],
          task: ["Own the migration for the team", 0],
          action: ["Ran the retrospective and shared the runbook", 1],
          result: ["Order query latency was 40 percent lower", 2],
        },
      );
    if (/mentor|junior/i.test(spoken))
      return star(
        request,
        [
          {
            text: "Mentored three junior developers through weekly pairing and code review",
            pointers: ["/roles/0/responsibilities/1"],
          },
        ],
        // The matrix holds no measured outcome of the mentoring: result missing.
        {
          // Each element only restates what its cited entry says (fix round 1:
          // element text is verified against the cited quotes).
          situation: ["Three junior developers were mentored", 0],
          task: ["Mentor the junior developers through code review", 0],
          action: ["Weekly pairing and code review", 0],
        },
      );
    return star(request, [], {});
  };

  it("drafts source-backed STAR answers, lists missing elements, and keeps them apart from a technical answer", async () => {
    const w = await world("evidence-h", {
      profile: true,
      engine: createFakeEngine({ result: managerModel }),
    });
    await replay(w, MANAGER_FIXTURE.phases);
    // A technical-concept question in the same session.
    await w.ingestor.ingest({
      eventId: "mgr-technical",
      role: "interviewer",
      startMs: 600_000,
      endMs: 603_000,
      text: TECHNICAL,
    });
    await settle(w.processor);

    const results = [...(await currentResults(w)).values()];
    expect(results).toHaveLength(10);
    const leadership = results.filter(
      (result) => result.category === "leadership-behavioural",
    );
    const technical = results.filter(
      (result) => result.category === "technical-concept",
    );
    // Category separation across the set: nine leadership drafts carry a STAR
    // outline, the technical answer carries none and no leadership category.
    expect(leadership).toHaveLength(9);
    expect(technical).toHaveLength(1);
    expect(technical[0]?.star).toBeNull();
    expect(technical[0]?.claims.map((claim: AnyRow) => claim.kind)).toEqual([
      "general-knowledge",
    ]);
    for (const result of leadership) expect(result.star).not.toBeNull();

    const elements = ["situation", "task", "action", "result"] as const;
    let complete = 0;
    let partial = 0;
    let none = 0;
    for (const result of leadership) {
      const outline = result.star as AnyRow;
      for (const element of elements) {
        if (outline.missing.includes(element)) {
          // Missing is listed, not invented.
          expect(outline[element]).toEqual({ text: "", claimIndexes: [] });
          continue;
        }
        // Each STAR element cites at least one matrix-backed claim whose
        // references point into the approved matrix.
        const cited = outline[element].claimIndexes.map(
          (index: number) => result.claims[index],
        );
        expect(cited.length).toBeGreaterThan(0);
        expect(
          cited.some((claim: AnyRow) => claim.kind === "matrix-backed"),
        ).toBe(true);
        for (const claim of cited)
          for (const ref of claim.refs)
            expect(ref.pointer).toMatch(/^\/roles\/\d+\//);
      }
      if (outline.missing.length === 0) complete += 1;
      else if (outline.missing.length === elements.length) none += 1;
      else partial += 1;
    }
    expect([complete > 0, partial > 0, none > 0]).toEqual([true, true, true]);
    await report("engineering-manager", w, MANAGER_FIXTURE);
  }, 180_000);
});

// ---- (i) live coding: constraint changes on one task -----------------------------

describe("(i) live coding with a mid-exercise constraint change", () => {
  const proseFor = (request: SessionAsk) => ({
    category: "coding",
    draft: "Restate the problem, then outline the approach.",
    claims: [],
    star: null,
    logistics: null,
    codingBrief: {
      language: "typescript",
      restatement: RESTATEMENT,
      constraints: [
        ...(LIVE_CODING_EXPECT.revisions[revisionOf(request) - 1]
          ?.constraints ?? []),
      ],
    },
  });
  // Records every method the processor calls on the runner, to show it uses
  // the sandboxed test runner and nothing else.
  const recordedRunner = () => {
    const base = fakeRunner();
    const used: string[] = [];
    const runner: SessionCodeRunner = {
      runAll: async (input) => {
        used.push("runAll");
        return base.runAll(input);
      },
      checkSyntax: async () => {
        used.push("checkSyntax");
        return base.checkSyntax();
      },
    };
    return { runner, used };
  };
  const draftRows = async (w: World) =>
    (
      await fx.owner.query(
        "SELECT workspace_id, artifact_id, revision, value FROM interview.assistant_drafts WHERE actor_id=$1",
        [w.person.id],
      )
    ).rows as AnyRow[];

  it("supersedes the earlier solution on ONE task and publishes the final revision's solution to the session-owned draft", async () => {
    // The revision-2 solution call is held while revisions 3 and 4 arrive.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached = false;
    const inner = createFakeEngine({
      result: (request) =>
        isSolutionRequest(request) ? solutionFor(request) : proseFor(request),
      // The held answer arrives late, after its revision was replaced.
      answersAfterCancel: true,
    });
    // Every call goes through the engine's `answer`, so the wrap is put on
    // the engine itself.
    const engine = inner;
    const answered = inner.answer;
    engine.answer = async (request) => {
      if (
        request.profileId === INTERVIEW_ANSWER_PROFILE &&
        revisionOf(request) === 2
      ) {
        reached = true;
        await gate;
      }
      return answered(request);
    };
    const { runner, used } = recordedRunner();
    const w = await world("evidence-i1", { engine, codeRunner: runner });
    const [stating, burst, instances, bucket] = ALL_REPLAY_SETS["live-coding"]!
      .phases as readonly ReplayPhase[];
    const before = await protectedTableDigests(fx);

    // Revision 1: stated, answered and solved.
    await replay(w, [stating as ReplayPhase]);
    expect(
      (await w.actions()).map((a) => [
        a.taskRevision,
        a.actionKind,
        a.dispatchStatus,
      ]),
    ).toEqual([
      [1, "draft-answer", "succeeded"],
      [1, "solve-code", "succeeded"],
    ]);

    // Revision 2 reaches its held solution call; revisions 3 and 4 arrive.
    for (const segment of (burst as ReplayPhase).segments)
      await w.ingestor.ingest(segment);
    for (let i = 0; i < 60 && !reached; i += 1) {
      await w.processor.tick(NEVER_ABORTED);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(reached).toBe(true);
    for (const phase of [instances, bucket] as ReplayPhase[])
      for (const segment of phase.segments) await w.ingestor.ingest(segment);
    for (let i = 0; i < 6; i += 1) await w.processor.tick(NEVER_ABORTED);
    release();
    // The held call finishes (and is suppressed as stale) before the next
    // revision is dispatched; settle only returns on an idle tick, so wait.
    await w.processor.idle();
    await settle(w.processor, 20);
    await settle(w.processor, 20);

    // ONE task, revision 4, every earlier revision outdated.
    expect(w.processor.snapshot(w.sessionId)?.tasks).toEqual([
      {
        taskId: expect.any(String),
        revision: 4,
        standing: { 1: "outdated", 2: "outdated", 3: "outdated", 4: "current" },
      },
    ]);
    const solves = (await w.actions()).filter(
      (action) => action.actionKind === "solve-code",
    );
    expect(solves.map((a) => [a.taskRevision, a.dispatchStatus])).toEqual([
      [1, "succeeded"],
      [2, "suppressed"],
      [4, "succeeded"],
    ]);
    // The earlier solution's late result was suppressed, not published.
    expect(solves[1]).toMatchObject({
      suppressionReason: "revision_stale",
      result: null,
    });
    // The final revision's solution replaces the first in the one session-owned
    // draft; neither the suppressed solution's code nor any other draft exists.
    const final = solves[2]?.result as AnyRow;
    expect(final.replacesRevision).toBe(1);
    expect(final.workspace).toMatchObject({
      published: true,
      workspaceId: `active-session:${w.sessionId}`,
    });
    const rows = await draftRows(w);
    expect(rows.map((row) => row.workspace_id)).toEqual([
      `active-session:${w.sessionId}`,
    ]);
    expect(rows[0]?.value.answer.code).toContain("CODE-CANARY-4");
    expect(JSON.stringify(rows)).not.toContain("CODE-CANARY-1");
    expect(JSON.stringify(rows)).not.toContain("CODE-CANARY-2");

    // Nothing was typed or sent anywhere: only the sandboxed runner's two
    // methods ran, no job was created, protected tables are unchanged.
    expect([...new Set(used)].sort()).toEqual(["checkSyntax", "runAll"]);
    expect(await agentJobCount(fx, w.person.id)).toBe(0);
    expect(await protectedTableDigests(fx)).toEqual(before);
    expect(
      new Set((await w.actions()).map((action) => action.actionKind)),
    ).toEqual(new Set(["draft-answer", "solve-code"]));
    await report("live-coding", w, ALL_REPLAY_SETS["live-coding"] as never);
  }, 120_000);

  it("reports generated, tests passed and fully verified as distinct states when the last constraint has no test", async () => {
    const engine = createFakeEngine({
      result: (request) =>
        isSolutionRequest(request)
          ? solutionFor(
              request,
              revisionOf(request) === 4
                ? // Four constraints are in force; one is covered.
                  { coverage: [{ constraintIndex: 0, testName: "t0" }] }
                : {},
            )
          : proseFor(request),
    });
    const { runner } = recordedRunner();
    const w = await world("evidence-i2", { engine, codeRunner: runner });
    await replay(w, ALL_REPLAY_SETS["live-coding"]?.phases ?? []);

    const solves = (await w.actions()).filter(
      (action) => action.actionKind === "solve-code",
    );
    expect(solves.map((a) => a.taskRevision)).toEqual([1, 2, 3, 4]);
    const states = solves.map((a) => (a.result as AnyRow).states);
    // Revisions 1 to 3 are fully verified; the last has generated code and
    // passing tests but an uncovered constraint.
    expect(states.slice(0, 3)).toEqual(
      [0, 1, 2].map(() => ({
        generated: true,
        testsPassed: true,
        fullyVerified: true,
        reasons: [],
      })),
    );
    expect(states[3]).toMatchObject({
      generated: true,
      testsPassed: true,
      fullyVerified: false,
    });
    expect(states[3].reasons).toContain("constraint_uncovered");
  }, 120_000);

  it("exposes no port that could type into or send to an external interface", () => {
    // Compile-time: a new processor port forces this list to change.
    const ports: Record<keyof SessionProcessorPorts, string> = {
      claim: "worker lease and fence",
      store: "owner-scoped database",
      engine: "AI execution by profile",
      answeredBy: "host display metadata",
      policy: "task identity and stages",
      clock: "time",
      trace: "id-only events",
      codeRunner: "sandboxed test run",
      runnerDeviceLocal: "host declaration",
      agentEscalation: "typed job profile and prompt store",
      visionProfileId: "host declaration",
      afterPurge: "host cleanup of staged content",
    };
    const external =
      /send|submit|type|click|keyboard|mouse|post|email|message|operate|automat|webhook|http/i;
    const storeMethods = Object.keys(createDatabaseStorePort(fx.member));
    expect(
      [...Object.keys(ports), ...storeMethods].filter((name) =>
        external.test(name),
      ),
    ).toEqual([]);
    // The one port that runs code can only run tests and check syntax.
    expect(Object.keys(fakeRunner().runner).sort()).toEqual([
      "checkSyntax",
      "runAll",
    ]);
  });
});
