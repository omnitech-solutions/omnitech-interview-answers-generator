// The session-owned Workspace draft on a disposable PostgreSQL as the member
// role: the publish effect writes inside the fenced publish transaction behind
// an expected-revision check, a conflict is an outcome that keeps the held
// result on the action, a throwing effect rolls the publish back, a stale
// revision never reaches the effect, and the purger deletes only the drafts the
// session still marks (rule:complete-session-purge, ADR-0008).
import { withTenant } from "@omnitech/database";
import { renderGuideMarkdown } from "@omnitech/interview-contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  InterviewWorkspaceRepository,
  interviewDraftSchema,
  type WorkspaceScope,
} from "../assistant/workspace.js";
import type { CodingBrief } from "./assist-stage.js";
import type { CodeStates } from "./code-states.js";
import type { CodingSolution } from "./coding-stage.js";
import type { TaskState } from "./core/index.js";
import { FencedSessionWrites } from "./fenced-writes.js";
import {
  type Fixture,
  type Person,
  startFixture,
} from "./live-session-fixture.js";
import { ActiveSessionRepository } from "./repository.js";
import { claimSessions, type SessionClaim } from "./session-claim.js";
import { createDatabaseStorePort } from "./session-ports.js";
import {
  buildSessionDraft,
  sessionArtifactId,
  sessionDraftEffect,
  sessionDraftPurger,
  sessionProposalId,
  sessionWorkspaceId,
  workspaceTransaction,
} from "./session-drafts.js";
import { asSessionPurge } from "./session-purge.js";

let fx: Fixture;
let repo: ActiveSessionRepository;
let writes: FencedSessionWrites;
let tenant = "";
let counter = 0;

beforeAll(async () => {
  fx = await startFixture();
  tenant = fx.tenantA;
  repo = new ActiveSessionRepository(fx.member);
  writes = new FencedSessionWrites(fx.member);
}, 90_000);
afterAll(() => fx?.stop());

const BRIEF: CodingBrief = {
  language: "typescript",
  restatement: "Implement a rate limiter for a Node service.",
  constraints: [
    "at most a fixed number of requests per client in a sliding window",
    "a small burst above the limit is allowed",
  ],
};
const STATES: CodeStates = {
  generated: true,
  testsPassed: true,
  fullyVerified: true,
  reasons: [],
};
const solution = (code: string): CodingSolution => ({
  language: "typescript",
  code,
  testCode: 'it("window", () => {});',
  coverage: [
    { constraintIndex: 0, testName: "window" },
    { constraintIndex: 1, testName: "burst" },
  ],
  escalation: "none",
  notes: "A map of timestamps per client.",
});
function draftFor(code: string) {
  const built = buildSessionDraft({
    brief: BRIEF,
    solution: solution(code),
    states: STATES,
  });
  if (!built.ok) throw new Error("expected a valid draft");
  return built.draft;
}

const tasks = (taskId: string, revision: number): TaskState => ({
  tasks: {
    [taskId]: {
      taskId,
      taskKey: `key-${taskId}`,
      revision,
      revisions: Array.from({ length: revision }, (_, index) => ({
        revision: index + 1,
        basedOn: [],
        reason:
          index === 0 ? ("opened" as const) : ("constraint_changed" as const),
        sourceSuperseded: false,
      })),
    },
  },
  byKey: { [`key-${taskId}`]: taskId },
  deferred: {},
});

async function world(name: string) {
  counter += 1;
  const person: Person = await fx.provision(tenant, `${name}-${counter}`);
  const scope = { tenantId: tenant, actorId: person.id };
  const { session } = await repo.startSession(scope, {
    processingPolicy: "permitted-remote",
    captureSources: ["microphone"],
  });
  const claims = await claimSessions(fx.member, `worker-${name}`, 60_000, 500);
  const claim = claims.find((c) => c.sessionId === session.id) as SessionClaim;
  return {
    person,
    scope,
    sessionId: session.id,
    claim,
    holder: { workerId: `worker-${name}`, fence: claim.fence },
    workspaceScope: {
      tenantId: tenant,
      actorId: person.id,
      productId: "omnitech.interview",
    } satisfies WorkspaceScope,
  };
}
type World = Awaited<ReturnType<typeof world>>;

