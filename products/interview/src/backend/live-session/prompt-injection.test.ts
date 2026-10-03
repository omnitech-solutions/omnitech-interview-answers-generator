// Captured text and images cannot grant tools, change privacy policy or request
// secrets (ADR-0012 rule:captured-input-untrusted, ADR-0011
// rule:fast-path-no-tools, rule:structured-field-decisions). A synthetic corpus
// (prompt-injection-fixtures.ts) of hostile transcript lines, window labels,
// employer context and model replies is driven through the REAL processor and
// assist stage on a disposable PostgreSQL with a scripted fake gateway (no real
// model is reached) and these properties are proven:
//   - the policy text of every request is constant and equals the policy built
//     with no input at all; hostile text appears only inside the labelled
//     captured or employer block it arrived in, never in the policy, the
//     header, the schema or any request field, and screen text never reaches a
//     prompt;
//   - a request has no tool field, and its profile and processing policy are
//     what the session row dictates;
//   - a model reply outside the closed schema is rejected as a violation by
//     path and code, nothing is published, no job is created, no profile or
//     privacy column and no matrix or catalogue row changes;
//   - a reply inside the schema that carries hostile text publishes only as
//     inert data: no job, no promotion, no action kind beyond the answer;
//   - traces never contain corpus text;
//   - the checks are not vacuous: a stage that interpolates captured text into
//     the policy (or into the prompt header) fails them.
import type { AiExecutionRequest } from "@omnitech/ai-contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  INTERVIEW_SESSION_DEVICE_PROFILE,
  INTERVIEW_SESSION_FAST_PROFILE,
} from "../../assistant-profile.js";
import { type AssistStage, createAssistStage } from "./assist-stage.js";
import { buildContextSnapshot } from "./context-snapshot.js";
import { ingestObservation } from "./ingest.js";
import { createInterviewSessionPolicy } from "./interview-policy.js";
import {
  type Fixture,
  PNG_BYTES,
  startFixture,
} from "./live-session-fixture.js";
import {
  buildProcessor,
  type CollectedTrace,
  collectTraces,
  createFakeGateway,
  type FakeGateway,
  ingestorFor,
  seedBriefingDraft,
  seedMatrixProfile,
  settle,
} from "./processor-fixture.js";
import {
  EMBEDDED_REPLIES,
  INJECTION_CORPUS,
  type InjectionItem,
  NEUTRAL_QUESTION,
  OUT_OF_SCHEMA_REPLIES,
} from "./prompt-injection-fixtures.js";
import {
  agentJobCount,
  answer,
  blockJson,
  outsideBlocks,
  protectedTableDigests,
  sessionPrivacyColumns,
} from "./replay-evidence-fixture.js";
import { ActiveSessionRepository } from "./repository.js";
import { SYNTHETIC_MATRIX } from "./replay-fixture-matrix.js";
import { seg } from "./session-replay-fixtures.js";

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

const ofChannel = (channel: InjectionItem["channel"]) =>
  INJECTION_CORPUS.filter((entry) => entry.channel === channel);

// ---- what a clean request looks like ---------------------------------------

// The policy text as built with no captured text, no context and no profile:
// the one constant every request must carry, whatever arrives.
const CLEAN_SYSTEM = (() => {
  const prepared = createAssistStage().prepare({
    taskId: "task-clean",
    revision: 1,
    captured: [],
    context: {
      snapshot: buildContextSnapshot({ matrix: null, profile: null }),
      matrix: null,
    },
    deviceOnly: false,
  });
  if (!prepared.ok) throw new Error("clean prompt did not build");
  return prepared.prompt.system;
})();

const ALLOWED_REQUEST_FIELDS = [
  "context",
  "idempotencyKey",
  "processingPolicy",
  "profileId",
  "signal",
  "task",
];
const ALLOWED_TASK_FIELDS = ["prompt", "schema", "system", "type"];

type Expectation = {
  profileId: string;
  processingPolicy: "permitted-remote" | "device-only";
  captured: readonly string[];
  employer: readonly string[];
  screen: readonly string[];
};

