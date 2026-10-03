// What the ended view says, derived from the session record and the results the
// store holds. Pure: no fetching, no React. Every sentence here is a claim the
// product makes about a finished session, so each one rests on a rule:
//   - nothing was promoted:       ADR-0011 rule:no-promotion
//   - retention modes and purge:  ADR-0012/retention-modes, complete-session-purge
//   - the hint count:             ADR-0012/tombstone-keeps-hint-count
// Answer drafts and code are session content: they are returned as plain text
// for the view to render inertly (rule:inert-draft-rendering).
import type {
  LiveAction,
  LiveRetentionMode,
  LiveSessionView,
} from "@omnitech/interview-contracts";
import { CLAIM_KINDS, type ClaimKind } from "./session-results";
import type { TaskKind, TaskView } from "./session-tasks";

// ---- Dates ----------------------------------------------------------------

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

// "3 Oct 2026". The server's UTC day, so the same session reads the same
// anywhere; the view says UTC where the hour is shown.
export function formatDay(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? "" : DATE.format(time);
}
export function formatDayTime(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time)
    ? ""
    : `${DATE.format(time)}, ${TIME.format(time)} UTC`;
}

// ---- Retention --------------------------------------------------------------

export const RETENTION_MODES: readonly LiveRetentionMode[] = [
  "delete-at-end",
  "thirty-days",
  "until-deleted",
];
export const RETENTION_LABEL: Record<LiveRetentionMode, string> = {
  "delete-at-end": "Delete at end",
  "thirty-days": "30 days",
  "until-deleted": "Until I delete",
};
// What a purge does not reach, and what is never stored at all. ADR-0012: a
// draft the owner promoted or exported to a Document is outside the purge
// (promotion clears its session provenance) and raw audio is never stored.
export const PROMOTED_NOTE =
  "Raw audio is never stored. Drafts you promoted or exported to a Document are not part of the session and are not deleted with it.";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// What the chosen mode means for this session, in one sentence.
export function retentionMeaning(
  session: Pick<LiveSessionView, "retention" | "endedAt">,
): string {
  switch (session.retention) {
    case "delete-at-end":
      return "Session data is deleted as soon as the session ends.";
    case "thirty-days": {
      const ended = session.endedAt ? Date.parse(session.endedAt) : Number.NaN;
      return Number.isNaN(ended)
        ? "Kept for 30 days after the session ends, then deleted."
        : `Kept until ${DATE.format(ended + THIRTY_DAYS_MS)} (UTC), then deleted.`;
    }
    case "until-deleted":
      return "Kept until you delete it.";
  }
}

// Retention can only be shortened (ADR-0012/owner-chooses-retention): the modes
// strictly shorter than the current one.
export function shorterRetentions(
  current: LiveRetentionMode,
): LiveRetentionMode[] {
  return RETENTION_MODES.slice(0, RETENTION_MODES.indexOf(current));
}

// ---- Target -----------------------------------------------------------------

export type TargetChoices = {
  candidacies: {
    id: string;
    title: string;
    interviews: { id: string; label: string }[];
  }[];
};

// The agreed target's name. The session record carries ids only, so the title
// comes from the setup choices when they can be read; without them it says
// what kind of target it was, never a guess at a name.
export function targetTitle(
  session: Pick<
    LiveSessionView,
    "rehearsalRunId" | "interviewId" | "candidacyId"
  >,
  choices: TargetChoices | null,
): string {
  if (session.rehearsalRunId) return "Rehearsal";
  const candidacy = choices?.candidacies.find(
    (item) => item.id === session.candidacyId,
  );
  const interview = candidacy?.interviews.find(
    (item) => item.id === session.interviewId,
  );
  if (candidacy && interview) return `${candidacy.title} · ${interview.label}`;
  if (candidacy) return candidacy.title;
  if (session.interviewId) return "Interview";
  if (session.candidacyId) return "Candidacy";
  return "No interview linked";
}

// ---- Answer drafts ----------------------------------------------------------

const KIND_TITLE: Record<TaskKind, string> = {
  "experience-question": "Experience answer",
  "leadership-behavioural": "Leadership answer",
  logistics: "Logistics answer",
  concept: "Concept answer",
  "programming-challenge": "Coding task",
  other: "Answer draft",
  unclassified: "Answer draft",
};
const CLAIM_COUNT_LABEL: Record<ClaimKind, string> = {
  "matrix-backed": "matrix-backed",
  "preference-backed": "from your preferences",
  "suggested-interpretation": "interpretation",
  "general-knowledge": "general knowledge",
  "not-in-matrix": "not in your matrix",
};

