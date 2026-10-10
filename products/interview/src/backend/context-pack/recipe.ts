// The interview context recipe (ADR-0038): what kinds of fact a person's
// material holds, and the named selections ("projections") a task reads.
// It is configuration, not code: the AI engine prepares sources into records
// of these kinds and resolves a projection for one question, the same way
// for the coach, an answer and the view a person inspects.
import type {
  Annotator,
  Extractor,
  JsonSchema,
  LinkStep,
  Recipe,
  Slot,
} from "@omnitech/ai-engine";

// [DOMAIN] A record keeps its kind. What the candidate did is never mixed
// with what the employer wants: an employer's requirement can aim an answer,
// and can never be offered as the candidate's experience.
export const KINDS = {
  profile: "candidate-profile",
  role: "candidate-role",
  // One whole thing the person did, with the role it was done in: composed in
  // code from a role's parts (sources.ts), never a bare fragment.
  achievement: "candidate-achievement",
  story: "candidate-story",
  preference: "candidate-preference",
  employer: "employer-detail",
  requirement: "employer-requirement",
  employerFact: "employer-fact",
  prep: "prep-note",
  // One speaker's turn of a stage's transcript, as it was said: RAW material
  // for extraction (brief-sources.ts). No projection has a slot for it, so it
  // is counted and inspectable, and never offered to a reader as a fact.
  turn: "transcript-turn",
  // What a stage's transcript holds, read by a model and kept only with the
  // words it rests on (the transcript extractor below). They belong to the
  // stage they were said in, and a later stage is given them after its own.
  asked: "stage-question",
  answered: "stage-answer",
  signal: "employer-signal",
  commitment: "stage-commitment",
} as const;
export type ContextKind = (typeof KINDS)[keyof typeof KINDS];

// Whose a kind is, for whoever reads a selected fact.
export const ABOUT: Readonly<
  Record<ContextKind, "candidate" | "employer" | "preference">
> = {
  "candidate-profile": "candidate",
  "candidate-role": "candidate",
  "candidate-achievement": "candidate",
  "candidate-story": "candidate",
  "candidate-preference": "preference",
  "employer-detail": "employer",
  "employer-requirement": "employer",
  "employer-fact": "employer",
  "prep-note": "employer",
  // The safe side: a turn is never the candidate's approved record.
  "transcript-turn": "employer",
  // What was said in a stage is a record of the conversation. Even the
  // person's own answer there is what they SAID, not their approved record:
  // a claim is never verified against it.
  "stage-question": "employer",
  "stage-answer": "employer",
  "employer-signal": "employer",
  "stage-commitment": "employer",
};

// Known fields, looked up exactly and never written by a model.
const exact = (id: string, kind: ContextKind, field: string): Slot => ({
  id,
  mode: "exact",
  kind,
  field,
});
const EXACT: readonly Slot[] = [
  exact("candidate.name", KINDS.profile, "name"),
  exact("candidate.headline", KINDS.profile, "headline"),
  exact("candidate.location", KINDS.profile, "location"),
  exact("employer.company", KINDS.employer, "company"),
  exact("employer.role", KINDS.employer, "role"),
];

// [DOMAIN] Where a word was found says how much it means. Best first:
//   - `technologies` (a technology the achievement itself names) and
//     `company` count 3: the question is about exactly this;
//   - `themes` (a subject of the role that this achievement speaks to) and
//     `stack` (the role's technologies) count 2: the achievement belongs to
//     the subject without naming it;
//   - `tags` (every subject of the role) and the text count 1: in passing;
//   - `period` counts nothing: "2018" is when, never what.
const EVIDENCE_WEIGHTS = {
  technologies: 3,
  company: 3,
  themes: 2,
  stack: 2,
  tags: 1,
  text: 1,
  period: 0,
};
// A role is found by its employer, its technologies and its own subjects.
const ROLE_WEIGHTS = { technologies: 3, company: 3, tags: 2, text: 1 };
// [DOMAIN] A line that is headed with the question's own topic ("NestJS: …")
// is about the question; one that says the word on its way to something else
// ("Round: … experience deep dive") is not. The heading is the words before a
// sentence's colon (sources.ts), and a word found there counts 3.
// A record a model extracted has no heading; it has the search words and the
// questions the extractor gave it, which say what it is about as a heading
// does.
const HEADED_WEIGHTS = { heading: 3, answers: 3, themes: 2, text: 1 };

