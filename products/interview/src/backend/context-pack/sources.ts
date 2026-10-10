// A person's material as sources the AI engine prepares (ADR-0038): the
// experience matrix, the employer brief and the person's preferences, each
// record with an identity, a kind, the words a model reads, the fields a
// look-up reads, and where in the material it came from.
//
// [DOMAIN] Identity is not position. A role is named by its employer and
// title, a fact by its role, its section and what it says, so inserting a
// role above it changes no identity. The position is kept beside it as the
// `locator` ("/roles/3/proof_points/1"): the address the windows already
// open, valid for the revision it was read at.
// These sources are structured, so preparing them calls no model.
import { createHash } from "node:crypto";
import type { Source } from "@omnitech/ai-engine";
import type {
  CandidateMatrix,
  EmployerBrief,
} from "@omnitech/interview-contracts";
import { KINDS, sameAs, wordsOf } from "./recipe";

type SourceRecord = NonNullable<Source["records"]>[number];

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "x";
const short = (text: string) =>
  createHash("sha256").update(text).digest("hex").slice(0, 12);
// One line: what a model reads, and what a person sees quoted.
const line = (text: string) => text.replace(/\s+/g, " ").trim();

// How much each section of a role says about what the person achieved.
const SECTIONS = [
  ["proof_points", 4],
  ["leadership_signals", 2],
  ["responsibilities", 1],
] as const;
// A metric that stands alone is a result with no account of how: below a
// proof point, above what was led.
const METRIC_ALONE = 3;
// Where a metric may belong: a result is stated by a proof point first, then
// by a responsibility. A leadership signal ("mentorship") states no figure.
const CARRIES_METRICS: readonly string[] = ["proof_points", "responsibilities"];
// How many of a role's technologies an achievement's sentence names.
const STACK_SAID = 3;

// One part of the matrix an achievement was composed from: where it is, and
// its own words. The parts are objects, so selection never matches on them.
type Part = { section: string; locator: string; text: string };
type Statement = {
  section: string;
  index: number;
  weight: number;
  said: string;
  parts: Part[];
  // The metrics that belong to it and that its own words do not say whole.
  added: string[];
};

const has = (words: ReadonlySet<string>, word: string) =>
  sameAs(word).some((form) => words.has(form));
// Whether a text states a value as a whole ("6" is not in "65%").
const states = (text: string, value: string) => {
  const at = text.toLowerCase().indexOf(value.toLowerCase());
  if (at === -1 || value === "") return false;
  const before = text[at - 1] ?? " ";
  const after = text[at + value.length] ?? " ";
  return !/[a-z0-9]/i.test(before) && !/[a-z0-9%]/i.test(after);
};
const SMALL = new Set(["a", "an", "and", "the", "of", "to", "for", "in", "on"]);
const meaning = (text: string) =>
  wordsOf(text).filter((word) => !SMALL.has(word));

// [DOMAIN] Which statement a metric belongs to, decided in code and so kept
// strict. A metric belongs to a statement that STATES ITS VALUE ("release
// cycles: monthly to daily" belongs to "Cut release cycles from monthly to
// daily"); failing that, to one that says EVERY word of its label ("API
// usage" in "Grew API usage across partners"). Proof points are tried before
// responsibilities, the first that fits wins, and a metric that fits none
// stands as an achievement of its own with its role. Pairing a responsibility
// with the proof point it led to needs judgement and is not done here.
function owner(
  statements: readonly Statement[],
  metric: { label: string; value: string | number },
): Statement | undefined {
  const value = String(metric.value);
  const label = meaning(metric.label);
  const able = CARRIES_METRICS.flatMap((section) =>
    statements.filter((each) => each.section === section),
  );
  return (
    able.find((each) => states(each.said, value)) ??
    able.find((each) => {
      const said = new Set(wordsOf(each.said));
      return label.length > 0 && label.every((word) => has(said, word));
    })
  );
}

// [DOMAIN] A theme is a subject the person filed the role under (its tags,
// patterns, problem spaces and system types): a closed vocabulary, the
// matrix's own. An achievement takes a theme when its own words say at least
// half of the theme's words, in any accepted form. That is what lets a
// question about "a migration" find "Led modernization of the legacy
// monolith" under "legacy modernization", and not every line of the role.
function themesOf(phrases: readonly string[], said: string): string[] {
  const words = new Set(wordsOf(said));
  return phrases.filter((phrase) => {
    const parts = meaning(phrase);
    const found = parts.filter((word) => has(words, word)).length;
    return parts.length > 0 && found >= Math.ceil(parts.length / 2);
  });
}

