// An application's context pack, PREPARED BY A MODEL and kept (ADR-0041).
//
// PROBLEM: the posting, the research, what the employer said and each stage's
// transcript are prose. Turning them into facts a reader can lean on needs a
// model, of any size, and nothing a model writes may be kept unless the
// source says it. STRATEGY: the engine does the work (it cuts each source to
// the model's window, asks, looks for every quote in the source, merges, ties
// records together and keeps the result under a name); this file says WHAT is
// prepared (every part of the application, all stages), in what ORDER (a few
// sources at a time, so a person sees how far it is and stopping loses
// nothing already read), under which NAME (one pack per application and
// member), and what the person is SHOWN of the result (the review).
// It is the only place the product asks a model to prepare a pack: every
// reader takes what is kept here and asks no model (kept.ts, pack.ts).
// COMPLEXITY: one engine call per group of sources read; inside it, one model
// call per piece of a source and per batch of ties.
import type {
  AiEngine,
  Correction,
  Prepared,
  PreparedStore,
  PrepareStats,
  ProfileSummary,
  Source,
} from "@omnitech/ai-engine";
import {
  type CandidateMatrix,
  type EmployerBrief,
  employerSaidLine,
  PACK_REVIEW_BOUNDS,
  type PackCorrection,
  type PackReview,
  type PackSourceState,
} from "@omnitech/interview-contracts";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import type { BriefMaterial } from "../brief/repository";
import {
  BRIEF_SOURCE_KINDS,
  type BriefSource,
  briefSources,
  remoteSources,
  stageOf,
  withStageBrief,
} from "./brief-sources";
import { FROM_THE_POSTING, sectionOf, standing } from "./kept";
import { givenLinks } from "./links";
import { ContextPackError, contextSources } from "./pack";
import {
  CODE_ONLY_RECIPE,
  EXTRACTORS,
  INTERVIEW_CONTEXT_RECIPE,
  KINDS,
  LINKS,
} from "./recipe";

// Everything of one application a pack is prepared from.
export type ApplicationMaterial = {
  candidacyId: string;
  matrix?: { matrix: CandidateMatrix; id: string; revision: number } | null;
  // The model-cleaned employer brief, while the application has one.
  brief?: EmployerBrief | null;
  preferences?: { text: string; id: string; revision: string } | null;
  // The posting, each stage's notes, people and transcripts, what the
  // employer said and the research.
  interview: BriefMaterial | null;
};

// [DOMAIN] One pack per application AND member: the engine keeps packs by
// workspace and product, and an application is one member's own.
export const packKey = (candidacyId: string, actorId: string) =>
  `application:${candidacyId}:${actorId}`;
const RECIPE_ID = INTERVIEW_CONTEXT_RECIPE.id;

// Where kept packs are read from: the store the engine itself keeps them in.
export type PackStore = Pick<PreparedStore, "load" | "save">;
type Scope = { tenantId: string; actorId: string };
const storeScope = (scope: Scope) => ({
  tenantId: scope.tenantId,
  productId: INTERVIEW_PRODUCT_ID,
});

// A store that keeps packs for the life of this process: what a host gives
// the engine when it has no database for it (`AI_ENGINE_DATABASE_URL`). The
// process that prepared a pack is then the only one that can read it.
// A host has the same in `@omnitech/platform-runtime/ai-packs`; this one is
// the product's own, for its suites and its benchmark, which build an engine
// with no host.
export function createMemoryPackStore(): PreparedStore {
  const whole = new Map<string, Prepared>();
  const named = new Map<string, Prepared>();
  const at = (scope: { tenantId: string; productId: string }, key: string) =>
    `${scope.tenantId}\n${scope.productId}\n${key}`;
  const wanted = (prepared: Pick<Prepared, "recipe" | "sources">) =>
    JSON.stringify([
      prepared.recipe.id,
      prepared.recipe.version,
      prepared.sources.map(({ id, revision }) => [id, revision]),
    ]);
  return {
    get: async (scope, asked) => whole.get(at(scope, wanted(asked))),
    put: async (scope, prepared) => {
      whole.set(at(scope, wanted(prepared)), prepared);
    },
    load: async (scope, name) =>
      named.get(at(scope, `${name.recipeId}\n${name.key}`)),
    save: async (scope, name, prepared) => {
      named.set(at(scope, `${name.recipeId}\n${name.key}`), prepared);
    },
  };
}

