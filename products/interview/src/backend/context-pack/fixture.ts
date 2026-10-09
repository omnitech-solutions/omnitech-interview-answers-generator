// Invented material for the context-pack suites: a person, three roles, an
// employer brief and preferences. Nothing here describes a real person or
// company.
import type {
  CandidateMatrix,
  EmployerBrief,
} from "@omnitech/interview-contracts";
import type { SessionContext } from "../live-session/session-context";

export const HARBOURLINE = {
  company: "Harbourline",
  title: "Staff Engineer",
  period: "2022 to 2025",
  technologies: ["Go", "PostgreSQL", "Kafka"],
  tags: ["platform"],
  proof_points: [
    "Cut tide-table query latency from 900ms to 120ms by repartitioning PostgreSQL",
    "Rewrote the berth scheduler in Go for the harbour pilots",
  ],
  leadership_signals: ["Mentored four engineers through the ledger rewrite"],
  responsibilities: ["Owned the on-call rota for the berth scheduler"],
  metrics: [
    { label: "uptime", value: "99.95%" },
    { label: "p95 latency", value: "120ms", direction: "down" },
  ],
};
export const QUAYSIDE = {
  company: "Quayside Freight",
  title: "Senior Engineer",
  technologies: ["NestJS", "TypeScript", "Redis"],
  proof_points: ["Built a NestJS reporting service for dock invoices"],
  responsibilities: ["Reviewed every change to the invoice ledger"],
  metrics: [{ label: "invoices per day", value: 42000 }],
};
export const TIDEWATER = {
  company: "Tidewater Labs",
  title: "Engineer",
  technologies: ["Ruby", "Rails"],
  proof_points: ["Shipped a Rails booking flow for ferry crews"],
};
// A role that goes in first, above the others (ADR-0038 scenario 1).
export const NEWER = {
  company: "Saltmarsh Robotics",
  title: "Principal Engineer",
  technologies: ["Rust"],
  proof_points: ["Wrote a Rust controller for the dredger arm"],
};

export const MATRIX = {
  candidate: {
    name: "Mira Okonjo",
    headline: "Platform  engineer",
    location: "Lisbon",
  },
  roles: [HARBOURLINE, QUAYSIDE, TIDEWATER],
  story_selector: [
    {
      need: "conflict with a stakeholder",
      primary_story:
        "The Quayside Freight invoice dispute with the finance director",
      backup_story: "The pilots' rota disagreement",
    },
  ],
} as CandidateMatrix;

export const BRIEF: EmployerBrief = {
  company: "Larkspur Analytics",
  role: "Principal Engineer",
  companyFacts: ["Larkspur sells tide forecasts to 300 marinas"],
  prepNotes: ["The round is with the head of platform"],
  summary: "A principal engineer to rebuild the forecasting pipeline.",
  mustHaves: ["Five years of NestJS in production", "Elixir at scale"],
  niceToHaves: ["Experience with Erlang clustering"],
  techStack: ["PostgreSQL", "Elixir"],
  responsibilities: ["Lead the forecasting pipeline rebuild"],
  team: "Six engineers and one designer.",
  values: ["Write things down"],
  questionsToAsk: ["How does the group decide what to build next?"],
};

export const PREFERENCES =
  "- Base salary: 140k minimum.\n* Notice period: four weeks. Remote first!\n2) Prefers small squads";

export const PROFILE = { id: "profile-1", revision: 3, sha256: "a".repeat(64) };

export const contextOf = (
  material: Partial<NonNullable<SessionContext["material"]>> = {},
  matrix: CandidateMatrix | null = MATRIX,
): SessionContext => ({
  matrix,
  // The pack reads the material, never the snapshot's lines.
  snapshot: {} as SessionContext["snapshot"],
  material: {
    profile: PROFILE,
    brief: { ...BRIEF, candidacyId: "candidacy-1" },
    candidatePreferences: PREFERENCES,
    draftRevision: 2,
    ...material,
  },
});

export const EXECUTION = {
  scope: {
    tenantId: "00000000-0000-4000-8000-000000000001",
    actorId: "00000000-0000-4000-8000-000000000002",
  },
  signal: new AbortController().signal,
};
