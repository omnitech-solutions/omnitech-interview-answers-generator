// The context pack's benchmark with a pack a MODEL prepared: the fixture's
// whole application (the posting, the research, what the employer said, both
// stages' notes and the transcript) read by a profile, kept, and scored.
//
// PROBLEM: "extraction is right and the pack got better" has to be a number
// that a gate can assert and that a real model can be held to. STRATEGY: the
// same run for both. In the gate the profile is a SCRIPTED model built from
// the fixture's gold (deterministic, no network): it answers each piece with
// the gold records whose words are in that piece, adds proposals the source
// does not say, and proposes ties the recipe forbids, so the checks are
// exercised. Live, the profile is a real one. Either way the scores are read
// from the pack the engine kept: what was found against the gold, what was
// kept without a quote (must be none), which ties are wrong (must be none),
// what a later stage's remote reader is given of an earlier one (nothing of a
// device-only transcript; all of one that may leave this machine), and how
// many calls it took.
import { readFileSync } from "node:fs";
import {
  type AiEngine,
  createAiEngine,
  type ModelInput,
  type ModelPort,
  type Prepared,
  type PreparedStore,
  type PrepareStats,
  type Source,
} from "@omnitech/ai-engine";
import { z } from "zod";
import type { BriefMaterial } from "../brief/repository";
import {
  type BenchMaterial,
  fixtureFolder,
  type Gold,
  type QuestionScore,
  readBenchMaterial,
  readGold,
  scoreQuestion,
} from "./bench";
import { readStageFixture, type StageGold, stageContext } from "./bench-stages";
import { BRIEF_SOURCE_KINDS, remoteSources } from "./brief-sources";
import {
  type ApplicationMaterial,
  applicationSources,
  createMemoryPackStore,
  type PrepareProgress,
  prepareApplicationPack,
  readByModel,
  reviewPack,
} from "./prepare";
import {
  ABOUT,
  type ContextKind,
  EXTRACTORS,
  INTERVIEW_CONTEXT_RECIPE,
  KINDS,
} from "./recipe";
import { prepareStagePack, type StagePack } from "./stage";

const proposal = z.looseObject({
  kind: z.string(),
  text: z.string(),
  quote: z.string(),
  fields: z.record(z.string(), z.unknown()),
  themes: z.array(z.string()),
  answers: z.array(z.string()),
});
export const extractionGoldSchema = z.looseObject({
  name: z.string().min(1),
  // What a careful reader finds, source by source.
  sources: z.array(
    z.strictObject({
      source: z.string().min(1),
      // The kind of source (recipe.ts, TEXT_SOURCE_KINDS).
      kind: z.string().min(1),
      records: z.array(proposal),
    }),
  ),
  // What a model might add that the source does not say. Offered by the
  // scripted model with the piece that holds `after`; each must be refused.
  invented: z.array(
    z.strictObject({
      kind: z.string().min(1),
      after: z.string().min(1),
      record: proposal,
    }),
  ),
});
export type ExtractionGold = z.infer<typeof extractionGoldSchema>;

const evidence = z.looseObject({
  company: z.string().min(1),
  says: z.string().min(1),
});
const tie = z.strictObject({
  // The words the record it is from starts with.
  from: z.string().min(1),
  to: z.array(evidence).min(1),
});
export const linkGoldSchema = z.looseObject({
  name: z.string().min(1),
  fit: z.array(tie),
  proof: z.array(tie),
  story: z.array(tie),
  // Ties the recipe does not allow, proposed by the scripted model: evidence
  // as the requirement, and one requirement as evidence for another.
  forbidden: z.array(z.looseObject({ step: z.string(), from: z.string() })),
});
export type LinkGold = z.infer<typeof linkGoldSchema>;

export type PreparedFixture = {
  material: BenchMaterial;
  gold: Gold;
  brief: BriefMaterial;
  stageGold: StageGold;
  extraction: ExtractionGold;
  links: LinkGold;
};

