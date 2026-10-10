// The interview brief's storage (BRIEF-interview-brief-and-context-pack,
// section 3): an application's stages with their people, notes, transcripts
// and outcome, what the employer said, and the research documents.
//
// PROBLEM: one application's whole brief must be read and edited by the member
// it belongs to and by nobody else. STRATEGY: every function takes the
// tenant-scoped handle of a transaction opened by `withTenant` (so forced
// row-level security binds every statement, ADR-0005) and first settles that
// the application is the member's own; an application that is not answers
// exactly as one that does not exist. Everything is the query builder
// (ADR-0023): there is no raw statement here.
import type { TenantDatabase } from "@omnitech/database";
import {
  CARRIED_RESEARCH_ID,
  type EmployerSaidEntry,
  type EmployerSaidInput,
  INTERVIEW_BRIEF_BOUNDS,
  type InterviewBrief,
  type InterviewBriefErrorCode,
  type InterviewStage,
  mayLeaveDevice,
  type ResearchDocument,
  type ResearchDocumentDetail,
  STAGE_PERSON_ROLES,
  type StageCreate,
  type StagePersonInput,
  type StageTranscript,
  type StageTranscriptDetail,
  type StageUpdate,
  type TranscriptPolicy,
} from "@omnitech/interview-contracts";
import { and, asc, eq, inArray, isNull, max, ne, or } from "drizzle-orm";
import {
  employerSaidEntries,
  interviewTranscripts,
  researchDocuments,
} from "../db/brief";
import {
  candidacies,
  companies,
  interviewParticipants,
  interviews,
  memberPeople,
  people,
} from "../db/schema";
import { sha256Of, turnsOf } from "./transcript";

const BOUNDS = INTERVIEW_BRIEF_BOUNDS;

export type BriefScope = { tenantId: string; actorId: string };

// A refusal, by code alone: what was sent never rides along in an error.
export class BriefError extends Error {
  constructor(readonly code: InterviewBriefErrorCode) {
    super(code);
    this.name = "BriefError";
  }
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);
const blank = (value: string | null | undefined) =>
  value === null || value === undefined || value.trim() === "" ? null : value;

type Candidacy = {
  id: string;
  title: string;
  notes: string | null;
  companyId: string;
  companyName: string;
  companyResearch: string | null;
  jobDescription: string | null;
  employerBrief: unknown;
};

// [SAFETY] The application, only when it is the member's own: its candidate
// is the person this member is in the workspace.
async function ownedCandidacy(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
): Promise<Candidacy> {
  const [row] = await db
    .select({
      id: candidacies.id,
      title: candidacies.title,
      notes: candidacies.notes,
      companyId: candidacies.companyId,
      companyName: companies.name,
      companyResearch: companies.research,
      jobDescription: candidacies.jobDescription,
      employerBrief: candidacies.employerBrief,
    })
    .from(candidacies)
    .innerJoin(
      memberPeople,
      and(
        eq(memberPeople.tenantId, candidacies.tenantId),
        eq(memberPeople.personId, candidacies.candidatePersonId),
      ),
    )
    .innerJoin(
      companies,
      and(
        eq(companies.tenantId, candidacies.tenantId),
        eq(companies.id, candidacies.companyId),
      ),
    )
    .where(
      and(
        eq(candidacies.tenantId, scope.tenantId),
        eq(candidacies.id, candidacyId),
        eq(memberPeople.userId, scope.actorId),
      ),
    )
    .limit(1);
  if (!row) throw new BriefError("not-found");
  return row;
}

type StageRow = typeof interviews.$inferSelect;

async function stageRows(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
): Promise<StageRow[]> {
  return db
    .select()
    .from(interviews)
    .where(
      and(
        eq(interviews.tenantId, scope.tenantId),
        eq(interviews.candidacyId, candidacyId),
      ),
    )
    .orderBy(asc(interviews.ordinal));
}

// One stage of an application the member owns.
async function ownedStage(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
  stageId: string,
): Promise<{ candidacy: Candidacy; stage: StageRow }> {
  const candidacy = await ownedCandidacy(db, scope, candidacyId);
  const [stage] = await db
    .select()
    .from(interviews)
    .where(
      and(
        eq(interviews.tenantId, scope.tenantId),
        eq(interviews.candidacyId, candidacyId),
        eq(interviews.id, stageId),
      ),
    )
    .limit(1);
  if (!stage) throw new BriefError("not-found");
  return { candidacy, stage };
}

