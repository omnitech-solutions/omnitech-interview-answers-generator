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
import type {
  CandidateMatrix,
  ContextView,
  EmployerBrief,
} from "@omnitech/interview-contracts";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import type { SessionContext } from "../live-session/session-context";
import { withSessionBrief } from "./brief-sources";
import { linkSources, linksOf, roleOf } from "./links";
import {
  ABOUT,
  type ContextKind,
  DOMINATES,
  EVIDENCE_PLACES,
  INTERVIEW_CONTEXT_RECIPE,
  KINDS,
  keyTerms,
  type ProjectionId,
  SPEAKS_FOR,
  sameAs,
  wordsOf,
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

// A person's material as the sources the pack is prepared from: each part
// turned into records, then linked to one another (links.ts). Every reader
// builds its sources here, so a note names the same evidence for all of them.
export function contextSources(material: {
  matrix?: { matrix: CandidateMatrix; id: string; revision: number };
  brief?: { brief: EmployerBrief; id: string; revision?: string };
  preferences?: { text: string; id: string; revision: string };
}): Source[] {
  const { matrix, brief, preferences } = material;
  return linkSources([
    ...(matrix ? [matrixSource(matrix.matrix, matrix)] : []),
    ...(brief
      ? [
          briefSource(brief.brief, {
            id: brief.id,
            // The brief carries no revision of its own: what it says is one.
            revision:
              brief.revision ??
              createHash("sha256")
                .update(JSON.stringify(brief.brief))
                .digest("hex")
                .slice(0, 16),
          }),
        ]
      : []),
    ...(preferences?.text
      ? [preferencesSource(preferences.text, preferences)]
      : []),
  ]);
}

// The sources a session's approved material gives. Empty when the session
// pinned no profile and linked no brief or preferences.
export function sessionSources(context: SessionContext): Source[] {
  const { material, matrix } = context;
  if (!material) return [];
  const sources = contextSources({
    ...(matrix && material.profile
      ? { matrix: { matrix, ...material.profile } }
      : {}),
    ...(material.brief
      ? { brief: { brief: material.brief, id: material.brief.candidacyId } }
      : {}),
    ...(material.candidatePreferences
      ? {
          preferences: {
            text: material.candidatePreferences,
            id: "draft",
            revision: String(material.draftRevision ?? 0),
          },
        }
      : {}),
  });
  // The application's interview brief (each stage's notes, outcome, people
  // and transcripts, what the employer said, the research), as the stage the
  // session was started for reads it (brief-sources.ts).
  return withSessionBrief(sources, context);
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
  const byId = new Map(prepared.records.map((record) => [record.id, record]));
  // Every achievement by the role it is of, and by each technology of that
  // role's stack: what a link to a role or to a technology stands for.
  const ofRole = new Map<string, string[]>();
  const onTechnology = new Map<string, string[]>();
  const put = (into: Map<string, string[]>, key: string, id: string) =>
    into.set(key, [...(into.get(key) ?? []), id]);
  for (const record of prepared.records) {
    if (record.kind !== KINDS.achievement) continue;
    const role = roleOf(record);
    if (role) put(ofRole, role, record.id);
    const stack = record.fields?.["stack"];
    for (const technology of Array.isArray(stack) ? stack : [])
      if (typeof technology === "string")
        put(onTechnology, technology.toLowerCase(), record.id);
  }

  // [DOMAIN] How strongly an achievement is tied to what leads the other
  // slots (recipe.ts, rule 1). The record that leads its slot speaks for the
  // question: a note found in passing, third in its slot, names nothing.
  const PERSON = 4;
  const tiersFor = (
    resolved: Resolved,
    person: readonly string[],
    // The words the question came to.
    asked: readonly string[],
  ): Map<string, number> => {
    const tiers = new Map<string, number>();
    const raise = (ids: readonly string[], tier: number) => {
      for (const id of ids)
        if (byId.get(id)?.kind === KINDS.achievement)
          tiers.set(id, Math.max(tier, tiers.get(id) ?? 0));
    };
    const leading = (slot: string) => {
      const fact = resolved.selected.find((each) => each.slot === slot);
      // One shared word is in passing: such a line links nothing.
      if (!fact || fact.score.words < Math.min(SPEAKS_FOR, asked.length))
        return undefined;
      const record = byId.get(fact.recordId);
      return record && linksOf(record);
    };
    for (const links of [leading("stories"), leading("prep")]) {
      if (!links) continue;
      raise(links.achievements, 3);
      raise(
        links.roles.flatMap((role) => ofRole.get(role) ?? []),
        2,
      );
    }
    // [DOMAIN] A requirement may name several technologies ("TypeScript and
    // Node; NestJS preferred"). The ones the question itself says are the
    // ones it is about; when it says none of them ("event-driven" for a
    // requirement that names Kafka), every one of them bears on it.
    const required = leading("requirements");
    if (required) {
      const said = new Set(asked);
      const says = (technology: string) =>
        wordsOf(technology).every((word) =>
          sameAs(word).some((form) => said.has(form)),
        );
      const about = <Item>(
        items: readonly Item[],
        name: (item: Item) => string,
      ) => {
        const named = items.filter((item) => says(name(item)));
        return named.length > 0 ? named : items;
      };
      const through = required.through ?? [];
      const all = [
        ...required.technologies,
        ...through.map((each) => each.technology),
      ];
      const meant = new Set(about(all, (name) => name));
      raise(
        through
          .filter((each) => meant.has(each.technology))
          .flatMap((each) => each.roles)
          .flatMap((role) => ofRole.get(role) ?? []),
        2,
      );
      raise(
        required.technologies
          .filter((technology) => meant.has(technology))
          .flatMap(
            (technology) => onTechnology.get(technology.toLowerCase()) ?? [],
          ),
        1,
      );
    }
    raise(person, PERSON);
    return tiers;
  };

  // [STRATEGY] The engine ranked a shortlist; the places are filled from it
  // by the recipe's three rules. Nothing is found here that the engine did
  // not rank, and what is left out says so with the engine's own reason.
  const arrange = (
    projection: ProjectionId,
    resolved: Resolved,
    tiers: ReadonlyMap<string, number>,
  ): Resolved => {
    const plan = EVIDENCE_PLACES[projection];
    const ranked = resolved.selected.filter((fact) => fact.slot === "evidence");
    if (ranked.length === 0) return resolved;
    const tier = (fact: { recordId: string }) => tiers.get(fact.recordId) ?? 0;
    // Rule 1: linked first. What a note or story is linked to is one group:
    // within it the better match for the question leads, and of two equal
    // matches the one whose figure the note states. The sort is stable, so
    // the engine's order stands wherever these rules say nothing.
    const NAMED = 2;
    const group = (fact: { recordId: string }) =>
      tier(fact) === PERSON ? PERSON : Math.min(tier(fact), NAMED);
    const ordered = [...ranked].sort(
      (a, b) =>
        group(b) - group(a) ||
        (group(a) === NAMED
          ? b.score.words - a.score.words || tier(b) - tier(a)
          : 0),
    );
    const roleFor = (fact: { recordId: string }) => {
      const record = byId.get(fact.recordId);
      return (record && roleOf(record)) ?? fact.recordId;
    };

    let chosen = ordered;
    if (plan.roles) {
      // A person's pin is theirs: it is never left out for a role's sake.
      const pinned = ordered.filter((fact) => tier(fact) === PERSON);
      const open = ordered.filter((fact) => tier(fact) !== PERSON);
      const order = [...new Set(open.map(roleFor))];
      const of = (role: string | undefined) =>
        open.filter((fact) => roleFor(fact) === role);
      const [primary, backup] = [of(order[0]), of(order[1])];
      const [best, next] = [primary[0], backup[0]];
      // Rule 3: the backup is left out when the primary clearly dominates.
      const dominated =
        best !== undefined &&
        next !== undefined &&
        ((best.score.words > 0 &&
          best.score.words >= DOMINATES * next.score.words) ||
          (group(best) > group(next) && next.score.words < SPEAKS_FOR));
      const second = dominated ? [] : backup;
      // Rule 2: the primary leads and takes most places; either fills what
      // the other leaves.
      const room = Math.max(0, plan.places - pinned.length);
      const lead = Math.min(room, plan.lead ?? room);
      const led = primary.slice(0, Math.max(lead, room - second.length));
      chosen = [...pinned, ...led, ...second.slice(0, room - led.length)];
    }
    chosen = chosen.slice(0, plan.places);
    if (
      chosen.length === ranked.length &&
      chosen.every((fact, at) => fact === ranked[at])
    )
      return resolved;

    const kept = new Set(chosen);
    const at = resolved.selected.findIndex((fact) => fact.slot === "evidence");
    const others = resolved.selected.filter((fact) => fact.slot !== "evidence");
    const selected = [...others.slice(0, at), ...chosen, ...others.slice(at)];
    return {
      ...resolved,
      selected,
      excluded: [
        ...resolved.excluded,
        ...ranked
          .filter((fact) => !kept.has(fact))
          .map((fact) => ({
            recordId: fact.recordId,
            slot: "evidence",
            reason: "limit" as const,
          })),
      ],
      resolutions: resolved.resolutions.map((resolution) =>
        resolution.of === "slot" && resolution.subject === "evidence"
          ? { ...resolution, recordIds: chosen.map((fact) => fact.recordId) }
          : resolution,
      ),
      meta: {
        ...resolved.meta,
        usedChars: selected.reduce((sum, fact) => sum + fact.text.length, 0),
        // The engine's digest covers what it ranked; this says the places
        // were then filled by the recipe's rules, which add no input.
        digest: `${resolved.meta.digest}+arranged`,
      },
    };
  };

  // [DOMAIN] The slots that hold the person's own record. A story's words
  // and a link widen the search of THESE only: "Larchmont Pay" names a role
  // to tell, and must not find the person's pay among their preferences or
  // re-order the notes they prepared.
  const OWN: ReadonlySet<string> = new Set(["evidence", "roles"]);
  const withOwn = (
    projection: ProjectionId,
    base: Resolved,
    own: Resolved,
  ): Resolved => {
    const order = new Map(
      (
        recipe.projections.find((each) => each.id === projection)?.slots ?? []
      ).map((slot, at) => [slot.id, at]),
    );
    const merged = <Item extends { slot: string }>(
      from: readonly Item[],
      wide: readonly Item[],
    ) =>
      [
        ...from.filter((each) => !OWN.has(each.slot)),
        ...wide.filter((each) => OWN.has(each.slot)),
      ].sort((a, b) => (order.get(a.slot) ?? 0) - (order.get(b.slot) ?? 0));
    const selected = merged(base.selected, own.selected);
    return {
      selected,
      excluded: merged(base.excluded, own.excluded),
      resolutions: merged(
        base.resolutions.map((each) => ({ ...each, slot: each.subject })),
        own.resolutions.map((each) => ({ ...each, slot: each.subject })),
      ).map(({ slot: _slot, ...resolution }) => resolution),
      meta: {
        ...base.meta,
        usedChars: selected.reduce((sum, fact) => sum + fact.text.length, 0),
        // Two selections made it: both digests reproduce it.
        digest: `${base.meta.digest}+${own.meta.digest}`,
      },
    };
  };

  const resolve: ContextPack["resolve"] = (projection, spoken, overrides) => {
    const query = keyTerms(spoken);
    const person = overrides?.pinned ?? [];
    const base = select(projection, query, overrides);
    // [DOMAIN] A story the person chose for this kind of question speaks for
    // the question: "conflict with a stakeholder" names the dispute, and the
    // dispute names the role whose facts tell it. So the person's own record
    // is searched again with the chosen story's words beside what was asked.
    const stories = base.selected.filter((fact) => fact.slot === "stories");
    const asked =
      query && stories.length > 0
        ? keyTerms(`${spoken} ${stories.map((story) => story.text).join(" ")}`)
        : query;
    // [DOMAIN] What the leading note, story or requirement is linked to is
    // ranked before everything else, whether or not it shares a word with
    // the question: the note that answers "NestJS" names the employer, and
    // the employer's record never says "NestJS". The engine ranks a pinned
    // record first and never drops it for relevance, which is what a link
    // needs; a person's own pins stay ahead of any link (rule 1).
    const tiers = tiersFor(base, person, query.split(" "));
    const tied = (least: number) =>
      [...tiers].flatMap(([id, tier]) =>
        tier >= least && tier < PERSON ? [id] : [],
      );
    // A named employer or a stated figure decides alone; a requirement's
    // technologies are followed only when nothing stronger is linked.
    const linked = query ? (tied(2).length > 0 ? tied(2) : tied(1)) : [];
    const found =
      asked === query && linked.length === 0
        ? base
        : withOwn(
            projection,
            base,
            select(projection, asked, {
              ...overrides,
              pinned: [...person, ...linked],
            }),
          );
    const first = arrange(projection, found, tiers);
    // [DOMAIN] A question nothing in the material answers by its words
    // ("tell me about yourself") is still about the person: their recent
    // roles are offered, chosen by recency alone and marked as that slot.
    const answered = first.selected.some((fact) => !fact.exact);
    if (query && !answered) {
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