const ranked = (
  id: string,
  kind: ContextKind,
  limit: number,
  more: Partial<Slot> = {},
): Slot => ({ id, mode: "ranked", kind, limit, maxChars: 400, ...more });

export const PROJECTIONS = {
  // What a note written in two seconds can use: a few of the best facts.
  coach: "coach",
  // What a full answer can lean on.
  answer: "answer",
  // Everything that bears on a question, for the view a person inspects.
  inspect: "inspect",
  // The person's roles with their achievements whole, and what the employer
  // asks for, for a resume or a letter. The roles are cast elsewhere
  // (documents/cast.ts); readers.ts keeps the cast roles' achievements.
  document: "document",
  // One stage, to prepare for it: who is met, what they asked for, the fit
  // and the gaps, the person's notes, and what earlier stages asked.
  briefing: "briefing",
} as const;
export type ProjectionId = (typeof PROJECTIONS)[keyof typeof PROJECTIONS];

// [DOMAIN] How the evidence for one question is arranged (pack.ts does it,
// after the engine has ranked). The engine ranks every achievement that bears
// on the question or is tied to what the earlier slots selected; a
// projection's places are then filled by these rules, in this order:
//   1. LINKED FIRST. Evidence linked to the note, story or requirement that
//      leads its slot comes before evidence that merely shares a word: the
//      achievements of an employer the note or story names (the better match
//      for the question first, and of two equal matches the one whose figure
//      the note states), then achievements that share a technology with the
//      leading requirement (followed only when no note or story names
//      anything).
//      A line speaks for the question only when it matches it on its heading
//      or on SPEAKS_FOR words (or on every word of a shorter question): one
//      word shared in passing links nothing.
//   2. TWO ROLES. The places go to at most `roles` roles: the role of the
//      best-ranked achievement (the primary story) and the next role (the
//      backup). The primary takes up to `lead` places and comes first.
//   3. UNLESS ONE DOMINATES. The backup is left out, and the primary may
//      take every place, when the primary's best achievement matches at
//      least DOMINATES times as many words as the backup's best, or when the
//      primary is linked more strongly and the backup was only found in
//      passing (fewer than SPEAKS_FOR words).
// `inspect`, `document` and `briefing` show everything that bears, so they
// are not arranged by role: only rule 1 orders them.
export const EVIDENCE_PLACES: Readonly<
  Record<ProjectionId, { places: number; roles?: number; lead?: number }>
> = {
  coach: { places: 4, roles: 2, lead: 3 },
  answer: { places: 6, roles: 2, lead: 4 },
  inspect: { places: 60 },
  document: { places: 400 },
  briefing: { places: 24 },
};
// Every achievement the engine may rank for one question: all of them. A tie
// (LINKS below) keeps an achievement in the ranking though it shares no word
// with the question, and the places above are what bound a selection.
const EVIDENCE_RANKED = 400;
export const DOMINATES = 2;
export const SPEAKS_FOR = 2;

// [DOMAIN] The ties between records (the engine's link steps). A step is from
// one kind to others, and that is also the rule: the engine refuses a tie
// whose ends are of any other kinds, whoever proposed it. No step ends at a
// kind of the employer's, so an employer's fact can never be tied in as the
// candidate's experience.
//   Made in code (links.ts), never asked of a model:
//     names  a prep note      -> the achievements of an employer it names
//     tells  a chosen story   -> the achievements of an employer it names
//     stack  a requirement    -> the achievements done on a technology it names
//   Proposed by a model, each checked by the engine:
//     fit    a requirement    -> the achievements that prove it, how strongly
//     proof  a prep note      -> the achievement it rests on
//     story  a question asked -> the story to tell, primary or backup
export const LINKS = {
  names: "names",
  tells: "tells",
  stack: "stack",
  fit: "fit",
  proof: "proof",
  story: "story",
} as const;
export const FIT_STRENGTHS = ["strong", "partial", "gap"] as const;
export type FitStrength = (typeof FIT_STRENGTHS)[number];

