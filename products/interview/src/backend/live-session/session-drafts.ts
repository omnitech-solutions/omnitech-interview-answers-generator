// The session-owned Workspace draft (plan #2 D6, ADR-0012 complete purge).
//
// A tested coding solution lands in ONE Workspace draft per task, in the
// workspace `active-session:<sessionId>`, written INSIDE the fenced publish
// transaction so the draft and the action result commit or roll back together.
// The write uses InterviewWorkspaceRepository semantics - drafts are optimistic
// by revision - and an EXPECTED-REVISION CHECK keeps a late AI result from
// overwriting newer edits: the session remembers the draft revision it last
// wrote (kept in the previous revision's action result, read in the same
// transaction). If the stored draft is at any other revision the owner edited
// it, so the result is NOT written; it stays on the action as a held result and
// `workspace: {published: false, conflict: true}` says so. A conflict is an
// outcome, never an exception: throwing would strand the action in flight.
//
// Provenance marks the draft as session-created (proposalId `session:<id>`). An
// owner edit clears provenance (workspace.ts editTransaction), which takes the
// draft out of the purge: the SessionDraftPurger deletes only drafts that still
// carry the mark and that no saved answer revision refers to.
//
// The Workspace repository speaks string-query transactions; the fenced write
// holds a Drizzle transaction. `workspaceTransaction` adapts one to the other:
// it rebinds each `$n` placeholder as a Drizzle parameter, so values stay bound
// parameters (never concatenated) on the same connection and transaction.
import type { TenantDatabase } from "@omnitech/database";
import {
  type AnswerGuide,
  type InterviewProvenance,
  renderGuideMarkdown,
} from "@omnitech/interview-contracts";
import { type SQL, sql } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile.js";
import {
  InterviewWorkspaceRepository,
  interviewDraftSchema,
  type WorkspaceScope,
  type WorkspaceTransaction,
} from "../assistant/workspace.js";
import type { CodingBrief } from "./assist-stage.js";
import type { CodeStates } from "./code-states.js";
import { CODING_ACTION_KIND, type CodingSolution } from "./coding-stage.js";
import type { PublishEffect } from "./fenced-writes.js";
import type { WorkspaceDraftKey } from "./mapping.js";
import { firstRow } from "./scope.js";
import type { SessionDraftPurger } from "./session-purge.js";

export const sessionWorkspaceId = (sessionId: string): string =>
  `active-session:${sessionId}`;
// The draft's artifact is derived from the task, so every revision of one task
// updates the same draft.
export const sessionArtifactId = (taskId: string): string => `coding:${taskId}`;
export const sessionDraftKey = (
  sessionId: string,
  taskId: string,
): WorkspaceDraftKey => ({
  workspaceId: sessionWorkspaceId(sessionId),
  artifactId: sessionArtifactId(taskId),
});
// The mark a session-created draft carries; owner edits clear it.
export const sessionProposalId = (sessionId: string): string =>
  `session:${sessionId}`;

const PROMPT_VERSION = "active-session-solve-code-v1";
const ADAPTER_VERSION = "active-session-v1";

// Rebinds the `$n` placeholders of a query as Drizzle parameters.
function boundQuery(text: string, values: readonly unknown[]): SQL {
  const parts = text.split(/\$(\d+)/);
  return sql.join(
    parts.map((part, index) =>
      index % 2 === 0 ? sql.raw(part) : sql.param(values[Number(part) - 1]),
    ),
    sql.raw(""),
  );
}

export function workspaceTransaction(tx: TenantDatabase): WorkspaceTransaction {
  return {
    async query(text, values = []) {
      const result = await tx.execute(boundQuery(text, values));
      return result.rows as unknown as readonly Record<string, unknown>[];
    },
  };
}

// The repository is used only through its *Transaction methods, on the fenced
// write's own transaction; it never opens one of its own.
const workspace = new InterviewWorkspaceRepository({
  tenantTransaction: () => {
    throw new Error("The session draft writes inside the fenced transaction.");
  },
});

const NOT_ANALYSED = "Not analysed by the session assistant.";
const yesNo = (value: boolean) => (value ? "yes" : "no");

export type SessionDraftValue = {
  question: string;
  notes: string;
  answer: NonNullable<ReturnType<typeof interviewDraftSchema.parse>["answer"]>;
};

