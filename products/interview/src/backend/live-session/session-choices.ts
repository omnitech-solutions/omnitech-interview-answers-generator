// What the Studio Live setup screen needs to start a session, and nothing
// else: the owner's candidacies and interviews (the same links confirmLinks in
// repository.ts authorizes at start) and the owner's approved candidate-profile
// revisions. Every query repeats confirmLinks' ownership predicate, so a choice
// offered here is a choice a start is not refused for. Titles, labels, dates
// and counts only: no matrix text, notes, job description or research.
import type { PlatformDatabase } from "@omnitech/database";
import {
  readCandidacyRows,
  readInterviewRows,
  readProfileRevisionRows,
} from "./repositories/choices.repository";
import { inOwnerScope, type OwnerScope } from "./scope";

const MAX_CANDIDACIES = 50;
const MAX_INTERVIEWS_PER_CANDIDACY = 20;
const MAX_PROFILE_REVISIONS = 50;

type InterviewChoice = {
  id: string;
  label: string;
  kind: string;
  scheduledAt: string | null;
};
type CandidacyChoice = {
  id: string;
  title: string;
  companyName: string;
  createdAt: string;
  hasJobSpec: boolean;
  hasBrief: boolean;
  interviews: InterviewChoice[];
};
type ProfileChoice = {
  profileId: string;
  name: string;
  revision: number;
  createdAt: string;
  // The number of roles in the revision's matrix.
  entryCount: number;
  latest: boolean;
};
export type SessionChoices = {
  candidacies: CandidacyChoice[];
  profiles: ProfileChoice[];
};

const iso = (value: unknown): string => new Date(value as string).toISOString();

export async function getSessionChoices(
  database: PlatformDatabase,
  scope: OwnerScope,
): Promise<SessionChoices> {
  return inOwnerScope(database, scope, async (tx) => {
    // [GUARD] A candidacy is the owner's only through member_people, the same
    // join the start's link check uses.
    const candidacyRows = await readCandidacyRows(tx, scope, MAX_CANDIDACIES);
    const candidacyIds = candidacyRows.map((row) => String(row["id"]));
    const interviewRows =
      candidacyIds.length === 0
        ? []
        : await readInterviewRows(
            tx,
            scope,
            candidacyIds,
            MAX_CANDIDACIES * MAX_INTERVIEWS_PER_CANDIDACY,
          );
    const interviewsByCandidacy = new Map<string, InterviewChoice[]>();
    for (const row of interviewRows) {
      const list = interviewsByCandidacy.get(String(row["candidacy_id"])) ?? [];
      list.push({
        id: String(row["id"]),
        label: String(row["label"]),
        kind: String(row["kind"]),
        scheduledAt: row["scheduled_at"] ? iso(row["scheduled_at"]) : null,
      });
      interviewsByCandidacy.set(String(row["candidacy_id"]), list);
    }

    // Approved revisions of the owner's profiles that are not revoked, the
    // ones a start may pin. The matrix is reduced to a count in the database.
    const profileRows = await readProfileRevisionRows(
      tx,
      scope,
      MAX_PROFILE_REVISIONS,
    );

    return {
      candidacies: candidacyRows.map((row) => ({
        id: String(row["id"]),
        title: String(row["title"]),
        companyName: String(row["company_name"]),
        createdAt: iso(row["created_at"]),
        hasJobSpec: row["has_job_spec"] === true,
        hasBrief: row["has_brief"] === true,
        interviews: interviewsByCandidacy.get(String(row["id"])) ?? [],
      })),
      profiles: profileRows.map((row) => ({
        profileId: String(row["id"]),
        name: String(row["name"]),
        revision: Number(row["revision"]),
        createdAt: iso(row["created_at"]),
        entryCount: Number(row["entry_count"]),
        latest: Number(row["revision"]) === Number(row["current_revision"]),
      })),
    };
  });
}