// The fixture with its posting and the gold for extraction and for links.
export function readPreparedFixture(name: string): PreparedFixture {
  const folder = fixtureFolder(name);
  const json = (file: string): unknown =>
    JSON.parse(readFileSync(`${folder}${file}`, "utf8"));
  const fixture = readStageFixture(name);
  return {
    ...fixture,
    brief: {
      ...fixture.brief,
      posting: readFileSync(`${folder}posting.txt`, "utf8"),
    },
    extraction: extractionGoldSchema.parse(json("gold-extraction.json")),
    links: linkGoldSchema.parse(json("gold-links.json")),
  };
}

// An application kept OUTSIDE the repository (a person's own material is
// never committed): the matrix, the employer brief and the questions' gold as
// the first benchmark reads them, the application as `readBriefMaterial`
// gives it (stages, employer-said, research; a file like the fixture's
// stages.json), the posting, and, where a person wrote them, the gold for
// extraction and for links. Without those two the scores that need them say
// 0 of 0, and the rest (quotes verified, wrong links, calls) still stand.
export function readPreparedMaterial(paths: {
  matrix: string;
  brief: string;
  gold: string;
  application: string;
  preferences?: string;
  posting?: string;
  extraction?: string;
  links?: string;
}): PreparedFixture {
  const json = (file: string): unknown =>
    JSON.parse(readFileSync(file, "utf8"));
  const brief = json(paths.application) as BriefMaterial;
  return {
    material: readBenchMaterial(paths),
    gold: readGold(paths.gold),
    brief: paths.posting
      ? { ...brief, posting: readFileSync(paths.posting, "utf8") }
      : brief,
    stageGold: { name: "none", questions: [] } as unknown as StageGold,
    extraction: paths.extraction
      ? extractionGoldSchema.parse(json(paths.extraction))
      : { name: "outside-the-repository", sources: [], invented: [] },
    links: paths.links
      ? linkGoldSchema.parse(json(paths.links))
      : { name: "none", fit: [], proof: [], story: [], forbidden: [] },
  };
}

// [DOMAIN] The same application with every transcript marked as one that MAY
// leave this machine: what it would be had the person pasted or attached it
// and allowed it out, or recorded it under a permitted policy. In memory only:
// the fixture's file keeps its device-only recording. A transcript's identity
// and revision are its id and its words, so a pack kept for the one is the
// pack kept for the other; only who may be given it differs.
export function transcriptsPermitted(brief: BriefMaterial): BriefMaterial {
  return {
    ...brief,
    stages: brief.stages.map((stage) => ({
      ...stage,
      transcripts: stage.transcripts.map((transcript) => ({
        ...transcript,
        capturePolicy: "permitted-remote" as const,
      })),
    })),
  };
}
// A fixture read that way.
export const withTranscriptsPermitted = <
  Fixture extends Pick<PreparedFixture, "brief">,
>(
  fixture: Fixture,
): Fixture => ({ ...fixture, brief: transcriptsPermitted(fixture.brief) });

// Text as a quote is compared: without case, with every run of space one.
const plain = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
const textOf = (input: ModelInput, role: "system" | "user") =>
  input.messages
    .filter((message) => message.role === role)
    .flatMap((message) =>
      message.parts.map((part) => (part.type === "text" ? part.text : "")),
    )
    .join("\n");

// One call the scripted model was asked.
export type Asked = {
  // The extractor or the link step it was for.
  for: string;
  system: string;
  user: string;
  policy?: string | undefined;
};
export type ScriptedModel = {
  port: ModelPort;
  calls: Asked[];
};