// The application's kept pack, or undefined: none was prepared, the store is
// not there, or it did not answer. [SAFETY] A reader never fails for want of
// a kept pack; it reads the person's material as it stands.
export async function loadKeptPack(
  store: PackStore | undefined,
  scope: Scope,
  candidacyId: string,
): Promise<Prepared | undefined> {
  if (!store?.load) return undefined;
  try {
    return await store.load(storeScope(scope), {
      key: packKey(candidacyId, scope.actorId),
      recipeId: RECIPE_ID,
    });
  } catch {
    return undefined;
  }
}

// The kept pack of the application a session was started for, or undefined.
export function keptFor(
  store: PackStore | undefined,
  scope: Scope,
  context: {
    material?: { interviewBrief?: { candidacyId: string } | null } | undefined;
  },
): Promise<Prepared | undefined> {
  const candidacyId = context.material?.interviewBrief?.candidacyId;
  return candidacyId
    ? loadKeptPack(store, scope, candidacyId)
    : Promise.resolve(undefined);
}

// [STRATEGY] Every source of the application, every stage, unscoped: the
// kept pack is one for the application, and a reader scopes it to its stage.
// The notes are linked to the person's record in code first (links.ts).
export function applicationSources(material: ApplicationMaterial): Source[] {
  const base = contextSources({
    ...(material.matrix ? { matrix: material.matrix } : {}),
    ...(material.brief
      ? { brief: { brief: material.brief, id: material.candidacyId } }
      : {}),
    ...(material.preferences ? { preferences: material.preferences } : {}),
  });
  if (!material.interview) return base;
  const brief = briefSources(material.interview, {
    skipCarriedNotes: (material.brief?.prepNotes ?? []).length > 0,
  });
  // [DOMAIN] The employer brief is the posting cleaned by a model, with no
  // pointer back to it. Where the application has its posting, the pack is
  // prepared from the posting itself, each line quoted, and the brief's copy
  // of it is left out: the same requirement is not kept twice. What the brief
  // distilled from the person's notes stays.
  const own = brief.some((source) => source.kind === BRIEF_SOURCE_KINDS.posting)
    ? base.map((source) =>
        source.kind === "employer-brief"
          ? {
              ...source,
              records: (source.records ?? []).filter(
                (record) => !FROM_THE_POSTING.includes(sectionOf(record)),
              ),
            }
          : source,
      )
    : base;
  return withStageBrief(own, brief, undefined).sources;
}

// The name a person knows each source by.
export function sourceTitles(
  material: ApplicationMaterial,
): Map<string, string> {
  const titles = new Map<string, string>();
  const interview = material.interview;
  if (!interview) return titles;
  titles.set(`posting:${interview.candidacyId}`, "Job posting");
  for (const stage of interview.stages) {
    titles.set(`stage:${stage.id}:notes`, `${stage.label}: notes`);
    titles.set(`stage:${stage.id}:outcome`, `${stage.label}: outcome`);
    titles.set(`stage:${stage.id}:details`, `${stage.label}: people and time`);
    for (const transcript of stage.transcripts)
      titles.set(
        `stage:${stage.id}:transcript:${transcript.id}`,
        `${stage.label}: ${transcript.title}`,
      );
  }
  for (const entry of interview.employerSaid)
    titles.set(
      `employer-said:${entry.id}`,
      `Employer said: ${employerSaidLine(entry).slice(0, 80)}`,
    );
  for (const document of interview.research)
    titles.set(`research:${document.id}`, `Research: ${document.title}`);
  return titles;
}

