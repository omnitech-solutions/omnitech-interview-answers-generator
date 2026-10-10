// The context pack of an application over HTTP (ADR-0041): its review, its
// preparation by a model, and what the person corrects in it.
//
// They are registered on the documents API's app, so its guard has already
// settled the member (tenant, membership, `interview.read`, and
// `interview.documents.write` for anything that is not a read). Ownership is
// settled here before anything is read or prepared: the application's
// candidate is the member, or the answer is `not-found`, to another member
// of the workspace exactly as to another workspace.
//
//   GET  …/candidacies/:id/context-pack              the review
//   POST …/candidacies/:id/context-pack/prepare      prepare, as NDJSON lines
//   POST …/candidacies/:id/context-pack/corrections  confirm, edit or remove
//
// [SAFETY] Preparing asks a model through the engine by PROFILE (rule 7): an
// agent profile's calls run in the agent worker as agent jobs, exactly as a
// document's do. A source that may not leave this machine is skipped by the
// engine for a profile that does not run on it, and the review says so.
// Nothing of what a source or a record says is logged here.
//
// [SAFETY] The review is the person's own screen (the "Context pack" card in
// the Interview form), read by the member the application is of and by no
// one else, and it is where they check and correct what a model made of
// their material. So it shows what a model that runs on this machine read
// from a device-only transcript, and says so by reading as `reader:
// "device"`. A review is answered to the browser and to nothing else: no
// prompt is built from one. Every reader that does write a prompt (the coach,
// a briefing, a document) reads the pack as a remote reader and is given
// none of that (pack.ts).
import type { AiEngine, ProfileSummary } from "@omnitech/ai-engine";
import type { PlatformDatabase } from "@omnitech/database";
import {
  type CandidateMatrix,
  employerBriefSchema,
  type PackProgress,
  type PackReview,
  packCorrectionsSchema,
  packPrepareSchema,
} from "@omnitech/interview-contracts";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import { BriefError, type BriefScope } from "../brief/repository";
import { createInFlight, linkedAbort, ndjsonResponse } from "../work-guards";
import { ContextPackError } from "./pack";
import {
  type ApplicationMaterial,
  applicationSources,
  correctApplicationPack,
  loadKeptPack,
  PackPreparationCancelled,
  type PackStore,
  prepareApplicationPack,
  reviewPack,
  runsOnDevice,
} from "./prepare";
import { readApplicationMaterial } from "./services/application-material";

const uuid = z.uuid();
const SMALL_JSON = 64 * 1024;
// The profile that reads when the host names none: the Claude agent runner,
// the one the employer brief is cleaned on.
export const DEFAULT_PACK_PROFILE = "agent/claude-code";

type ScopedContext = Context<{ Variables: { documentScope: BriefScope } }>;

export type PackRoutesOptions = {
  database: PlatformDatabase;
  prefix: string;
  engine: Pick<AiEngine, "context" | "profiles">;
  // Where the engine keeps prepared packs (the same store it was built
  // with). Absent: nothing is kept, and every reader uses the person's
  // material as it stands.
  packs?: PackStore | undefined;
  // The profile a preparation reads with, by id.
  packProfile?: string | undefined;
  // The member's experience matrix at its latest revision, or null.
  loadMatrix?:
    | ((scope: BriefScope) => Promise<{
        matrix: CandidateMatrix;
        id: string;
        revision: number;
      } | null>)
    | undefined;
};

async function boundedJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (Buffer.byteLength(text) > SMALL_JSON)
    throw new BriefError("body-too-large");
  return text.trim() === "" ? {} : (JSON.parse(text) as unknown);
}