// [STRATEGY] A model that reads as the gold reads: asked about a piece of a
// source, it returns the gold records whose quoted words are in that piece;
// asked to tie two lists, it returns the gold ties between the lines it is
// shown. It knows no source id and no record id, only what a model is given.
export function scriptedModel(
  gold: Pick<PreparedFixture, "extraction" | "links">,
  options: {
    // Also propose what the source does not say, and ties the recipe forbids.
    misbehave?: boolean;
    // A call that fails, as a provider's failure does.
    fail?: (asked: Asked) => boolean;
  } = {},
): ScriptedModel {
  const calls: Asked[] = [];
  const steps = INTERVIEW_CONTEXT_RECIPE.links ?? [];
  const extracted = (extractor: (typeof EXTRACTORS)[number], user: string) => {
    const piece = plain(user);
    const records = gold.extraction.sources
      .filter((source) => source.kind === extractor.sourceKind)
      .flatMap((source) => source.records)
      .filter((record) => piece.includes(plain(record.quote)));
    const invented = options.misbehave
      ? gold.extraction.invented
          .filter(
            (each) =>
              each.kind === extractor.sourceKind &&
              piece.includes(plain(each.after)),
          )
          .map((each) => each.record)
      : [];
    return { records: [...records, ...invented] };
  };
  const lines = (list: string) =>
    list
      .split("\n")
      .map((line) => /^([AB]\d+): (.*)$/.exec(line))
      .flatMap((found) =>
        found ? [{ label: found[1] as string, text: found[2] as string }] : [],
      );
  const linked = (step: string, user: string) => {
    const [first = "", second = ""] = user.split("\n\nSecond list:\n");
    const from = lines(first.replace(/^First list:\n/, ""));
    const to = lines(second);
    const starts = (line: { text: string }, words: string) =>
      plain(line.text).startsWith(plain(words));
    const made: { from: string; to: string; fields?: unknown }[] = [];
    const entries =
      step === "fit"
        ? gold.links.fit
        : step === "proof"
          ? gold.links.proof
          : gold.links.story;
    for (const entry of entries)
      for (const a of from.filter((line) => starts(line, entry.from)))
        for (const wanted of entry.to) {
          const { company, says, ...fields } = wanted;
          for (const b of to.filter(
            (line) =>
              plain(line.text).startsWith(plain(`At ${company} (`)) &&
              plain(line.text).includes(plain(says)),
          ))
            made.push({
              from: a.label,
              to: b.label,
              ...(step === "proof" ? {} : { fields }),
            });
        }
    if (options.misbehave && step === "fit") {
      // Evidence offered as the requirement, a requirement as evidence for
      // another, and an end that is not there: each must be refused.
      const [a, other] = from;
      const [b] = to;
      if (a && b)
        made.push({
          from: b.label,
          to: a.label,
          fields: { strength: "strong" },
        });
      if (a && other)
        made.push({
          from: a.label,
          to: other.label,
          fields: { strength: "strong" },
        });
      if (a)
        made.push({
          from: a.label,
          to: "B9999",
          fields: { strength: "strong" },
        });
    }
    return { links: made };
  };
  return {
    calls,
    port: {
      async *stream(_scope, input: ModelInput) {
        const system = textOf(input, "system");
        const user = textOf(input, "user");
        const extractor = EXTRACTORS.find((each) =>
          system.startsWith(each.instructions),
        );
        const step = steps.find(
          (each) =>
            each.instructions !== undefined &&
            system.startsWith(each.instructions),
        );
        const asked: Asked = {
          for: extractor?.id ?? step?.id ?? "unknown",
          system,
          user,
        };
        // A repair turn is the engine asking again about the same piece.
        if (!system.includes("That output was not accepted")) calls.push(asked);
        if (options.fail?.(asked))
          throw new Error("The scripted model failed.");
        const answer = extractor
          ? extracted(extractor, user)
          : step
            ? linked(step.id, user)
            : {};
        yield { type: "text" as const, text: JSON.stringify(answer) };
      },
    },
  };
}

// [DOMAIN] The two sizes a preparation is proven at. "large" holds a whole
// posting or transcript in one call, as Claude Code and Codex do; "small"
// declares what a local model loaded at a few thousand tokens does, so every
// long source is read in pieces and every list of records in batches.
export const BENCH_WINDOWS = {
  large: { contextTokens: 200_000, outputTokens: 16_000 },
  small: { contextTokens: 1_500, outputTokens: 400 },
} as const;
export const BENCH_PROFILE = "pack-reader";