const object = (
  properties: Record<string, JsonSchema>,
  required: readonly string[] = [],
): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  required: [...required],
  properties,
});
const text: JsonSchema = { type: "string" };
const texts: JsonSchema = { type: "array", items: { type: "string" } };
// How much of an achievement a model is shown when it links: who, where and
// what, without the stack that ends every line.
const LINK_CHARS = 220;

const CODE_LINKS: readonly LinkStep[] = [
  {
    id: LINKS.names,
    from: KINDS.prep,
    to: KINDS.achievement,
    fields: object({ basis: { enum: ["figure", "employer"] } }, ["basis"]),
  },
  {
    id: LINKS.tells,
    from: KINDS.story,
    to: KINDS.achievement,
    fields: object({ basis: { enum: ["figure", "employer"] } }, ["basis"]),
  },
  {
    id: LINKS.stack,
    from: KINDS.requirement,
    to: KINDS.achievement,
    fields: object({ technology: text, via: { enum: ["own", "note"] } }, [
      "technology",
      "via",
    ]),
  },
];
const MODEL_LINKS: readonly LinkStep[] = [
  {
    id: LINKS.fit,
    from: KINDS.requirement,
    to: KINDS.achievement,
    instructions:
      'The first list is what an employer asks of a candidate. The second list is what the candidate has done. For each requirement, name the achievements that are evidence for it: at most three, the most direct first. Give "strength": "strong" when the achievement shows the very thing asked for, "partial" when it shows something close. When nothing in the second list is evidence for a requirement, return one tie from it to the nearest achievement with "strength": "gap" and, as "note", one sentence on what is missing; never present a gap as experience.',
    fields: object({ strength: { enum: [...FIT_STRENGTHS] }, note: text }, [
      "strength",
    ]),
    maxChars: LINK_CHARS,
  },
  {
    id: LINKS.proof,
    from: KINDS.prep,
    to: KINDS.achievement,
    instructions:
      "The first list is notes a candidate prepared for an interview. The second list is what the candidate has done. For each note, name the achievements the note rests on or that would be told as its example: at most two. Return no tie for a note that is about the employer, the process or a question to ask.",
    maxChars: LINK_CHARS,
  },
  {
    id: LINKS.story,
    from: KINDS.asked,
    to: [KINDS.story, KINDS.achievement],
    instructions:
      'The first list is questions an interviewer asked in an earlier stage, which may be asked again. The second list is the candidate\'s stories and achievements. For each question, name the one to tell first with "rank": "primary" and, if there is another, one with "rank": "backup".',
    fields: object({ rank: { enum: ["primary", "backup"] } }, ["rank"]),
    maxChars: LINK_CHARS,
  },
];
// Every step a slot of evidence follows.
const FOLLOWED = Object.values(LINKS);

const projection = (id: ProjectionId, other: number) => ({
  id,
  slots: [
    ...EXACT,
    // A story the person chose for this kind of question leads.
    ranked("stories", KINDS.story, 2),
    ranked("requirements", KINDS.requirement, other, {
      // A technology a requirement names counts as one an achievement names.
      weights: { ...HEADED_WEIGHTS, technologies: 3 },
      share: 0.15,
    }),
    ranked("prep", KINDS.prep, other, { weights: HEADED_WEIGHTS }),
    // What an interviewer asked in this stage or an earlier one, and what
    // they said to expect: a later stage is given an earlier one's after its
    // own (the engine's scope).
    ranked("asked", KINDS.asked, other, { weights: HEADED_WEIGHTS }),
    ranked("signals", KINDS.signal, other, { weights: HEADED_WEIGHTS }),
    // What the person answered and promised in this stage or an earlier one
    // (PackFlags.said; selectingRecipe leaves these out when it is off).
    ranked("answered", KINDS.answered, other, { weights: HEADED_WEIGHTS }),
    ranked("commitments", KINDS.commitment, other, {
      weights: HEADED_WEIGHTS,
    }),
    // [DOMAIN] After the slots above, because the engine follows a tie from
    // what an EARLIER slot selected: a selected note, story, requirement or
    // question keeps the achievements tied to it in the ranking.
    ranked("evidence", KINDS.achievement, EVIDENCE_RANKED, {
      weights: EVIDENCE_WEIGHTS,
      share: 0.6,
      follow: FOLLOWED,
    }),
    ranked("roles", KINDS.role, 3, { weights: ROLE_WEIGHTS }),
    ranked("preferences", KINDS.preference, other, {
      weights: HEADED_WEIGHTS,
    }),
    ranked("employer", KINDS.employerFact, other, {
      weights: HEADED_WEIGHTS,
      share: 0.15,
    }),
  ],
});