export function registerPackRoutes(
  // biome-ignore lint/suspicious/noExplicitAny: the host app's variables are its own; these routes read only `documentScope`
  host: Hono<any>,
  options: PackRoutesOptions,
): void {
  const app = host as Hono<{ Variables: { documentScope: BriefScope } }>;
  const base = `${options.prefix}/candidacies/:id/context-pack`;
  const preparing = createInFlight();
  const asking = (scope: BriefScope) => ({
    scope: {
      tenantId: scope.tenantId,
      actorId: scope.actorId,
      productId: INTERVIEW_PRODUCT_ID,
    },
    permissions: ["interview.read", "interview.documents.write"],
  });

  // [SAFETY] Everything of the application, read in the member's own scope.
  // `readBriefMaterial` settles ownership first: another member's
  // application, and another workspace's, is `not-found`.
  async function materialOf(
    scope: BriefScope,
    candidacyId: string,
  ): Promise<ApplicationMaterial> {
    const { interview, brief } = await readApplicationMaterial(
      options.database,
      scope,
      candidacyId,
    );
    const parsed = employerBriefSchema.safeParse(brief);
    const matrix =
      (await options.loadMatrix?.(scope).catch(() => null)) ?? null;
    return {
      candidacyId,
      matrix,
      brief: parsed.success ? parsed.data : null,
      interview,
    };
  }
  // The profile that would read, as the member may use it; null when it is
  // not offered to them (no agent worker, no model configured).
  async function profileOf(
    scope: BriefScope,
    asked?: string,
  ): Promise<ProfileSummary | null> {
    const id = asked ?? options.packProfile ?? DEFAULT_PACK_PROFILE;
    const offered = await options.engine.profiles(asking(scope));
    return (
      offered.find(
        (profile) =>
          profile.id === id &&
          (profile.kind === "agent" || profile.kind === "model"),
      ) ?? null
    );
  }
  async function reviewOf(
    scope: BriefScope,
    candidacyId: string,
    more: { stats?: Parameters<typeof reviewPack>[0]["stats"] } = {},
  ): Promise<PackReview> {
    const material = await materialOf(scope, candidacyId);
    return reviewPack({
      material,
      sources: applicationSources(material),
      kept: await loadKeptPack(options.packs, scope, candidacyId),
      profile: await profileOf(scope),
      ...(more.stats ? { stats: more.stats } : {}),
      reader: "device",
    });
  }

  const STATUS = {
    "not-found": 404,
    "invalid-request": 400,
    "body-too-large": 413,
  } as const;
  const route =
    (work: (c: ScopedContext) => Promise<Response>) =>
    async (c: ScopedContext) => {
      try {
        return await work(c);
      } catch (error) {
        if (error instanceof BriefError)
          return c.json(
            { error: { code: error.code } },
            STATUS[error.code as keyof typeof STATUS] ?? 400,
          );
        // A correction the pack refuses (no such record, nothing prepared).
        if (error instanceof ContextPackError)
          return c.json({ error: { code: "invalid-request" } }, 400);
        throw error;
      }
    };

  app.get(
    base,
    route(async (c) => {
      const scope = c.get("documentScope");
      const id = uuid.parse(c.req.param("id"));
      return c.json(await reviewOf(scope, id));
    }),
  );

  // [DOMAIN] Preparing takes as long as its model does, so it answers as it
  // goes: one line as each group of sources is read, then the review. The
  // reader leaving (Cancel, a closed window) stops it, and what was read up
  // to then is kept: the next preparation reads only the rest.
  app.post(
    `${base}/prepare`,
    route(async (c) => {
      const scope = c.get("documentScope");
      const id = uuid.parse(c.req.param("id"));
      const input = packPrepareSchema.parse(await boundedJson(c.req.raw));
      const material = await materialOf(scope, id);
      const profile = await profileOf(scope, input.profileId);
      if (!profile)
        return c.json({ error: { code: "generation-unavailable" } }, 503);
      const sources = applicationSources(material);
      if (
        input.sourceId !== undefined &&
        !sources.some((source) => source.id === input.sourceId)
      )
        throw new BriefError("not-found");
      // One preparation of an application at a time: a second asker is told,
      // not charged.
      const release = preparing.claim(
        `${scope.tenantId}\n${scope.actorId}\n${id}`,
      );
      if (!release) return c.json({ error: { code: "already-running" } }, 409);
      const { signal, readerGone } = linkedAbort(c.req.raw.signal);
      const titles = new Map(
        reviewPack({ material, sources, kept: undefined, profile }).sources.map(
          (source) => [source.id, source.title],
        ),
      );
      return ndjsonResponse<PackProgress>(
        async (send) => {
          try {
            const done = await prepareApplicationPack(
              options.engine,
              {
                candidacyId: id,
                sources,
                profileId: profile.id,
                // From the profile's declared locality, never a guess.
                onDevice: runsOnDevice(profile),
                kept: await loadKeptPack(options.packs, scope, id),
                again: input.sourceId,
                packs: options.packs,
              },
              { scope, signal },
              (progress) =>
                send({
                  t: "progress",
                  done: progress.done,
                  total: progress.total,
                  reading: progress.reading.map(
                    (source) => titles.get(source) ?? source,
                  ),
                  calls: progress.calls,
                }),
            );
            send({
              t: "done",
              review: reviewPack({
                material,
                sources,
                // What is kept is what a reader will be given. With no store
                // the pack is prepared, shown, and not kept.
                kept:
                  (await loadKeptPack(options.packs, scope, id)) ??
                  done.prepared,
                profile,
                stats: done.stats,
                reader: "device",
              }),
            });
          } catch (error) {
            send({
              t: "error",
              code:
                error instanceof PackPreparationCancelled
                  ? "cancelled"
                  : error instanceof ContextPackError
                    ? "generation-failed"
                    : "server-error",
            });
          }
        },
        { onReaderGone: readerGone, onSettled: release },
      );
    }),
  );

  app.post(
    `${base}/corrections`,
    route(async (c) => {
      const scope = c.get("documentScope");
      const id = uuid.parse(c.req.param("id"));
      const input = packCorrectionsSchema.parse(await boundedJson(c.req.raw));
      // Ownership first: a pack is corrected only by the member it is of.
      await materialOf(scope, id);
      await correctApplicationPack(
        options.engine,
        { candidacyId: id, corrections: input.corrections },
        { scope, signal: c.req.raw.signal },
      );
      return c.json(await reviewOf(scope, id));
    }),
  );
}