// [DOMAIN] The coding draft in the answer-guide shape (ADR-0008): the guide is
// the source and its Markdown is rendered from it. Every guide field is filled
// from the structured result and the verified states, deterministically; the
// session never invents a complexity claim, so it says it did not analyse one.
export function buildSessionDraft(input: {
  brief: CodingBrief;
  solution: CodingSolution;
  states: CodeStates;
}): { ok: true; draft: SessionDraftValue } | { ok: false } {
  const { brief, solution, states } = input;
  const guide: AnswerGuide = {
    version: 1,
    understand: {
      prompt: brief.restatement,
      examples: [],
      constraints: brief.constraints.slice(0, 8),
      clarify: [],
    },
    plan: {
      steps: [
        `Restate the task and its ${brief.constraints.length} stated constraint(s).`,
        solution.notes.trim() ||
          `Implement the solution in ${solution.language}.`,
        "Check it with the named tests and the syntax check.",
      ],
      complexity: {
        time: NOT_ANALYSED,
        space: NOT_ANALYSED,
        note: "Work out the complexity before presenting this solution.",
      },
    },
    edgeCases: solution.coverage.slice(0, 10).flatMap((entry) => {
      const name = brief.constraints[entry.constraintIndex];
      return name === undefined ? [] : [{ name, test: entry.testName }];
    }),
    explain: [
      {
        heading: "How this draft was produced",
        body: `Drafted by the Active Session assistant from the captured question. Generated: ${yesNo(states.generated)}. Tests passed: ${yesNo(states.testsPassed)}. Fully verified: ${yesNo(states.fullyVerified)}. Review it before relying on it.`,
      },
    ],
    talkingPoints: [
      "State the constraints you were given before describing the approach.",
      "Walk through the named tests that cover each constraint.",
      "Say plainly what has not been verified yet.",
    ],
  };
  const title = brief.restatement.slice(0, 80);
  const candidate = {
    question: brief.restatement,
    notes: "",
    answer: {
      title,
      language: solution.language,
      answerMarkdown: renderGuideMarkdown(guide),
      code: solution.code,
      usageCode: solution.usageCode ?? "",
      testCode: solution.testCode,
      guide,
    },
  };
  const parsed = interviewDraftSchema.safeParse(candidate);
  if (!parsed.success || !parsed.data.answer) return { ok: false };
  return {
    ok: true,
    draft: {
      question: parsed.data.question,
      notes: parsed.data.notes,
      answer: parsed.data.answer,
    },
  };
}

export type WorkspaceOutcome =
  | {
      published: true;
      workspaceId: string;
      artifactId: string;
      artifactRevision: number;
    }
  | {
      published: false;
      conflict: true;
      reason: "owner_edited" | "draft_removed" | "draft_exists";
      expectedRevision: number | null;
      foundRevision: number | null;
    };

const provenanceOf = (
  sessionId: string,
  revision: number,
): InterviewProvenance => ({
  proposalId: sessionProposalId(sessionId),
  draftRevision: revision,
  acceptedDraftRevision: revision,
  promptVersion: PROMPT_VERSION,
  adapterVersion: ADAPTER_VERSION,
  claims: [],
  sources: [],
});