// [DOMAIN] A resume is written from the person's whole record: every role,
// every achievement whole (none cut for length a note would be), and what the
// employer asks for with the evidence tied to it.
const DOCUMENT_PROJECTION = {
  id: PROJECTIONS.document,
  slots: [
    ...EXACT,
    ranked("requirements", KINDS.requirement, 40, {
      weights: { ...HEADED_WEIGHTS, technologies: 3 },
      maxChars: 600,
    }),
    ranked("roles", KINDS.role, 40, { weights: ROLE_WEIGHTS }),
    ranked("evidence", KINDS.achievement, EVIDENCE_RANKED, {
      weights: EVIDENCE_WEIGHTS,
      maxChars: 1200,
      follow: FOLLOWED,
    }),
  ],
};
// [DOMAIN] One stage, to prepare for it. Read with no question it is the
// stage's material by priority; `where` keeps the people apart from the
// other facts of the employer.
const BRIEFING_PROJECTION = {
  id: PROJECTIONS.briefing,
  slots: [
    ...EXACT,
    ranked("people", KINDS.employerFact, 16, {
      where: [
        { field: "section", op: "equals" as const, value: "stageDetails" },
      ],
    }),
    ranked("stories", KINDS.story, 4),
    ranked("requirements", KINDS.requirement, 16, {
      weights: { ...HEADED_WEIGHTS, technologies: 3 },
    }),
    ranked("prep", KINDS.prep, 16, { weights: HEADED_WEIGHTS }),
    ranked("asked", KINDS.asked, 16, { weights: HEADED_WEIGHTS }),
    ranked("signals", KINDS.signal, 8, { weights: HEADED_WEIGHTS }),
    ranked("answered", KINDS.answered, 8, { weights: HEADED_WEIGHTS }),
    ranked("commitments", KINDS.commitment, 8, { weights: HEADED_WEIGHTS }),
    ranked("evidence", KINDS.achievement, EVIDENCE_RANKED, {
      weights: EVIDENCE_WEIGHTS,
      follow: FOLLOWED,
    }),
    ranked("employer", KINDS.employerFact, 16, { weights: HEADED_WEIGHTS }),
  ],
};

