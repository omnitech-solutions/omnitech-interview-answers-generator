// The interview context recipe (ADR-0038): what kinds of fact a person's
// material holds, and the named selections ("projections") a task reads.
// It is configuration, not code: the AI engine prepares sources into records
// of these kinds and resolves a projection for one question, the same way
// for the coach, an answer and the view a person inspects.
import type { Recipe, Slot } from "@omnitech/ai-engine";

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
const HEADED_WEIGHTS = { heading: 3, text: 1 };

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
} as const;
export type ProjectionId = (typeof PROJECTIONS)[keyof typeof PROJECTIONS];

// [DOMAIN] How the evidence for one question is arranged (pack.ts does it,
// after the engine has ranked). The engine ranks every achievement that bears
// on the question, up to EVIDENCE_RANKED; a projection's places are then
// filled by these rules, in this order:
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
// `inspect` shows everything that bears on a question, so it is not arranged
// by role: only rule 1 orders it.
export const EVIDENCE_PLACES: Readonly<
  Record<ProjectionId, { places: number; roles?: number; lead?: number }>
> = {
  coach: { places: 4, roles: 2, lead: 3 },
  answer: { places: 6, roles: 2, lead: 4 },
  inspect: { places: 60 },
};
const EVIDENCE_RANKED = 60;
export const DOMINATES = 2;
export const SPEAKS_FOR = 2;

const projection = (id: ProjectionId, other: number) => ({
  id,
  slots: [
    ...EXACT,
    // A story the person chose for this kind of question leads.
    ranked("stories", KINDS.story, 2),
    ranked("evidence", KINDS.achievement, EVIDENCE_RANKED, {
      weights: EVIDENCE_WEIGHTS,
      share: 0.6,
    }),
    ranked("roles", KINDS.role, 3, { weights: ROLE_WEIGHTS }),
    ranked("preferences", KINDS.preference, other, {
      weights: HEADED_WEIGHTS,
    }),
    ranked("requirements", KINDS.requirement, other, {
      // A technology a requirement names counts as one an achievement names.
      weights: { ...HEADED_WEIGHTS, technologies: 3 },
      share: 0.15,
    }),
    ranked("employer", KINDS.employerFact, other, {
      weights: HEADED_WEIGHTS,
      share: 0.15,
    }),
    ranked("prep", KINDS.prep, other, { weights: HEADED_WEIGHTS }),
  ],
});

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

export const INTERVIEW_CONTEXT_RECIPE: Recipe = {
  id: "interview-context",
  version: "2",
  kinds: Object.fromEntries(Object.values(KINDS).map((kind) => [kind, {}])),
  projections: [
    projection(PROJECTIONS.coach, 3),
    projection(PROJECTIONS.answer, 6),
    projection(PROJECTIONS.inspect, 24),
  ],
  aliases: ALIASES,
};

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
export function keyTerms(spoken: string): string {
  return wordsOf(spoken)
    .filter((word) => !FILLER.has(word))
    .join(" ");
}