// Records a solve-code action for a task revision and publishes a result with
// the session draft effect, the way the coding path does.
async function publishSolution(
  w: World,
  taskId: string,
  revision: number,
  code: string,
  effect = sessionDraftEffect({ draft: draftFor(code) }),
) {
  const state = tasks(taskId, revision);
  const recorded = await writes.recordAction({
    scope: w.scope,
    sessionId: w.sessionId,
    holder: w.holder,
    tasks: state,
    taskId,
    revision,
    actionKind: "solve-code",
  });
  if (recorded.outcome !== "dispatched") throw new Error(recorded.outcome);
  const outcome = await writes.publishResult({
    scope: w.scope,
    sessionId: w.sessionId,
    holder: w.holder,
    actionId: recorded.actionId,
    tasks: state,
    result: { version: 1, stage: "solve-code", code },
    show: true,
    effect,
  });
  return { outcome, actionId: recorded.actionId };
}

const draftRow = async (w: World, taskId: string) =>
  (
    await fx.owner.query(
      "SELECT revision, value, provenance FROM interview.assistant_drafts WHERE actor_id=$1 AND workspace_id=$2 AND artifact_id=$3",
      [w.person.id, sessionWorkspaceId(w.sessionId), sessionArtifactId(taskId)],
    )
  ).rows[0];
const actionResult = async (actionId: string) =>
  (
    await fx.owner.query(
      "SELECT dispatch_status, result FROM interview.session_actions WHERE id=$1",
      [actionId],
    )
  ).rows[0];

// An owner edit through the real repository, so it clears provenance exactly
// as a person's edit does.
async function ownerEdits(
  w: World,
  taskId: string,
  code:
    | string
    | { notes: string }
    | { progress: { stage: "plan"; clarified: number[] } },
) {
  const workspace = new InterviewWorkspaceRepository({
    tenantTransaction: (_tenantId, work) =>
      fx.member.transaction((client) =>
        work({
          query: async (text, values) =>
            (await client.query(text, values as unknown[])).rows,
        }),
      ),
  });
  const current = await workspace.read(
    w.workspaceScope,
    sessionWorkspaceId(w.sessionId),
    sessionArtifactId(taskId),
  );
  const answer = current.value.answer;
  if (!answer) throw new Error("expected an answer");
  return workspace.edit(
    w.workspaceScope,
    current.origin,
    typeof code === "string" ? { answer: { ...answer, code } } : code,
  );
}

describe("the draft shape", () => {
  it("builds an answer-guide draft the Workspace accepts, with Markdown rendered from the guide", () => {
    const draft = draftFor("export const allow = () => true;");
    expect(interviewDraftSchema.safeParse(draft).success).toBe(true);
    expect(draft.question).toBe(BRIEF.restatement);
    expect(draft.answer.code).toBe("export const allow = () => true;");
    expect(draft.answer.testCode).toContain("window");
    expect(draft.answer.answerMarkdown).toBe(
      renderGuideMarkdown(draft.answer.guide),
    );
    // No invented complexity claim, exactly three talking points, the states
    // are stated, and the constraint-to-test mapping is the edge-case list.
    expect(draft.answer.guide.plan.complexity.time).toMatch(/not analysed/i);
    expect(draft.answer.guide.talkingPoints).toHaveLength(3);
    expect(draft.answer.guide.explain[0]?.body).toContain(
      "Fully verified: yes",
    );
    expect(draft.answer.guide.edgeCases).toEqual([
      { name: BRIEF.constraints[0], test: "window" },
      { name: BRIEF.constraints[1], test: "burst" },
    ]);
  });

  it("refuses a brief the answer shape cannot hold instead of building a draft", () => {
    const built = buildSessionDraft({
      brief: { ...BRIEF, restatement: "   " },
      solution: solution("export const x = 1;"),
      states: STATES,
    });
    expect(built.ok).toBe(false);
  });
});

