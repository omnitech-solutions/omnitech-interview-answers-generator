// The context pack resolved for one STAGE of an application.
//
// PROBLEM: an application has several stages, each with its own notes,
// people and transcripts, and a question in the technical round should be
// answered from that round's preparation first. STRATEGY: nothing is ranked
// here. The brief's sources are scoped to the stage BEFORE anything is
// linked, prepared, selected or arranged (brief-sources.ts): a later stage's
// records are left out, and of two records that match a question equally the
// stage's own leads, an earlier stage's follows, the application's comes
// after (the engine breaks an equal match by priority). What bears on the
// question more still comes first: a stage's note said in passing never
// displaces the note that answers the question. The pack then selects as it
// always does (pack.ts); this file adds what a view shows of the stage.
// COMPLEXITY: one prepare per stage asked for; nothing per question beyond
// the pack's own.
import type { Prepared, Resolved, Source } from "@omnitech/ai-engine";
import type {
  SessionContext,
  SessionStage,
} from "../live-session/session-context";
import {
  type BriefSource,
  remoteSources,
  sessionBriefSources,
  stageOf,
  withStageBrief,
} from "./brief-sources";
import {
  type ContextEngine,
  type ContextPack,
  type PackOptions,
  type PackView,
  prepareContextPack,
  sessionSources,
} from "./pack";
import { ABOUT, type ContextKind, KINDS } from "./recipe";

export type StagePack = ContextPack & {
  // The stage resolved for; null: the whole application, no stage leading.
  stage: SessionStage | null;
  stages: SessionStage[];
};

// The slot a kind fills in every projection, for a record that was left out
// before any slot saw it.
const SLOT_OF: Partial<Record<ContextKind, string>> = {
  [KINDS.prep]: "prep",
  [KINDS.employerFact]: "employer",
  [KINDS.turn]: "transcript",
};

// The stages of the session's application, in order.
export function stagesOf(context: SessionContext): SessionStage[] {
  return (context.material?.interviewBrief?.stages ?? []).map(
    ({ id, ordinal, label, kind }) => ({ id, ordinal, label, kind }),
  );
}

// [DOMAIN] Which stage a session's pack is resolved for: the one asked for by
// its place, else the one the session was started for, else none. A place
// the application does not have is none.
export function stageFor(
  context: SessionContext,
  asked?: number | "all",
): SessionStage | null {
  if (asked === "all") return null;
  const stages = stagesOf(context);
  if (asked !== undefined)
    return stages.find((stage) => stage.ordinal === asked) ?? null;
  return context.material?.stage ?? null;
}

export async function prepareStagePack(
  engine: ContextEngine,
  context: SessionContext,
  execution: Parameters<typeof prepareContextPack>[2],
  asked?: number | "all",
  // The application's pack as a model prepared it, when one is kept: what it
  // extracted is read with the stage's own material (kept.ts).
  options: {
    kept?: Prepared | undefined;
    // Where the pack is read (pack.ts): a remote prompt unless said otherwise.
    reader?: "device" | "remote" | undefined;
    // Flags in place of each projection's own (pack.ts).
    flags?: PackOptions["flags"];
  } = {},
): Promise<StagePack> {
  const stage = stageFor(context, asked);
  const stages = stagesOf(context);
  // The person's material without the brief, then the brief's sources
  // scoped to the stage wanted and linked with it (brief-sources.ts): the
  // scope is settled before anything is prepared, selected or arranged.
  const material = context.material;
  const base = sessionSources(
    material
      ? { ...context, material: { ...material, interviewBrief: null } }
      : context,
  );
  const brief = sessionBriefSources(context);
  // [SAFETY] A source that may not leave this machine is no part of a remote
  // reader's pack (pack.ts withholds it), and so none of its records is
  // listed as left out for its stage either: `left` carries what a record
  // says. Only the person's own screen is told of them.
  const readable =
    options.reader === "device" ? brief : remoteSources(brief).sendable;
  const { sources, left } = withStageBrief(base, readable, stage?.ordinal);
  const all: readonly Source[] = [...base, ...brief];
  const pack = await prepareContextPack(engine, sources, execution, {
    kept: options.kept,
    stage: stage?.ordinal,
    reader: options.reader,
    flags: options.flags,
  });

  const stageById = new Map<string, number | undefined>(
    pack.prepared.records.map((record) => [record.id, stageOf(record)]),
  );
  // What each source is, for the view: its kind, its stage, how many records
  // it gave and whether it may leave this machine.
  const about = new Map(
    (all as readonly (Source & Partial<BriefSource>)[]).map((source) => [
      source.id,
      {
        kind: source.kind,
        ...(source.stage !== undefined ? { stage: source.stage } : {}),
        records: (source.records ?? []).length,
        sendable: source.sendable !== false,
      },
    ]),
  );
  const resolve: ContextPack["resolve"] = (projection, spoken, overrides) => {
    const resolved: Resolved = pack.resolve(projection, spoken, overrides);
    if (!stage) return resolved;
    return {
      ...resolved,
      // The same question read by another stage is another selection.
      meta: {
        ...resolved.meta,
        digest: `${resolved.meta.digest}+stage:${stage.ordinal}`,
      },
    };
  };
  const staged = <Fact extends { id: string }>(fact: Fact) => {
    const own = stageById.get(fact.id);
    return own === undefined ? fact : { ...fact, stage: own };
  };
  return {
    prepared: pack.prepared,
    gaps: pack.gaps,
    stage,
    stages,
    resolve,
    facts: pack.facts,
    lookup: pack.lookup,
    view(projection, spoken): PackView {
      const view = pack.view(projection, spoken);
      return {
        ...view,
        // Every record of the application, the ones left out for their stage
        // among them.
        records: view.records + left.length,
        selected: view.selected.map(staged),
        excluded: [
          ...view.excluded.map(staged),
          // [DOMAIN] A later stage's records, each with its reason.
          ...left.map((record) => {
            const kind = record.kind as ContextKind;
            const own = stageOf(record);
            return {
              id: record.id,
              pointer: record.locator ?? record.id,
              text: record.text,
              kind,
              about: ABOUT[kind] ?? "employer",
              slot: SLOT_OF[kind] ?? kind,
              reason: "scope" as const,
              ...(own !== undefined ? { stage: own } : {}),
            };
          }),
        ],
        digest: stage ? `${view.digest}+stage:${stage.ordinal}` : view.digest,
        sources: all.map(({ id, revision }) => ({
          id,
          revision,
          ...about.get(id),
        })),
        stage,
        stages,
      };
    },
  };
}