export function scriptedEngine(
  model: ScriptedModel,
  options: {
    window?: { contextTokens: number; outputTokens: number };
    // Whether the profile runs on this machine: a device-only source is read
    // only when it does.
    onDevice?: boolean;
    store?: PreparedStore;
  } = {},
): AiEngine {
  return createAiEngine({
    profiles: [
      {
        id: BENCH_PROFILE,
        provider: "scripted",
        window: options.window ?? BENCH_WINDOWS.large,
        ...(options.onDevice ? { locality: "device" as const } : {}),
      },
    ],
    providers: { scripted: model.port },
    prepared: options.store ?? createMemoryPackStore(),
    log: { level: "silent" },
  });
}

export const BENCH_SCOPE = {
  tenantId: "00000000-0000-4000-8000-0000000000b1",
  actorId: "00000000-0000-4000-8000-0000000000b2",
};

// The fixture as the application a pack is prepared from.
export function applicationOf(
  fixture: Pick<PreparedFixture, "material" | "brief">,
): ApplicationMaterial {
  return {
    candidacyId: fixture.brief.candidacyId,
    matrix: { matrix: fixture.material.matrix, id: "bench", revision: 1 },
    brief: fixture.material.brief,
    preferences: fixture.material.preferences.trim()
      ? { text: fixture.material.preferences, id: "draft", revision: "1" }
      : null,
    interview: fixture.brief,
  };
}

type Tally = { right: number; of: number };
export type PreparedBenchResult = {
  benchmark: string;
  at: string;
  profile: string;
  recipe: { id: string; version: string };
  records: { total: number; extracted: number; byKind: Record<string, number> };
  // Model-written records whose quote the engine found in their source.
  verifiedQuotes: Tally;
  // The posting's requirements a careful reader finds, found by the model.
  requirementsFound: Tally;
  // Requirements kept whose quoted words are not in the posting: must be 0.
  requirementsInvented: number;
  // The questions actually asked in the transcript, found by the model.
  questionsFound: Tally;
  // Proposals refused because the source does not say them.
  rejected: number;
  // Requirements (must and nice) with evidence tied to them.
  requirementsWithEvidence: Tally;
  gaps: number;
  // Ties that end at anything but the candidate's own record: must be 0.
  wrongLinks: number;
  refusedLinks: number;
  // Of what an earlier stage asked and signalled, how much the next stage is
  // given when it asks the same thing. Both are of a REMOTE reader (the
  // coach, a briefing: a prompt sent to a model that does not run here).
  // `carryForward`: with each transcript under the policy it was recorded
  // with. A device-only transcript gives such a reader nothing, which is the
  // rule kept and not a failure; `carryWithheld` counts those transcripts.
  carryForward: Tally;
  carryWithheld: number;
  // The same with every transcript permitted to leave this machine (pasted or
  // attached and allowed out, or recorded under a permitted policy).
  carryForwardPermitted: Tally;
  holes: number;
  withheld: number;
  stats: PrepareStats;
  // Sources a model reads, and the text of them it was not allowed to.
  sources: Tally;
  prepareMs: number;
  // The first benchmark's questions, each at the stage that asks it, with
  // the prepared pack read beside the person's material.
  questions: {
    evidenceFirst: Tally;
    evidenceInThree: Tally;
    prepFirst: Tally;
    wrongEmployerInThree: Tally;
    nothingUseful: number;
    resolveMs: { median: number; largest: number };
    each: QuestionScore[];
  };
};