// The transcript's columns a list shows: never `content`.
const transcriptSummary = {
  id: interviewTranscripts.id,
  interviewId: interviewTranscripts.interviewId,
  title: interviewTranscripts.title,
  origin: interviewTranscripts.origin,
  originName: interviewTranscripts.originName,
  capturePolicy: interviewTranscripts.capturePolicy,
  occurredAt: interviewTranscripts.occurredAt,
  chars: interviewTranscripts.chars,
  turns: interviewTranscripts.turns,
  contentSha256: interviewTranscripts.contentSha256,
  createdAt: interviewTranscripts.createdAt,
  updatedAt: interviewTranscripts.updatedAt,
};
type TranscriptSummaryRow = {
  id: string;
  interviewId: string;
  title: string;
  origin: string;
  originName: string | null;
  capturePolicy: string;
  occurredAt: Date | null;
  chars: number;
  turns: number;
  contentSha256: string;
  createdAt: Date;
  updatedAt: Date;
};
const transcriptOf = (row: TranscriptSummaryRow): StageTranscript => {
  const capturePolicy = row.capturePolicy as TranscriptPolicy;
  return {
    id: row.id,
    stageId: row.interviewId,
    title: row.title,
    origin: row.origin as StageTranscript["origin"],
    originName: row.originName,
    capturePolicy,
    sendable: mayLeaveDevice({ capturePolicy }),
    occurredAt: iso(row.occurredAt),
    chars: row.chars,
    turns: row.turns,
    sha256: row.contentSha256,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
};

const entryOf = (
  row: typeof employerSaidEntries.$inferSelect,
): EmployerSaidEntry => ({
  id: row.id,
  said: row.said,
  saidBy: row.saidBy,
  channel: row.channel as EmployerSaidEntry["channel"],
  saidOn: row.saidOn,
  sha256: row.contentSha256,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

type ResearchRow = Omit<typeof researchDocuments.$inferSelect, "content">;
const researchSummary = {
  id: researchDocuments.id,
  tenantId: researchDocuments.tenantId,
  createdBy: researchDocuments.createdBy,
  createdAt: researchDocuments.createdAt,
  updatedAt: researchDocuments.updatedAt,
  ownerUserId: researchDocuments.ownerUserId,
  companyId: researchDocuments.companyId,
  candidacyId: researchDocuments.candidacyId,
  title: researchDocuments.title,
  origin: researchDocuments.origin,
  originRef: researchDocuments.originRef,
  contentSha256: researchDocuments.contentSha256,
  chars: researchDocuments.chars,
};
const researchOf = (row: ResearchRow): ResearchDocument => ({
  id: row.id,
  scope: row.candidacyId ? "application" : "company",
  title: row.title,
  origin: row.origin as ResearchDocument["origin"],
  originRef: row.originRef,
  chars: row.chars,
  sha256: row.contentSha256,
  carried: false,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
// [DOMAIN] The company's old single research text is offered as one document
// until the person keeps it: nothing is moved or rewritten by reading.
export const CARRIED_RESEARCH_TITLE = "Company research";
const carriedResearch = (text: string): ResearchDocumentDetail => ({
  id: CARRIED_RESEARCH_ID,
  scope: "company",
  title: CARRIED_RESEARCH_TITLE,
  origin: "pasted",
  originRef: null,
  chars: text.length,
  sha256: sha256Of(text),
  carried: true,
  createdAt: null,
  updatedAt: null,
  text,
});

// The research that bears on an application: the company's documents and the
// application's own, in the order they were added.
const researchFor = (scope: BriefScope, candidacy: Candidacy) =>
  and(
    eq(researchDocuments.tenantId, scope.tenantId),
    eq(researchDocuments.companyId, candidacy.companyId),
    or(
      isNull(researchDocuments.candidacyId),
      eq(researchDocuments.candidacyId, candidacy.id),
    ),
  );

async function peopleOf(
  db: TenantDatabase,
  scope: BriefScope,
  stageIds: readonly string[],
) {
  if (stageIds.length === 0) return [];
  return db
    .select({
      id: interviewParticipants.id,
      interviewId: interviewParticipants.interviewId,
      role: interviewParticipants.role,
      name: people.fullName,
      title: people.title,
      createdAt: interviewParticipants.createdAt,
    })
    .from(interviewParticipants)
    .innerJoin(
      people,
      and(
        eq(people.tenantId, interviewParticipants.tenantId),
        eq(people.id, interviewParticipants.personId),
      ),
    )
    .where(
      and(
        eq(interviewParticipants.tenantId, scope.tenantId),
        inArray(interviewParticipants.interviewId, [...stageIds]),
        // The candidate is the member; "other" has no place on the form.
        ne(interviewParticipants.role, "candidate"),
        ne(interviewParticipants.role, "other"),
      ),
    )
    .orderBy(asc(interviewParticipants.createdAt), asc(people.fullName));
}

function stagesOf(
  candidacy: Candidacy,
  rows: readonly StageRow[],
  participants: Awaited<ReturnType<typeof peopleOf>>,
  transcripts: readonly TranscriptSummaryRow[],
): InterviewStage[] {
  return rows.map((row, at) => ({
    id: row.id,
    // The place among the application's stages: 1 is the first, whatever
    // gaps a removal left in the stored numbers.
    ordinal: at + 1,
    kind: row.kind,
    label: row.label,
    scheduledAt: iso(row.scheduledAt),
    durationMinutes: row.durationMinutes,
    format: row.format,
    status: row.status,
    notes: blank(row.notes),
    // [DOMAIN] The application's old notes are offered to the first stage
    // while it has none of its own; they stay where they are until moved.
    offeredNotes:
      at === 0 && blank(row.notes) === null ? blank(candidacy.notes) : null,
    outcome: blank(row.outcome),
    nextSteps: blank(row.nextSteps),
    people: participants
      .filter((person) => person.interviewId === row.id)
      .map((person) => ({
        id: person.id,
        name: person.name,
        title: person.title,
        role: person.role as InterviewStage["people"][number]["role"],
      })),
    transcripts: transcripts
      .filter((transcript) => transcript.interviewId === row.id)
      .map(transcriptOf),
  }));
}

const saidOrder = (a: EmployerSaidEntry, b: EmployerSaidEntry) =>
  (a.saidOn ?? "").localeCompare(b.saidOn ?? "") ||
  a.createdAt.localeCompare(b.createdAt);

export async function readBrief(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
): Promise<InterviewBrief> {
  const candidacy = await ownedCandidacy(db, scope, candidacyId);
  const rows = await stageRows(db, scope, candidacyId);
  const stageIds = rows.map((row) => row.id);
  const participants = await peopleOf(db, scope, stageIds);
  const transcripts =
    stageIds.length === 0
      ? []
      : await db
          .select(transcriptSummary)
          .from(interviewTranscripts)
          .where(
            and(
              eq(interviewTranscripts.tenantId, scope.tenantId),
              inArray(interviewTranscripts.interviewId, stageIds),
            ),
          )
          .orderBy(
            asc(interviewTranscripts.occurredAt),
            asc(interviewTranscripts.createdAt),
          );
  const said = await db
    .select()
    .from(employerSaidEntries)
    .where(
      and(
        eq(employerSaidEntries.tenantId, scope.tenantId),
        eq(employerSaidEntries.candidacyId, candidacyId),
      ),
    );
  const research = await db
    .select(researchSummary)
    .from(researchDocuments)
    .where(researchFor(scope, candidacy))
    .orderBy(asc(researchDocuments.createdAt));
  const carried = blank(candidacy.companyResearch);
  return {
    candidacyId: candidacy.id,
    companyName: candidacy.companyName,
    title: candidacy.title,
    applicationNotes: blank(candidacy.notes),
    stages: stagesOf(candidacy, rows, participants, transcripts),
    employerSaid: said.map(entryOf).sort(saidOrder),
    research: [
      ...(carried
        ? [(({ text: _text, ...summary }) => summary)(carriedResearch(carried))]
        : []),
      ...research.map(researchOf),
    ],
  };
}

// ---- Stages ---------------------------------------------------------------

export async function addStage(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
  input: StageCreate,
): Promise<string> {
  await ownedCandidacy(db, scope, candidacyId);
  const rows = await stageRows(db, scope, candidacyId);
  if (rows.length >= BOUNDS.stages) throw new BriefError("limit-reached");
  const [last] = await db
    .select({ ordinal: max(interviews.ordinal) })
    .from(interviews)
    .where(
      and(
        eq(interviews.tenantId, scope.tenantId),
        eq(interviews.candidacyId, candidacyId),
      ),
    );
  const [made] = await db
    .insert(interviews)
    .values({
      tenantId: scope.tenantId,
      createdBy: scope.actorId,
      candidacyId,
      ordinal: (last?.ordinal ?? 0) + 1,
      kind: input.kind,
      label: input.label,
    })
    .returning({ id: interviews.id });
  if (!made) throw new BriefError("not-found");
  return made.id;
}

// [DOMAIN] A stage's people are `people` rows of the employer, tied to the
// stage by `interview_participants`. A person already known at that company
// under the same name is the same person (their title is brought up to
// date); the list given is the whole list.
async function replacePeople(
  db: TenantDatabase,
  scope: BriefScope,
  candidacy: Candidacy,
  stageId: string,
  input: readonly StagePersonInput[],
) {
  const known = await db
    .select({ id: people.id, name: people.fullName, title: people.title })
    .from(people)
    .where(
      and(
        eq(people.tenantId, scope.tenantId),
        eq(people.companyId, candidacy.companyId),
      ),
    );
  await db.delete(interviewParticipants).where(
    and(
      eq(interviewParticipants.tenantId, scope.tenantId),
      eq(interviewParticipants.interviewId, stageId),
      // Only the places the form shows: the candidate's own and an
      // "other" one are not its to remove.
      inArray(interviewParticipants.role, [...STAGE_PERSON_ROLES]),
    ),
  );
  const placed = new Set<string>();
  // One after another, so the order typed is the order read back.
  let at = 0;
  for (const person of input) {
    const role = person.role ?? "interviewer";
    const name = person.name.toLowerCase();
    let found = known.find((each) => each.name.toLowerCase() === name);
    if (!found) {
      const [made] = await db
        .insert(people)
        .values({
          tenantId: scope.tenantId,
          createdBy: scope.actorId,
          fullName: person.name,
          title: person.title ?? null,
          companyId: candidacy.companyId,
        })
        .returning({
          id: people.id,
          name: people.fullName,
          title: people.title,
        });
      if (!made) continue;
      found = made;
      known.push(made);
    } else if (person.title !== undefined && person.title !== found.title) {
      await db
        .update(people)
        .set({ title: person.title, updatedAt: new Date() })
        .where(
          and(eq(people.tenantId, scope.tenantId), eq(people.id, found.id)),
        );
      found.title = person.title;
    }
    // The same person in the same role twice is one participant.
    if (placed.has(`${found.id}:${role}`)) continue;
    placed.add(`${found.id}:${role}`);
    await db.insert(interviewParticipants).values({
      tenantId: scope.tenantId,
      createdBy: scope.actorId,
      interviewId: stageId,
      personId: found.id,
      role,
      // Kept apart by a millisecond each, so the read order is the typed one.
      createdAt: new Date(Date.now() + at),
    });
    at += 1;
  }
}

export async function updateStage(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
  stageId: string,
  input: StageUpdate,
): Promise<void> {
  const { candidacy } = await ownedStage(db, scope, candidacyId, stageId);
  const { people: listed, scheduledAt, ...fields } = input;
  const text = (value: string | null | undefined) =>
    value === undefined ? undefined : blank(value);
  const changes = {
    ...(fields.kind !== undefined ? { kind: fields.kind } : {}),
    ...(fields.label !== undefined ? { label: fields.label } : {}),
    ...(fields.status !== undefined ? { status: fields.status } : {}),
    ...(fields.format !== undefined ? { format: fields.format } : {}),
    ...(fields.durationMinutes !== undefined
      ? { durationMinutes: fields.durationMinutes }
      : {}),
    ...(scheduledAt !== undefined
      ? { scheduledAt: scheduledAt === null ? null : new Date(scheduledAt) }
      : {}),
    ...(fields.notes !== undefined ? { notes: text(fields.notes) } : {}),
    ...(fields.outcome !== undefined ? { outcome: text(fields.outcome) } : {}),
    ...(fields.nextSteps !== undefined
      ? { nextSteps: text(fields.nextSteps) }
      : {}),
  };
  if (Object.keys(changes).length > 0)
    await db
      .update(interviews)
      .set({ ...changes, updatedAt: new Date() })
      .where(
        and(
          eq(interviews.tenantId, scope.tenantId),
          eq(interviews.id, stageId),
        ),
      );
  if (listed) await replacePeople(db, scope, candidacy, stageId, listed);
}

// [DOMAIN] Removing a stage removes its people's places and its transcripts
// with it. A stage a live session or a document was made for is refused by
// the database (their references restrict), and the caller says so.
export async function removeStage(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
  stageId: string,
): Promise<void> {
  await ownedStage(db, scope, candidacyId, stageId);
  await db
    .delete(interviewParticipants)
    .where(
      and(
        eq(interviewParticipants.tenantId, scope.tenantId),
        eq(interviewParticipants.interviewId, stageId),
      ),
    );
  await db
    .delete(interviews)
    .where(
      and(eq(interviews.tenantId, scope.tenantId), eq(interviews.id, stageId)),
    );
}

// Whether a failure is a reference refusing a delete (SQLSTATE 23503).
export function isReferenced(error: unknown): boolean {
  for (
    let each: unknown = error, depth = 0;
    each && depth < 4;
    each = (each as { cause?: unknown }).cause, depth += 1
  )
    if ((each as { code?: unknown }).code === "23503") return true;
  return false;
}

// Every stage of the application, in the order wanted. The stored numbers are
// unique per application, so each stage is first moved out of the way.
export async function orderStages(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
  order: readonly string[],
): Promise<void> {
  await ownedCandidacy(db, scope, candidacyId);
  const rows = await stageRows(db, scope, candidacyId);
  const known = new Set(rows.map((row) => row.id));
  // [GUARD] Exactly the application's stages, each once.
  if (
    order.length !== rows.length ||
    new Set(order).size !== order.length ||
    order.some((id) => !known.has(id))
  )
    throw new BriefError("invalid-request");
  const away = Math.max(0, ...rows.map((row) => row.ordinal)) + order.length;
  const place = (id: string, ordinal: number) =>
    db
      .update(interviews)
      .set({ ordinal, updatedAt: new Date() })
      .where(
        and(eq(interviews.tenantId, scope.tenantId), eq(interviews.id, id)),
      );
  for (const [at, id] of order.entries()) await place(id, away + at + 1);
  for (const [at, id] of order.entries()) await place(id, at + 1);
}

// [DOMAIN] The carry-over of the application's old notes: they become the
// first stage's (after what it already holds), and the old field is emptied
// in the same transaction, so they are in one place before and after.
export async function moveApplicationNotes(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
): Promise<void> {
  const candidacy = await ownedCandidacy(db, scope, candidacyId);
  const [first] = await stageRows(db, scope, candidacyId);
  const notes = blank(candidacy.notes);
  if (!notes || !first) throw new BriefError("nothing-to-carry");
  const held = blank(first.notes);
  const moved = held ? `${held}\n\n${notes}` : notes;
  if (moved.length > BOUNDS.notesChars) throw new BriefError("limit-reached");
  await db
    .update(interviews)
    .set({ notes: moved, updatedAt: new Date() })
    .where(
      and(eq(interviews.tenantId, scope.tenantId), eq(interviews.id, first.id)),
    );
  await db
    .update(candidacies)
    .set({ notes: null, updatedAt: new Date() })
    .where(
      and(
        eq(candidacies.tenantId, scope.tenantId),
        eq(candidacies.id, candidacyId),
      ),
    );
}

// ---- Transcripts ----------------------------------------------------------

export type TranscriptInput = {
  title: string;
  origin: StageTranscript["origin"];
  originName?: string | undefined;
  capturePolicy: TranscriptPolicy;
  occurredAt?: string | undefined;
  text: string;
};

export async function addTranscript(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
  stageId: string,
  input: TranscriptInput,
): Promise<StageTranscript> {
  await ownedStage(db, scope, candidacyId, stageId);
  // [GUARD] Bounded, and something must have been said in it.
  if (input.text.length > BOUNDS.transcriptChars)
    throw new BriefError("body-too-large");
  const turns = turnsOf(input.text);
  if (turns.length === 0) throw new BriefError("invalid-transcript");
  const contentSha256 = sha256Of(input.text);
  const mine = and(
    eq(interviewTranscripts.tenantId, scope.tenantId),
    eq(interviewTranscripts.interviewId, stageId),
  );
  const held = await db
    .select(transcriptSummary)
    .from(interviewTranscripts)
    .where(mine);
  // The same words attached twice are the one transcript already there.
  const same = held.find((each) => each.contentSha256 === contentSha256);
  if (same) return transcriptOf(same);
  if (held.length >= BOUNDS.transcriptsPerStage)
    throw new BriefError("limit-reached");
  const [made] = await db
    .insert(interviewTranscripts)
    .values({
      tenantId: scope.tenantId,
      createdBy: scope.actorId,
      ownerUserId: scope.actorId,
      interviewId: stageId,
      title: input.title,
      origin: input.origin,
      originName: input.originName ?? null,
      capturePolicy: input.capturePolicy,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : null,
      content: input.text,
      contentSha256,
      chars: input.text.length,
      turns: turns.length,
    })
    .returning(transcriptSummary);
  if (!made) throw new BriefError("not-found");
  return transcriptOf(made);
}

const ownTranscript = (
  scope: BriefScope,
  stageId: string,
  transcriptId: string,
) =>
  and(
    eq(interviewTranscripts.tenantId, scope.tenantId),
    eq(interviewTranscripts.interviewId, stageId),
    eq(interviewTranscripts.id, transcriptId),
  );

export async function readTranscriptDetail(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
  stageId: string,
  transcriptId: string,
): Promise<StageTranscriptDetail> {
  await ownedStage(db, scope, candidacyId, stageId);
  const [row] = await db
    .select()
    .from(interviewTranscripts)
    .where(ownTranscript(scope, stageId, transcriptId))
    .limit(1);
  if (!row) throw new BriefError("not-found");
  return {
    ...transcriptOf(row),
    text: row.content,
    spoken: turnsOf(row.content),
  };
}

export async function updateTranscript(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
  stageId: string,
  transcriptId: string,
  input: {
    title?: string | undefined;
    occurredAt?: string | null | undefined;
    capturePolicy?: TranscriptPolicy | undefined;
  },
): Promise<StageTranscript> {
  await ownedStage(db, scope, candidacyId, stageId);
  const [current] = await db
    .select(transcriptSummary)
    .from(interviewTranscripts)
    .where(ownTranscript(scope, stageId, transcriptId))
    .limit(1);
  if (!current) throw new BriefError("not-found");
  // [SAFETY] The policy a transcript was RECORDED under is a fact about the
  // recording: a device-only recording is never made sendable afterwards.
  // What the person uploaded or pasted is theirs to decide either way.
  if (
    current.origin === "recorded" &&
    current.capturePolicy === "device-only" &&
    input.capturePolicy === "permitted-remote"
  )
    throw new BriefError("loosening-refused");
  const [saved] = await db
    .update(interviewTranscripts)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.occurredAt !== undefined
        ? {
            occurredAt:
              input.occurredAt === null ? null : new Date(input.occurredAt),
          }
        : {}),
      ...(input.capturePolicy !== undefined
        ? { capturePolicy: input.capturePolicy }
        : {}),
      updatedAt: new Date(),
    })
    .where(ownTranscript(scope, stageId, transcriptId))
    .returning(transcriptSummary);
  if (!saved) throw new BriefError("not-found");
  return transcriptOf(saved);
}

export async function removeTranscript(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
  stageId: string,
  transcriptId: string,
): Promise<void> {
  await ownedStage(db, scope, candidacyId, stageId);
  const removed = await db
    .delete(interviewTranscripts)
    .where(ownTranscript(scope, stageId, transcriptId))
    .returning({ id: interviewTranscripts.id });
  if (removed.length === 0) throw new BriefError("not-found");
}

// The recordings already attached to this application, by their file name.
export async function attachedRecordings(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
): Promise<Set<string>> {
  await ownedCandidacy(db, scope, candidacyId);
  const stageIds = (await stageRows(db, scope, candidacyId)).map(
    (row) => row.id,
  );
  if (stageIds.length === 0) return new Set();
  const rows = await db
    .select({ originName: interviewTranscripts.originName })
    .from(interviewTranscripts)
    .where(
      and(
        eq(interviewTranscripts.tenantId, scope.tenantId),
        inArray(interviewTranscripts.interviewId, stageIds),
        eq(interviewTranscripts.origin, "recorded"),
      ),
    );
  return new Set(
    rows.flatMap((row) => (row.originName ? [row.originName] : [])),
  );
}

// ---- Employer said --------------------------------------------------------

const saidHash = (entry: {
  said: string;
  saidBy?: string | null | undefined;
  channel?: string | null | undefined;
  saidOn?: string | null | undefined;
}) =>
  sha256Of(
    JSON.stringify([
      entry.said,
      entry.saidBy ?? null,
      entry.channel ?? null,
      entry.saidOn ?? null,
    ]),
  );

export async function addEmployerSaid(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
  input: EmployerSaidInput,
): Promise<EmployerSaidEntry> {
  await ownedCandidacy(db, scope, candidacyId);
  const held = await db
    .select({ id: employerSaidEntries.id })
    .from(employerSaidEntries)
    .where(
      and(
        eq(employerSaidEntries.tenantId, scope.tenantId),
        eq(employerSaidEntries.candidacyId, candidacyId),
      ),
    );
  if (held.length >= BOUNDS.employerSaidEntries)
    throw new BriefError("limit-reached");
  const [made] = await db
    .insert(employerSaidEntries)
    .values({
      tenantId: scope.tenantId,
      createdBy: scope.actorId,
      ownerUserId: scope.actorId,
      candidacyId,
      said: input.said,
      saidBy: input.saidBy ?? null,
      channel: input.channel ?? null,
      saidOn: input.saidOn ?? null,
      contentSha256: saidHash(input),
    })
    .returning();
  if (!made) throw new BriefError("not-found");
  return entryOf(made);
}

const ownEntry = (scope: BriefScope, candidacyId: string, entryId: string) =>
  and(
    eq(employerSaidEntries.tenantId, scope.tenantId),
    eq(employerSaidEntries.candidacyId, candidacyId),
    eq(employerSaidEntries.id, entryId),
  );

export async function updateEmployerSaid(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
  entryId: string,
  input: {
    said?: string | undefined;
    saidBy?: string | null | undefined;
    channel?: EmployerSaidEntry["channel"] | undefined;
    saidOn?: string | null | undefined;
  },
): Promise<EmployerSaidEntry> {
  await ownedCandidacy(db, scope, candidacyId);
  const [current] = await db
    .select()
    .from(employerSaidEntries)
    .where(ownEntry(scope, candidacyId, entryId))
    .limit(1);
  if (!current) throw new BriefError("not-found");
  const next = {
    said: input.said ?? current.said,
    saidBy: input.saidBy === undefined ? current.saidBy : input.saidBy,
    channel: input.channel === undefined ? current.channel : input.channel,
    saidOn: input.saidOn === undefined ? current.saidOn : input.saidOn,
  };
  const [saved] = await db
    .update(employerSaidEntries)
    .set({ ...next, contentSha256: saidHash(next), updatedAt: new Date() })
    .where(ownEntry(scope, candidacyId, entryId))
    .returning();
  if (!saved) throw new BriefError("not-found");
  return entryOf(saved);
}

export async function removeEmployerSaid(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
  entryId: string,
): Promise<void> {
  await ownedCandidacy(db, scope, candidacyId);
  const removed = await db
    .delete(employerSaidEntries)
    .where(ownEntry(scope, candidacyId, entryId))
    .returning({ id: employerSaidEntries.id });
  if (removed.length === 0) throw new BriefError("not-found");
}

// ---- Research -------------------------------------------------------------

export type ResearchInput = {
  scope: ResearchDocument["scope"];
  title: string;
  origin: ResearchDocument["origin"];
  originRef?: string | undefined;
  text: string;
};

async function insertResearch(
  db: TenantDatabase,
  scope: BriefScope,
  candidacy: Candidacy,
  input: ResearchInput,
): Promise<ResearchDocument> {
  if (input.text.length > BOUNDS.researchChars)
    throw new BriefError("body-too-large");
  const held = await db
    .select({ id: researchDocuments.id })
    .from(researchDocuments)
    .where(researchFor(scope, candidacy));
  if (held.length >= BOUNDS.researchDocuments)
    throw new BriefError("limit-reached");
  const [made] = await db
    .insert(researchDocuments)
    .values({
      tenantId: scope.tenantId,
      createdBy: scope.actorId,
      ownerUserId: scope.actorId,
      companyId: candidacy.companyId,
      candidacyId: input.scope === "application" ? candidacy.id : null,
      title: input.title,
      origin: input.origin,
      originRef: input.originRef ?? null,
      content: input.text,
      contentSha256: sha256Of(input.text),
      chars: input.text.length,
    })
    .returning(researchSummary);
  if (!made) throw new BriefError("not-found");
  return researchOf(made);
}

export async function addResearch(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
  input: ResearchInput,
): Promise<ResearchDocument> {
  return insertResearch(
    db,
    scope,
    await ownedCandidacy(db, scope, candidacyId),
    input,
  );
}

export async function readResearch(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
  documentId: string,
): Promise<ResearchDocumentDetail> {
  const candidacy = await ownedCandidacy(db, scope, candidacyId);
  if (documentId === CARRIED_RESEARCH_ID) {
    const carried = blank(candidacy.companyResearch);
    if (!carried) throw new BriefError("not-found");
    return carriedResearch(carried);
  }
  const [row] = await db
    .select()
    .from(researchDocuments)
    .where(
      and(researchFor(scope, candidacy), eq(researchDocuments.id, documentId)),
    )
    .limit(1);
  if (!row) throw new BriefError("not-found");
  return { ...researchOf(row), text: row.content };
}

export async function updateResearch(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
  documentId: string,
  input: {
    scope?: ResearchDocument["scope"] | undefined;
    title?: string | undefined;
    text?: string | undefined;
  },
): Promise<ResearchDocument> {
  const candidacy = await ownedCandidacy(db, scope, candidacyId);
  const [saved] = await db
    .update(researchDocuments)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.scope !== undefined
        ? { candidacyId: input.scope === "application" ? candidacy.id : null }
        : {}),
      ...(input.text !== undefined
        ? {
            content: input.text,
            contentSha256: sha256Of(input.text),
            chars: input.text.length,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(researchFor(scope, candidacy), eq(researchDocuments.id, documentId)),
    )
    .returning(researchSummary);
  if (!saved) throw new BriefError("not-found");
  return researchOf(saved);
}

export async function removeResearch(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
  documentId: string,
): Promise<void> {
  const candidacy = await ownedCandidacy(db, scope, candidacyId);
  const removed = await db
    .delete(researchDocuments)
    .where(
      and(researchFor(scope, candidacy), eq(researchDocuments.id, documentId)),
    )
    .returning({ id: researchDocuments.id });
  if (removed.length === 0) throw new BriefError("not-found");
}

// [DOMAIN] The carry-over of the company's old research text: kept as one
// document of the company, and the old field emptied in the same transaction.
export async function keepCarriedResearch(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
): Promise<ResearchDocument> {
  const candidacy = await ownedCandidacy(db, scope, candidacyId);
  const carried = blank(candidacy.companyResearch);
  if (!carried) throw new BriefError("nothing-to-carry");
  const kept = await insertResearch(db, scope, candidacy, {
    scope: "company",
    title: CARRIED_RESEARCH_TITLE,
    origin: "pasted",
    text: carried,
  });
  await db
    .update(companies)
    .set({ research: null, updatedAt: new Date() })
    .where(
      and(
        eq(companies.tenantId, scope.tenantId),
        eq(companies.id, candidacy.companyId),
      ),
    );
  return kept;
}

// ---- The whole brief, with its words, for the context pack -----------------

// What the pack is prepared from (context-pack/brief-sources.ts): the same
// brief, with every text. Read in the owner's scope like everything above.
export type BriefMaterial = {
  candidacyId: string;
  // The job posting as the person pasted it; null when there is none. Read by
  // a model only when the application's context pack is prepared.
  posting?: string | null;
  stages: Array<{
    id: string;
    ordinal: number;
    kind: string;
    label: string;
    scheduledAt: string | null;
    durationMinutes: number | null;
    format: string | null;
    // The stage's own notes, or the application's old notes while they are
    // only offered to the first stage (`carried`).
    notes: string | null;
    notesCarried: boolean;
    outcome: string | null;
    nextSteps: string | null;
    people: Array<{ name: string; title: string | null; role: string }>;
    transcripts: Array<{
      id: string;
      title: string;
      origin: string;
      capturePolicy: TranscriptPolicy;
      occurredAt: string | null;
      sha256: string;
      text: string;
    }>;
  }>;
  employerSaid: Array<{
    id: string;
    said: string;
    saidBy: string | null;
    channel: string | null;
    saidOn: string | null;
    sha256: string;
  }>;
  research: Array<{
    id: string;
    scope: "company" | "application";
    title: string;
    origin: string;
    originRef: string | null;
    sha256: string;
    text: string;
    carried: boolean;
  }>;
};

// [DOMAIN] The member's one application to a company for a role, by their
// names as typed (case and surrounding space aside), or null: none, or more
// than one, so no one application is meant.
export async function findCandidacy(
  db: TenantDatabase,
  scope: BriefScope,
  named: { company: string; role: string },
): Promise<string | null> {
  const rows = await db
    .select({
      id: candidacies.id,
      title: candidacies.title,
      company: companies.name,
    })
    .from(candidacies)
    .innerJoin(
      memberPeople,
      and(
        eq(memberPeople.tenantId, candidacies.tenantId),
        eq(memberPeople.personId, candidacies.candidatePersonId),
      ),
    )
    .innerJoin(
      companies,
      and(
        eq(companies.tenantId, candidacies.tenantId),
        eq(companies.id, candidacies.companyId),
      ),
    )
    .where(
      and(
        eq(candidacies.tenantId, scope.tenantId),
        eq(memberPeople.userId, scope.actorId),
      ),
    )
    .limit(500);
  const same = (a: string, b: string) =>
    a.trim().toLowerCase() === b.trim().toLowerCase();
  const found = rows.filter(
    (row) => same(row.company, named.company) && same(row.title, named.role),
  );
  return found.length === 1 ? (found[0]?.id ?? null) : null;
}

// The application's model-cleaned employer brief as it is stored (validated
// by its reader), or null: the member's own application only.
export async function readEmployerBrief(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
): Promise<unknown> {
  return (await ownedCandidacy(db, scope, candidacyId)).employerBrief ?? null;
}

export async function readBriefMaterial(
  db: TenantDatabase,
  scope: BriefScope,
  candidacyId: string,
): Promise<BriefMaterial> {
  const candidacy = await ownedCandidacy(db, scope, candidacyId);
  const brief = await readBrief(db, scope, candidacyId);
  const stageIds = brief.stages.map((stage) => stage.id);
  const contents =
    stageIds.length === 0
      ? []
      : await db
          .select({
            id: interviewTranscripts.id,
            content: interviewTranscripts.content,
          })
          .from(interviewTranscripts)
          .where(
            and(
              eq(interviewTranscripts.tenantId, scope.tenantId),
              inArray(interviewTranscripts.interviewId, stageIds),
            ),
          );
  const textOf = new Map(contents.map((row) => [row.id, row.content]));
  const documents = await db
    .select({ id: researchDocuments.id, content: researchDocuments.content })
    .from(researchDocuments)
    .where(researchFor(scope, candidacy));
  const researchText = new Map(documents.map((row) => [row.id, row.content]));
  return {
    candidacyId,
    posting: blank(candidacy.jobDescription),
    stages: brief.stages.map((stage) => ({
      id: stage.id,
      ordinal: stage.ordinal,
      kind: stage.kind,
      label: stage.label,
      scheduledAt: stage.scheduledAt,
      durationMinutes: stage.durationMinutes,
      format: stage.format,
      notes: stage.notes ?? stage.offeredNotes,
      notesCarried: stage.notes === null && stage.offeredNotes !== null,
      outcome: stage.outcome,
      nextSteps: stage.nextSteps,
      people: stage.people.map(({ name, title, role }) => ({
        name,
        title,
        role,
      })),
      transcripts: stage.transcripts.map((transcript) => ({
        id: transcript.id,
        title: transcript.title,
        origin: transcript.origin,
        capturePolicy: transcript.capturePolicy,
        occurredAt: transcript.occurredAt,
        sha256: transcript.sha256,
        text: textOf.get(transcript.id) ?? "",
      })),
    })),
    employerSaid: brief.employerSaid.map(
      ({ id, said, saidBy, channel, saidOn, sha256 }) => ({
        id,
        said,
        saidBy,
        channel,
        saidOn,
        sha256,
      }),
    ),
    research: brief.research.map((document) => ({
      id: document.id,
      scope: document.scope,
      title: document.title,
      origin: document.origin,
      originRef: document.originRef,
      sha256: document.sha256,
      text: document.carried
        ? (blank(candidacy.companyResearch) ?? "")
        : (researchText.get(document.id) ?? ""),
      carried: document.carried,
    })),
  };
}
