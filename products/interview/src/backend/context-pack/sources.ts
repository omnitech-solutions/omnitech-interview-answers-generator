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
import { KINDS } from "./recipe";

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
  ["proof_points", 3],
  ["leadership_signals", 2],
  ["responsibilities", 1],
] as const;

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
    const tags = [
      ...(role.tags ?? []),
      ...(role.patterns ?? []),
      ...(role.problem_spaces ?? []),
      ...(role.system_types ?? []),
      ...(role.industry ?? []),
    ];
    const shared = {
      company: role.company,
      title: role.title,
      technologies,
      tags,
    };
    records.push({
      id: key,
      kind: KINDS.role,
      text: line(
        `${role.title}, ${role.company}${role.period ? ` (${role.period})` : ""}`,
      ),
      fields: { ...shared, ...(role.period ? { period: role.period } : {}) },
      // A matrix lists the newest role first: with nothing else to go on,
      // the recent ones are the ones to talk about.
      priority: Math.max(0, 10 - at),
      locator: `/roles/${at}`,
    });
    for (const [section, priority] of SECTIONS)
      for (const [index, said] of (role[section] ?? []).entries())
        records.push({
          id: `${key}:${section}:${short(said)}`,
          kind: KINDS.evidence,
          text: line(said),
          fields: { ...shared, section },
          priority,
          locator: `/roles/${at}/${section}/${index}`,
        });
    for (const [index, metric] of (role.metrics ?? []).entries()) {
      const text = line(
        `${metric.label}: ${metric.value}${metric.direction ? ` (${metric.direction})` : ""}`,
      );
      records.push({
        id: `${key}:metrics:${short(text)}`,
        kind: KINDS.evidence,
        text,
        fields: { ...shared, section: "metrics" },
        priority: 3,
        locator: `/roles/${at}/metrics/${index}`,
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
        fields: { section, label },
        priority,
      });
  for (const [section, kind, label] of BRIEF_TEXTS) {
    const said = brief[section];
    if (said)
      records.push({
        id: `brief:${section}`,
        kind,
        text: line(said),
        fields: { section, label },
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
