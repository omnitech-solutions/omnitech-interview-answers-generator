import type { BriefingContext } from "@omnitech/interview-contracts";

const CONDENSE_MIN_CHARS = 4_000;
export const condenseBudget = (text: string) =>
  Math.min(Math.max(Math.round(text.length / 4), 3_000), 9_000);

export function condenseMaterial(context: BriefingContext) {
  const long = (value: string | undefined) =>
    (value?.length ?? 0) >= CONDENSE_MIN_CHARS ? (value as string) : "";
  return {
    jobDescription: long(context.jobDescription),
    research: long(context.research),
  };
}

export function shorterMaterial(
  material: { jobDescription: string; research: string },
  generated: { jobDescription: string; research: string },
) {
  const condensed: { jobDescription?: string; research?: string } = {};
  for (const key of ["jobDescription", "research"] as const) {
    const text = generated[key].trim();
    if (text && text.length < material[key].length) condensed[key] = text;
  }
  return condensed;
}

export function withCondensedContext(
  context: BriefingContext,
  condensed: { jobDescription?: string; research?: string },
) {
  const { condensed: _previous, ...rest } = context;
  return Object.keys(condensed).length ? { ...rest, condensed } : rest;
}