// Every way a request can carry hostile input it must not. Returns codes, so
// the same check can prove a mutated stage is caught.
function requestViolations(
  requests: readonly AiExecutionRequest[],
  expected: Expectation,
): string[] {
  const found: string[] = [];
  const flag = (code: string) => {
    if (!found.includes(code)) found.push(code);
  };
  const all = [...expected.captured, ...expected.employer, ...expected.screen];
  for (const request of requests) {
    for (const key of Object.keys(request))
      if (!ALLOWED_REQUEST_FIELDS.includes(key)) flag(`request_field:${key}`);
    for (const key of Object.keys(request.task))
      if (!ALLOWED_TASK_FIELDS.includes(key)) flag(`task_field:${key}`);
    if (request.profileId !== expected.profileId) flag("profile_changed");
    if (request.processingPolicy !== expected.processingPolicy)
      flag("policy_changed");
    if (request.task.system !== CLEAN_SYSTEM) flag("system_policy_varies");
    // Everything but the prompt body: marker search.
    const rest = JSON.stringify({
      ...request,
      task: { ...request.task, prompt: "", system: "" },
      signal: undefined,
    });
    const outside = outsideBlocks(request.task.prompt);
    for (const marker of all) {
      if (request.task.system?.includes(marker)) flag("marker_in_system");
      if (rest.includes(marker)) flag("marker_in_request_field");
      if (outside.includes(marker)) flag("marker_outside_block");
    }
    // Each block carries only what belongs in it.
    const block = (label: string) =>
      JSON.stringify(blockJson<unknown>(request.task.prompt, label));
    for (const marker of expected.captured) {
      if (block("APPROVED EXPERIENCE").includes(marker))
        flag("captured_in_experience_block");
      if (block("CANDIDATE PREFERENCES").includes(marker))
        flag("captured_in_preferences_block");
      if (block("EMPLOYER MATERIAL").includes(marker))
        flag("captured_in_employer_block");
    }
    for (const marker of expected.employer)
      if (block("CAPTURED DATA").includes(marker))
        flag("employer_in_captured_block");
    for (const marker of expected.screen)
      if (request.task.prompt.includes(marker)) flag("screen_text_in_prompt");
  }
  return found;
}

// ---- a session, optionally with screen capture and employer context --------

type World = Awaited<ReturnType<typeof world>>;
async function world(
  name: string,
  options: {
    policy?: "permitted-remote" | "device-only";
    employer?: boolean;
    screen?: boolean;
    gateway?: FakeGateway;
    assist?: AssistStage;
  } = {},
) {
  const policy = options.policy ?? "permitted-remote";
  const person = await fx.provision(fx.tenantA, name);
  // A small approved matrix: candidate sources come first in a task view and
  // the view holds 40, so the full synthetic matrix would leave no room for
  // the employer block this suite needs to see carry hostile text.
  const profile = await seedMatrixProfile(fx, fx.tenantA, person.id, {
    matrix: {
      candidate: SYNTHETIC_MATRIX.candidate,
      roles: SYNTHETIC_MATRIX.roles.slice(2),
    },
  });
  const employer = (field: NonNullable<InjectionItem["field"]>) =>
    ofChannel("employer-context")
      .filter((entry) => entry.field === field)
      .map((entry) => entry.text)
      .join("\n");
  const workspaceDraft = options.employer
    ? await seedBriefingDraft(fx, fx.tenantA, person.id, profile, {
        jobDescription: employer("jobDescription"),
        employerNotes: employer("employerNotes"),
        research: employer("research"),
        candidatePreferences: "Notice period: two weeks.",
      })
    : undefined;
  const scope = { tenantId: fx.tenantA, actorId: person.id };
  const started = await repo.startSession(scope, {
    processingPolicy: policy,
    captureSources: options.screen
      ? ["microphone", "application-audio", "screen"]
      : ["microphone", "application-audio"],
    profile: { id: profile.id },
    ...(workspaceDraft ? { workspaceDraft } : {}),
  });
  const ingestor = ingestorFor(fx, fx.tenantA, started.credential.value);
  const trace: CollectedTrace = collectTraces();
  const gateway = options.gateway ?? createFakeGateway();
  const processor = buildProcessor(fx, {
    workerId: `worker-${name}`,
    gateway,
    trace,
    ...(options.assist
      ? { policy: createInterviewSessionPolicy({ assist: options.assist }) }
      : {}),
  });
  const sessionId = started.session.id;
  cleanups.push(async () => {
    gateway.releaseAll();
    await processor.close();
    await repo.controlSession(scope, sessionId, "end");
  });
  return {
    person,
    scope,
    sessionId,
    credential: started.credential.value,
    ingestor,
    trace,
    gateway,
    processor,
    actions: () => repo.listActions(scope, sessionId),
  };
}