// Whether a model reads a source: it has text or pieces, and the recipe has
// an extractor for its kind.
const READ: ReadonlySet<string> = new Set(
  EXTRACTORS.map((each) => each.sourceKind),
);
export const readByModel = (source: Source): boolean =>
  (source.text !== undefined || source.pieces !== undefined) &&
  READ.has(source.kind);

// [SAFETY] Whether a profile is DECLARED to run on this machine: a model
// profile whose locality says so. An agent runtime (Claude Code, Codex) sends
// what it is given to its provider, and no profile is no such declaration.
export const runsOnDevice = (profile: ProfileSummary | null): boolean =>
  profile !== null && profile.kind !== "agent" && profile.locality === "device";

export type PrepareProgress = {
  // Sources a model has read in this run, of those it has to.
  done: number;
  total: number;
  // The sources being read now.
  reading: string[];
  // Model calls so far.
  calls: number;
};
export type PreparedApplication = {
  prepared: Prepared;
  stats: PrepareStats;
};
export class PackPreparationCancelled extends Error {}

// How many sources are read in one step. A step is one engine call: its
// pieces are asked `concurrency` at a time, and what it kept is saved before
// the next step begins.
const SOURCES_PER_STEP = 3;
const NO_STATS: PrepareStats = {
  sources: 0,
  extracted: 0,
  reused: 0,
  pieces: 0,
  calls: 0,
  linkCalls: 0,
  kept: 0,
  rejected: 0,
  holes: 0,
  links: 0,
  linksReused: 0,
};

