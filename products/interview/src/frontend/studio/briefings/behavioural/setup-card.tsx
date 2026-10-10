import type {
  BriefingClient,
  BriefingProfileSummary,
} from "@omnitech/interview-api-client";
import {
  type BriefingContext,
  briefingEmployerSaid,
  type CandidateMatrix,
  type EmployerSaidInput,
  employerSaidText,
} from "@omnitech/interview-contracts";
import { useState } from "react";
import { Icon } from "../../icon";
import { EmployerSaidList } from "../../interview-brief/brief-lists";
import { STAGES } from "./config";
import { MatrixPicker, type ProfileRef } from "./matrix-picker";

// What the person tells us about the interview, before it becomes the pack's
// context. Text fields stay strings while being typed.
export type PackSetup = {
  profile: ProfileRef | null;
  company: string;
  role: string;
  interviewer: string;
  interviewerTitle: string;
  duration: string;
  stage: BriefingContext["stage"];
  jobDescription: string;
  // What the employer or a recruiter said, as dated entries (the old single
  // "employer notes" text reads as one entry with no date).
  employerSaid: readonly EmployerSaidInput[];
  research: string;
  roleIds: readonly string[];
};

export const emptySetup = (profile: ProfileRef | null): PackSetup => ({
  profile,
  company: "",
  role: "",
  interviewer: "",
  interviewerTitle: "",
  duration: "30",
  stage: "recruiter",
  jobDescription: "",
  employerSaid: [],
  research: "",
  roleIds: [],
});

export function setupOf(context: BriefingContext): PackSetup {
  return {
    profile: context.profile,
    company: context.company,
    role: context.role,
    interviewer: context.interviewer ?? "",
    interviewerTitle: context.interviewerTitle ?? "",
    duration: String(context.durationMinutes ?? ""),
    stage: context.stage,
    jobDescription: context.jobDescription ?? "",
    employerSaid: briefingEmployerSaid(context),
    research: context.research ?? "",
    roleIds: context.roleIds ?? [],
  };
}

// [GUARD] A pack needs a matrix, a company and a role; everything else is
// optional and left out when blank.
export function contextOf(
  setup: PackSetup,
  previous?: BriefingContext,
): BriefingContext | null {
  if (!setup.profile || !setup.company.trim() || !setup.role.trim())
    return null;
  const optional = (value: string) => value.trim() || undefined;
  const minutes = Number.parseInt(setup.duration, 10);
  const context: BriefingContext = {
    company: setup.company.trim(),
    role: setup.role.trim(),
    stage: setup.stage,
    profile: setup.profile,
    ...(previous?.request ? { request: previous.request } : {}),
    ...(previous?.candidatePreferences
      ? { candidatePreferences: previous.candidatePreferences }
      : {}),
    // [GUARD] The condensed copy holds only while both long fields are what
    // it was made from: an edit to either drops it, so the assistant never
    // reads a summary of text that is no longer there.
    ...(previous?.condensed &&
    (previous.jobDescription ?? "") === setup.jobDescription.trim() &&
    (previous.research ?? "") === setup.research.trim()
      ? { condensed: previous.condensed }
      : {}),
  };
  for (const [key, value] of [
    ["interviewer", optional(setup.interviewer)],
    ["interviewerTitle", optional(setup.interviewerTitle)],
    ["jobDescription", optional(setup.jobDescription)],
    ["research", optional(setup.research)],
  ] as const)
    if (value) context[key] = value;
  // [DOMAIN] The entries are kept as they were typed, and beside them as the
  // one text every reader of the pack's employer notes takes.
  if (setup.employerSaid.length > 0) {
    context.employerSaid = [...setup.employerSaid];
    context.employerNotes = employerSaidText(setup.employerSaid);
  }
  if (minutes >= 5 && minutes <= 480) context.durationMinutes = minutes;
  if (setup.roleIds.length) context.roleIds = [...setup.roleIds];
  return context;
}

// A field worth condensing is a long one (the server leaves short ones alone).
const LONG_FIELD_CHARS = 4_000;
const thousands = (count: number) => count.toLocaleString("en-US");

