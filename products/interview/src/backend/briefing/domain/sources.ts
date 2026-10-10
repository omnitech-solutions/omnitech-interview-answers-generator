import { createHash } from "node:crypto";
import type { BriefingContext } from "@omnitech/interview-contracts";
import type { Source } from "../contracts";
import type { selectCandidateFragments } from "../selection";
export const sha = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export const briefContext = ({
  request: _request,
  jobDescription: _jobDescription,
  // The entries are sent once, as the text of `employerNotes`.
  employerSaid: _employerSaid,
  employerNotes: _employerNotes,
  research: _research,
  candidatePreferences: _preferences,
  condensed: _condensed,
  ...facts
}: BriefingContext) => facts;
function extractLeaves(
  value: unknown,
  pointer: string,
  result: Source[],
  profileId: string,
  profileRevision: number,
) {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value);
    if (text)
      result.push({
        pointer,
        text,
        sourceKind: "candidate",
        id: sha(`${profileId}:${pointer}`),
        revision: profileRevision,
        sha256: sha(text),
      });
  } else if (Array.isArray(value)) {
    for (const [index, item] of value.entries())
      extractLeaves(
        item,
        `${pointer}/${index}`,
        result,
        profileId,
        profileRevision,
      );
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value))
      extractLeaves(
        item,
        `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
        result,
        profileId,
        profileRevision,
      );
  }
}
export function candidateSources(
  matrix: unknown,
  selected: ReturnType<typeof selectCandidateFragments>,
  profileId: string,
  profileRevision: number,
): Source[] {
  const result: Source[] = [];
  const root = matrix as Record<string, unknown>;
  extractLeaves(
    root["candidate"],
    "/candidate",
    result,
    profileId,
    profileRevision,
  );
  for (const item of selected)
    extractLeaves(item.role, item.pointer, result, profileId, profileRevision);
  for (const section of [
    "resume_variants",
    "industry_mappings",
    "technology_mappings",
    "leadership_signals",
    "story_selector",
    "tag_taxonomy",
    "repositories_of_note",
    "experience_matrix_extensions",
  ]) {
    if (root[section] !== undefined)
      extractLeaves(
        root[section],
        `/${section}`,
        result,
        profileId,
        profileRevision,
      );
  }
  return result;
}
export function contextSources(
  context: {
    request?: string | undefined;
    jobDescription?: string | undefined;
    employerNotes?: string | undefined;
    research?: string | undefined;
    candidatePreferences?: string | undefined;
  },
  draftRevision: number,
): Source[] {
  const result: Source[] = [];
  for (const [key, sourceKind] of [
    ["request", "employer-context"],
    ["jobDescription", "employer-context"],
    ["employerNotes", "employer-context"],
    ["research", "employer-context"],
    ["candidatePreferences", "candidate-preference"],
  ] as const) {
    const text = context[key];
    if (text)
      result.push({
        pointer: `/context/${key}`,
        text,
        sourceKind,
        id: sha(`${key}:${text}`),
        revision: draftRevision,
        sha256: sha(text),
      });
  }
  return result;
}