export function matrixSource(
  matrix: CandidateMatrix,
  profile: { id: string; revision: number },
): Source {
  const records: SourceRecord[] = [];
  const { candidate } = matrix;
  const about = {
    ...(candidate.name ? { name: candidate.name } : {}),
    ...(candidate.headline ? { headline: line(candidate.headline) } : {}),
    ...(candidate.location ? { location: line(candidate.location) } : {}),
  };
  if (Object.keys(about).length > 0)
    records.push({
      id: "candidate",
      kind: KINDS.profile,
      text: [about.name, about.headline].filter(Boolean).join(": "),
      fields: about,
      locator: "/candidate",
    });

  // Two roles with one employer and title are told apart by their order
  // among themselves, never among all roles.
  const seen = new Map<string, number>();
  for (const [at, role] of matrix.roles.entries()) {
    const named = `role:${slug(role.company)}:${slug(role.title)}`;
    const again = seen.get(named) ?? 0;
    seen.set(named, again + 1);
    const key = again === 0 ? named : `${named}:${again + 1}`;
    const technologies = role.technologies ?? [];
    // The role's own subjects: the closed vocabulary its themes come from.
    const subjects = [
      ...(role.tags ?? []),
      ...(role.patterns ?? []),
      ...(role.problem_spaces ?? []),
      ...(role.system_types ?? []),
    ];
    const tags = [...subjects, ...(role.industry ?? [])];
    // A matrix lists the newest role first: with nothing else to go on,
    // the recent ones are the ones to talk about.
    const recency = Math.max(0, 10 - at);
    records.push({
      id: key,
      kind: KINDS.role,
      text: line(
        `${role.title}, ${role.company}${role.period ? ` (${role.period})` : ""}`,
      ),
      fields: {
        company: role.company,
        title: role.title,
        technologies,
        tags,
        ...(role.period ? { period: role.period } : {}),
      },
      priority: recency,
      locator: `/roles/${at}`,
    });

    // [STRATEGY] First every statement the role makes, then each metric to
    // the statement it belongs to, then one achievement per statement.
    const statements: Statement[] = SECTIONS.flatMap(([section, weight]) =>
      (role[section] ?? []).map((said, index) => ({
        section,
        index,
        weight,
        said: line(said),
        parts: [
          {
            section,
            locator: `/roles/${at}/${section}/${index}`,
            text: line(said),
          },
        ],
        added: [],
      })),
    );
    for (const [index, metric] of (role.metrics ?? []).entries()) {
      const text = line(
        `${metric.label}: ${metric.value}${metric.direction ? ` (${metric.direction})` : ""}`,
      );
      const part = {
        section: "metrics",
        locator: `/roles/${at}/metrics/${index}`,
        text,
      };
      const belongs = owner(statements, metric);
      if (!belongs) {
        statements.push({
          section: "metrics",
          index,
          weight: METRIC_ALONE,
          said: text,
          parts: [part],
          added: [],
        });
        continue;
      }
      belongs.parts.push(part);
      // [SAFETY] The metric is written after the statement unless the
      // statement already says all of it, its value and every word of its
      // label: a claim is checked against this text, so nothing a part says
      // may be missing from it ("p95" is a figure a claim can cite).
      const said = new Set(wordsOf(belongs.said));
      const whole =
        states(belongs.said, String(metric.value)) &&
        meaning(metric.label).every((word) => has(said, word));
      if (!whole) belongs.added.push(text);
    }

    // [DOMAIN] One achievement says who, where, when and what in one line:
    // "At <employer> (<period>, <title>): <what was done>; <its metric>.
    // Stack: <the role's technologies>." Everything in it is the matrix's own
    // words in the matrix's own order, so a figure in it is the person's
    // figure and a claim checked against it is checked against the record.
    const where = `At ${role.company} (${[role.period, role.title].filter(Boolean).join(", ")})`;
    const stack =
      technologies.length > 0
        ? ` Stack: ${technologies.slice(0, STACK_SAID).join(", ")}.`
        : "";
    for (const each of statements) {
      const what = [each.said, ...each.added].join("; ");
      // Its own words: the statement and every metric that belongs to it.
      const own = each.parts.map((part) => part.text).join(" ");
      const said = new Set(wordsOf(own));
      const themes = themesOf(subjects, own);
      records.push({
        id: `${key}:${each.section}:${short(each.said)}`,
        kind: KINDS.achievement,
        text: line(`${where}: ${what.replace(/[.;]+$/, "")}.${stack}`),
        fields: {
          company: role.company,
          title: role.title,
          ...(role.period ? { period: role.period } : {}),
          // A technology the achievement itself names, and the role's whole
          // stack: the first is about it, the second is where it was done.
          technologies: technologies.filter((technology) =>
            wordsOf(technology).every((word) => has(said, word)),
          ),
          stack: technologies,
          themes,
          tags,
          of: { role: key, section: each.section },
          parts: each.parts,
        },
        // Recent roles first, then the section's weight, then the order the
        // person listed things in: the engine breaks an equal match by this.
        priority:
          recency * 100 + each.weight * 10 + Math.max(0, 9 - each.index),
        // The pointer is the statement's own place; `parts` has every place.
        locator: each.parts[0]?.locator ?? `/roles/${at}`,
      });
    }
  }
  for (const [index, story] of (matrix.story_selector ?? []).entries()) {
    const text = line(
      `For "${story.need}": ${story.primary_story}${story.backup_story ? ` (or: ${story.backup_story})` : ""}`,
    );
    records.push({
      id: `story:${short(text)}`,
      kind: KINDS.story,
      text,
      fields: { need: story.need },
      priority: 2,
      locator: `/story_selector/${index}`,
    });
  }
  return {
    id: `matrix:${profile.id}`,
    revision: String(profile.revision),
    kind: "experience-matrix",
    records: distinct(records),
  };
}