// [DOMAIN] Words that mean the same thing when someone asks. Each group
// works every way round: asking about "pay" finds "salary" and asking about
// "salary" finds "pay". Grown from matches a person accepts; these are the
// ones every interview needs. Only words that mean the one thing: "rate" and
// "base" are also an error rate and a code base, so they are not pay.
const SAME = [
  ["salary", "compensation", "pay", "remuneration"],
  ["notice", "availability", "available", "start"],
  ["remote", "hybrid", "onsite", "office"],
  ["led", "lead", "leading", "leadership", "managed"],
  // Moving a system off what it was. A person asked about "a migration"
  // tells their modernization story, and the other way round. "Legacy" is
  // what is moved FROM, not the move, so it is not here: legacy work is found
  // through a role's own themes ("legacy modernization").
  [
    "migration",
    "migrations",
    "migrate",
    "migrated",
    "migrating",
    "modernization",
    "modernisation",
    "modernize",
    "modernized",
    "replatform",
    "replatformed",
  ],
  ["scale", "scaling", "scaled"],
  ["mentoring", "mentored", "mentor", "mentorship", "coaching", "coached"],
  // Two people wanting different things. "Pushback" and "tension" are also a
  // design review and a trade-off, so they are not here.
  ["conflict", "conflicts", "disagreement", "disagree", "disagreed", "dispute"],
  ["kubernetes", "k8s"],
  ["postgres", "postgresql"],
  ["javascript", "js"],
  ["typescript", "ts"],
  ["node", "node.js", "nodejs"],
] as const;
// [DOMAIN] One word in its forms. The engine matches whole words and does no
// stemming, so "an incident" would not find "incidents". Only the forms of
// ONE word are grouped here, which can never join two meanings; the nouns and
// verbs are the ones interview questions and prep notes are written in.
const FORMS = [
  ["api", "apis"],
  ["integration", "integrations", "integrate", "integrated", "integrating"],
  ["incident", "incidents"],
  ["deadline", "deadlines"],
  ["stakeholder", "stakeholders"],
  ["test", "tests", "testing", "tested"],
  ["team", "teams"],
  ["metric", "metrics"],
  ["form", "forms"],
  ["workflow", "workflows"],
  ["service", "services"],
  ["microservice", "microservices"],
  ["boundary", "boundaries"],
  ["idempotent", "idempotency"],
  ["import", "imports", "importer", "importers", "imported", "importing"],
  ["question", "questions"],
  ["tool", "tools", "tooling"],
  ["contract", "contracts"],
  ["payment", "payments"],
  ["engineer", "engineers"],
] as const;
// [DOMAIN] Two words that are one term. The engine splits "event-driven"
// into "event" and "driven", and "driven" alone would find every
// "schema-driven" form. A compound the question says whole is matched whole:
// a record must say both words.
const COMPOUNDS = [
  "event driven",
  "schema driven",
  "test driven",
  "domain driven",
  "data driven",
  "contract first",
  "api first",
  "third party",
  "front end",
  "back end",
  "full stack",
  "real time",
  "self service",
  "open source",
] as const;
const ALIASES: Record<string, string[]> = {};
for (const compound of COMPOUNDS) ALIASES[compound] = [];
for (const group of [...SAME, ...FORMS])
  for (const word of group)
    ALIASES[word] = group.filter((other) => other !== word);

// The engine's name for the scope of a stage, by its place (1 first): what a
// model extracted from a stage's transcript belongs to that stage.
export const stageScope = (ordinal: number) => `stage:${ordinal}`;

// [DOMAIN] The kinds of source a model reads (brief-sources.ts gives them).
export const TEXT_SOURCE_KINDS = {
  posting: "job-description",
  employerSaid: "employer-said",
  research: "research",
  transcript: "transcript",
} as const;

// [DOMAIN] The sections a model files an extracted record under. The posting's
// are the employer brief's own names, so a reader that knows a brief line by
// its section knows an extracted one the same way.
export const POSTING_SECTIONS = [
  "mustHaves",
  "niceToHaves",
  "responsibilities",
  "techStack",
  "team",
  "values",
  "process",
  "companyFacts",
] as const;
export const SAID_SECTIONS = ["process", "date", "constraint"] as const;
export const RESEARCH_SECTIONS = [
  "company",
  "product",
  "people",
  "risk",
  "questionsToAsk",
] as const;

