// SYNTHETIC candidate matrix and candidate preferences for the replay fixtures
// (E-A1). Invented and anonymised: placeholder employers only, no contact
// details, no currency or compensation figures. The matrix DOES contain a
// document-database to PostgreSQL migration story with a metric, mentoring of
// junior developers and TypeScript, Node and React; it does NOT contain
// ABSENT_FRAMEWORK, which hazard 7a has the candidate affirm anyway.
import type { CandidateMatrix } from "@omnitech/interview-contracts";

// A plausible framework the matrix never mentions (hazard 7a).
export const ABSENT_FRAMEWORK = "Django";

export const SYNTHETIC_MATRIX: CandidateMatrix = {
  candidate: {
    name: "Candidate",
    headline: "Senior software engineer, TypeScript and Node services",
    profile_tags: ["backend", "mentoring", "data migration"],
  },
  roles: [
    {
      company: "Example Corp",
      title: "Senior software engineer",
      period: "2021 - present",
      industry: ["internal tooling"],
      technologies: ["TypeScript", "Node", "React", "PostgreSQL", "Docker"],
      patterns: ["staged cutover", "dual running", "code review"],
      responsibilities: [
        "Led the migration of the order service from a document database to PostgreSQL",
        "Mentored three junior developers through weekly pairing and code review",
        "Owned the release pipeline and the rollback runbook",
      ],
      metrics: [
        {
          label: "order query p95 latency after the PostgreSQL migration",
          value: "40% lower",
          direction: "down",
        },
        { label: "services migrated", value: 12 },
      ],
      leadership_signals: [
        "Mentored junior developers",
        "Ran the migration retrospective and shared the runbook",
      ],
    },
    {
      company: "Sample Labs",
      title: "Software engineer",
      period: "2018 - 2021",
      industry: ["developer tools"],
      technologies: ["TypeScript", "Node", "React", "Docker"],
      patterns: ["feature flags", "pair programming"],
      responsibilities: [
        "Built a React dashboard and the Node API behind it",
        "Introduced feature flags for staged releases",
      ],
      metrics: [{ label: "deploy frequency", value: "weekly to daily" }],
      leadership_signals: ["Onboarded two new teammates"],
    },
    {
      company: "Example Corp",
      title: "Developer",
      period: "2015 - 2018",
      industry: ["internal tooling"],
      technologies: ["Node", "React"],
      responsibilities: ["Maintained internal Node scripts and a React admin"],
      metrics: [{ label: "support tickets closed per month", value: 30 }],
    },
  ],
  leadership_signals: [
    {
      signal: "Mentoring junior developers",
      evidence: ["Mentored three junior developers through weekly pairing"],
    },
  ],
};

// Candidate preferences are the only approved source of notice period and
// compensation: expressed without any currency amount or figure.
export const CANDIDATE_PREFERENCES = [
  "Notice period: two weeks.",
  "Compensation: open to a range in line with market for the level, to discuss after the technical stages.",
].join("\n");

// A candidate set with no preferences supplied (logistics drafts must then
// list the missing fields rather than invent them).
export const CANDIDATE_PREFERENCES_NONE = "";

// Every string of the matrix and preferences, for the privacy scan.
export function matrixTexts(): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "number") out.push(String(value));
    else if (Array.isArray(value)) for (const item of value) walk(item);
    else if (value !== null && typeof value === "object")
      for (const item of Object.values(value)) walk(item);
  };
  walk(SYNTHETIC_MATRIX);
  out.push(CANDIDATE_PREFERENCES);
  return out;
}
