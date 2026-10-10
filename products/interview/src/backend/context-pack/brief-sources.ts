// The interview brief as sources the AI engine prepares (ADR-0038): each
// stage's notes, outcome and people, what the employer said, the research
// documents and each stage's transcripts. No model is called here: the text a
// person typed or imported is cut into records in code, each with an
// identity, a revision (the hash of what it says) and, where it has one, its
// STAGE.
//
// [DOMAIN] What each part becomes (phase 3 reads exactly these):
//   stage:<stageId>:notes                 kind "candidate-notes"
//       records "prep-note", one per line of the notes
//   stage:<stageId>:outcome               kind "stage-outcome"
//       records "prep-note": what happened, what comes next
//   stage:<stageId>:details               kind "stage-details"
//       records "employer-fact": when and how, and each person met
//   stage:<stageId>:transcript:<id>       kind "transcript"
//       records "transcript-turn", one per speaker turn: RAW, in no slot
//   employer-said:<entryId>               kind "employer-said"
//       records "employer-fact", one per line the employer said
//   research:<documentId>                 kind "research"
//       records "employer-fact", one per passage
// A record of a stage carries `fields.stage` (its place, 1 first) and
// `fields.stageId`. Nothing here is ever the candidate's own record.
//
// [SAFETY] A transcript taken under a device-only policy is prepared like any
// other (preparing runs on this machine), and every turn of it says
// `deviceOnly: true`. Whoever sends a source to a model that does not run
// here asks `sourceMayLeaveDevice` first; `remoteSources` is that question
// asked of a whole list.
import { createHash } from "node:crypto";
import type { Source } from "@omnitech/ai-engine";
import {
  employerSaidLine,
  mayLeaveDevice,
  type TranscriptPolicy,
} from "@omnitech/interview-contracts";
import type { BriefMaterial } from "../brief/repository";
import { clockOf, turnsOf } from "../brief/transcript";
import type { SessionContext } from "../live-session/session-context";
import { linkSources } from "./links";
import { KINDS } from "./recipe";
import { headingsOf } from "./sources";

type SourceRecord = NonNullable<Source["records"]>[number];

export const BRIEF_SOURCE_KINDS = {
  notes: "candidate-notes",
  outcome: "stage-outcome",
  details: "stage-details",
  transcript: "transcript",
  employerSaid: "employer-said",
  research: "research",
} as const;

// A source of the brief: the engine's source, and what a view or a sender
// needs to know about it without reading its records.
export type BriefSource = Source & {
  // The whole text's SHA-256: the revision is its first sixteen characters.
  sha256: string;
  chars: number;
  // The stage it belongs to, by place (1 first) and by id.
  stage?: number;
  stageId?: string;
  // A transcript's capture policy; absent for everything a person typed.
  capturePolicy?: TranscriptPolicy;
  // Whether it may be sent to a model that does not run on this machine.
  sendable: boolean;
};