// One interviewer question per call, separated by a non-backchannel candidate
// line so adjacent questions never coalesce into one utterance.
let counter = 0;
async function ask(w: World, text: string) {
  counter += 1;
  await w.ingestor.ingest(
    seg(`inj-q-${counter}`, "interviewer", counter * 20_000, text),
  );
  await settle(w.processor);
  await w.ingestor.ingest(
    seg(
      `inj-c-${counter}`,
      "candidate",
      counter * 20_000 + 8_000,
      "Let me think about that for a moment.",
    ),
  );
  await settle(w.processor);
}
async function showScreen(w: World, label: string, n: number) {
  const ack = await ingestObservation(
    fx.member,
    w.credential,
    fx.tenantA,
    {
      version: 1,
      kind: "screen.snapshot",
      sourceId: "screen",
      eventId: `inj-scr-${n}`,
      occurredAt: "2026-10-03T10:00:00.000Z",
      sequence: n,
      content: {
        payloadRef: `shot-inj-${n}`,
        mediaType: "image/png",
        byteLength: PNG_BYTES.byteLength,
        windowLabel: label,
      },
    },
    { payload: PNG_BYTES },
  );
  expect(ack.status).toBe("accepted");
}

// What a hostile input must leave exactly as it found it.
async function unchangedFacts(w: World) {
  return {
    row: await sessionPrivacyColumns(fx, w.sessionId),
    tables: await protectedTableDigests(fx),
    jobs: await agentJobCount(fx, w.person.id),
  };
}

const markersOf = (items: readonly InjectionItem[]) =>
  items.map((entry) => entry.id);
const allTexts = () => INJECTION_CORPUS.map((entry) => entry.text);
const traced = (w: World) => JSON.stringify(w.trace.events);

// ---- captured text, employer context and screen text ----------------------

describe.each([
  ["permitted-remote", INTERVIEW_SESSION_FAST_PROFILE],
  ["device-only", INTERVIEW_SESSION_DEVICE_PROFILE],
] as const)("the hostile corpus in a %s session", (policy, profileId) => {
  it("changes nothing: constant policy text, labelled blocks only, no tool, the row's profile and policy, no side effect", async () => {
    const w = await world(`inj-corpus-${policy}`, {
      policy,
      employer: true,
      screen: true,
    });
    const before = await unchangedFacts(w);

    for (const [n, entry] of ofChannel("screen").entries())
      await showScreen(w, entry.text, n + 1);
    for (const entry of ofChannel("captured")) await ask(w, entry.text);

    // One answer per hostile captured question, and nothing else was asked.
    const requests = w.gateway.requests;
    expect(requests).toHaveLength(ofChannel("captured").length);
    const violations = requestViolations(requests, {
      profileId,
      processingPolicy: policy,
      captured: markersOf(ofChannel("captured")),
      employer: markersOf(ofChannel("employer-context")),
      screen: markersOf(ofChannel("screen")),
    });
    expect(violations).toEqual([]);

    // Not vacuous on the data side: the hostile text DID reach the model, in
    // its own block - each captured line in the request for its question, the
    // employer text in the employer block.
    const capturedSeen = ofChannel("captured").every((entry) =>
      requests.some((request) =>
        JSON.stringify(
          blockJson<unknown>(request.task.prompt, "CAPTURED DATA"),
        ).includes(entry.id),
      ),
    );
    expect(capturedSeen).toBe(true);
    const employerSeen = new Set(
      requests.flatMap((request) =>
        markersOf(ofChannel("employer-context")).filter((marker) =>
          JSON.stringify(
            blockJson<unknown>(request.task.prompt, "EMPLOYER MATERIAL"),
          ).includes(marker),
        ),
      ),
    );
    expect([...employerSeen].sort()).toEqual(
      markersOf(ofChannel("employer-context")).sort(),
    );

    // The answers published, and only as answers: no action beyond the draft.
    const stored = await w.actions();
    expect(new Set(stored.map((action) => action.actionKind))).toEqual(
      new Set(["draft-answer"]),
    );
    expect(
      stored.every((action) => action.dispatchStatus === "succeeded"),
    ).toBe(true);

    // Privacy columns, profile pin, matrix and catalogue rows and jobs.
    expect(await unchangedFacts(w)).toEqual(before);

    // Traces hold ids, counts and codes: never a line of the corpus.
    const events = traced(w);
    for (const text of allTexts()) expect(events).not.toContain(text);
    for (const marker of INJECTION_CORPUS.map((entry) => entry.id))
      expect(events).not.toContain(marker);
  }, 180_000);
});