export async function prepareApplicationPack(
  engine: Pick<AiEngine, "context">,
  input: {
    candidacyId: string;
    sources: readonly Source[];
    // The profile that reads. Pieces are sized from what it declares, and a
    // device-only source is read only when it runs on this machine.
    profileId: string;
    // [SAFETY] Whether that profile is DECLARED to run on this machine (its
    // `locality`, as the host's profile summary says it; never a guess).
    // Unless it is, what an earlier preparation by a local model extracted
    // from a device-only source is set aside before any call and put back
    // after: the engine skips such a source for a remote profile, but it
    // would still show the records already extracted from it when it asks
    // for ties. Absent is "not on this machine": fail closed.
    onDevice?: boolean | undefined;
    // The pack as it is kept now, so only what changed is read again.
    kept?: Prepared | undefined;
    // Read this source again though it has not changed.
    again?: string | undefined;
    concurrency?: number;
    // Where the engine keeps the pack, to keep what could not be read (below).
    packs?: PackStore | undefined;
  },
  execution: { scope: Scope; signal: AbortSignal },
  onProgress?: (progress: PrepareProgress) => void | Promise<void>,
): Promise<PreparedApplication> {
  const recipe = INTERVIEW_CONTEXT_RECIPE;
  const { sources } = input;
  // [GUARD] A pack kept by another recipe version is not this pack's past:
  // the engine reads every source again, so nothing of it is carried here.
  let previous =
    input.kept?.recipe.id === recipe.id &&
    input.kept.recipe.version === recipe.version
      ? input.kept
      : undefined;
  // [DOMAIN] "Prepare again" for one source: the kept pack is told it never
  // read it, so the engine does, and every other source is left as it is.
  if (previous && input.again !== undefined)
    previous = {
      ...previous,
      sources: previous.sources.filter(({ id }) => id !== input.again),
    };
  // [SAFETY] What the kept pack holds of a source that may not leave this
  // machine, set aside from a profile not declared to run on it: the records
  // a local model extracted, every tie to one, and what code refused of its
  // proposals. The source itself stays listed at the revision it was read
  // at, so the engine has nothing to read and nothing of it to show.
  const aside = setAside(
    previous,
    input.onDevice === true ? [] : remoteSources(sources).withheld,
  );
  previous = aside.rest;
  const keptAt = new Map(
    (previous?.sources ?? []).map(({ id, revision }) => [id, revision]),
  );
  const holed = new Set((previous?.holes ?? []).map((hole) => hole.sourceId));
  // The sources a model has to read now: new, changed, or left with a hole.
  const due = sources.filter(
    (source) =>
      readByModel(source) &&
      (keptAt.get(source.id) !== source.revision || holed.has(source.id)),
  );
  const steps: Source[][] = [];
  for (let at = 0; at < due.length; at += SOURCES_PER_STEP)
    steps.push(due.slice(at, at + SOURCES_PER_STEP));
  // With nothing to read there is still one step: the person's own records
  // are taken as they are now, and their ties are made again.
  if (steps.length === 0) steps.push([]);

  const links = givenLinks(sources.flatMap((source) => source.records ?? []));
  const read = new Set<string>();
  // [DOMAIN] The engine reads a source again while a part of it is unread.
  // That is right for the NEXT preparation and wrong within this one: a
  // source that failed in an early step would be asked about again in every
  // later step. So a hole made in this run is set aside as it is made, and
  // put back on the pack at the end.
  const unread: NonNullable<Prepared["holes"]>[number][] = [];
  let stats = NO_STATS;
  let prepared = previous;
  for (const step of steps) {
    if (execution.signal.aborted) throw new PackPreparationCancelled();
    await onProgress?.({
      done: read.size,
      total: due.length,
      reading: step.map((source) => source.id),
      calls: stats.calls + stats.linkCalls,
    });
    for (const source of step) read.add(source.id);
    // [STRATEGY] A source whose turn has not come is given as the pack last
    // knew it (the revision it was read at), so the engine reuses what was
    // extracted from it and the pack loses nothing while the run goes on; a
    // source never read is left out until its turn. After the last step
    // every source has had its turn and is at its own revision.
    const given = sources.flatMap((source): Source[] => {
      if (!readByModel(source) || read.has(source.id) || !due.includes(source))
        return [source];
      const before = keptAt.get(source.id);
      if (before === undefined || holed.has(source.id)) return [];
      return [{ ...source, revision: before }];
    });
    const ids = new Set(
      given.flatMap((source) => (source.records ?? []).map(({ id }) => id)),
    );
    const result = await engine.context.prepare(
      {
        sources: given,
        recipe,
        profileId: input.profileId,
        key: packKey(input.candidacyId, execution.scope.actorId),
        ...(prepared ? { previous: prepared } : {}),
        // The ties made in code, between the records given in this step.
        links: links.filter((link) => ids.has(link.from) && ids.has(link.to)),
        concurrency: input.concurrency ?? 2,
      },
      {
        scope: { ...execution.scope, productId: INTERVIEW_PRODUCT_ID },
        permissions: ["interview.read", "interview.documents.write"],
        signal: execution.signal,
        for: { kind: "candidacy", id: input.candidacyId },
      },
    );
    if (!result.ok) {
      if (result.failure.code === "cancelled" || execution.signal.aborted)
        throw new PackPreparationCancelled();
      throw new ContextPackError(result.failure.reason);
    }
    const made = (result.prepared.holes ?? []).filter((hole) =>
      read.has(hole.sourceId),
    );
    unread.push(...made);
    prepared = {
      ...result.prepared,
      holes: (result.prepared.holes ?? []).filter(
        (hole) => !read.has(hole.sourceId),
      ),
    };
    const now = result.stats ?? NO_STATS;
    // What the run did, summed; what the pack holds, as it is now.
    stats = {
      ...now,
      extracted: stats.extracted + step.length,
      holes: unread.length + (now.holes - made.length),
      // Sources a model has read before and did not have to read now.
      reused: sources.filter(readByModel).length - due.length,
      pieces: stats.pieces + now.pieces,
      calls: stats.calls + now.calls,
      linkCalls: stats.linkCalls + now.linkCalls,
      linksReused: stats.linksReused + now.linksReused,
    };
  }
  // What could not be read is part of the pack: the review shows it, and the
  // next preparation reads those sources again.
  let whole = prepared as Prepared;
  // What was set aside is part of the pack again, where its source still
  // says what it said: the person's own screen reads it, and no remote
  // reader does (pack.ts).
  const back = putBack(whole, aside);
  if (unread.length > 0 || back !== whole) {
    whole = { ...back, holes: [...(back.holes ?? []), ...unread] };
    await input.packs
      ?.save?.(
        storeScope(execution.scope),
        {
          key: packKey(input.candidacyId, execution.scope.actorId),
          recipeId: RECIPE_ID,
        },
        whole,
      )
      // A store that fails costs the saving, never the result.
      ?.catch(() => undefined);
  }
  await onProgress?.({
    done: due.length,
    total: due.length,
    reading: [],
    calls: stats.calls + stats.linkCalls,
  });
  return { prepared: whole, stats };
}

