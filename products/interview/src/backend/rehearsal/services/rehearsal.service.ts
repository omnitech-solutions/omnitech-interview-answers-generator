import { randomUUID } from "node:crypto";
import type {
  PlanItemStatus,
  RehearsalSession,
  RehearsalSessionInput,
} from "@omnitech/interview-contracts";
import type {
  InterviewWorkspaceRepository,
  WorkspaceScope,
  WorkspaceTransaction,
} from "../../assistant/workspace";
import {
  hintsOfSessions,
  type SessionHints,
  scopeHasSessions,
  scoredRehearsal,
  sessionOfRow,
  statusOfLatestScore,
} from "../domain/scorecard";
import {
  activeSessionsOfRun,
  insertRehearsalRow,
  latestRehearsalScoreRow,
  listRehearsalRows,
  lockRehearsalRun,
  rehearsalRunSaved,
} from "../repository";

// Rehearsal use cases. Each opens one tenant transaction through the workspace.
type Workspace = Pick<InterviewWorkspaceRepository, "transaction">;

// [SAFETY] [DOMAIN] The hint count is derived here, never taken from the
// client (rule:assistance-counts-as-hints, rule:no-second-scorecard). It reads
// only this member's own Active Session rows for the run id, tombstones
// included because a purge keeps the count (rule:tombstone-keeps-hint-count);
// row security pins tenant and actor, and the query repeats both. A run id
// derives ONCE: a later save for the same run id is refused, decided under a
// per-run advisory lock so two racing saves cannot both count. A strictness
// claim that disagrees with the matching session is refused; when no session
// matches, nothing is counted and nothing is refused.
async function deriveSessionHints(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  rehearsalRunId: string,
  strict: boolean,
): Promise<SessionHints> {
  await lockRehearsalRun(tx, scope, rehearsalRunId);
  if (await rehearsalRunSaved(tx, scope, rehearsalRunId))
    return { refused: "rehearsal-run-already-saved" };
  if (!scopeHasSessions(scope)) return { hints: 0 };
  return hintsOfSessions(
    await activeSessionsOfRun(tx, scope, rehearsalRunId),
    strict,
  );
}

export async function latestRehearsalStatus(
  workspace: Workspace,
  scope: WorkspaceScope,
): Promise<PlanItemStatus> {
  return statusOfLatestScore(
    await workspace.transaction(scope, (tx) =>
      latestRehearsalScoreRow(tx, scope),
    ),
  );
}

export async function listRehearsals(
  workspace: Workspace,
  scope: WorkspaceScope,
): Promise<RehearsalSession[]> {
  const rows = await workspace.transaction(scope, (tx) =>
    listRehearsalRows(tx, scope),
  );
  return rows.map(sessionOfRow);
}

// Saved once: derive the run's hints under its lock, score, then store.
export function saveRehearsal(
  workspace: Workspace,
  scope: WorkspaceScope,
  input: RehearsalSessionInput,
): Promise<
  | { refused: Extract<SessionHints, { refused: string }>["refused"] }
  | {
      session: RehearsalSession;
    }
> {
  return workspace.transaction(scope, async (tx) => {
    const derived =
      input.rehearsalRunId === undefined
        ? undefined
        : await deriveSessionHints(
            tx,
            scope,
            input.rehearsalRunId,
            input.strict,
          );
    if (derived && "refused" in derived) return derived;
    const { value, score } = scoredRehearsal(input, derived?.hints);
    const row = await insertRehearsalRow(tx, scope, {
      id: randomUUID(),
      format: input.format,
      score,
      value,
      endedAt: input.endedAt,
    });
    return { session: sessionOfRow(row) };
  });
}