// ---- model replies outside the closed schema --------------------------------

describe("model replies outside the closed schema", () => {
  it("are rejected as violations by code, publish nothing and change nothing", async () => {
    const replies = [...OUT_OF_SCHEMA_REPLIES];
    let call = 0;
    const gateway = createFakeGateway({
      result: () => {
        const reply = replies[call];
        call += 1;
        return reply?.build(answer({}));
      },
    });
    const w = await world("inj-out-of-schema", { gateway });
    const before = await unchangedFacts(w);

    for (const [index] of replies.entries())
      await ask(w, NEUTRAL_QUESTION(index));

    const stored = await w.actions();
    expect(stored).toHaveLength(replies.length);
    for (const action of stored)
      expect(action).toMatchObject({
        actionKind: "draft-answer",
        dispatchStatus: "suppressed",
        suppressionReason: "invalid_output",
        result: null,
      });
    // Each rejection is a violation by path and code, never a copied string.
    const rejections = w.trace.events.filter(
      (event) => event.event === "dispatch.suppressed",
    );
    expect(rejections).toHaveLength(replies.length);
    for (const [index, event] of rejections.entries()) {
      expect(event.outcome).toBe("invalid-output");
      expect(String(event.detail?.["firstViolation"])).toMatch(
        /^[\w.$]+:[a-z_]+(:\d+)?$/,
      );
      // The detail is a count and a path:code, and a reply's own field names
      // (model-controlled) are never copied into it.
      expect(Object.keys(event.detail ?? {}).sort()).toEqual([
        "firstViolation",
        "violationCount",
      ]);
      for (const name of replies[index]?.names ?? [])
        expect(JSON.stringify(event.detail)).not.toContain(name);
    }
    const events = traced(w);
    for (const reply of replies) expect(events).not.toContain(reply.id);
    expect(JSON.stringify(stored)).not.toContain("INJ-O");

    // Nothing but answers were asked for, with the row's profile and policy.
    expect(
      requestViolations(w.gateway.requests, {
        profileId: INTERVIEW_SESSION_FAST_PROFILE,
        processingPolicy: "permitted-remote",
        captured: [],
        employer: [],
        screen: [],
      }),
    ).toEqual([]);
    expect(await unchangedFacts(w)).toEqual(before);
  }, 180_000);
});

// ---- hostile text inside allowed fields -----------------------------------