// [DOMAIN] What a line is headed with: the words before a sentence's colon
// ("NestJS: …", "Base salary: …", and "Why leaving: …" inside a longer note).
// A heading is short; a colon after many words is punctuation ("…, 10:00"),
// and "Proof:" heads the evidence a note names, not a topic.
const HEADING_WORDS = 8;
const PROOF_LABELS: readonly string[] = ["proof", "evidence", "example"];
export function headingsOf(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).flatMap((sentence) => {
    const at = sentence.indexOf(":");
    if (at <= 0) return [];
    const heading = sentence.slice(0, at).trim();
    const words = wordsOf(heading);
    return words.length > 0 &&
      words.length <= HEADING_WORDS &&
      !PROOF_LABELS.includes(heading.toLowerCase())
      ? [heading]
      : [];
  });
}
const headed = (text: string) => {
  const heading = headingsOf(text);
  return heading.length > 0 ? { heading } : {};
};

// The model-cleaned employer brief: already a schema, so each line is a
// record of its own kind. Locators follow the brief's labelled lines.
// Each section with the words a person uses for it when they ask ("do you
// have any questions for us", "what do they value"): a line is found by what
// it says or by what it is.
const BRIEF_LISTS = [
  ["mustHaves", KINDS.requirement, 3, "must have requirements required"],
  ["techStack", KINDS.requirement, 2, "tech stack technologies tools"],
  ["responsibilities", KINDS.requirement, 1, "responsibilities role job"],
  ["niceToHaves", KINDS.requirement, 1, "nice to have bonus"],
  ["companyFacts", KINDS.employerFact, 2, "company business"],
  ["values", KINDS.employerFact, 2, "values culture care"],
  ["prepNotes", KINDS.prep, 3, "prep notes"],
  ["questionsToAsk", KINDS.prep, 2, "questions ask"],
] as const;
const BRIEF_TEXTS = [
  ["summary", KINDS.employerFact, "summary role company"],
  ["team", KINDS.employerFact, "team people structure"],
  ["interviewFormat", KINDS.employerFact, "interview format process stages"],
] as const;

export function briefSource(
  brief: EmployerBrief,
  from: { id: string; revision: string },
): Source {
  const records: SourceRecord[] = [
    {
      id: "employer",
      kind: KINDS.employer,
      text: line(`${brief.role} at ${brief.company}`),
      fields: { company: brief.company, role: brief.role },
      locator: "/context/employerBrief",
    },
  ];
  for (const [section, kind, priority, label] of BRIEF_LISTS)
    for (const said of brief[section] ?? [])
      records.push({
        id: `brief:${section}:${short(said)}`,
        kind,
        text: line(said),
        fields: { section, label, ...headed(line(said)) },
        priority,
      });
  for (const [section, kind, label] of BRIEF_TEXTS) {
    const said = brief[section];
    if (said)
      records.push({
        id: `brief:${section}`,
        kind,
        text: line(said),
        fields: { section, label, ...headed(line(said)) },
        priority: 1,
      });
  }
  return {
    id: `brief:${from.id}`,
    revision: from.revision,
    kind: "employer-brief",
    records: distinct(records).filter((record) => record.text !== ""),
  };
}

// What the person typed about what they want (notice, pay, how they work):
// used as given, one line a record.
export function preferencesSource(
  text: string,
  from: { id: string; revision: string },
): Source {
  return {
    id: `preferences:${from.id}`,
    revision: from.revision,
    kind: "candidate-preferences",
    records: distinct(
      text
        .split(/\r?\n+/)
        // A line's bullet or number goes first, so "1. Remote first" is one
        // thing said and not a "1." and a "Remote first".
        .map((row) => row.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""))
        .flatMap((row) => row.split(/(?<=[.!?;])\s+/))
        .map(line)
        .filter(Boolean)
        .map((piece, index) => ({
          id: `preference:${short(piece)}`,
          kind: KINDS.preference,
          text: piece,
          ...(headingsOf(piece).length > 0 ? { fields: headed(piece) } : {}),
          locator: `/context/candidatePreferences/${index}`,
        })),
    ),
  };
}

// The same thing said twice is one record: the first keeps its place.
function distinct(records: readonly SourceRecord[]): SourceRecord[] {
  const kept = new Map<string, SourceRecord>();
  for (const record of records)
    if (!kept.has(record.id)) kept.set(record.id, record);
  return [...kept.values()];
}