const ROUND: Readonly<Record<string, number>> = {
  "hiring-manager": 1,
  technical: 2,
};
const middle = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
};
const wordsIn = (text: string) =>
  new Set(plain(text).match(/[a-z0-9][a-z0-9+#.-]*/g) ?? []);
// Whether a record rests on the words the gold names: the same sentence, or
// most of its words (a model may quote a little more or less of a line).
const restsOn = (quote: string | undefined, gold: string) => {
  if (!quote) return false;
  const [mine, theirs] = [plain(quote), plain(gold)];
  if (mine.includes(theirs) || theirs.includes(mine)) return true;
  const wanted = [...wordsIn(gold)];
  const said = wordsIn(quote);
  return wanted.filter((word) => said.has(word)).length >= wanted.length * 0.6;
};

// The scores of a prepared pack, read from what the engine kept.
export async function scorePrepared(
  fixture: PreparedFixture,
  run: {
    engine: Pick<AiEngine, "context">;
    prepared: Prepared;
    stats: PrepareStats;
    profile: string;
    onDevice: boolean;
    prepareMs: number;
  },
  nowMs: () => number = () => performance.now(),
): Promise<PreparedBenchResult> {
  const { prepared } = run;
  const application = applicationOf(fixture);
  const sources = applicationSources(application);
  const model = prepared.records.filter((record) => record.by === "model");
  const byKind: Record<string, number> = {};
  for (const record of prepared.records)
    byKind[record.kind] = (byKind[record.kind] ?? 0) + 1;

  const posting = fixture.brief.posting ?? "";
  const requirements = model.filter(
    (record) => record.kind === KINDS.requirement,
  );
  const asks = (
    fixture.extraction.sources.find(
      (source) => source.kind === "job-description",
    )?.records ?? []
  ).filter((record) =>
    ["mustHaves", "niceToHaves"].includes(String(record.fields["section"])),
  );
  const asked = (
    fixture.extraction.sources.find((source) => source.kind === "transcript")
      ?.records ?? []
  ).filter((record) => record.kind === KINDS.asked);
  const found = (
    wanted: readonly { quote: string }[],
    among: readonly Prepared["records"][number][],
  ): Tally => ({
    right: wanted.filter((each) =>
      among.some((record) =>
        [
          record.source.quote,
          ...(record.source.also ?? []).map((also) => also.quote),
        ].some((quote) => restsOn(quote, each.quote)),
      ),
    ).length,
    of: wanted.length,
  });

  const byId = new Map(prepared.records.map((record) => [record.id, record]));
  const wrongLinks = (prepared.links ?? []).filter(
    (link) => ABOUT[byId.get(link.to)?.kind as ContextKind] !== "candidate",
  ).length;
  const review = reviewPack({
    material: application,
    sources,
    kept: prepared,
    profile: {
      id: run.profile,
      label: run.profile,
      kind: "model",
      provider: "bench",
      locality: run.onDevice ? "device" : "remote",
    },
    stats: run.stats,
  });

  // The packs a session of each stage reads: its own material, and what
  // stands of the kept pack.
  const context = stageContext(fixture.material, fixture.brief);
  const packs = new Map<number, StagePack>();
  for (const { ordinal } of fixture.brief.stages)
    packs.set(
      ordinal,
      await prepareStagePack(
        run.engine,
        context,
        { scope: BENCH_SCOPE, signal: new AbortController().signal },
        ordinal,
        { kept: prepared },
      ),
    );
  const packFor = (stage: number) => packs.get(stage) as StagePack;
  const took: number[] = [];
  const each = fixture.gold.questions.map((question) => {
    const from = nowMs();
    const scored = scoreQuestion(
      packFor(ROUND[question.stage] ?? 1),
      "coach",
      question,
    );
    took.push(nowMs() - from);
    return scored;
  });
  const tally = (pick: (score: QuestionScore) => boolean | null): Tally => ({
    right: each.filter((score) => pick(score) === true).length,
    of: each.filter((score) => pick(score) !== null).length,
  });

  // [DOMAIN] Carry-forward: what stage 1's transcript gave (its questions and
  // what it said to expect), asked again in stage 2 by a REMOTE reader. Scored
  // twice: with the transcripts as recorded, and with each of them permitted
  // to leave this machine. [SAFETY] A device-only transcript carries nothing
  // to a remote reader (pack.ts), so the first is 0 for the fixture and must
  // stay so; the second is the feature.
  const earlier = (
    fixture.extraction.sources.find((source) => source.kind === "transcript")
      ?.records ?? []
  ).filter(
    (record) => record.kind === KINDS.asked || record.kind === KINDS.signal,
  );
  const last = Math.max(...fixture.brief.stages.map((stage) => stage.ordinal));
  const carriedBy = (pack: StagePack) =>
    earlier.filter((record) =>
      pack
        .facts("coach", record.text)
        .some(
          (fact) =>
            (fact.slot === "asked" || fact.slot === "signals") &&
            restsOn(byId.get(fact.id)?.source.quote, record.quote),
        ),
    ).length;
  const carried = carriedBy(packFor(last));
  const carriedPermitted = carriedBy(
    await prepareStagePack(
      run.engine,
      stageContext(fixture.material, transcriptsPermitted(fixture.brief)),
      { scope: BENCH_SCOPE, signal: new AbortController().signal },
      last,
      { kept: prepared },
    ),
  );
  const carryWithheld = remoteSources(sources).withheld.filter((withheld) =>
    sources.some(
      (source) =>
        source.id === withheld.id &&
        source.kind === BRIEF_SOURCE_KINDS.transcript,
    ),
  ).length;

  const readable = sources.filter(readByModel);
  return {
    benchmark: fixture.extraction.name,
    at: new Date().toISOString(),
    profile: run.profile,
    recipe: prepared.recipe,
    records: {
      total: prepared.records.length,
      extracted: model.length,
      byKind,
    },
    verifiedQuotes: {
      right: model.filter((record) => record.verified === "quote-found").length,
      of: model.length,
    },
    requirementsFound: found(asks, requirements),
    requirementsInvented: requirements.filter(
      (record) =>
        !record.source.quote ||
        !plain(posting).includes(plain(record.source.quote)),
    ).length,
    questionsFound: found(
      asked,
      model.filter((record) => record.kind === KINDS.asked),
    ),
    rejected: prepared.rejected.filter((each) => each.code !== undefined)
      .length,
    requirementsWithEvidence: {
      right: review.fit.strong + review.fit.partial,
      of: review.fit.requirements,
    },
    gaps: review.fit.gap,
    wrongLinks,
    refusedLinks: review.fit.refused,
    carryForward: { right: carried, of: earlier.length },
    carryWithheld,
    carryForwardPermitted: { right: carriedPermitted, of: earlier.length },
    holes: (prepared.holes ?? []).length,
    withheld: review.withheld.length,
    stats: run.stats,
    sources: {
      right: readable.filter((source) =>
        review.sources.some(
          (each) => each.id === source.id && each.state === "current",
        ),
      ).length,
      of: readable.length,
    },
    prepareMs: run.prepareMs,
    questions: {
      evidenceFirst: tally((score) => score.evidenceFirst),
      evidenceInThree: tally((score) => score.evidenceInThree),
      prepFirst: tally((score) => score.prepFirst),
      wrongEmployerInThree: tally((score) =>
        score.wrongEmployers === null ? null : score.wrongEmployers > 0,
      ),
      nothingUseful: each.filter((score) => score.nothingUseful).length,
      resolveMs: { median: middle(took), largest: Math.max(0, ...took) },
      each,
    },
  };
}

// Prepare the fixture's application with a profile of an engine, and score it.
export async function runPreparedBench(
  fixture: PreparedFixture,
  run: {
    engine: Pick<AiEngine, "context">;
    profile: string;
    onDevice: boolean;
    kept?: Prepared;
    // The store the engine keeps the pack in.
    packs?: PreparedStore;
    sources?: readonly Source[];
    concurrency?: number;
    signal?: AbortSignal;
    onProgress?: (progress: PrepareProgress) => void;
  },
  nowMs: () => number = () => performance.now(),
): Promise<PreparedBenchResult & { prepared: Prepared }> {
  const startedAt = nowMs();
  const done = await prepareApplicationPack(
    run.engine,
    {
      candidacyId: fixture.brief.candidacyId,
      sources: run.sources ?? applicationSources(applicationOf(fixture)),
      profileId: run.profile,
      onDevice: run.onDevice,
      kept: run.kept,
      packs: run.packs,
      ...(run.concurrency ? { concurrency: run.concurrency } : {}),
    },
    {
      scope: BENCH_SCOPE,
      signal: run.signal ?? new AbortController().signal,
    },
    run.onProgress,
  );
  const prepareMs = nowMs() - startedAt;
  return {
    ...(await scorePrepared(
      fixture,
      { ...run, prepared: done.prepared, stats: done.stats, prepareMs },
      nowMs,
    )),
    prepared: done.prepared,
  };
}

// The result as lines a person reads; `before` is the same questions on the
// pack as code alone prepares it (the stage benchmark's base).
export function reportPreparedBench(
  result: PreparedBenchResult,
  before?: {
    evidenceFirst: Tally;
    prepFirst: Tally;
    wrongEmployerInThree: Tally;
  },
): string {
  const share = ({ right, of }: Tally) => `${right}/${of}`;
  const row = (label: string, value: string, was?: string) =>
    `  ${label.padEnd(46)}${value.padEnd(12)}${was === undefined ? "" : `code only: ${was}`}`;
  const kinds = Object.entries(result.records.byKind)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${kind} ${count}`)
    .join(", ");
  const q = result.questions;
  return [
    `pack:bench prepared ${result.benchmark}: profile ${result.profile}, recipe ${result.recipe.id} v${result.recipe.version}`,
    `records: ${result.records.total} (${result.records.extracted} written by the model): ${kinds}`,
    row("sources read by the model", share(result.sources)),
    row(
      "model calls (pieces; link batches)",
      `${result.stats.calls + result.stats.linkCalls}`,
    ) +
      `(${result.stats.pieces} pieces, ${result.stats.calls} extraction calls, ${result.stats.linkCalls} link calls)`,
    row("records with a verified quote", share(result.verifiedQuotes)),
    row("proposals refused (not in the source)", String(result.rejected)),
    row("requirements found (recall)", share(result.requirementsFound)),
    row(
      "requirements invented (must be 0)",
      String(result.requirementsInvented),
    ),
    row("questions asked, found", share(result.questionsFound)),
    row(
      "requirements with evidence linked",
      share(result.requirementsWithEvidence),
    ),
    row("  of them gaps (no evidence)", String(result.gaps)),
    row("wrong links (must be 0)", String(result.wrongLinks)),
    row("ties refused by the recipe's rule", String(result.refusedLinks)),
    "  stage carry-forward, to a remote reader (the coach, a briefing):",
    row("    transcript as recorded", share(result.carryForward)) +
      (result.carryWithheld > 0 ? "withheld: device-only" : ""),
    row("    transcript permitted remote", share(result.carryForwardPermitted)),
    row(
      "parts not read (holes); withheld",
      `${result.holes}; ${result.withheld}`,
    ),
    row("prepared in", `${Math.round(result.prepareMs)} ms`),
    "",
    `the first benchmark's ${q.each.length} questions, each at its stage (coach projection):`,
    row(
      "right evidence first",
      share(q.evidenceFirst),
      before && share(before.evidenceFirst),
    ),
    row("right evidence in the first three", share(q.evidenceInThree)),
    row(
      "right prep note first",
      share(q.prepFirst),
      before && share(before.prepFirst),
    ),
    row(
      "wrong-employer evidence in the first three",
      share(q.wrongEmployerInThree),
      before && share(before.wrongEmployerInThree),
    ),
    row("questions with nothing useful", String(q.nothingUseful)),
    row(
      "resolve per question (median, largest)",
      `${q.resolveMs.median.toFixed(1)} ms, ${q.resolveMs.largest.toFixed(1)} ms`,
    ),
  ].join("\n");
}

// One line in short, for a run among several.
export const summaryLine = (result: PreparedBenchResult): string => {
  const share = ({ right, of }: Tally) => `${right}/${of}`;
  return [
    result.profile,
    `calls ${result.stats.calls + result.stats.linkCalls}`,
    `pieces ${result.stats.pieces}`,
    `extracted ${result.records.extracted}`,
    `quotes ${share(result.verifiedQuotes)}`,
    `requirements ${share(result.requirementsFound)}`,
    `invented ${result.requirementsInvented}`,
    `asked ${share(result.questionsFound)}`,
    `linked ${share(result.requirementsWithEvidence)}`,
    `wrong ${result.wrongLinks}`,
    `carry ${share(result.carryForward)}${result.carryWithheld > 0 ? " (withheld: device-only)" : ""}`,
    `carry if permitted ${share(result.carryForwardPermitted)}`,
    `holes ${result.holes}`,
    `evidence ${share(result.questions.evidenceFirst)}`,
    `prep ${share(result.questions.prepFirst)}`,
    `${Math.round(result.prepareMs / 1000)}s`,
  ].join(" | ");
};