// [DOMAIN] The extractors: what a model is asked to find in each kind of
// source. The product writes the meaning here; the engine cuts the source to
// the model's size, asks, checks every quote against the source and merges
// what two pieces both found. A record whose quote is not in the source is
// never kept, so nothing here can add a fact the source does not state.
export const EXTRACTORS: readonly Extractor[] = [
  {
    id: "posting",
    sourceKind: TEXT_SOURCE_KINDS.posting,
    recordKinds: [KINDS.requirement, KINDS.employerFact],
    instructions:
      'This is a job posting. List what it says, one record for each separate thing, in the posting\'s own terms. Use kind "employer-requirement" for what it asks of a candidate ("section": "mustHaves" with "level": "must" when required, "niceToHaves" with "level": "nice" when preferred or a bonus), for what the person will do ("responsibilities") and for each technology it names ("techStack", one record a technology). Use kind "employer-fact" for the team ("team"), what the company values ("values"), the interview process ("process") and facts about the company ("companyFacts"). Keep each record to one sentence.',
    fields: object(
      {
        section: { enum: [...POSTING_SECTIONS] },
        level: { enum: ["must", "nice"] },
      },
      ["section"],
    ),
    themes: true,
    answers: true,
  },
  {
    id: "employer-said",
    sourceKind: TEXT_SOURCE_KINDS.employerSaid,
    recordKinds: [KINDS.employerFact],
    instructions:
      'This is something the employer or a recruiter told the candidate. List each fact it states, one record each: how the process runs ("section": "process"), a date or a deadline ("date"), or a rule or limit the candidate must keep to ("constraint"). Keep each record to one sentence.',
    fields: object({ section: { enum: [...SAID_SECTIONS] } }, ["section"]),
    themes: true,
    answers: true,
  },
  {
    id: "research",
    sourceKind: TEXT_SOURCE_KINDS.research,
    recordKinds: [KINDS.employerFact, KINDS.prep],
    instructions:
      'This is research a candidate gathered about an employer. List what it states, one record each, as kind "employer-fact": a fact about the company ("section": "company"), about what it builds or sells ("product"), about a person the candidate may meet ("people"), or something that could go wrong for the company or the role ("risk"). Where the text raises something worth asking the employer, give it as kind "prep-note" with "section": "questionsToAsk", worded as the question, and quote the words that raise it. Keep each record to one sentence.',
    fields: object({ section: { enum: [...RESEARCH_SECTIONS] } }, ["section"]),
    themes: true,
    answers: true,
  },
  {
    id: "transcript",
    sourceKind: TEXT_SOURCE_KINDS.transcript,
    recordKinds: [KINDS.asked, KINDS.answered, KINDS.signal, KINDS.commitment],
    instructions:
      'This is a transcript of one interview stage; each line begins with its time and its speaker. "Me" is the candidate. List, one record each: every question an interviewer asked the candidate (kind "stage-question": the question as asked, "askedBy" the speaker, "followUps" any follow-up questions on the same subject); what the candidate answered to it (kind "stage-answer": one sentence on what was said, "used" the employer or project the answer drew on, if it named one, "missing" what the answer left out that the question asked for, such as a figure); what the interviewer pressed on or said to expect later (kind "employer-signal": one sentence, "expect" what to prepare, "carriesTo" the later stage it was said about, by its name, if one was named); and anything the candidate promised to do or send (kind "stage-commitment"). Quote the speaker\'s own words.',
    fields: object({
      askedBy: text,
      followUps: texts,
      used: text,
      missing: texts,
      expect: text,
      carriesTo: text,
    }),
    themes: true,
    answers: true,
  },
];

// [DOMAIN] "Asked as": for each thing the person did, each story they chose
// and each note they prepared, a model writes the words it would be searched
// by and the questions it answers. An interviewer rarely uses the record's own
// words ("how do you stop a payout going out twice?" for a line about
// idempotency keys), and ranking is by words. Written ONCE, when a pack is
// prepared, by the profile that reads the sources; never when a question is
// resolved. Opt-in (prepare.ts, `annotate`): it costs model calls. The engine
// never shows a record of a device-only source to a profile that is not on
// this machine, checks every term, and matches a term only while the record
// says what it said when the term was written.
export const ANNOTATORS: readonly Annotator[] = [
  {
    id: "asked-as",
    kinds: [KINDS.achievement, KINDS.story, KINDS.prep],
    instructions:
      "Each record is something a job candidate did, a story they chose to tell, or a note they prepared for an interview. For each, write the words an interviewer would use to ask about it when they do NOT use the record's own words (the plain-language problem it solved, the common name or acronym of the technique, the kind of interview question it answers), and the questions it would be the answer to, as an interviewer would say them aloud. Add nothing the record does not show: no technology, employer, figure or outcome that is not in it.",
    terms: 6,
    questions: 3,
    maxChars: 400,
  },
];

const PROJECTIONS_OF = [
  projection(PROJECTIONS.coach, 3),
  projection(PROJECTIONS.answer, 6),
  projection(PROJECTIONS.inspect, 24),
  DOCUMENT_PROJECTION,
  BRIEFING_PROJECTION,
];

