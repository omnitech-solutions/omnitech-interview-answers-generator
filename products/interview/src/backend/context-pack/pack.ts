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
import type {
  AiEngine,
  ContextLink,
  Prepared,
  Resolved,
  Source,
} from "@omnitech/ai-engine";
import type {
  CandidateMatrix,
  ContextView,
  EmployerBrief,
} from "@omnitech/interview-contracts";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import type { SessionContext } from "../live-session/session-context";
import { remoteSources, withSessionBrief } from "./brief-sources";
import { withKept } from "./kept";
import { givenLinks, linkSources, linksOf, roleOf } from "./links";
import {
  ABOUT,
  CODE_ONLY_RECIPE,
  type ContextKind,
  DOMINATES,
  EVIDENCE_PLACES,
  flagsFor,
  KINDS,
  keyTerms,
  LINKS,
  type PackFlags,
  type ProjectionId,
  SPEAKS_FOR,
  sameAs,
  selectingRecipe,
  stageScope,
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
  // What the pack selects from: today's material and, when a model prepared
  // the application, what it extracted and tied that still stands.
  prepared: Prepared;
  // Requirements a model found no evidence for, each tied to the nearest
  // achievement with what is missing. Never followed as evidence.
  gaps: readonly ContextLink[];
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

// [DOMAIN] Where a fact is. The person's own material is addressed by its
// place in it ("/roles/3/proof_points/1"), which the windows open. A record a
// model extracted is addressed by its source and the place of the words it
// rests on ("research:<id>@chars:120-180"), since two sources both have a
// character 120.
const pointerOf = (
  source: Prepared["records"][number]["source"],
  recordId: string,
): string =>
  source.locator === undefined
    ? recordId
    : source.quote === undefined
      ? source.locator
      : `${source.id}@${source.locator}`;

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

// What a pack is made with beside its sources.
export type PackOptions = {
  // The application's pack as a model prepared it (prepare.ts), when one is
  // kept: its extracted records and its ties are read with today's material
  // wherever the source they rest on has not changed since (kept.ts).
  kept?: Prepared | undefined;
  // The stage resolved for, by its place. What a model extracted from a
  // stage's transcript belongs to that stage: this stage's leads, an earlier
  // stage's follows, a later stage's is left out (the engine's scope).
  stage?: number | undefined;
  // [SAFETY] Where what the pack selects is read. "remote" (the default: fail
  // closed) is a prompt sent to a model that does not run on this machine,
  // so a device-only source is left out before anything is prepared, with
  // everything a model extracted from it. "device" is the person's own
  // screen, which shows all of it.
  reader?: "device" | "remote" | undefined;
  // Flags that replace a projection's own (recipe.ts, PACK_FLAGS) for every
  // projection of this pack: how the evaluation's arms switch one mechanism
  // off or on (eval/arms.ts). Absent: each projection selects by its row.
  flags?: Partial<PackFlags> | undefined;
};

// A kept pack without what rests on the sources named: their records, and
// every tie that touches one.
function withoutSources(
  kept: Prepared,
  withheld: readonly { id: string }[],
): Prepared {
  if (withheld.length === 0) return kept;
  const left = new Set(withheld.map((source) => source.id));
  const records = kept.records.filter((record) => !left.has(record.source.id));
  const seen = new Set(records.map((record) => record.id));
  return {
    ...kept,
    sources: kept.sources.filter((source) => !left.has(source.id)),
    records,
    ...(kept.links
      ? {
          links: kept.links.filter(
            (link) => seen.has(link.from) && seen.has(link.to),
          ),
        }
      : {}),
  };
}

export async function prepareContextPack(
  engine: ContextEngine,
  sources: readonly Source[],
  execution: {
    scope: { tenantId: string; actorId: string };
    signal: AbortSignal;
    for?: { kind: string; id: string };
  },
  options: PackOptions = {},
): Promise<ContextPack> {
  // [SAFETY] No model is on this path, whatever the sources hold: the recipe
  // has no extractor and asks for no tie, and a source's raw text is not
  // passed. A pack is prepared by a model only in prepare.ts.
  const recipe = CODE_ONLY_RECIPE;
  const { sendable, withheld } =
    options.reader === "device"
      ? { sendable: [...sources], withheld: [] }
      : remoteSources(sources);
  const given = sendable.map(
    ({ text: _text, pieces: _pieces, ...source }) => source,
  );
  const result = await engine.context.prepare(
    {
      sources: given,
      recipe,
      // The ties made in code (links.ts), for the engine to check and keep.
      links: givenLinks(given.flatMap((source) => source.records ?? [])),
    },
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
  const read = options.kept
    ? withKept(result.prepared, withoutSources(options.kept, withheld))
    : result.prepared;
  const merged = read;
  // [SAFETY] A gap is a requirement with NO evidence: its tie says what is
  // missing and is never followed, or the nearest achievement would be
  // offered as the experience the person lacks.
  const isGap = (link: ContextLink) =>
    link.step === LINKS.fit && link.fields?.["strength"] === "gap";
  const gaps = (merged.links ?? []).filter(isGap);
  const prepared: Prepared = merged.links
    ? { ...merged, links: merged.links.filter((link) => !isGap(link)) }
    : merged;
  const stage = options.stage;
  const scope =
    stage === undefined
      ? undefined
      : {
          is: stageScope(stage),
          // The nearest earlier stage first.
          earlier: Array.from({ length: stage - 1 }, (_, at) =>
            stageScope(stage - 1 - at),
          ),
        };

  // [DOMAIN] What a model wrote ABOUT the person's records (its search terms;
  // kept.ts carries them) is matched only by a projection whose flags say so:
  // the others select from the same pack without them.
  const bare: Prepared = prepared.records.some((record) => record.terms)
    ? {
        ...prepared,
        records: prepared.records.map((record) => {
          if (!record.terms) return record;
          const { terms: _terms, ...said } = record;
          return said;
        }),
      }
    : prepared;
  const flagsOf = (projection: ProjectionId) =>
    flagsFor(projection, options.flags);

  const select = (
    projection: ProjectionId,
    query: string,
    overrides: Parameters<ContextPack["resolve"]>[2],
  ): Resolved => {
    const flags = flagsOf(projection);
    const resolved = engine.context.resolve({
      prepared: flags.terms ? prepared : bare,
      recipe: selectingRecipe(flags),
      projection,
      ...(query ? { query } : {}),
      ...(overrides ? { overrides } : {}),
      ...(scope ? { scope } : {}),
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

  // A model's ties by the step and the record they are from.
  const tiedFrom = new Map<string, ContextLink[]>();
  for (const link of prepared.links ?? []) {
    if (link.by !== "model") continue;
    const key = `${link.step}\n${link.from}`;
    tiedFrom.set(key, [...(tiedFrom.get(key) ?? []), link]);
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
    // Filled here: how strongly a model tied each achievement to a line that
    // leads its slot (2 or 1).
    fits: Map<string, number>,
  ): Map<string, number> => {
    const tiers = new Map<string, number>();
    const raise = (ids: readonly string[], tier: number) => {
      for (const id of ids)
        if (byId.get(id)?.kind === KINDS.achievement)
          tiers.set(id, Math.max(tier, tiers.get(id) ?? 0));
    };
    const leader = (slot: string) => {
      // The line that leads its slot. Among questions asked before, a stage's
      // own come first whatever they match (the engine's scope), so the one
      // that speaks for the question is the one that matches it best.
      const of = resolved.selected.filter((each) => each.slot === slot);
      const fact =
        slot === "asked"
          ? [...of].sort((a, b) => b.score.words - a.score.words)[0]
          : of[0];
      // One shared word is in passing: such a line links nothing.
      if (!fact || fact.score.words < Math.min(SPEAKS_FOR, asked.length))
        return undefined;
      return byId.get(fact.recordId);
    };
    const leading = (slot: string) => {
      const record = leader(slot);
      return record && linksOf(record);
    };
    // [DOMAIN] What a MODEL tied to the line that leads its slot (recipe.ts,
    // LINKS) is an inference, one step away from the question: the note or
    // requirement was found by a word of the question, and what a model tied
    // to it need not share any. The person's own words outrank it: a note
    // that names its proof, a story they chose. So a model's tie never
    // outranks an achievement that answers the question itself. It breaks a
    // tie (of two equal matches the tied one comes first: a note's proof, a
    // primary story and strong evidence before a backup story and partial
    // evidence), and it keeps the achievement in the ranking though it shares
    // no word with the question.
    for (const [slot, step, strength] of [
      ["prep", LINKS.proof, () => 2],
      [
        "asked",
        LINKS.story,
        (link: ContextLink) => (link.fields?.["rank"] === "backup" ? 1 : 2),
      ],
      [
        "requirements",
        LINKS.fit,
        (link: ContextLink) => (link.fields?.["strength"] === "strong" ? 2 : 1),
      ],
    ] as const) {
      const from = leader(slot)?.id;
      if (!from) continue;
      for (const link of tiedFrom.get(`${step}\n${from}`) ?? [])
        if (byId.get(link.to)?.kind === KINDS.achievement)
          fits.set(link.to, Math.max(fits.get(link.to) ?? 0, strength(link)));
    }
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
    const stack = leading("requirements");
    if (stack) {
      const required = stack;
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

  // What a record scored for the question.
  const worth = (fact: Resolved["selected"][number]) =>
    fact.score.total ?? fact.score.words;

  // [STRATEGY] The engine ranked a shortlist; the places are filled from it
  // by the recipe's three rules. Nothing is found here that the engine did
  // not rank, and what is left out says so with the engine's own reason.
  const arrange = (
    projection: ProjectionId,
    resolved: Resolved,
    tiers: ReadonlyMap<string, number>,
    fits: ReadonlyMap<string, number>,
    // Whether anything was asked: with no question nothing is left out for
    // sharing no word with it.
    asked: boolean,
  ): Resolved => {
    const plan = EVIDENCE_PLACES[projection];
    const ranked = resolved.selected.filter((fact) => fact.slot === "evidence");
    if (ranked.length === 0) return resolved;
    const tier = (fact: { recordId: string }) => tiers.get(fact.recordId) ?? 0;
    // Rule 1: linked first. What a note or story is linked to is one group:
    // within it the better match for the question leads, and of two equal
    // matches the one whose figure the note states. Everywhere else the
    // order is the engine's own for an untied record: the better match, then
    // the record's priority, then its id.
    const NAMED = 2;
    const group = (fact: { recordId: string }) =>
      tier(fact) === PERSON ? PERSON : Math.min(tier(fact), NAMED);
    // [DOMAIN] The engine keeps every achievement tied to ANYTHING the
    // earlier slots selected. Only what the LEADING line of a slot is tied to
    // speaks for the question, and a requirement's technologies only when
    // nothing stronger does: any other achievement that shares no word with
    // the question is left out, as it always was.
    const least = [...tiers.values()].some(
      (each) => each >= NAMED && each < PERSON,
    )
      ? NAMED
      : 1;
    const fit = (fact: { recordId: string }) => fits.get(fact.recordId) ?? 0;
    const bears = (fact: Resolved["selected"][number]) =>
      !asked || worth(fact) > 0 || tier(fact) >= least || fit(fact) > 0;
    const ordered = ranked
      .filter(bears)
      .sort(
        (a, b) =>
          group(b) - group(a) ||
          worth(b) - worth(a) ||
          (group(a) === NAMED ? tier(b) - tier(a) : 0) ||
          fit(b) - fit(a) ||
          b.score.priority - a.score.priority ||
          (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0),
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
        ((worth(best) > 0 && worth(best) >= DOMINATES * worth(next)) ||
          (group(best) > group(next) && worth(next) < SPEAKS_FOR));
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
            reason: bears(fact) ? ("limit" as const) : ("relevance" as const),
          })),
      ],
      resolutions: resolved.resolutions.map((resolution) =>
        resolution.of === "slot" && resolution.subject === "evidence"
          ? {
              ...resolution,
              state: chosen.length > 0 ? resolution.state : "no-such-fact",
              recordIds: chosen.map((fact) => fact.recordId),
            }
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

  // [DOMAIN] Under the engine's measured ranking a tie only SUPPORTS a
  // record: an achievement that shares no word with the question is left out
  // when another matches it directly. That is right for a tie a model
  // inferred, and wrong for what the PERSON tied: the note they wrote for
  // this question names its employer, and the story they chose names its
  // role. So what the leading note, story or requirement is tied to in code
  // (`tiers`) is put back among the evidence when the engine left it out for
  // matching too little, for `arrange` to place by the recipe's rules. What
  // was left out for any other reason (barred, out of scope, excluded by the
  // question itself, too long) stays out.
  const WEAK: ReadonlySet<string> = new Set(["relevance", "cut", "min-score"]);
  const withNamed = (
    resolved: Resolved,
    tiers: ReadonlyMap<string, number>,
  ): Resolved => {
    const back = resolved.excluded.filter(
      (each) =>
        each.slot === "evidence" &&
        WEAK.has(each.reason) &&
        (tiers.get(each.recordId) ?? 0) > 0,
    );
    if (back.length === 0) return resolved;
    const named = back.flatMap((each): Resolved["selected"][number][] => {
      const record = byId.get(each.recordId);
      return record
        ? [
            {
              recordId: record.id,
              slot: "evidence",
              kind: record.kind,
              text: record.text,
              exact: false,
              source: record.source,
              hash: record.hash,
              score: {
                words: 0,
                priority: record.priority ?? 0,
                pinned: false,
              },
            },
          ]
        : [];
    });
    const ids = new Set(named.map((fact) => fact.recordId));
    // After the evidence the engine ranked, before the slots that follow.
    const last = resolved.selected.findLastIndex(
      (fact) => fact.slot === "evidence",
    );
    const at =
      last >= 0
        ? last + 1
        : resolved.selected.findIndex((fact) =>
            ["roles", "preferences", "employer"].includes(fact.slot),
          );
    const selected =
      at < 0
        ? [...resolved.selected, ...named]
        : [
            ...resolved.selected.slice(0, at),
            ...named,
            ...resolved.selected.slice(at),
          ];
    return {
      ...resolved,
      selected,
      excluded: resolved.excluded.filter(
        (each) => !(each.slot === "evidence" && ids.has(each.recordId)),
      ),
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
    const flags = flagsOf(projection);
    // The question's words as the product's own rules count them (how many
    // words a note shares, which technology was named).
    const query = keyTerms(spoken);
    // What the engine is asked: the same words, with an exclusion phrase
    // ("not at X") kept whole where the engine reads exclusions.
    const put = (said: string) =>
      keyTerms(said, flags.match !== "plain" && flags.match.exclusion);
    const person = overrides?.pinned ?? [];
    const base = select(projection, query ? put(spoken) : "", overrides);
    // [DOMAIN] A story the person chose for this kind of question speaks for
    // the question: "conflict with a stakeholder" names the dispute, and the
    // dispute names the role whose facts tell it. So the person's own record
    // is searched again with the chosen story's words beside what was asked.
    const stories = base.selected.filter((fact) => fact.slot === "stories");
    const widened =
      query && stories.length > 0
        ? `${spoken} ${stories.map((story) => story.text).join(" ")}`
        : undefined;
    // [DOMAIN] What the leading note, story or requirement is linked to is
    // ranked before everything else, whether or not it shares a word with
    // the question: the note that answers "NestJS" names the employer, and
    // the employer's record never says "NestJS". The evidence slot FOLLOWS
    // the ties (recipe.ts), so the engine keeps a tied achievement in its
    // ranking; the places are then filled by the recipe's rules (`arrange`).
    const fits = new Map<string, number>();
    const tiers = tiersFor(base, person, query.split(" "), fits);
    let found = base;
    if (widened !== undefined) {
      const own = select(projection, put(widened), overrides);
      // What the question's own selection is tied to stays, though the
      // story's words selected other notes.
      const had = new Set(
        own.selected
          .filter((fact) => fact.slot === "evidence")
          .map((fact) => fact.recordId),
      );
      const tied = base.selected.filter(
        (fact) =>
          fact.slot === "evidence" &&
          !had.has(fact.recordId) &&
          ((tiers.get(fact.recordId) ?? 0) > 0 || fits.has(fact.recordId)),
      );
      const wide = withOwn(projection, base, own);
      const at = wide.selected.findIndex((fact) => fact.slot === "evidence");
      found =
        tied.length === 0
          ? wide
          : {
              ...wide,
              selected:
                at < 0
                  ? [...wide.selected, ...tied]
                  : [
                      ...wide.selected.slice(0, at),
                      ...tied,
                      ...wide.selected.slice(at),
                    ],
              excluded: wide.excluded.filter(
                (each) =>
                  !(
                    each.slot === "evidence" &&
                    tied.some((fact) => fact.recordId === each.recordId)
                  ),
              ),
            };
    }
    if (flags.match !== "plain") found = withNamed(found, tiers);
    const first = arrange(projection, found, tiers, fits, query !== "");
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
      pointer: pointerOf(selected.source, selected.recordId),
      text: selected.text,
      kind,
      about: ABOUT[kind] ?? "employer",
      slot: selected.slot,
      exact: selected.exact,
    };
  };
  return {
    prepared,
    gaps,
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
              pointer: pointerOf(record.source, recordId),
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
