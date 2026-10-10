// An application's kept context pack, read for a briefing or a document.
//
// PROBLEM: a briefing and a document are written in the web server, each for
// an application the member owns, and each must read the pack a model
// prepared for that application when there is one, and behave exactly as
// before when there is none. STRATEGY: one port. It settles ownership in the
// member's own scope (the application's candidate is the member, or it
// answers nothing), loads the kept pack, prepares today's material beside it
// in code (pack.ts: no model), and hands the reader its projection
// (readers.ts). Any failure on the way (no store, nothing kept, a store that
// does not answer, material the recipe refuses) is "no pack": the reader
// falls back, and never fails for want of one.
import type { AiEngine } from "@omnitech/ai-engine";
import { type PlatformDatabase, withTenant } from "@omnitech/database";
import {
  type BriefingContext,
  type CandidateMatrix,
  employerBriefSchema,
} from "@omnitech/interview-contracts";
import {
  type BriefScope,
  findCandidacy,
  readBriefMaterial,
  readEmployerBrief,
} from "../brief/repository";
import { briefSources, withStageBrief } from "./brief-sources";
import { type ContextPack, contextSources, prepareContextPack } from "./pack";
import { loadKeptPack, type PackStore } from "./prepare";
import {
  briefingLines,
  type DocumentPack,
  documentPack,
  stageBriefing,
} from "./readers";

export type ApplicationPacks = {
  // What a document's writing call is given of the application's pack, for
  // the roles it was cast with (by pointer, "/roles/3"); null with no pack.
  forDocument(
    scope: BriefScope,
    input: {
      candidacyId: string;
      matrix: CandidateMatrix;
      profile: { id: string; revision: number };
      roles?: readonly string[];
      signal: AbortSignal;
    },
  ): Promise<DocumentPack | null>;
  // What a briefing for a company, a role and a stage is given of the
  // member's application to that company for that role; empty with no pack,
  // or when no one application is meant.
  forBriefing(
    scope: BriefScope,
    context: Pick<BriefingContext, "company" | "role" | "stage">,
    signal: AbortSignal,
  ): Promise<{ pointer: string; text: string }[]>;
};

// [DOMAIN] A briefing names its stage by what it is for ("hiring-manager");
// an application's stage is a row with a kind ("hiring_manager"). They are
// the same stage when they say the same thing.
const sameKind = (briefing: string, kind: string) =>
  briefing.toLowerCase().replace(/[^a-z]/g, "") ===
  kind.toLowerCase().replace(/[^a-z]/g, "");

export function createApplicationPacks(options: {
  database: PlatformDatabase;
  engine: Pick<AiEngine, "context">;
  packs?: PackStore | undefined;
  loadMatrix?:
    | ((scope: BriefScope) => Promise<{
        matrix: CandidateMatrix;
        id: string;
        revision: number;
      } | null>)
    | undefined;
}): ApplicationPacks {
  const { engine } = options;
  async function packOf(
    scope: BriefScope,
    candidacyId: string,
    matrix: { matrix: CandidateMatrix; id: string; revision: number } | null,
    stage: (kinds: { ordinal: number; kind: string }[]) => number | undefined,
    signal: AbortSignal,
  ): Promise<ContextPack | null> {
    const kept = await loadKeptPack(options.packs, scope, candidacyId);
    if (!kept) return null;
    // [SAFETY] Read in the member's own scope: another member's application,
    // and another workspace's, is not found, and no pack is read for it.
    const { interview, brief } = await withTenant(
      scope,
      async (db) => ({
        interview: await readBriefMaterial(db, scope, candidacyId),
        brief: employerBriefSchema.safeParse(
          await readEmployerBrief(db, scope, candidacyId),
        ),
      }),
      { database: options.database },
    );
    const ordinal = stage(interview.stages);
    const base = contextSources({
      ...(matrix ? { matrix } : {}),
      ...(brief.success
        ? { brief: { brief: brief.data, id: candidacyId } }
        : {}),
    });
    const { sources } = withStageBrief(
      base,
      briefSources(interview, {
        skipCarriedNotes:
          brief.success && (brief.data.prepNotes ?? []).length > 0,
      }),
      ordinal,
    );
    return prepareContextPack(
      engine,
      sources,
      { scope, signal, for: { kind: "candidacy", id: candidacyId } },
      // [SAFETY] A briefing and a document are written by whichever profile
      // the Studio writes on, which this port is not told and which may be
      // an agent or a model elsewhere. So both read as a remote reader: a
      // device-only transcript, and what a local model extracted from one,
      // is no part of what they are given. Said outright, though it is the
      // pack's default.
      { kept, stage: ordinal, reader: "remote" },
    );
  }
  return {
    async forDocument(scope, input) {
      try {
        const pack = await packOf(
          scope,
          input.candidacyId,
          { matrix: input.matrix, ...input.profile },
          // A document is for the application, not for one stage.
          () => undefined,
          input.signal,
        );
        return (
          pack &&
          documentPack(
            engine,
            pack,
            {
              scope,
              signal: input.signal,
              for: { kind: "candidacy", id: input.candidacyId },
            },
            input.roles,
          )
        );
      } catch {
        return null;
      }
    },
    async forBriefing(scope, context, signal) {
      try {
        if (!options.packs) return [];
        // [GUARD] A briefing is not tied to an application: it names a
        // company and a role. The pack is read only when exactly one of the
        // member's applications is to that company for that role.
        const candidacyId = await withTenant(
          scope,
          (db) =>
            findCandidacy(db, scope, {
              company: context.company,
              role: context.role,
            }),
          { database: options.database },
        );
        if (!candidacyId) return [];
        const matrix =
          (await options.loadMatrix?.(scope).catch(() => null)) ?? null;
        const pack = await packOf(
          scope,
          candidacyId,
          matrix,
          (stages) =>
            stages.find((stage) => sameKind(context.stage, stage.kind))
              ?.ordinal,
          signal,
        );
        const briefing =
          pack &&
          stageBriefing(engine, pack, {
            scope,
            signal,
            for: { kind: "candidacy", id: candidacyId },
          });
        return briefing ? briefingLines(briefing) : [];
      } catch {
        return [];
      }
    },
  };
}