describe("hostile text inside the schema's allowed fields", () => {
  it("publishes only as inert data: no job, no promotion, no extra action", async () => {
    const replies = [...EMBEDDED_REPLIES];
    let call = 0;
    const gateway = createFakeGateway({
      result: () => {
        const reply = replies[call];
        call += 1;
        if (!reply) return answer({});
        return reply.field === "draft"
          ? answer({ draft: reply.text })
          : answer({
              claims: [{ kind: reply.kind, text: reply.text, refs: [] }],
            });
      },
    });
    const w = await world("inj-embedded", { gateway });
    const before = await unchangedFacts(w);

    for (const [index] of replies.entries())
      await ask(w, NEUTRAL_QUESTION(index));

    const stored = await w.actions();
    expect(stored).toHaveLength(replies.length);
    const RESULT_KEYS = [
      "category",
      "claims",
      "codingBrief",
      "contextRevisions",
      "draft",
      "logistics",
      "meta",
      "pinned",
      "sections",
      "stage",
      "star",
      "version",
    ];
    for (const [index, action] of stored.entries()) {
      const reply = replies[index];
      expect(action).toMatchObject({
        actionKind: "draft-answer",
        dispatchStatus: "succeeded",
      });
      const result = action.result as Record<string, any>;
      // Data in a data field and nothing else: the closed result shape only.
      expect(Object.keys(result).sort()).toEqual(RESULT_KEYS);
      expect(
        reply?.field === "draft" ? result["draft"] : result["claims"][0].text,
      ).toBe(reply?.text);
      expect(result["stage"]).toBe("draft-answer");
      expect(result["codingBrief"]).toBeNull();
      expect(result["meta"].processingPolicy).toBe("permitted-remote");
    }
    // No side effect followed any of it.
    expect(new Set(stored.map((action) => action.actionKind))).toEqual(
      new Set(["draft-answer"]),
    );
    expect(await unchangedFacts(w)).toEqual(before);
    // Traces carry counts, not the text.
    const events = traced(w);
    for (const reply of replies) {
      expect(events).not.toContain(reply.id);
      expect(events).not.toContain(reply.text);
    }
  }, 180_000);
});

// ---- the checks are not vacuous ---------------------------------------------

describe("a stage that lets captured text into the policy fails the checks", () => {
  const real = createAssistStage();
  // Wraps the real stage, then writes the latest captured line where it must
  // never go.
  const leaking = (where: "system" | "header"): AssistStage => ({
    ...real,
    prepare(input) {
      const prepared = real.prepare(input);
      if (!prepared.ok) return prepared;
      const text = input.captured.at(-1)?.text ?? "";
      return {
        ok: true,
        prompt: {
          ...prepared.prompt,
          ...(where === "system"
            ? { system: `${prepared.prompt.system}\n${text}` }
            : {
                prompt: prepared.prompt.prompt.replace(
                  "TASK: draft_answer",
                  `TASK: draft_answer ${text}`,
                ),
              }),
        },
      };
    },
  });
  const run = async (name: string, assist?: AssistStage) => {
    const w = await world(name, { ...(assist ? { assist } : {}) });
    const items = ofChannel("captured").slice(0, 3);
    for (const entry of items) await ask(w, entry.text);
    return requestViolations(w.gateway.requests, {
      profileId: INTERVIEW_SESSION_FAST_PROFILE,
      processingPolicy: "permitted-remote",
      captured: markersOf(items),
      employer: [],
      screen: [],
    });
  };

  it("passes for the real stage on the same input", async () => {
    expect(await run("inj-mutant-control")).toEqual([]);
  }, 60_000);

  it("fails when captured text is interpolated into the policy text", async () => {
    const violations = await run("inj-mutant-system", leaking("system"));
    expect(violations).toEqual(
      expect.arrayContaining(["system_policy_varies", "marker_in_system"]),
    );
  }, 60_000);

  it("fails when captured text is interpolated outside the labelled blocks", async () => {
    const violations = await run("inj-mutant-header", leaking("header"));
    expect(violations).toEqual(
      expect.arrayContaining(["marker_outside_block"]),
    );
  }, 60_000);

  it("flags a request that carries a tool field or a changed profile or policy", () => {
    const base: AiExecutionRequest = {
      context: {} as AiExecutionRequest["context"],
      profileId: "interview-admin",
      task: {
        type: "structured-generation",
        system: CLEAN_SYSTEM,
        prompt: "TASK: draft_answer",
        schema: {},
        tools: [{ name: "shell" }],
      } as AiExecutionRequest["task"],
      processingPolicy: "permitted-remote",
      tools: [{ name: "shell" }],
    } as AiExecutionRequest;
    expect(
      requestViolations([base], {
        profileId: INTERVIEW_SESSION_FAST_PROFILE,
        processingPolicy: "device-only",
        captured: [],
        employer: [],
        screen: [],
      }),
    ).toEqual(
      expect.arrayContaining([
        "request_field:tools",
        "task_field:tools",
        "profile_changed",
        "policy_changed",
      ]),
    );
  });
});