// [DOMAIN] The assistant reads the pack on every turn, so a posting or
// research pasted whole can fill its context. This makes a condensed copy for
// it; what is typed above is kept exactly as it is.
function CondenseRow({
  setup,
  condense,
}: {
  setup: PackSetup;
  condense: NonNullable<Parameters<typeof SetupCard>[0]["condense"]>;
}) {
  const original = setup.jobDescription.length + setup.research.length;
  const long =
    setup.jobDescription.length >= LONG_FIELD_CHARS ||
    setup.research.length >= LONG_FIELD_CHARS;
  const current = condense.current;
  // What the assistant reads now: each condensed field in place of its original.
  const seen =
    (current?.jobDescription?.length ?? setup.jobDescription.length) +
    (current?.research?.length ?? setup.research.length);
  return (
    <div className="bp-row" data-testid="bp-condense">
      <button
        type="button"
        className="bp-link"
        disabled={condense.busy || !long}
        onClick={condense.run}
        data-testid="bp-condense-run"
      >
        <Icon name="auto_awesome" />
        {condense.busy
          ? "Condensing…"
          : current
            ? "Condense again"
            : "Condense for the assistant"}
      </button>
      <span className="bp-meta" role="status" data-testid="bp-condense-status">
        {current
          ? `The assistant reads a condensed copy: ${thousands(seen)} of ${thousands(original)} characters. What you pasted is kept.`
          : long
            ? `The assistant reads all ${thousands(original)} characters on every turn. Condensing keeps what you pasted and gives it a shorter copy.`
            : "Short enough as it is: nothing to condense."}
      </span>
    </div>
  );
}

// [STRATEGY] Roles are ranked by how many of their skills, systems and
// domains appear in the posting (or the role title, without a posting).
export function rankRoles(matrix: CandidateMatrix, setup: PackSetup) {
  const target = `${setup.role} ${setup.jobDescription}`.toLowerCase();
  return matrix.roles
    .map((role, index) => {
      const keywords = [
        ...(role.technologies ?? []),
        ...(role.system_types ?? []),
        ...(role.problem_spaces ?? []),
        ...(role.industry ?? []),
        ...(role.tags ?? []),
      ].map((keyword) => keyword.toLowerCase());
      const hits = keywords.filter((keyword) => target.includes(keyword));
      const titleHit = setup.role
        .toLowerCase()
        .split(/\W+/)
        .some(
          (word) => word.length > 3 && role.title.toLowerCase().includes(word),
        );
      const match = Math.min(
        100,
        Math.round(
          (hits.length / Math.max(4, Math.min(keywords.length, 12))) * 100,
        ) + (titleHit ? 20 : 0),
      );
      return { id: `/roles/${index}`, role, match };
    })
    .sort((a, b) => b.match - a.match);
}

const TOP_ROLES = 8;