// The recipe a pack is PREPARED with when a model reads: the extractors and
// every link step.
export const INTERVIEW_CONTEXT_RECIPE: Recipe = {
  id: "interview-context",
  version: "3",
  kinds: Object.fromEntries(Object.values(KINDS).map((kind) => [kind, {}])),
  extractors: EXTRACTORS,
  links: [...CODE_LINKS, ...MODEL_LINKS],
  projections: PROJECTIONS_OF,
  aliases: ALIASES,
};
// [DOMAIN] The same recipe with no model in it: no extractor, and the model's
// link steps declared (so a kept tie is still followed) but never asked. A
// pack is prepared with this on every path a model must not be on: the live
// coach, the view a person inspects, and every reader when no pack was
// prepared.
export const CODE_ONLY_RECIPE: Recipe = {
  id: INTERVIEW_CONTEXT_RECIPE.id,
  version: INTERVIEW_CONTEXT_RECIPE.version,
  kinds: INTERVIEW_CONTEXT_RECIPE.kinds,
  links: [
    ...CODE_LINKS,
    ...MODEL_LINKS.map(({ instructions: _asked, ...step }) => step),
  ],
  projections: PROJECTIONS_OF,
  aliases: ALIASES,
};

// ---- The flags: how each projection selects ---------------------------------
//
// [DOMAIN] Every mechanism of selection that was MEASURED on the held-out
// questions (`pnpm pack:eval`; the brief's section 14 has each number) has
// one switch here, and each projection has its own row, so a projection can
// skip a mechanism. A default is what that evidence supports. What was tried
// and did not move the held-out number has no switch: a cap per employer, a
// follow-up's carry-over, the question passed as said, a model's tie counted
// as support.
export type PackFlags = {
  // How the engine matches and ranks. "plain": whole words, every word alike
  // (with the hand-written aliases above). Otherwise the engine's measured
  // version 2, each part with its own switch:
  //   stem       word forms are folded ("reconciled" finds "reconciliation")
  //   stop       a word that carries no meaning counts a tenth
  //   exclusion  "not at X", "other than X": records that say X are left out
  //   cut        a record under half of its slot's best score is left out
  // Measured: no gain and no loss in the right record leading (+12 -11 of
  // 178, p = 1.0), so it is OFF by default and here to be switched on.
  match:
    | "plain"
    | { stem: boolean; stop: boolean; exclusion: boolean; cut: boolean };
  // Whether the terms a model wrote for the person's own records are matched
  // (ANNOTATORS). Only a pack prepared with `annotate` has any, so this does
  // nothing until a person opts in there. Measured: +3 -0 under plain
  // matching (p = 0.25), +5 -0 under version 2 (p = 0.06): suggestive.
  terms: boolean;
  // Whether what the person ANSWERED and PROMISED in an earlier stage is
  // offered beside what was asked and signalled there (the `answered` and
  // `commitments` slots). The briefing always has them. Measured: +19 -0 of
  // 178 (p < 0.001).
  said: boolean;
};
// Selection exactly as recipe version 3 made it before any of this.
export const LEGACY_FLAGS: PackFlags = {
  match: "plain",
  terms: false,
  said: false,
};
// The engine's measured version 2, whole: what a row is given to switch it on.
export const MEASURED_MATCH: Exclude<PackFlags["match"], "plain"> = {
  stem: true,
  stop: true,
  exclusion: true,
  cut: true,
};
const ASKED: PackFlags = { match: "plain", terms: true, said: true };
export const PACK_FLAGS: Readonly<Record<ProjectionId, PackFlags>> = {
  coach: ASKED,
  answer: ASKED,
  inspect: ASKED,
  // Read with no question: there is nothing to match, and a briefing has what
  // was said by its own slots.
  document: LEGACY_FLAGS,
  briefing: LEGACY_FLAGS,
};
export const flagsFor = (
  projection: ProjectionId,
  over: Partial<PackFlags> = {},
): PackFlags => ({ ...PACK_FLAGS[projection], ...over });

