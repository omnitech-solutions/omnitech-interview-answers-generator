// How each kind of claim in a published answer is presented. The kinds come from
// the backend verifier (claims.ts): only a matrix-backed claim rests on an
// approved experience entry, and an answer is published only when every claim
// verified, so a kind is a label of provenance, never a rating.
import type { ClaimKind, ClaimRefView, ClaimView } from "./session-results";

export type ClaimTone = "green" | "amber" | "neutral" | "red";
export type ClaimPresentation = {
  label: string;
  tone: ClaimTone;
  // True when the claim says something about the candidate's own experience.
  claimsExperience: boolean;
  // One short line for the chip's tooltip.
  meaning: string;
};

export const CLAIM_PRESENTATION: Record<ClaimKind, ClaimPresentation> = {
  "matrix-backed": {
    label: "From your matrix",
    tone: "green",
    claimsExperience: true,
    meaning: "Supported by an approved entry in the pinned experience matrix.",
  },
  "preference-backed": {
    label: "From your preferences",
    tone: "green",
    claimsExperience: true,
    meaning: "Taken from the preferences in your approved context.",
  },
  "suggested-interpretation": {
    label: "Suggested framing · not a claim",
    tone: "amber",
    claimsExperience: false,
    meaning: "A way to say it. It asserts nothing about your experience.",
  },
  "general-knowledge": {
    label: "General knowledge · not your experience",
    tone: "neutral",
    claimsExperience: false,
    meaning: "Technical background, not something from your matrix.",
  },
  "not-in-matrix": {
    label: "Not in your matrix",
    tone: "red",
    claimsExperience: false,
    meaning:
      "Your approved experience does not say this. Do not present it as yours.",
  },
};

// A readable name for the entry a reference points at, from its pointer alone
// (the published result carries no role or employer text): "/roles/2/summary"
// is the third role of the pinned matrix. null when the pointer says nothing
// more.
export function entryLabel(ref: Pick<ClaimRefView, "pointer">): string | null {
  const role = /^\/roles\/(\d+)(?:\/|$)/.exec(ref.pointer);
  if (role) return `Role ${Number(role[1]) + 1}`;
  if (ref.pointer.startsWith("/context/")) return "Candidate context";
  return null;
}

export type ClaimChip = {
  kind: ClaimKind;
  text: string;
  presentation: ClaimPresentation;
  // The entries the claim cites, quote included, for the expandable chip.
  entries: { label: string | null; revision: number; quote: string }[];
};

export function claimChip(claim: ClaimView): ClaimChip {
  return {
    kind: claim.kind,
    text: claim.text,
    presentation: CLAIM_PRESENTATION[claim.kind],
    entries: claim.refs.map((ref) => ({
      label: entryLabel(ref),
      revision: ref.revision,
      quote: ref.quote,
    })),
  };
}