export type AnswerRow = {
  taskId: string;
  title: string;
  // "2 matrix-backed · 1 interpretation": only kinds that occur.
  claims: string;
  // The draft, as plain text to copy and to show inertly.
  draft: string;
  // Published for an earlier revision of the task, not its current one.
  stale: boolean;
};

export function answerRows(tasks: readonly TaskView[]): AnswerRow[] {
  const rows: AnswerRow[] = [];
  for (const task of tasks) {
    if (task.kind === "programming-challenge" || !task.answer) continue;
    const parts = CLAIM_KINDS.filter(
      (kind) => task.answer?.claimCounts[kind],
    ).map(
      (kind) => `${task.answer?.claimCounts[kind]} ${CLAIM_COUNT_LABEL[kind]}`,
    );
    rows.push({
      taskId: task.taskId,
      title: `${KIND_TITLE[task.kind]} ${rows.length + 1}`,
      claims: parts.length > 0 ? parts.join(" · ") : "No claims",
      draft: task.answer.draft,
      stale: task.answerStale,
    });
  }
  return rows;
}

// ---- Withheld drafts --------------------------------------------------------

// Drafts the server withheld because a claim failed verification, and (when the
// server recorded it) how many claims. The count is content-free; the claim
// text is never kept, so it is never shown.
export type WithheldNotice = { drafts: number; claims: number | null };

function rejectedClaims(action: LiveAction): number | null {
  const holders: unknown[] = [action, action.result];
  for (const holder of holders) {
    if (typeof holder !== "object" || holder === null) continue;
    const record = holder as Record<string, unknown>;
    const direct = record["rejectedClaimCount"];
    if (typeof direct === "number" && Number.isInteger(direct) && direct >= 0)
      return direct;
    const nested = record["withheld"];
    if (typeof nested === "object" && nested !== null) {
      const count = (nested as Record<string, unknown>)["rejectedClaimCount"];
      if (typeof count === "number" && Number.isInteger(count) && count >= 0)
        return count;
    }
  }
  return null;
}

export function withheldNotice(
  actions: readonly LiveAction[],
): WithheldNotice | null {
  const withheld = actions.filter(
    (action) =>
      action.actionKind === "draft-answer" &&
      action.dispatchStatus === "suppressed" &&
      action.suppressionReason?.split(".")[0] === "invalid_output",
  );
  if (withheld.length === 0) return null;
  const counts = withheld.map(rejectedClaims);
  const known = counts.filter((count): count is number => count !== null);
  return {
    drafts: withheld.length,
    claims: known.length > 0 ? known.reduce((a, b) => a + b, 0) : null,
  };
}

// ---- Coding drafts ----------------------------------------------------------

export type CodingRow = {
  taskId: string;
  title: string;
  // True when a draft exists in the session's Workspace to open.
  hasDraft: boolean;
  // generated / tests passed / fully verified, said separately; or that the
  // session ended before a draft was ready.
  summary: string;
  // The newest solution was not applied because the draft was edited.
  held: boolean;
  stale: boolean;
};

// The three states stay distinct (ADR-0011 coding states): "generated tests
// passed" never implies "fully verified".
export function codeSummary(task: TaskView): string {
  const code = task.code;
  if (!code) return "Ended before a draft was ready";
  const { generated, testsPassed, fullyVerified } = code.states;
  const tests = code.tests;
  const head = !generated
    ? "Draft not generated"
    : tests.total > 0
      ? `${tests.passed} of ${tests.total} generated tests passed`
      : testsPassed
        ? "Generated tests passed"
        : "Draft generated · tests did not run";
  return `${head} · ${fullyVerified ? "fully verified" : "not fully verified"}`;
}

// A row per coding task. A session that targeted a Workspace draft but found
// no coding task still says it ended before a draft was ready.
export function codingRows(
  tasks: readonly TaskView[],
  targetedWorkspace: boolean,
): CodingRow[] {
  const coding = tasks.filter((task) => task.kind === "programming-challenge");
  if (coding.length === 0)
    return targetedWorkspace
      ? [
          {
            taskId: "",
            title: "Workspace draft",
            hasDraft: false,
            summary: "Ended before a draft was ready",
            held: false,
            stale: false,
          },
        ]
      : [];
  return coding.map((task, index) => ({
    taskId: task.taskId,
    title:
      coding.length > 1 ? `Workspace draft ${index + 1}` : "Workspace draft",
    hasDraft: task.draft !== null,
    summary: codeSummary(task),
    held: task.heldResult,
    stale: task.codeStale,
  }));
}
