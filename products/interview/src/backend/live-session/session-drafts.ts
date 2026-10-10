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
// answer, briefing or question edit clears provenance (workspace.ts
// editTransaction) but a notes or progress edit does not, so the purger also
// compares the draft's revision with the one the session last wrote: it deletes
// only drafts still byte-for-byte the session's own and that no saved answer
// revision refers to.
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
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import {
  InterviewWorkspaceRepository,
  interviewDraftSchema,
  type WorkspaceScope,
  type WorkspaceTransaction,
} from "../assistant/workspace";
import type { CodingBrief } from "./assist-stage";
import type { CodeStates } from "./code-states";
import { CODING_ACTION_KIND, type CodingSolution } from "./coding-stage";
import type { PublishEffect } from "./fenced-writes";
import type { WorkspaceDraftKey } from "./mapping";
import { lastPublishedDraftRevision } from "./repositories/action.repository";
import {
  deleteSessionOwnedDrafts,
  lockDraftRevision,
} from "./repositories/draft.repository";
import type { SessionDraftPurger } from "./session-purge";

export const sessionWorkspaceId = (sessionId: string): string =>
  `active-session:${sessionId}`;
// The draft's artifact is derived from the task, so every revision of one task
// updates the same draft.
export const sessionArtifactId = (taskId: string): string => `coding:${taskId}`;
const sessionDraftKey = (
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
    const last = await lastPublishedDraftRevision(
      tx,
      scope,
      sessionId,
      taskId,
      CODING_ACTION_KIND,
    );
    const expected =
      last?.revision === null || last?.revision === undefined
        ? null
        : Number(last.revision);

    const stored = await lockDraftRevision(tx, {
      tenantId: scope.tenantId,
      actorId: scope.actorId,
      productId: INTERVIEW_PRODUCT_ID,
      workspaceId: key.workspaceId,
      artifactId: key.artifactId,
    });
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
// back with it) for the session's owner, BEFORE the session's actions are
// deleted. It deletes only drafts that are still byte-for-byte what the session
// wrote: the provenance mark is present AND the draft's revision equals the
// revision the session's newest published result recorded. Every owner edit of
// any field (answer, question, notes, progress) bumps the revision, but only an
// answer, briefing or question edit clears the mark, so the mark alone would
// delete a draft whose notes or progress the owner wrote. A draft a saved answer
// revision refers to is the owner's record (revisions are immutable and
// reference it), so it stays too.
export const sessionDraftPurger: SessionDraftPurger = {
  async purge(client, target) {
    return deleteSessionOwnedDrafts(client, {
      tenantId: target.tenantId,
      ownerUserId: target.ownerUserId,
      productId: INTERVIEW_PRODUCT_ID,
      workspaceId: sessionWorkspaceId(target.sessionId),
      proposalId: sessionProposalId(target.sessionId),
      sessionId: target.sessionId,
      actionKind: CODING_ACTION_KIND,
    });
  },
};