type Aside = {
  rest: Prepared | undefined;
  // The revision each withheld source was read at.
  at: ReadonlyMap<string, string>;
  records: Prepared["records"];
  links: NonNullable<Prepared["links"]>;
  rejected: Prepared["rejected"];
};
// A kept pack without what a model wrote from the sources named.
function setAside(
  kept: Prepared | undefined,
  withheld: readonly { id: string }[],
): Aside {
  const none: Aside = {
    rest: kept,
    at: new Map(),
    records: [],
    links: [],
    rejected: [],
  };
  if (!kept || withheld.length === 0) return none;
  const here = new Set(withheld.map(({ id }) => id));
  const records = kept.records.filter(
    (record) => record.by === "model" && here.has(record.source.id),
  );
  const rejected = kept.rejected.filter((each) => here.has(each.sourceId));
  if (records.length === 0 && rejected.length === 0) return none;
  const ids = new Set(records.map((record) => record.id));
  const touches = (link: { from: string; to: string }) =>
    ids.has(link.from) || ids.has(link.to);
  return {
    rest: {
      ...kept,
      records: kept.records.filter((record) => !ids.has(record.id)),
      rejected: kept.rejected.filter((each) => !here.has(each.sourceId)),
      ...(kept.links
        ? { links: kept.links.filter((link) => !touches(link)) }
        : {}),
    },
    at: new Map(
      kept.sources
        .filter(({ id }) => here.has(id))
        .map(({ id, revision }) => [id, revision]),
    ),
    records,
    links: (kept.links ?? []).filter(touches),
    rejected,
  };
}
// The pack with what was set aside, where the source is still at the revision
// it was read at and was not read again in this run. The same pack when
// there is nothing to put back.
function putBack(prepared: Prepared, aside: Aside): Prepared {
  const now = new Map(
    prepared.sources.map(({ id, revision }) => [id, revision]),
  );
  const stands = (sourceId: string) =>
    aside.at.get(sourceId) !== undefined &&
    aside.at.get(sourceId) === now.get(sourceId) &&
    !prepared.records.some(
      (record) => record.by === "model" && record.source.id === sourceId,
    );
  const records = aside.records.filter((record) => stands(record.source.id));
  const rejected = aside.rejected.filter((each) => stands(each.sourceId));
  if (records.length === 0 && rejected.length === 0) return prepared;
  const ids = new Set(
    [...prepared.records, ...records].map((record) => record.id),
  );
  return {
    ...prepared,
    records: [...prepared.records, ...records],
    rejected: [...prepared.rejected, ...rejected],
    links: [
      ...(prepared.links ?? []),
      ...aside.links.filter((link) => ids.has(link.from) && ids.has(link.to)),
    ],
  };
}