// [SAFETY] The one question to ask before a source leaves this machine.
export function sourceMayLeaveDevice(source: {
  capturePolicy?: TranscriptPolicy | null | undefined;
  sendable?: boolean | undefined;
}): boolean {
  return source.sendable !== false && mayLeaveDevice(source);
}
// The sources a remote model may be given, and the ones it may not, with why.
export function remoteSources<Each extends Source>(
  sources: readonly Each[],
): { sendable: Each[]; withheld: { id: string; reason: "device-only" }[] } {
  const sendable: Each[] = [];
  const withheld: { id: string; reason: "device-only" }[] = [];
  for (const source of sources)
    if (sourceMayLeaveDevice(source as BriefSource)) sendable.push(source);
    else withheld.push({ id: source.id, reason: "device-only" });
  return { sendable, withheld };
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const short = (text: string) => sha(text).slice(0, 12);
const revisionOf = (sha256: string) => sha256.slice(0, 16);
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

// A record a slot may take is at most this long: the recipe's ranked slots
// leave out anything over 400 characters as too long to give whole.
export const PIECE_CHARS = 360;

// [STRATEGY] Text as pieces a reader can be given whole, each keeping its
// place. One line is one piece (a bullet or a number in front is dropped, as
// the brief's prep notes are read today); a line too long for a slot is cut
// at its sentences, and a sentence too long at its words. Every piece of a
// line keeps that line's heading ("NestJS: …"), so the second half of a long
// note is still found by its topic.
export function piecesOf(
  text: string,
  max = PIECE_CHARS,
): { text: string; line: number; heading: string[] }[] {
  const found: { text: string; line: number; heading: string[] }[] = [];
  for (const [at, raw] of text.split(/\r?\n/).entries()) {
    const said = squash(raw.replace(/^\s*(?:[-*•]|#{1,6}|\d+[.)])\s+/, ""));
    if (said === "") continue;
    const heading = headingsOf(said);
    const push = (piece: string) =>
      found.push({ text: piece, line: at + 1, heading });
    if (said.length <= max) {
      push(said);
      continue;
    }
    let held = "";
    const keep = (part: string) => {
      const next = held ? `${held} ${part}` : part;
      if (next.length <= max) held = next;
      else {
        if (held) push(held);
        held = part;
      }
    };
    for (const sentence of said.split(/(?<=[.!?;])\s+/)) {
      if (sentence.length <= max) keep(sentence);
      // A sentence longer than a slot takes: word by word.
      else for (const word of sentence.split(" ")) keep(word.slice(0, max));
    }
    if (held) push(held);
  }
  return found;
}

// The same thing said twice in one source is one record.
function distinct(records: readonly SourceRecord[]): SourceRecord[] {
  const kept = new Map<string, SourceRecord>();
  for (const record of records)
    if (!kept.has(record.id)) kept.set(record.id, record);
  return [...kept.values()];
}

type Stage = BriefMaterial["stages"][number];
const of = (stage: Stage) => ({ stage: stage.ordinal, stageId: stage.id });

function textSource(
  from: {
    id: string;
    kind: string;
    text: string;
    stage?: Stage;
  },
  record: (piece: ReturnType<typeof piecesOf>[number]) => SourceRecord,
): BriefSource {
  const sha256 = sha(from.text);
  return {
    id: from.id,
    revision: revisionOf(sha256),
    kind: from.kind,
    records: distinct(piecesOf(from.text).map(record)),
    sha256,
    chars: from.text.length,
    ...(from.stage ? of(from.stage) : {}),
    sendable: true,
  };
}
const headed = (heading: readonly string[]) =>
  heading.length > 0 ? { heading: [...heading] } : {};

function stageSources(
  stage: Stage,
  options: { skipCarriedNotes: boolean },
): BriefSource[] {
  const sources: BriefSource[] = [];
  // [DOMAIN] The person's preparation for this stage, a line a record, as the
  // brief's prep notes are. The application's old notes, while they are only
  // offered to the first stage, are left out when the employer brief already
  // distilled them (`skipCarriedNotes`): the same note is not given twice.
  if (stage.notes && !(stage.notesCarried && options.skipCarriedNotes))
    sources.push(
      textSource(
        {
          id: `stage:${stage.id}:notes`,
          kind: BRIEF_SOURCE_KINDS.notes,
          text: stage.notes,
          stage,
        },
        (piece) => ({
          id: `prep:${stage.id}:${short(piece.text)}`,
          kind: KINDS.prep,
          text: piece.text,
          fields: {
            // The section links.ts reads a note's ties from: a stage's note
            // ties a technology to an employer as the brief's notes do.
            section: "prepNotes",
            label: "prep notes",
            ...of(stage),
            ...headed(piece.heading),
            ...(stage.notesCarried ? { carried: true } : {}),
          },
          priority: 3,
          locator: `/stages/${stage.id}/notes/${piece.line}`,
        }),
      ),
    );
  // What happened in the stage and what comes next: the person's own words,
  // which the next stage's preparation follows.
  const outcome = [
    stage.outcome ? `Outcome: ${squash(stage.outcome)}` : "",
    stage.nextSteps ? `Next: ${squash(stage.nextSteps)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  if (outcome)
    sources.push(
      textSource(
        {
          id: `stage:${stage.id}:outcome`,
          kind: BRIEF_SOURCE_KINDS.outcome,
          text: outcome,
          stage,
        },
        (piece) => ({
          id: `outcome:${stage.id}:${short(piece.text)}`,
          kind: KINDS.prep,
          text: piece.text,
          fields: {
            section: "stageOutcome",
            label: "outcome happened next steps",
            ...of(stage),
            ...headed(piece.heading),
          },
          priority: 2,
          locator: `/stages/${stage.id}/outcome/${piece.line}`,
        }),
      ),
    );
  // When and how the stage is held, and who is met in it.
  const when = [
    stage.scheduledAt ? stage.scheduledAt : "",
    stage.durationMinutes ? `${stage.durationMinutes} minutes` : "",
    stage.format ?? "",
  ].filter(Boolean);
  const details = [
    ...(when.length > 0 ? [`${stage.label} stage: ${when.join(", ")}`] : []),
    ...stage.people.map(
      (person) =>
        `${stage.label} stage, ${person.role.replace("_", " ")}: ${person.name}${person.title ? `, ${person.title}` : ""}`,
    ),
  ].join("\n");
  if (details)
    sources.push(
      textSource(
        {
          id: `stage:${stage.id}:details`,
          kind: BRIEF_SOURCE_KINDS.details,
          text: details,
          stage,
        },
        (piece) => ({
          id: `stage-detail:${stage.id}:${short(piece.text)}`,
          kind: KINDS.employerFact,
          text: piece.text,
          fields: {
            section: "stageDetails",
            label: "interview stage interviewer people when format",
            ...of(stage),
          },
          priority: 2,
          locator: `/stages/${stage.id}/details/${piece.line}`,
        }),
      ),
    );
  // [DOMAIN] A transcript is a source whose records are its turns. A turn is
  // RAW: what was said, by whom and when on the transcript's clock. It is
  // material for extraction, never a fact, so it is of a kind no slot takes.
  for (const transcript of stage.transcripts) {
    const sendable = mayLeaveDevice(transcript);
    sources.push({
      id: `stage:${stage.id}:transcript:${transcript.id}`,
      revision: revisionOf(transcript.sha256),
      kind: BRIEF_SOURCE_KINDS.transcript,
      records: turnsOf(transcript.text).map((turn, at) => ({
        id: `turn:${transcript.id}:${at}`,
        kind: KINDS.turn,
        text: turn.text,
        fields: {
          speaker: turn.speaker,
          startMs: turn.startMs,
          endMs: turn.endMs,
          clock: clockOf(turn.startMs),
          turn: at,
          transcriptId: transcript.id,
          ...of(stage),
          ...(sendable ? {} : { deviceOnly: true }),
        },
        // Where it is on the transcript's own clock.
        locator: `${clockOf(turn.startMs)}-${clockOf(turn.endMs)}`,
      })),
      sha256: transcript.sha256,
      chars: transcript.text.length,
      ...of(stage),
      capturePolicy: transcript.capturePolicy,
      sendable,
    });
  }
  return sources;
}

export function briefSources(
  material: BriefMaterial,
  options: { skipCarriedNotes?: boolean } = {},
): BriefSource[] {
  const sources: BriefSource[] = material.stages.flatMap((stage) =>
    stageSources(stage, {
      skipCarriedNotes: options.skipCarriedNotes === true,
    }),
  );
  // What the employer said: their words, a line a record, each knowing who
  // said it, how and when.
  for (const entry of material.employerSaid)
    sources.push(
      textSource(
        {
          id: `employer-said:${entry.id}`,
          kind: BRIEF_SOURCE_KINDS.employerSaid,
          text: entry.said,
        },
        (piece) => ({
          id: `said:${entry.id}:${short(piece.text)}`,
          kind: KINDS.employerFact,
          text: piece.text,
          fields: {
            section: "employerSaid",
            label: "employer said recruiter told process",
            ...(entry.saidBy ? { saidBy: entry.saidBy } : {}),
            ...(entry.channel ? { channel: entry.channel } : {}),
            ...(entry.saidOn ? { saidOn: entry.saidOn } : {}),
            // The entry as one attributed line, for a reader that quotes it.
            said: employerSaidLine({ ...entry, said: piece.text }),
            ...headed(piece.heading),
          },
          priority: 2,
          locator: `/employerSaid/${entry.id}/${piece.line}`,
        }),
      ),
    );
  // What the person found out, a passage a record.
  for (const document of material.research)
    sources.push(
      textSource(
        {
          id: `research:${document.id}`,
          kind: BRIEF_SOURCE_KINDS.research,
          text: document.text,
        },
        (piece) => ({
          id: `research:${document.id}:${short(piece.text)}`,
          kind: KINDS.employerFact,
          text: piece.text,
          fields: {
            section: "research",
            label: "research company found",
            title: document.title,
            scope: document.scope,
            origin: document.origin,
            ...(document.originRef ? { originRef: document.originRef } : {}),
            ...headed(piece.heading),
          },
          // Below what the employer's own posting says of itself.
          priority: 1,
          locator: `/research/${document.id}/${piece.line}`,
        }),
      ),
    );
  // A source nothing was read from says nothing.
  return sources.filter((source) => (source.records ?? []).length > 0);
}

// The stage a record belongs to, by its place; undefined for a record of the
// whole application or of the person.
export function stageOf(record: {
  fields?: Readonly<Record<string, unknown>> | undefined;
}): number | undefined {
  const stage = record.fields?.["stage"];
  return typeof stage === "number" ? stage : undefined;
}

// How much a record of the stage resolved for, and of an earlier one, is
// preferred when two records match a question equally (the engine breaks an
// equal match by priority).
const OWN_STAGE = 20;
const EARLIER_STAGE = 10;

// [DOMAIN] The sources as one stage reads them. That stage's records are
// preferred, an earlier stage's follow, and a LATER stage's are left out:
// preparing for the technical round must not lean on notes for the final one.
// `left` says what was left out, so a view can show it with its reason.
export function scopeToStage<Each extends Source>(
  sources: readonly Each[],
  stage: number | undefined,
): { sources: Each[]; left: SourceRecord[] } {
  if (stage === undefined) return { sources: [...sources], left: [] };
  const left: SourceRecord[] = [];
  const scoped = sources.flatMap((source) => {
    if (!source.records) return [source];
    const records = source.records.flatMap((record) => {
      const own = stageOf(record);
      if (own === undefined) return [record];
      if (own > stage) {
        left.push(record);
        return [];
      }
      return [
        {
          ...record,
          priority:
            (record.priority ?? 0) +
            (own === stage ? OWN_STAGE : EARLIER_STAGE),
        },
      ];
    });
    return records.length > 0 ? [{ ...source, records }] : [];
  });
  return { sources: scoped, left };
}

// The sources whose records the links are made between (links.ts): the
// person's notes. What was said in a transcript, read in research or told by
// the employer is raw text; were it read as "the material" it would only
// change which words count as names.
const LINKED: readonly string[] = [
  BRIEF_SOURCE_KINDS.notes,
  BRIEF_SOURCE_KINDS.outcome,
];

// [STRATEGY] The brief's sources beside the ones a person's material already
// gives (pack.ts), for one stage: scoped to the stage FIRST, then linked
// together with the rest (links.ts), so a stage's note that names an employer
// brings that employer's evidence, a requirement is tied through a stage's
// note exactly as through the employer brief's, and a later stage's note ties
// nothing. Selection and the arranging of evidence (pack.ts) then see only
// what the stage may read.
export function withStageBrief(
  base: readonly Source[],
  brief: readonly BriefSource[],
  stage: number | undefined,
): { sources: Source[]; left: SourceRecord[] } {
  const { sources: scoped, left } = scopeToStage(brief, stage);
  if (scoped.length === 0) return { sources: [...base], left };
  const linkable = scoped.filter((source) => LINKED.includes(source.kind));
  const raw = scoped.filter((source) => !LINKED.includes(source.kind));
  return { sources: [...linkSources([...base, ...linkable]), ...raw], left };
}

// A session's interview brief as sources, every stage (not yet scoped).
export function sessionBriefSources(context: SessionContext): BriefSource[] {
  const material = context.material;
  if (!material?.interviewBrief) return [];
  return briefSources(material.interviewBrief, {
    // The employer brief's prep notes are the application's notes, distilled.
    skipCarriedNotes: (material.brief?.prepNotes ?? []).length > 0,
  });
}

// What `sessionSources` adds: the brief's sources, as the stage the session
// was started for reads them (every stage when it was started for none).
export function withSessionBrief(
  base: readonly Source[],
  context: SessionContext,
): Source[] {
  return withStageBrief(
    base,
    sessionBriefSources(context),
    context.material?.stage?.ordinal,
  ).sources;
}
