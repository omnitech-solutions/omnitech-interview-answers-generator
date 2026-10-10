import { z } from "zod";

// [DOMAIN] The projection view (ADR-0038): for one question, what of a
// person's approved material a model is given under a named projection, what
// was left out and why, and what each slot came to. It is the same selection
// the coach and the answers read, so what the model read and what the person
// is shown cannot differ.
export const CONTEXT_PROJECTIONS = [
  "coach",
  "answer",
  "inspect",
  "document",
  "briefing",
] as const;

const fact = {
  // The record's identity, stable when other parts of the material change.
  id: z.string(),
  // Where it is in the material at the revision read.
  pointer: z.string(),
  text: z.string(),
  kind: z.string(),
  // Whose it is: the person's own record, the employer's material, or what
  // the person wants.
  about: z.enum(["candidate", "employer", "preference"]),
  slot: z.string(),
  // The stage it belongs to, by its place in the application (1 is the
  // first); absent for a fact of the whole application or of the person.
  stage: z.number().int().min(1).optional(),
};
// A stage of the application the material is for.
const stage = z.object({
  id: z.uuid(),
  ordinal: z.number().int().min(1),
  label: z.string(),
  kind: z.string(),
});

export const contextViewSchema = z.object({
  projection: z.enum(CONTEXT_PROJECTIONS),
  spoken: z.string(),
  // The words of what was asked that selected.
  terms: z.string(),
  records: z.number().int().nonnegative(),
  selected: z.array(z.object({ ...fact, exact: z.boolean() })),
  excluded: z.array(
    z.object({
      ...fact,
      reason: z.enum([
        "excluded",
        "relevance",
        "over-limit",
        "limit",
        "budget",
        // It belongs to a later stage than the one resolved for.
        "scope",
      ]),
    }),
  ),
  slots: z.array(
    z.object({
      slot: z.string(),
      state: z.enum([
        "covered",
        "needs-choice",
        "known-empty",
        "no-such-fact",
        "out-of-scope",
      ]),
      count: z.number().int().nonnegative(),
    }),
  ),
  // Reproduces the selection: same digest, same facts.
  digest: z.string(),
  sources: z.array(
    z.object({
      id: z.string(),
      revision: z.string(),
      // What kind of source it is ("transcript", "research", …), the stage
      // it belongs to, how many records it gave, and whether it may be sent
      // to a model that does not run on this machine. Absent: older server.
      kind: z.string().optional(),
      stage: z.number().int().min(1).optional(),
      records: z.number().int().nonnegative().optional(),
      sendable: z.boolean().optional(),
    }),
  ),
  // [DOMAIN] The stage the selection was resolved for: that stage's records
  // lead their slot, an earlier stage's follow, a later stage's are left out.
  // Null: the whole application, no stage leading. Absent: older server.
  stage: stage.nullable().optional(),
  // Every stage of the application, in order, for the picker.
  stages: z.array(stage).optional(),
});
export const contextViewResponseSchema = z.object({ view: contextViewSchema });

export type ContextProjection = (typeof CONTEXT_PROJECTIONS)[number];
export type ContextView = z.infer<typeof contextViewSchema>;
