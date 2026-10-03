// Test support for the replay-evidence and prompt-injection suites: reading the
// labelled blocks of a session prompt, building a verbatim reference to an
// entry the prompt really carries, scripting the fake gateway from what a
// prompt carries, and reading back the facts a hostile input must not change
// (the matrix and catalogue tables, the session row's privacy columns).
// Synthetic and content-free by construction. Tests, not production code,
// import this.
import type { AiExecutionRequest } from "@omnitech/ai-contracts";
import type { Fixture } from "./live-session-fixture.js";

export type PromptEntry = {
  sourceId: string;
  revision: number;
  pointer: string;
  text: string;
};

// The labelled data blocks of a session prompt: "BEGIN <LABEL> ..." then one
// JSON line, then "END <LABEL>".
export function blockJson<T = PromptEntry[]>(prompt: string, label: string): T {
  const lines = prompt.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`BEGIN ${label}`));
  return JSON.parse(lines[start + 1] ?? "[]") as T;
}

// A prompt with every labelled block's body removed: what is left is the
// header (task id, revision) and the block markers, never data.
export function outsideBlocks(prompt: string): string {
  const kept: string[] = [];
  let inside = false;
  for (const line of prompt.split("\n")) {
    if (line.startsWith("BEGIN ")) {
      inside = true;
      kept.push(line.replace(/\(.*$/, "").trim());
    } else if (line.startsWith("END ")) {
      inside = false;
      kept.push(line);
    } else if (!inside) kept.push(line);
  }
  return kept.join("\n");
}

export const capturedLines = (request: AiExecutionRequest) =>
  blockJson<{ speaker: string; text: string }[]>(
    request.task.prompt,
    "CAPTURED DATA",
  );
export const capturedText = (request: AiExecutionRequest) =>
  capturedLines(request)
    .map((line) => line.text)
    .join(" ");

// A verbatim reference to an entry the prompt really carries.
export function refFor(
  request: AiExecutionRequest,
  label: "APPROVED EXPERIENCE" | "CANDIDATE PREFERENCES",
  pointer: string,
) {
  const entry = blockJson(request.task.prompt, label).find(
    (item) => item.pointer === pointer,
  );
  if (!entry) throw new Error(`prompt carries no entry at ${pointer}`);
  return {
    sourceId: entry.sourceId,
    revision: entry.revision,
    pointer: entry.pointer,
    quote: entry.text,
  };
}

// The closed answer shape with every optional section null.
export const answer = (overrides: Record<string, unknown>) => ({
  category: "technical-concept",
  draft: "A short spoken outline.",
  claims: [],
  star: null,
  logistics: null,
  codingBrief: null,
  ...overrides,
});

// Every table the live session must never change, as a count and a digest of
// every row, read as the fixture owner.
const PROTECTED_TABLES = [
  "interview.candidate_profiles",
  "interview.candidate_profile_revisions",
  "interview.concept_briefs",
  "interview.briefing_proposals",
  "interview.rehearsal_sessions",
  "interview.assistant_evidence",
  "interview.assistant_answer_revisions",
  "practice.exercises",
  "practice.exercise_attempts",
] as const;
export async function protectedTableDigests(fx: Fixture) {
  return Object.fromEntries(
    await Promise.all(
      PROTECTED_TABLES.map(async (table) => {
        const result = await fx.owner.query(
          `SELECT count(*) AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS digest FROM ${table} t`,
        );
        return [table, `${result.rows[0].n}:${result.rows[0].digest}`];
      }),
    ),
  );
}

// The session row's privacy and pinning columns: immutable after start.
export async function sessionPrivacyColumns(fx: Fixture, sessionId: string) {
  const result = await fx.owner.query(
    `SELECT retention_mode, processing_policy, sources, strict, profile_id,
            profile_revision, workspace_draft_id, interview_id, candidacy_id,
            credential_hash, rehearsal_run_id
       FROM interview.active_sessions WHERE id = $1`,
    [sessionId],
  );
  return result.rows[0] as Record<string, unknown>;
}

// Agent jobs the session's owner has in the database.
export async function agentJobCount(fx: Fixture, ownerId: string) {
  const result = await fx.owner.query(
    "SELECT count(*)::int AS n FROM ai.agent_jobs WHERE user_id = $1",
    [ownerId],
  );
  return Number(result.rows[0].n);
}
