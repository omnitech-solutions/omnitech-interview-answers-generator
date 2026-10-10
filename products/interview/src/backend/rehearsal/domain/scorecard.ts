import {
  MAX_SESSION_HINTS,
  type PlanItemStatus,
  type RehearsalSession,
  rehearsalScore,
} from "@omnitech/interview-contracts";

// The rehearsal scorecard's rules, with no I/O.

export type SessionHints =
  | { refused: "rehearsal-strictness-mismatch" | "rehearsal-run-already-saved" }
  | { hints: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Session rows key tenant and owner by uuid; any other scope has none.
export const scopeHasSessions = (scope: {
  tenantId: string;
  actorId: string;
}) => UUID.test(scope.tenantId) && UUID.test(scope.actorId);

// [DOMAIN] A strictness claim that disagrees with a matching session is
// refused; otherwise the drafts shown in non-strict sessions are the hints,
// bounded. No matching session counts nothing and refuses nothing.
export function hintsOfSessions(
  sessions: readonly Record<string, unknown>[],
  strict: boolean,
): SessionHints {
  if (sessions.some((row) => Boolean(row["strict"]) !== strict))
    return { refused: "rehearsal-strictness-mismatch" };
  const shown = sessions
    .filter((row) => !row["strict"])
    .reduce((sum, row) => sum + Number(row["shown_draft_count"]), 0);
  return { hints: Math.min(MAX_SESSION_HINTS, Math.max(0, shown)) };
}

// [DOMAIN] The score comes from what was ticked and opened, not the client;
// session hints cost like extra reveals but are not stored as reveals.
export function scoredRehearsal<
  Input extends { checks: readonly unknown[]; reveals: readonly unknown[] },
>(input: Input, hints: number | undefined) {
  const checks = [...new Set(input.checks)];
  const reveals = [...new Set(input.reveals)];
  return {
    value: {
      ...input,
      checks,
      reveals,
      ...(hints === undefined ? {} : { sessionHints: hints }),
    },
    score: rehearsalScore(checks.length, reveals.length + (hints ?? 0)),
  };
}

// The latest rehearsal, as Home's plan reports it.
export function statusOfLatestScore(
  row: Record<string, unknown> | undefined,
): PlanItemStatus {
  if (!row) return { label: "Not rehearsed yet", tone: "neutral" };
  const score = Number(row["score"]);
  return {
    label: `Last score ${score}`,
    tone: score >= 75 ? "good" : "warn",
  };
}

export function sessionOfRow(row: Record<string, unknown>): RehearsalSession {
  return {
    ...(row["value"] as Omit<RehearsalSession, "id" | "score">),
    id: String(row["id"]),
    score: Number(row["score"]),
  };
}