// The publish effect for one validated coding result. Runs under the owner's
// tenant, actor and product (inOwnerScope) with the session row locked.
export function sessionDraftEffect(input: {
  draft: SessionDraftValue;
}): PublishEffect {
  return async ({ tx, scope, sessionId, taskId }) => {
    const wtx = workspaceTransaction(tx);
    const workspaceScope: WorkspaceScope = {
      tenantId: scope.tenantId,
      actorId: scope.actorId,
      productId: INTERVIEW_PRODUCT_ID,
    };
    const key = sessionDraftKey(sessionId, taskId);

    // The revision this session last wrote for the task: the newest earlier
    // result that actually wrote the draft.
    const last = await firstRow<{ revision: string | number | null }>(
      tx,
      sql`SELECT result->'workspace'->>'artifactRevision' AS revision
          FROM interview.session_actions
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid
            AND session_id = ${sessionId}::uuid
            AND task_id = ${taskId}
            AND action_kind = ${CODING_ACTION_KIND}
            AND dispatch_status = 'succeeded'
            AND result->'workspace'->>'published' = 'true'
          ORDER BY task_revision DESC, created_at DESC
          LIMIT 1`,
    );
    const expected =
      last?.revision === null || last?.revision === undefined
        ? null
        : Number(last.revision);

    const stored = await firstRow<{ revision: string | number }>(
      tx,
      sql`SELECT revision FROM interview.assistant_drafts
          WHERE tenant_id = ${scope.tenantId}
            AND actor_id = ${scope.actorId}
            AND product_id = ${INTERVIEW_PRODUCT_ID}
            AND workspace_id = ${key.workspaceId}
            AND artifact_id = ${key.artifactId}
          FOR UPDATE`,
    );
    const found = stored === undefined ? null : Number(stored.revision);
    const conflict = (
      reason: "owner_edited" | "draft_removed" | "draft_exists",
    ): { workspace: WorkspaceOutcome } => ({
      workspace: {
        published: false,
        conflict: true,
        reason,
        expectedRevision: expected,
        foundRevision: found,
      },
    });

    if (found === null) {
      // The session wrote one earlier and it is gone: the owner removed it, and
      // a removal is not undone by a late result.
      if (expected !== null) return conflict("draft_removed");
      const created = await workspace.createTransaction(
        wtx,
        workspaceScope,
        { ...key, artifactRevision: 0 },
        { question: input.draft.question, answer: input.draft.answer },
      );
      await workspace.setProvenanceTransaction(
        wtx,
        workspaceScope,
        created.origin,
        provenanceOf(sessionId, created.origin.artifactRevision),
      );
      return {
        workspace: {
          published: true,
          ...key,
          artifactRevision: created.origin.artifactRevision,
        } satisfies WorkspaceOutcome,
      };
    }
    // A draft this session never wrote, or one edited since: not ours to
    // overwrite.
    if (expected === null) return conflict("draft_exists");
    if (found !== expected) return conflict("owner_edited");

    const edited = await workspace.editTransaction(
      wtx,
      workspaceScope,
      { ...key, artifactRevision: expected },
      { question: input.draft.question, answer: input.draft.answer },
    );
    // An edit clears provenance (a user edit would); the session's own write
    // marks the draft again at its new revision.
    await workspace.setProvenanceTransaction(
      wtx,
      workspaceScope,
      edited.origin,
      provenanceOf(sessionId, edited.origin.artifactRevision),
    );
    return {
      workspace: {
        published: true,
        ...key,
        artifactRevision: edited.origin.artifactRevision,
      } satisfies WorkspaceOutcome,
    };
  };
}

// [SAFETY] The purger runs inside the purge transaction (so it commits or rolls
// back with it) for the session's owner. It deletes only drafts that still carry
// the session's provenance mark: a draft the owner edited lost the mark, and a
// draft a saved answer revision refers to is the owner's record (revisions are
// immutable and reference it), so both stay.
export const sessionDraftPurger: SessionDraftPurger = {
  async purge(client, target) {
    const result = await client.query(
      `DELETE FROM interview.assistant_drafts d
       WHERE d.tenant_id = $1 AND d.actor_id = $2 AND d.product_id = $3
         AND d.workspace_id = $4
         AND starts_with(COALESCE(d.provenance->>'proposalId', ''), $5)
         AND NOT EXISTS (
           SELECT 1 FROM interview.assistant_answer_revisions r
           WHERE r.tenant_id = d.tenant_id AND r.actor_id = d.actor_id
             AND r.product_id = d.product_id AND r.workspace_id = d.workspace_id
             AND r.artifact_id = d.artifact_id)
         AND NOT EXISTS (
           SELECT 1 FROM interview.assistant_reverts v
           WHERE v.tenant_id = d.tenant_id AND v.actor_id = d.actor_id
             AND v.product_id = d.product_id AND v.workspace_id = d.workspace_id
             AND v.artifact_id = d.artifact_id)`,
      [
        target.tenantId,
        target.ownerUserId,
        INTERVIEW_PRODUCT_ID,
        sessionWorkspaceId(target.sessionId),
        sessionProposalId(target.sessionId),
      ],
    );
    return result.rowCount ?? 0;
  },
};