describe("the publish effect", () => {
  it("creates the session draft inside the publish transaction, marks it, and merges the outcome into the action result", async () => {
    const w = await world("create");
    const { outcome, actionId } = await publishSolution(w, "task-1", 1, "v1");
    expect(outcome).toEqual({ outcome: "published" });

    const row = await draftRow(w, "task-1");
    expect(Number(row.revision)).toBe(0);
    expect(row.value.answer.code).toBe("v1");
    expect(row.provenance).toMatchObject({
      proposalId: sessionProposalId(w.sessionId),
      draftRevision: 0,
    });
    const stored = await actionResult(actionId);
    expect(stored.dispatch_status).toBe("succeeded");
    expect(stored.result).toMatchObject({
      code: "v1",
      workspace: {
        published: true,
        workspaceId: sessionWorkspaceId(w.sessionId),
        artifactId: sessionArtifactId("task-1"),
        artifactRevision: 0,
      },
    });
  });

  it("updates the same draft for a later revision at the revision it last wrote, and re-marks it", async () => {
    const w = await world("update");
    await publishSolution(w, "task-1", 1, "v1");
    const { actionId } = await publishSolution(w, "task-1", 2, "v2");

    const row = await draftRow(w, "task-1");
    expect(Number(row.revision)).toBe(1);
    expect(row.value.answer.code).toBe("v2");
    expect(row.provenance).toMatchObject({
      proposalId: sessionProposalId(w.sessionId),
      draftRevision: 1,
      acceptedDraftRevision: 1,
    });
    expect((await actionResult(actionId)).result.workspace).toMatchObject({
      published: true,
      artifactRevision: 1,
    });
  });

  it("does not overwrite an owner's edit: the result is held on the action and the conflict is reported", async () => {
    const w = await world("conflict");
    await publishSolution(w, "task-1", 1, "v1");
    await ownerEdits(w, "task-1", "the owner's own code");
    const edited = await draftRow(w, "task-1");
    expect(Number(edited.revision)).toBe(1);
    expect(edited.provenance).toBeNull();

    const { outcome, actionId } = await publishSolution(
      w,
      "task-1",
      2,
      "late AI result",
    );
    // The publish itself succeeded: a conflict is an outcome, not an error.
    expect(outcome).toEqual({ outcome: "published" });
    const after = await draftRow(w, "task-1");
    expect(Number(after.revision)).toBe(1);
    expect(after.value.answer.code).toBe("the owner's own code");
    expect(after.provenance).toBeNull();
    const stored = await actionResult(actionId);
    expect(stored.dispatch_status).toBe("succeeded");
    expect(stored.result).toMatchObject({
      code: "late AI result",
      workspace: {
        published: false,
        conflict: true,
        reason: "owner_edited",
        expectedRevision: 0,
        foundRevision: 1,
      },
    });
  });

  it("keeps holding after a conflict: the expected revision stays the one the session last wrote", async () => {
    const w = await world("conflict-twice");
    await publishSolution(w, "task-1", 1, "v1");
    await ownerEdits(w, "task-1", "owner");
    await publishSolution(w, "task-1", 2, "held 2");
    const { actionId } = await publishSolution(w, "task-1", 3, "held 3");
    expect((await actionResult(actionId)).result.workspace).toMatchObject({
      published: false,
      conflict: true,
    });
    expect((await draftRow(w, "task-1")).value.answer.code).toBe("owner");
  });

  it("does not resurrect a draft the owner removed, and does not claim one it never wrote", async () => {
    const removed = await world("removed");
    await publishSolution(removed, "task-1", 1, "v1");
    await fx.owner.query(
      "DELETE FROM interview.assistant_drafts WHERE actor_id=$1 AND workspace_id=$2",
      [removed.person.id, sessionWorkspaceId(removed.sessionId)],
    );
    const again = await publishSolution(removed, "task-1", 2, "v2");
    expect((await actionResult(again.actionId)).result.workspace).toMatchObject(
      { published: false, conflict: true, reason: "draft_removed" },
    );
    expect(await draftRow(removed, "task-1")).toBeUndefined();

    const foreign = await world("foreign");
    await fx.owner.query(
      "INSERT INTO interview.assistant_drafts(tenant_id,actor_id,product_id,workspace_id,artifact_id,value) VALUES($1,$2,'omnitech.interview',$3,$4,$5::jsonb)",
      [
        tenant,
        foreign.person.id,
        sessionWorkspaceId(foreign.sessionId),
        sessionArtifactId("task-1"),
        JSON.stringify({
          question: "Owner's own question",
          notes: "",
          answer: null,
        }),
      ],
    );
    const result = await publishSolution(foreign, "task-1", 1, "v1");
    expect(
      (await actionResult(result.actionId)).result.workspace,
    ).toMatchObject({
      published: false,
      conflict: true,
      reason: "draft_exists",
    });
    expect((await draftRow(foreign, "task-1")).value.question).toBe(
      "Owner's own question",
    );
  });

  it("rolls the whole publish back when the effect throws, leaving the action in flight", async () => {
    const w = await world("throws");
    const state = tasks("task-1", 1);
    const recorded = await writes.recordAction({
      scope: w.scope,
      sessionId: w.sessionId,
      holder: w.holder,
      tasks: state,
      taskId: "task-1",
      revision: 1,
      actionKind: "solve-code",
    });
    if (recorded.outcome !== "dispatched") throw new Error("not dispatched");
    await expect(
      writes.publishResult({
        scope: w.scope,
        sessionId: w.sessionId,
        holder: w.holder,
        actionId: recorded.actionId,
        tasks: state,
        result: { version: 1 },
        show: true,
        effect: async (context) => {
          // Writes first, then throws: the write must roll back too.
          await sessionDraftEffect({ draft: draftFor("v1") })(context);
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
    expect((await actionResult(recorded.actionId)).dispatch_status).toBe(
      "in_flight",
    );
    expect(await draftRow(w, "task-1")).toBeUndefined();
    const shown = await fx.owner.query(
      "SELECT shown_draft_count FROM interview.active_sessions WHERE id=$1",
      [w.sessionId],
    );
    expect(Number(shown.rows[0].shown_draft_count)).toBe(0);
  });

  it("never runs the effect for a stale revision", async () => {
    const w = await world("stale");
    const effect = vi.fn(async () => ({ workspace: {} }));
    const recorded = await writes.recordAction({
      scope: w.scope,
      sessionId: w.sessionId,
      holder: w.holder,
      tasks: tasks("task-1", 1),
      taskId: "task-1",
      revision: 1,
      actionKind: "solve-code",
    });
    if (recorded.outcome !== "dispatched") throw new Error("not dispatched");
    const outcome = await writes.publishResult({
      scope: w.scope,
      sessionId: w.sessionId,
      holder: w.holder,
      actionId: recorded.actionId,
      // The processor has since moved the task to revision 2.
      tasks: tasks("task-1", 2),
      result: { version: 1 },
      effect,
    });
    expect(outcome).toMatchObject({
      outcome: "refused",
      reason: "revision_stale",
    });
    expect(effect).not.toHaveBeenCalled();
    expect(await draftRow(w, "task-1")).toBeUndefined();
  });

  it("adapts the string-query port with bound parameters on the same transaction", async () => {
    const w = await world("adapter");
    const rows = await withTenant(
      {
        tenantId: tenant,
        actorId: w.person.id,
        productId: "omnitech.interview",
      },
      async (tx) =>
        workspaceTransaction(tx).query(
          "SELECT $1::text AS a, $2::int AS b, $1::text AS c, current_setting('app.actor_id', true) AS actor",
          ["it's $1; DROP TABLE x", 7],
        ),
      { database: fx.member },
    );
    expect(rows[0]).toEqual({
      a: "it's $1; DROP TABLE x",
      b: 7,
      c: "it's $1; DROP TABLE x",
      actor: w.person.id,
    });
  });
});

describe("the session draft purger", () => {
  const purge = (w: World) =>
    asSessionPurge(
      fx.member,
      { tenantId: tenant, ownerUserId: w.person.id },
      (client) =>
        sessionDraftPurger.purge(
          client,
          {
            tenantId: tenant,
            ownerUserId: w.person.id,
            sessionId: w.sessionId,
          },
          null,
        ),
    );

  it("deletes the drafts the session still marks and counts them", async () => {
    const w = await world("purge");
    await publishSolution(w, "task-1", 1, "v1");
    await publishSolution(w, "task-2", 1, "v1");
    expect(await purge(w)).toBe(2);
    expect(await draftRow(w, "task-1")).toBeUndefined();
    expect(await draftRow(w, "task-2")).toBeUndefined();
    expect(await purge(w)).toBe(0);
  });

  it("keeps a draft the owner edited (provenance cleared), and the owner's other drafts", async () => {
    const w = await world("purge-edited");
    await publishSolution(w, "task-1", 1, "v1");
    await publishSolution(w, "task-2", 1, "v1");
    await ownerEdits(w, "task-1", "owner's edit");
    await fx.owner.query(
      "INSERT INTO interview.assistant_drafts(tenant_id,actor_id,product_id,workspace_id,artifact_id,value) VALUES($1,$2,'omnitech.interview','my-workspace','mine',$3::jsonb)",
      [
        tenant,
        w.person.id,
        JSON.stringify({ question: "Mine", notes: "", answer: null }),
      ],
    );
    expect(await purge(w)).toBe(1);
    expect((await draftRow(w, "task-1")).value.answer.code).toBe(
      "owner's edit",
    );
    expect(await draftRow(w, "task-2")).toBeUndefined();
    const mine = await fx.owner.query(
      "SELECT 1 FROM interview.assistant_drafts WHERE actor_id=$1 AND workspace_id='my-workspace'",
      [w.person.id],
    );
    expect(mine.rows).toHaveLength(1);
  });

  it("keeps a draft whose notes or progress the owner edited, though the edit keeps the provenance mark", async () => {
    // Review finding 7: editTransaction clears provenance only for answer,
    // briefing and question patches, so the mark alone cannot tell.
    const w = await world("purge-notes-progress");
    await publishSolution(w, "task-1", 1, "v1");
    await publishSolution(w, "task-2", 1, "v1");
    await publishSolution(w, "task-3", 1, "v1");
    await ownerEdits(w, "task-1", { notes: "my own notes" });
    await ownerEdits(w, "task-2", {
      progress: { stage: "plan", clarified: [0] },
    });
    expect((await draftRow(w, "task-1")).provenance).not.toBeNull();
    expect(await purge(w)).toBe(1);
    expect((await draftRow(w, "task-1")).value.notes).toBe("my own notes");
    expect((await draftRow(w, "task-2")).value.progress).toEqual({
      stage: "plan",
      clarified: [0],
    });
    expect(await draftRow(w, "task-3")).toBeUndefined();
  });

  it("keeps a draft a saved answer revision refers to, and never touches another session's or user's drafts", async () => {
    const w = await world("purge-saved");
    await publishSolution(w, "task-1", 1, "v1");
    await fx.owner.query(
      "INSERT INTO interview.assistant_answer_revisions(tenant_id,actor_id,product_id,workspace_id,artifact_id,saved_revision,draft_revision,value) VALUES($1,$2,'omnitech.interview',$3,$4,1,0,$5::jsonb)",
      [
        tenant,
        w.person.id,
        sessionWorkspaceId(w.sessionId),
        sessionArtifactId("task-1"),
        JSON.stringify((await draftRow(w, "task-1")).value),
      ],
    );
    const other = await world("purge-other");
    await publishSolution(other, "task-1", 1, "v1");
    expect(await purge(w)).toBe(0);
    expect(await draftRow(w, "task-1")).toBeDefined();
    expect(await draftRow(other, "task-1")).toBeDefined();
  });

  it("is the default purger of the database store port: a purge deletes the session draft and counts it", async () => {
    const w = await world("purge-default");
    await publishSolution(w, "task-1", 1, "v1");
    await repo.controlSession(w.scope, w.sessionId, "end");
    const result = await createDatabaseStorePort(fx.member).purge({
      tenantId: tenant,
      ownerUserId: w.person.id,
      sessionId: w.sessionId,
    });
    expect(result).toMatchObject({
      outcome: "complete",
      counts: { drafts: 1 },
    });
    expect(await draftRow(w, "task-1")).toBeUndefined();
  });
});