// What the person did in the review, applied to the kept pack by the engine
// and kept with it: it outlives the next preparation.
export async function correctApplicationPack(
  engine: Pick<AiEngine, "context">,
  input: {
    candidacyId: string;
    corrections: readonly PackCorrection[];
  },
  execution: { scope: Scope; signal: AbortSignal },
): Promise<Prepared> {
  const result = await engine.context.correct(
    {
      recipe: INTERVIEW_CONTEXT_RECIPE,
      key: packKey(input.candidacyId, execution.scope.actorId),
      corrections: input.corrections.map(
        (each): Correction =>
          each.action === "edit"
            ? {
                recordId: each.recordId,
                action: "edit",
                ...(each.text === undefined ? {} : { text: each.text }),
                ...(each.themes === undefined ? {} : { themes: each.themes }),
                ...(each.answers === undefined
                  ? {}
                  : { answers: each.answers }),
              }
            : { recordId: each.recordId, action: each.action },
      ),
    },
    {
      scope: { ...execution.scope, productId: INTERVIEW_PRODUCT_ID },
      permissions: ["interview.read", "interview.documents.write"],
      signal: execution.signal,
      for: { kind: "candidacy", id: input.candidacyId },
    },
  );
  if (!result.ok) throw new ContextPackError(result.failure.reason);
  return result.prepared;
}

const ASKS: readonly string[] = ["mustHaves", "niceToHaves"];
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

