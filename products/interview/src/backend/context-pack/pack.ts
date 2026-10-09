// The context pack (ADR-0038): a session's approved material, prepared once
// into attributable records, then resolved for one question.
//
// PROBLEM: the same question must find the same facts whoever asks (the
// coach, an answer, the view a person inspects), and every fact must say
// where it came from. STRATEGY: two steps, both the AI engine's. `prepare`
// turns the material into records (no model for structured material, and the
// result is reused while the material's revisions stand). `resolve` selects
// for one question under a named projection: pure, repeatable, and every
// record left out carries its reason.
import { createHash } from "node:crypto";
import type { AiEngine, Prepared, Resolved, Source } from "@omnitech/ai-engine";
import type { ContextView } from "@omnitech/interview-contracts";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import type { SessionContext } from "../live-session/session-context";
import {
  ABOUT,
  type ContextKind,
  INTERVIEW_CONTEXT_RECIPE,
  keyTerms,
  type ProjectionId,
} from "./recipe";
import { briefSource, matrixSource, preferencesSource } from "./sources";

export type ContextEngine = Pick<AiEngine, "context">;

// One selected fact, as a reader uses it.
export type PackFact = {
  // The record's identity, stable across edits elsewhere in the material.
  id: string;
  // Where it is in the material at the revision read ("/roles/3/proof_points/1").
  pointer: string;
  text: string;
  kind: ContextKind;
  about: "candidate" | "employer" | "preference";
  // A known field, looked up and never ranked ("employer.company").
  slot: string;
  exact: boolean;
};

export type ContextPack = {
  prepared: Prepared;
  // The selection for one question. `spoken` is what was said, as it was
  // said; an empty one selects by priority alone.
  resolve(
    projection: ProjectionId,
    spoken: string,
    overrides?: { pinned?: readonly string[]; excluded?: readonly string[] },
  ): Resolved;
  // The selection as facts, best first within each slot.
  facts(projection: ProjectionId, spoken: string): PackFact[];
  // A known field by its slot ("candidate.name"), or undefined.
  lookup(slot: string): string | undefined;
  // The whole selection for a person to inspect: what was chosen, what was
  // left out and why, and what each slot came to.
  view(projection: ProjectionId, spoken: string): PackView;
};

// The projection view (ADR-0038), as the browser contract states it.
export type PackView = ContextView;

export class ContextPackError extends Error {
  constructor(readonly reason: string) {
    super("The context pack could not be prepared.");
    this.name = "ContextPackError";
  }
}

// The sources a session's approved material gives. Empty when the session
// pinned no profile and linked no brief or preferences.
export function sessionSources(context: SessionContext): Source[] {
  const { material, matrix } = context;
  if (!material) return [];
  return [
    ...(matrix && material.profile
      ? [matrixSource(matrix, material.profile)]
      : []),
    ...(material.brief
      ? [
          briefSource(material.brief, {
            id: material.brief.candidacyId,
            // The brief carries no revision of its own: what it says is one.
            revision: createHash("sha256")
              .update(JSON.stringify(material.brief))
              .digest("hex")
              .slice(0, 16),
          }),
        ]
      : []),
    ...(material.candidatePreferences
      ? [
          preferencesSource(material.candidatePreferences, {
            id: "draft",
            revision: String(material.draftRevision ?? 0),
          }),
        ]
      : []),
  ];
}

