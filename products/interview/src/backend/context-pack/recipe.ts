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
  evidence: "candidate-evidence",
  story: "candidate-story",
  preference: "candidate-preference",
  employer: "employer-detail",
  requirement: "employer-requirement",
  employerFact: "employer-fact",
  prep: "prep-note",
} as const;
export type ContextKind = (typeof KINDS)[keyof typeof KINDS];

// Whose a kind is, for whoever reads a selected fact.
export const ABOUT: Readonly<
  Record<ContextKind, "candidate" | "employer" | "preference">
> = {
  "candidate-profile": "candidate",
  "candidate-role": "candidate",
  "candidate-evidence": "candidate",
  "candidate-story": "candidate",
  "candidate-preference": "preference",
  "employer-detail": "employer",
  "employer-requirement": "employer",
  "employer-fact": "employer",
  "prep-note": "employer",
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

// [DOMAIN] A word found in a fact's technologies or its employer's name says
// more than the same word in passing, so it counts for more.
const EVIDENCE_WEIGHTS = { technologies: 3, company: 3, tags: 2, text: 1 };

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

const projection = (
  id: ProjectionId,
  size: { evidence: number; other: number },
) => ({
  id,
  slots: [
    ...EXACT,
    // A story the person chose for this kind of question leads.
    ranked("stories", KINDS.story, 2),
    ranked("evidence", KINDS.evidence, size.evidence, {
      weights: EVIDENCE_WEIGHTS,
      share: 0.6,
    }),
    ranked("roles", KINDS.role, 3, { weights: EVIDENCE_WEIGHTS }),
    ranked("preferences", KINDS.preference, size.other),
    ranked("requirements", KINDS.requirement, size.other, { share: 0.15 }),
    ranked("employer", KINDS.employerFact, size.other, { share: 0.15 }),
    ranked("prep", KINDS.prep, size.other),
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
  ["migration", "migrate", "migrated", "migrating"],
  ["scale", "scaling", "scaled"],
  ["mentoring", "mentored", "mentor", "coaching"],
  ["kubernetes", "k8s"],
  ["postgres", "postgresql"],
  ["javascript", "js"],
  ["typescript", "ts"],
] as const;
const ALIASES: Record<string, string[]> = {};
for (const group of SAME)
  for (const word of group)
    ALIASES[word] = group.filter((other) => other !== word);

export const INTERVIEW_CONTEXT_RECIPE: Recipe = {
  id: "interview-context",
  version: "1",
  kinds: Object.fromEntries(Object.values(KINDS).map((kind) => [kind, {}])),
  projections: [
    projection(PROJECTIONS.coach, { evidence: 6, other: 3 }),
    projection(PROJECTIONS.answer, { evidence: 16, other: 6 }),
    projection(PROJECTIONS.inspect, { evidence: 60, other: 24 }),
  ],
  aliases: ALIASES,
};

// [STRATEGY] What was asked, without the words every question shares. The
// engine counts every word of a query; a spoken question is mostly "tell me
// about a time you", which would match every fact a little and none more
// than another. Short technology names ("go", "c#") are words and stay.
const FILLER = new Set(
  "a about again all also an and any are as at be been but by can could did do does for from had has have how i if in into is it its just like me more my of on one or our out over so some tell than that the their them then there these they this those time to up us was we were what when where which who why will with would you your yeah okay ok um uh well great thanks thank really kind sort bit walk through talk give describe example explain".split(
    " ",
  ),
);
export function keyTerms(spoken: string): string {
  return (spoken.toLowerCase().match(/[a-z0-9][a-z0-9+#.]*/g) ?? [])
    .map((word) => word.replace(/\.+$/, ""))
    .filter((word) => word !== "" && !FILLER.has(word))
    .join(" ");
}