// [DOMAIN] The review: what the person checks before anything leans on the
// pack. Counts by kind; what a model extracted, each with its quote; what
// code refused and why; what could not be read; what was not sent off this
// machine; the requirements with no evidence; the stages with no material.
// Made in code from the kept pack and the material as it is now, so it also
// says which sources have changed since they were read.
export function reviewPack(input: {
  material: ApplicationMaterial;
  sources: readonly Source[];
  kept: Prepared | undefined;
  profile: ProfileSummary | null;
  stats?: PrepareStats;
  // [SAFETY] Where the review is read (pack.ts, `PackOptions.reader`).
  // "device" is the person's own screen: the card in the Interview form,
  // which shows what a model that runs here read from a device-only source.
  // Anything else (the default: fail closed) is counted but not SAID: no
  // record extracted from such a source, and no proposal refused from one, is
  // listed with its words. A review is never given to a model either way.
  reader?: "device" | "remote" | undefined;
}): PackReview {
  const { material, sources, kept } = input;
  const keptHere =
    input.reader === "device"
      ? new Set<string>()
      : new Set(remoteSources(sources).withheld.map(({ id }) => id));
  const said = (sourceId: string) => !keptHere.has(sourceId);
  const recipe = INTERVIEW_CONTEXT_RECIPE;
  const titles = sourceTitles(material);
  const titleOf = (id: string) => titles.get(id) ?? id;
  const current =
    kept !== undefined &&
    kept.recipe.id === recipe.id &&
    kept.recipe.version === recipe.version;
  const now = {
    recipe: CODE_ONLY_RECIPE,
    sources: sources.map(({ id, revision }) => ({ id, revision })),
  };
  // What of the kept pack still stands: only that is shown as extracted.
  const stood = kept ? standing(now, kept) : undefined;
  const extracted = stood?.records ?? [];
  const keptAt = new Map(
    (current ? (kept?.sources ?? []) : []).map(({ id, revision }) => [
      id,
      revision,
    ]),
  );
  const holes = (current ? (kept?.holes ?? []) : []).filter((hole) =>
    sources.some((source) => source.id === hole.sourceId),
  );
  const onDevice = runsOnDevice(input.profile);
  const stageBySource = new Map(
    (sources as readonly Partial<BriefSource>[]).flatMap((source) =>
      source.id !== undefined && source.stage !== undefined
        ? [[source.id, source.stage] as const]
        : [],
    ),
  );

  // Every record a reader would have: the person's own, and what stands.
  const own = sources.flatMap((source) => source.records ?? []);
  const counts = new Map<
    string,
    { total: number; extracted: number; confirmed: number; edited: number }
  >();
  const count = (kind: string) => {
    const known = counts.get(kind) ?? {
      total: 0,
      extracted: 0,
      confirmed: 0,
      edited: 0,
    };
    counts.set(kind, known);
    return known;
  };
  for (const record of own) count(record.kind).total++;
  for (const record of extracted) {
    const known = count(record.kind);
    known.total++;
    known.extracted++;
    if (record.reviewed === "confirmed") known.confirmed++;
    if (record.reviewed === "edited") known.edited++;
  }

  const ids = new Set([...own, ...extracted].map((record) => record.id));
  const links = (current ? (kept?.links ?? []) : []).filter(
    (link) => ids.has(link.from) && ids.has(link.to),
  );
  const byStep = new Map<string, { total: number; byModel: number }>();
  for (const link of links) {
    const known = byStep.get(link.step) ?? { total: 0, byModel: 0 };
    known.total++;
    if (link.by === "model") known.byModel++;
    byStep.set(link.step, known);
  }

  // [DOMAIN] The fit map. A requirement has evidence when a tie says so: a
  // model's "strong" or "partial", or a technology of the person's own that
  // it names. A model's "gap", and a requirement with no tie at all, is a
  // gap: something the employer asks for that the record does not show.
  // The map is of what the employer ASKS of a candidate (must and nice): a
  // technology of its stack or a duty of the role is not a gap for having no
  // achievement tied to it.
  const requirements = [...own, ...extracted].filter(
    (record) =>
      record.kind === KINDS.requirement && ASKS.includes(sectionOf(record)),
  );
  const best = new Map<string, { strength: number; note?: string }>();
  for (const link of links) {
    if (link.step !== LINKS.fit && link.step !== LINKS.stack) continue;
    const said = text(link.fields?.["strength"]);
    const strength =
      link.step === LINKS.stack
        ? 2
        : said === "strong"
          ? 3
          : said === "partial"
            ? 2
            : 0;
    const known = best.get(link.from);
    const note = text(link.fields?.["note"]);
    if (!known || strength > known.strength)
      best.set(link.from, { strength, ...(note ? { note } : {}) });
  }
  const fit = {
    requirements: requirements.length,
    strong: 0,
    partial: 0,
    gap: 0,
  };
  const gaps: PackReview["gaps"] = [];
  for (const requirement of requirements) {
    const known = best.get(requirement.id);
    if (known && known.strength === 3) fit.strong++;
    else if (known && known.strength === 2) fit.partial++;
    else {
      fit.gap++;
      gaps.push({
        id: requirement.id,
        text: requirement.text,
        ...(known?.note ? { note: known.note } : {}),
      });
    }
  }

  const state = (source: Source): PackSourceState => {
    if (!readByModel(source)) return "structured";
    const mine = holes.filter((hole) => hole.sourceId === source.id);
    if (mine.some((hole) => hole.reason === "locality")) return "withheld";
    const at = keptAt.get(source.id);
    if (at === undefined) return "unread";
    if (at !== source.revision) return "changed";
    return mine.length > 0 ? "partial" : "current";
  };
  const extractedFrom = (id: string) =>
    extracted.filter((record) => record.source.id === id).length;
  // [SAFETY] What stays on this machine: a source the model that prepared
  // was not given, and, before any preparation, a source a model that does
  // not run here would not be given.
  const withheld = sources
    .filter(
      (source) =>
        readByModel(source) &&
        (state(source) === "withheld" ||
          (source.policy === "device-only" && !onDevice)),
    )
    .map((source) => ({
      sourceId: source.id,
      title: titleOf(source.id),
      reason: "device-only" as const,
    }));

  const stages = (material.interview?.stages ?? []).map((stage) => {
    const of = extracted.filter(
      (record) => stageBySource.get(record.source.id) === stage.ordinal,
    ).length;
    const notes = own.filter(
      (record) =>
        stageOf(record) === stage.ordinal &&
        record.fields?.["section"] === "prepNotes",
    ).length;
    return {
      ordinal: stage.ordinal,
      label: stage.label,
      notes,
      transcripts: stage.transcripts.length,
      extracted: of,
      empty: notes === 0 && stage.transcripts.length === 0,
    };
  });

  return {
    candidacyId: material.candidacyId,
    prepared: current && kept !== undefined,
    recipe: { id: recipe.id, version: recipe.version },
    current: kept === undefined || current,
    profile: input.profile
      ? { id: input.profile.id, label: input.profile.label, onDevice }
      : null,
    counts: [...counts]
      .map(([kind, known]) => ({ kind, ...known }))
      .sort((a, b) => a.kind.localeCompare(b.kind)),
    links: [...byStep]
      .map(([step, known]) => ({ step, ...known }))
      .sort((a, b) => a.step.localeCompare(b.step)),
    records: extracted
      .filter((record) => said(record.source.id))
      .slice(0, PACK_REVIEW_BOUNDS.records)
      .map((record) => {
        const stage = stageBySource.get(record.source.id);
        const section = text(record.fields?.["section"]);
        const level = text(record.fields?.["level"]);
        return {
          id: record.id,
          kind: record.kind,
          text: record.text,
          sourceId: record.source.id,
          ...(record.source.quote ? { quote: record.source.quote } : {}),
          ...(record.source.locator ? { locator: record.source.locator } : {}),
          ...(section ? { section } : {}),
          ...(level ? { level } : {}),
          ...(stage !== undefined ? { stage } : {}),
          ...(record.themes?.length ? { themes: [...record.themes] } : {}),
          ...(record.answers?.length ? { answers: [...record.answers] } : {}),
          ...(record.reviewed ? { reviewed: record.reviewed } : {}),
        };
      }),
    rejected: (current ? (kept?.rejected ?? []) : [])
      .filter((each) => each.extractor !== undefined || each.code !== undefined)
      .filter((each) => said(each.sourceId))
      .slice(0, PACK_REVIEW_BOUNDS.rejected)
      .map((each) => ({
        sourceId: each.sourceId,
        ...(each.kind ? { kind: each.kind } : {}),
        ...(each.text ? { text: each.text } : {}),
        ...(each.code ? { code: each.code } : {}),
        reason: each.reason,
      })),
    holes: holes.slice(0, PACK_REVIEW_BOUNDS.holes).map((hole) => ({
      sourceId: hole.sourceId,
      ...(hole.locator ? { locator: hole.locator } : {}),
      reason: hole.reason,
      // The failure's code, never its message: a provider's words may carry
      // what was sent to it.
      failure: hole.failure.refusal ?? hole.failure.code,
    })),
    withheld,
    gaps,
    fit: {
      ...fit,
      refused: (current ? (kept?.unlinked ?? []) : []).filter(
        (each) => each.reason !== "not-linked",
      ).length,
    },
    stages,
    sources: sources.map((source) => {
      const stage = stageBySource.get(source.id);
      return {
        id: source.id,
        kind: source.kind,
        title: titleOf(source.id),
        ...(stage !== undefined ? { stage } : {}),
        state: state(source),
        extracted: extractedFrom(source.id),
        readable: readByModel(source),
      };
    }),
    ...(input.stats
      ? {
          stats: {
            sources: input.stats.sources,
            extracted: input.stats.extracted,
            reused: input.stats.reused,
            pieces: input.stats.pieces,
            calls: input.stats.calls,
            linkCalls: input.stats.linkCalls,
            kept: input.stats.kept,
            rejected: input.stats.rejected,
            holes: input.stats.holes,
            links: input.stats.links,
          },
        }
      : {}),
  };
}

// Kept for a reader of BRIEF_SOURCE_KINDS: the kinds whose text a model reads.
export const MODEL_READ_KINDS: readonly string[] = [
  BRIEF_SOURCE_KINDS.posting,
  BRIEF_SOURCE_KINDS.employerSaid,
  BRIEF_SOURCE_KINDS.research,
  BRIEF_SOURCE_KINDS.transcript,
];