export function SetupCard({
  client,
  profiles,
  matrix,
  setup,
  onChange,
  onImported,
  condense,
}: {
  client: BriefingClient;
  profiles: readonly BriefingProfileSummary[];
  matrix: CandidateMatrix | null;
  setup: PackSetup;
  onChange(setup: PackSetup): void;
  onImported(profile: ProfileRef): void;
  // Condensing the long fields for the assistant: offered on a saved pack.
  condense?: {
    // The copy in force, when there is one that still matches the fields.
    current: {
      jobDescription?: string | undefined;
      research?: string | undefined;
    } | null;
    busy: boolean;
    run(): void;
  };
}) {
  const [moreContext, setMoreContext] = useState(
    Boolean(
      setup.jobDescription || setup.employerSaid.length > 0 || setup.research,
    ),
  );
  const [allRoles, setAllRoles] = useState(false);
  const set = (patch: Partial<PackSetup>) => onChange({ ...setup, ...patch });
  const stage = STAGES.find((item) => item.id === setup.stage)!;
  const ranked = matrix ? rankRoles(matrix, setup) : [];
  const shown = allRoles ? ranked : ranked.slice(0, TOP_ROLES);
  const field = (
    label: string,
    key: "company" | "role" | "interviewer" | "interviewerTitle" | "duration",
    placeholder = "",
  ) => (
    <label className="bp-field">
      {label}
      <input
        value={setup[key]}
        placeholder={placeholder}
        inputMode={key === "duration" ? "numeric" : undefined}
        onChange={(event) => set({ [key]: event.target.value })}
      />
    </label>
  );
  const area = (
    label: string,
    key: "jobDescription" | "research",
    placeholder: string,
  ) => (
    <label className="bp-field">
      {label}
      <textarea
        rows={5}
        value={setup[key]}
        placeholder={placeholder}
        onChange={(event) => set({ [key]: event.target.value })}
      />
    </label>
  );

  return (
    <div className="bp-card bp-setup">
      <MatrixPicker
        client={client}
        profiles={profiles}
        value={setup.profile}
        matrix={matrix}
        onChange={(profile) => set({ profile, roleIds: [] })}
        onImported={(profile) => {
          set({ profile, roleIds: [] });
          onImported(profile);
        }}
      />
      <div className="bp-section">
        <div className="bp-eyebrow">Interview</div>
        <div className="bp-grid">
          {field("Company", "company", "e.g. Northwind")}
          {field("Role", "role", "e.g. Senior Backend Engineer")}
          {field("Interviewer", "interviewer", "Name")}
          {field("Their role", "interviewerTitle", "e.g. Talent Acquisition")}
          {field("Length (minutes)", "duration")}
        </div>
        <div className="bp-stage">
          <span>Stage</span>
          <div className="brief-kinds" role="radiogroup" aria-label="Stage">
            {STAGES.map((item) => (
              // biome-ignore lint/a11y/useSemanticElements: a styled button is the radio here; a native input would change the element and its styling
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={item.id === setup.stage}
                onClick={() => set({ stage: item.id })}
              >
                {item.label}
              </button>
            ))}
          </div>
          <span>{stage.note}</span>
        </div>
        <button
          type="button"
          className="bp-disclosure"
          aria-expanded={moreContext}
          onClick={() => setMoreContext(!moreContext)}
        >
          <Icon name={moreContext ? "expand_less" : "expand_more"} />
          Job posting, research and notes
          <span>
            ·{" "}
            {setup.jobDescription.trim() || setup.research.trim()
              ? "added"
              : "optional, improves role matching"}
          </span>
        </button>
        {moreContext && (
          <div className="bp-grid wide">
            {area("Job description", "jobDescription", "Paste the posting")}
            <EmployerSaidList
              entries={setup.employerSaid.map((entry, at) => ({
                ...entry,
                id: String(at),
              }))}
              onAdd={(entry) =>
                set({ employerSaid: [...setup.employerSaid, entry] })
              }
              onRemove={(id) =>
                set({
                  employerSaid: setup.employerSaid.filter(
                    (_, at) => String(at) !== id,
                  ),
                })
              }
            />
            {area(
              "Research",
              "research",
              "Interviewer background, candidate reports, reviews…",
            )}
            {condense && <CondenseRow setup={setup} condense={condense} />}
          </div>
        )}
      </div>
      {matrix && (
        <div className="bp-section">
          <div className="bp-row">
            <span className="bp-eyebrow bp-grow">Roles to lean on</span>
            {ranked.length > TOP_ROLES && (
              <button
                type="button"
                className="bp-link"
                onClick={() => setAllRoles(!allRoles)}
              >
                {allRoles
                  ? `Show top ${TOP_ROLES}`
                  : `Show all ${ranked.length}`}
              </button>
            )}
          </div>
          <div className="bp-meta">
            {setup.jobDescription.trim()
              ? "Ranked against the job description."
              : `Ranked by fit for ${setup.role.trim() || "the role"}. Add the job description to sharpen this.`}{" "}
            {setup.roleIds.length
              ? `${setup.roleIds.length} selected.`
              : "None selected: every role is considered."}
          </div>
          <div className="bp-chips">
            {shown.map((item) => {
              const on = setup.roleIds.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className="bp-role"
                  aria-pressed={on}
                  title={`${item.role.title}${item.role.period ? ` · ${item.role.period}` : ""}`}
                  onClick={() =>
                    set({
                      roleIds: on
                        ? setup.roleIds.filter((id) => id !== item.id)
                        : [...setup.roleIds, item.id],
                    })
                  }
                >
                  <Icon name={on ? "check_circle" : "add"} filled={on} />
                  <span className="bp-role-name">{item.role.company}</span>
                  <span
                    className={`bp-mono${item.match >= 80 ? " strong" : ""}`}
                  >
                    {item.match}%
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