const SAID_SLOTS: ReadonlySet<string> = new Set(["answered", "commitments"]);
const selecting = new Map<string, Recipe>();
// [STRATEGY] The recipe a projection SELECTS with under its flags: the same
// kinds, link steps and projections as the recipe the pack was prepared with
// (so one prepared pack serves every row of the table), with the engine's
// matching and the slots as the flags say.
export function selectingRecipe(flags: PackFlags): Recipe {
  const key = JSON.stringify(flags);
  const held = selecting.get(key);
  if (held) return held;
  const { match } = flags;
  const recipe: Recipe = {
    ...CODE_ONLY_RECIPE,
    ...(match === "plain"
      ? {}
      : {
          match: {
            version: 2 as const,
            ...(match.stem ? {} : { stem: false as const }),
            ...(match.stop ? {} : { stop: false as const }),
            ...(match.exclusion ? {} : { exclusion: false as const }),
            ...(match.cut ? {} : { cut: false as const }),
          },
        }),
    projections: CODE_ONLY_RECIPE.projections.map((projection) => ({
      ...projection,
      slots: projection.slots
        // The briefing reads what was said whatever the flag says.
        .filter(
          (slot) =>
            flags.said ||
            projection.id === PROJECTIONS.briefing ||
            !SAID_SLOTS.has(slot.id),
        )
        .map((slot) =>
          // [DOMAIN] Under version 2 a tie only ever orders achievements
          // that match the question equally: which tie leads is decided in
          // pack.ts, by whose tie it is (the person's own before a model's).
          slot.id === "evidence" && match !== "plain"
            ? { ...slot, rank: { support: false as const } }
            : // [DOMAIN] A story is chosen by the person for a KIND of
              // question, and choosing one widens the search to its
              // employer. A model's guess at what a story might be asked as
              // is too weak a reason for that: a story is found by its own
              // words only.
              slot.id === "stories" && flags.terms
              ? { ...slot, rank: { terms: 0 } }
              : slot,
        ),
    })),
  };
  selecting.set(key, recipe);
  return recipe;
}

// A text as the words the engine matches on (the same split it uses), so
// what is attached in code and what is matched at selection agree.
export function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9+#.]*/g) ?? [])
    .map((word) => word.replace(/\.+$/, ""))
    .filter((word) => word !== "");
}
// A word with every word that means the same: itself first.
export const sameAs = (word: string): readonly string[] => [
  word,
  ...(ALIASES[word] ?? []),
];

// [STRATEGY] What was asked, without the words every question shares. The
// engine counts every word of a query; a spoken question is mostly "tell me
// about a time you", which would match every fact a little and none more
// than another. Short technology names ("go", "c#") are words and stay.
// The second list is how a question is put, not what it is about: "what is
// your EXPERIENCE with NestJS", "anything in your BACKGROUND", "how do you
// APPROACH", "have you EVER USED". Left in, "experience" finds every
// "employee experience" tag and "background" every "background job".
const FILLER = new Set(
  "a about again all also an and any are as at be been but by can could did do does for from had has have how i if in into is it its just like me more my of on one or our out over so some tell than that the their them then there these they this those time to up us was we were what when where which who why will with would you your yeah okay ok um uh well great thanks thank really kind sort bit walk through talk give describe example explain".split(
    " ",
  ),
);
for (const word of "experience experienced background ever approach handle handled used use using know worked".split(
  " ",
))
  FILLER.add(word);
// [DOMAIN] The phrases the engine reads as an exclusion ("an example that is
// NOT AT Larchmont", "OTHER THAN payments"). Their second word is filler
// anywhere else; after the first it is what makes the phrase, so it is kept
// when the engine is to read exclusions (`exclusions`).
const EXCLUDES: Readonly<Record<string, string>> = {
  not: "at",
  other: "than",
  except: "for",
  apart: "from",
  aside: "from",
};
export function keyTerms(spoken: string, exclusions = false): string {
  const words = wordsOf(spoken);
  return words
    .filter(
      (word, at) =>
        !FILLER.has(word) ||
        (exclusions && EXCLUDES[words[at - 1] ?? ""] === word),
    )
    .join(" ");
}