export async function prepareContextPack(
  engine: ContextEngine,
  sources: readonly Source[],
  execution: {
    scope: { tenantId: string; actorId: string };
    signal: AbortSignal;
    for?: { kind: string; id: string };
  },
): Promise<ContextPack> {
  const recipe = INTERVIEW_CONTEXT_RECIPE;
  const result = await engine.context.prepare(
    { sources, recipe },
    {
      scope: { ...execution.scope, productId: INTERVIEW_PRODUCT_ID },
      permissions: ["interview.read"],
      signal: execution.signal,
      ...(execution.for ? { for: execution.for } : {}),
    },
  );
  // [GUARD] Material the recipe does not know is refused whole, naming what
  // was wrong: nothing is dropped silently.
  if (!result.ok) throw new ContextPackError(result.failure.reason);
  const { prepared } = result;

  const select = (
    projection: ProjectionId,
    query: string,
    overrides: Parameters<ContextPack["resolve"]>[2],
  ): Resolved => {
    const resolved = engine.context.resolve({
      prepared,
      recipe,
      projection,
      ...(query ? { query } : {}),
      ...(overrides ? { overrides } : {}),
    });
    if (!resolved.ok) throw new ContextPackError(resolved.failure.reason);
    return resolved.resolved;
  };
  const resolve: ContextPack["resolve"] = (projection, spoken, overrides) => {
    const query = keyTerms(spoken);
    const first = select(projection, query, overrides);
    // [DOMAIN] A story the person chose for this kind of question speaks for
    // the question: "conflict with a stakeholder" names the dispute, and the
    // dispute names the role whose facts tell it. So the selection is made
    // again with the chosen story's own words beside what was asked.
    const stories = first.selected.filter((fact) => fact.slot === "stories");
    if (query && stories.length > 0)
      return select(
        projection,
        keyTerms(`${spoken} ${stories.map((story) => story.text).join(" ")}`),
        overrides,
      );
    // [DOMAIN] A question nothing in the material answers by its words
    // ("tell me about yourself") is still about the person: their recent
    // roles are offered, chosen by recency alone and marked as that slot.
    const found = first.selected.some((fact) => !fact.exact);
    if (query && !found) {
      const recent = select(projection, "", overrides).selected.filter(
        (fact) => fact.slot === "roles",
      );
      if (recent.length === 0) return first;
      // The whole result says so, not the selection alone: a role offered is
      // no longer listed as left out, and its slot is covered.
      const offered = new Set(recent.map((fact) => fact.recordId));
      return {
        ...first,
        selected: [...first.selected, ...recent],
        excluded: first.excluded.filter(
          (each) => !(each.slot === "roles" && offered.has(each.recordId)),
        ),
        resolutions: first.resolutions.map((resolution) =>
          resolution.of === "slot" && resolution.subject === "roles"
            ? { ...resolution, state: "covered", recordIds: [...offered] }
            : resolution,
        ),
        // A different selection has a different digest.
        meta: { ...first.meta, digest: `${first.meta.digest}+recent-roles` },
      };
    }
    return first;
  };
  const toFact = (selected: Resolved["selected"][number]): PackFact => {
    const kind = selected.kind as ContextKind;
    return {
      id: selected.recordId,
      pointer: selected.source.locator ?? selected.recordId,
      text: selected.text,
      kind,
      about: ABOUT[kind] ?? "employer",
      slot: selected.slot,
      exact: selected.exact,
    };
  };
  return {
    prepared,
    resolve,
    facts: (projection, spoken) =>
      resolve(projection, spoken).selected.map(toFact),
    view(projection, spoken) {
      const resolved = resolve(projection, spoken);
      const byId = new Map(
        prepared.records.map((record) => [record.id, record]),
      );
      return {
        projection,
        spoken,
        terms: keyTerms(spoken),
        records: prepared.records.length,
        selected: resolved.selected.map(toFact),
        excluded: resolved.excluded.flatMap(({ recordId, slot, reason }) => {
          const record = byId.get(recordId);
          if (!record) return [];
          const kind = record.kind as ContextKind;
          return [
            {
              id: recordId,
              pointer: record.source.locator ?? recordId,
              text: record.text,
              kind,
              about: ABOUT[kind] ?? "employer",
              slot,
              reason,
            },
          ];
        }),
        slots: resolved.resolutions
          .filter((resolution) => resolution.of === "slot")
          .map((resolution) => ({
            slot: resolution.subject,
            state: resolution.state,
            count: resolution.recordIds.length,
          })),
        digest: resolved.meta.digest,
        sources: resolved.meta.sources.map(({ id, revision }) => ({
          id,
          revision,
        })),
      };
    },
    lookup: (slot) =>
      resolve("inspect", "").selected.find(
        (fact) => fact.exact && fact.slot === slot,
      )?.text,
  };
}
