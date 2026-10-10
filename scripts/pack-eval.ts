// pnpm pack:eval: the context pack's evaluation on HELD-OUT questions.
//
// Three levels, each one command (run from anywhere in the repository):
//
//   pnpm pack:eval --retrieval             what each arm SELECTS, scored against
//                                          gold records (no model; seconds)
//   pnpm pack:eval --answers --model M     what a model ANSWERS given each
//                                          arm's context (live; cached)
//   pnpm pack:eval --coach [--runtime R]   the live coach replayed on the long
//                                          synthetic call with the pack
//
//   --arm ID[,ID]        only these arms (retrieval: before, adopted, said,
//                        said-terms, full, full-no-*, bm25, everything; answers: none, whole, bm25,
//                        pack-before, pack, gold, tools)
//   --model M            agent/claude-code[@haiku|@sonnet], agent/codex,
//                        openrouter[/model] (free models only), lm-studio[/model],
//                        or scripted (no model: the suite's gate)
//   --sample N           a stratified sample of N questions (answers; default 40)
//   --parallel N         model calls at once (default 4; 1 for a local model)
//   --category C[,C]     only these categories
//   --results DIR        where results are kept (default .dev-local/benchmarks/pack-eval)
//   --no-store           print, keep nothing
//   --check              check every gold item against the sources and stop
//   --show ID[,ID]       what the arms (--arm, default before,adopted) select
//                        for those questions, beside their gold
//   --dev                the 40 Kestrel questions (the DEVELOPMENT set) under
//                        each flag set: where a mechanism is tried and tuned,
//                        never evidence
//
// Preparing the corpus (rarely; a live model reads the sources once and the
// result is kept WITH the fixture, so every later run is code only):
//   --freeze APP --model M [--no-annotate] [--permit-device-only]   (then pnpm format:write)    prepare APP's pack and write
//                                          kept-pack.json beside its sources
//   --catalogue APP                        print APP's records as JSON lines
//                                          (what a question writer is shown)
//
// A kept result names the harness version and the hashes of the question set,
// of each application's kept pack and of each arm's flags: a number is a
// number of THAT configuration, and is compared only with the last run that
// has the same ones.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { liveEngine } from "../apps/agent-worker/src/pack-live";
import {
  readFixture,
  runPackBench,
} from "../products/interview/src/backend/context-pack/bench";
import {
  applicationOf,
  BENCH_SCOPE,
  transcriptsPermitted,
} from "../products/interview/src/backend/context-pack/bench-prepared";
import {
  ANSWER_ARMS,
  ANSWER_SCHEMA,
  type AnswerArm,
  type Answerer,
  type AnswerScore,
  answerTotals,
  reportAnswers,
  runAnswers,
  sample,
  scriptedAnswerer,
  verdict,
} from "../products/interview/src/backend/context-pack/eval/answers";
import {
  type Arm,
  bm25Arm,
  DEV_FLAGS,
  packArm,
  retrievalArms,
} from "../products/interview/src/backend/context-pack/eval/arms";
import {
  type Category,
  checkQuestions,
  type EvalFixture,
  HELD_OUT_APPLICATIONS,
  type HeldOutApplication,
  type Question,
  questionSetHash,
  readEvalFixture,
  readQuestions,
  sha256,
  sourceText,
} from "../products/interview/src/backend/context-pack/eval/fixture";
import {
  type ArmScore,
  compare,
  HARNESS_VERSION,
  reportCategories,
  reportRetrieval,
  scoreArm,
} from "../products/interview/src/backend/context-pack/eval/retrieval";
import { paired } from "../products/interview/src/backend/context-pack/eval/stats";
import {
  applicationSources,
  prepareApplicationPack,
} from "../products/interview/src/backend/context-pack/prepare";
import {
  KINDS,
  LEGACY_FLAGS,
  PACK_FLAGS,
  selectingRecipe,
} from "../products/interview/src/backend/context-pack/recipe";

// The engine's types, by way of the modules that already speak them (a
// script names no package of its own).
type AiEngine = Awaited<ReturnType<typeof liveEngine>>["engine"];
type Prepared = NonNullable<EvalFixture["kept"]>;

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const one = (flag: string): string | undefined => {
  const at = args.lastIndexOf(flag);
  return at === -1 ? undefined : args[at + 1];
};
const list = (flag: string) =>
  one(flag)
    ?.split(",")
    .map((each) => each.trim())
    .filter(Boolean);
const root = fileURLToPath(new URL("../", import.meta.url));
const results = resolve(
  root,
  one("--results") ?? ".dev-local/benchmarks/pack-eval",
);
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const keep = (name: string, value: unknown) => {
  if (has("--no-store")) return;
  mkdirSync(results, { recursive: true });
  const file = `${results}/${name}-${stamp()}.json`;
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`\nkept: ${file}`);
};
const last = <Kept>(name: string, same: (kept: Kept) => boolean) => {
  try {
    return readdirSync(results)
      .filter((file) => file.startsWith(`${name}-`) && file.endsWith(".json"))
      .sort()
      .reverse()
      .map(
        (file) =>
          JSON.parse(readFileSync(`${results}/${file}`, "utf8")) as Kept,
      )
      .find(same);
  } catch {
    return undefined;
  }
};

const fixtures = new Map<string, EvalFixture>(
  HELD_OUT_APPLICATIONS.flatMap((name) => {
    try {
      return [[name, readEvalFixture(name)] as const];
    } catch (error) {
      console.error(`${name}: ${(error as Error).message}`);
      return [];
    }
  }),
);
const fixtureOf = (name: string): EvalFixture => {
  const fixture = fixtures.get(name);
  if (!fixture) throw new Error(`No held-out application "${name}".`);
  return fixture;
};
// What identifies the configuration a number was measured on.
const configuration = (set: { version: string; hash: string }) => ({
  harness: HARNESS_VERSION,
  questions: set,
  keptPacks: Object.fromEntries(
    [...fixtures].map(([name, fixture]) => [
      name,
      fixture.kept ? sha256(JSON.stringify(fixture.kept)).slice(0, 16) : null,
    ]),
  ),
  flags: sha256(JSON.stringify(PACK_FLAGS)).slice(0, 16),
  recipe: sha256(JSON.stringify(selectingRecipe(PACK_FLAGS.coach))).slice(
    0,
    16,
  ),
});

// ---- Preparing the corpus ---------------------------------------------------

// What of a prepared pack is kept with the fixture: what a model wrote. The
// person's own records are prepared again from the sources on every run.
const slim = (prepared: Prepared): Prepared => ({
  ...prepared,
  records: prepared.records.filter(
    (record) => record.by === "model" || record.terms !== undefined,
  ),
});

async function freeze(app: HeldOutApplication, model: string) {
  const fixture = fixtureOf(app);
  const live = await liveEngine(...modelArgs(model));
  // [DOMAIN] --permit-device-only: a device-only transcript is read as if a
  // capable model ON THIS MACHINE had read it (in memory only; the fixture's
  // file keeps its policy, and so does the kept pack). For an invented
  // fixture only: it gives the benchmark the records a device reader sees, so
  // "withheld from a remote reader" has a paired positive. Never for a
  // person's own material.
  const application = applicationOf(
    has("--permit-device-only")
      ? { ...fixture, brief: transcriptsPermitted(fixture.brief) }
      : fixture,
  );
  const sources = applicationSources(application);
  const policies = new Map(
    applicationSources(applicationOf(fixture)).map((source) => [
      source.id,
      source.policy,
    ]),
  );
  const started = Date.now();
  try {
    const { prepared, stats } = await prepareApplicationPack(
      live.engine,
      {
        candidacyId: application.candidacyId,
        sources,
        profileId: live.profile,
        onDevice: live.onDevice,
        kept: fixture.kept ?? undefined,
        annotate: !has("--no-annotate"),
        concurrency: Number(one("--concurrency") ?? 3),
      },
      { scope: BENCH_SCOPE, signal: AbortSignal.timeout(3 * 3_600_000) },
      (progress) =>
        console.log(
          `  ${progress.done}/${progress.total} sources, ${progress.calls} calls${progress.reading.length ? `, reading ${progress.reading.length}` : ""}`,
        ),
    );
    const kept = slim({
      ...prepared,
      // Each source under the policy the fixture gives it.
      sources: prepared.sources.map((source) => {
        const policy = policies.get(source.id);
        return policy ? { ...source, policy } : source;
      }),
    });
    writeFileSync(
      `${fixture.folder}kept-pack.json`,
      `${JSON.stringify(kept)}\n`,
    );
    const by = (kind: string) =>
      kept.records.filter((record) => record.kind === kind).length;
    console.log(
      JSON.stringify(
        {
          app,
          model: live.profile,
          seconds: Math.round((Date.now() - started) / 1000),
          stats,
          modelRecords: kept.records.filter((record) => record.by === "model")
            .length,
          withTerms: kept.records.filter((record) => record.terms).length,
          requirements: by(KINDS.requirement),
          employerFacts: by(KINDS.employerFact),
          asked: by(KINDS.asked),
          answered: by(KINDS.answered),
          signals: by(KINDS.signal),
          commitments: by(KINDS.commitment),
          links: kept.links?.length ?? 0,
          rejected: kept.rejected.length,
          holes: (kept.holes ?? []).map(
            (hole) => `${hole.sourceId}: ${hole.reason}`,
          ),
          unannotated: kept.unannotated?.length ?? 0,
        },
        null,
        2,
      ),
    );
  } finally {
    await live.close();
  }
}

// The model named on the command line, as `liveEngine` takes it.
function modelArgs(
  model: string,
  more: { maximumTurns?: number } = {},
): Parameters<typeof liveEngine> {
  const [runtime, variant] = model.split("@");
  return [
    runtime as string,
    { ...(variant ? { model: variant } : {}), ...more },
  ];
}

async function catalogue(app: HeldOutApplication) {
  const fixture = fixtureOf(app);
  const arm = packArm("catalogue", "catalogue");
  for (const stage of fixture.brief.stages
    .map((each) => each.ordinal)
    .slice(-1)) {
    const pack = await arm.pack(fixture, {
      stage,
      reader: "device",
    } as Question);
    const policy = new Map(
      pack.prepared.sources.map((source) => [source.id, source.policy]),
    );
    for (const record of pack.prepared.records) {
      if (record.kind === KINDS.turn) continue;
      console.log(
        JSON.stringify({
          id: record.id,
          kind: record.kind,
          ...(typeof record.fields?.["company"] === "string"
            ? { employer: record.fields["company"] }
            : {}),
          ...((record as { scope?: string }).scope
            ? { stage: (record as { scope?: string }).scope }
            : {}),
          source: record.source.id,
          ...(policy.get(record.source.id) === "device-only"
            ? { deviceOnly: true }
            : {}),
          by: record.by ?? "code",
          text: record.text,
        }),
      );
    }
  }
}

// ---- The questions ------------------------------------------------------------

function questions(): {
  set: ReturnType<typeof readQuestions>;
  asked: Question[];
} {
  const set = readQuestions(one("--questions"));
  const categories = list("--category") as Category[] | undefined;
  return {
    set,
    asked: set.questions.filter(
      (question) =>
        fixtures.has(question.app) &&
        (!categories || categories.includes(question.category)),
    ),
  };
}
async function check(set: ReturnType<typeof readQuestions>) {
  // Gold is checked against the widest pack a question can be read from: the
  // person's own screen, at the question's stage.
  const arm = packArm("check", "check");
  const records = new Map<string, Set<string>>();
  const texts = new Map<string, string>();
  for (const question of set.questions) {
    const fixture = fixtureOf(question.app);
    const key = `${question.app}|${question.stage ?? ""}|${question.variant ?? ""}`;
    if (!records.has(key)) {
      const pack = await arm.pack(fixture, { ...question, reader: "device" });
      records.set(
        key,
        new Set(pack.prepared.records.map((record) => record.id)),
      );
    }
    if (!texts.has(question.app)) texts.set(question.app, sourceText(fixture));
  }
  return checkQuestions(set, (question) => ({
    records:
      records.get(
        `${question.app}|${question.stage ?? ""}|${question.variant ?? ""}`,
      ) ?? new Set(),
    sources: texts.get(question.app) ?? "",
  }));
}

// ---- Retrieval ------------------------------------------------------------------

type KeptRetrieval = {
  configuration: ReturnType<typeof configuration>;
  at: string;
  scores: ArmScore[];
};
async function retrieval() {
  const { set, asked } = questions();
  const faults = await check(set);
  if (faults.length > 0) {
    for (const fault of faults) console.error(`${fault.id}: ${fault.fault}`);
    console.error(`\n${faults.length} gold fault(s): nothing was scored.`);
    process.exit(1);
  }
  const wanted = list("--arm");
  const arms = retrievalArms().filter(
    (arm) => !wanted || wanted.includes(arm.id),
  );
  const scores: ArmScore[] = [];
  for (const arm of arms)
    scores.push(await scoreArm(arm, fixtures, asked, "coach"));
  // A briefing and a document read their projection with no question: the
  // pack's own arms only (BM25 has nothing to rank by).
  for (const projection of ["briefing", "document"] as const)
    for (const arm of arms.filter((each) =>
      ["before", "adopted", "full", "everything"].includes(each.id),
    ))
      scores.push(await scoreArm(arm, fixtures, asked, projection, "coverage"));
  const config = configuration({
    version: set.version,
    hash: questionSetHash(set),
  });
  console.log(
    `held-out set ${set.name} v${set.version} (${config.questions.hash}): ${asked.length} questions; harness ${HARNESS_VERSION}`,
  );
  console.log(reportRetrieval(scores, "before"));
  console.log("");
  console.log(
    reportCategories(scores.filter((each) => each.projection === "coach")),
  );
  const before = last<KeptRetrieval>(
    "retrieval",
    (kept) =>
      kept.configuration.harness === config.harness &&
      kept.configuration.questions.hash === config.questions.hash,
  );
  if (before) {
    console.log(
      `\nagainst the last kept run of these questions (${before.at}):`,
    );
    for (const score of scores) {
      const was = before.scores.find(
        (each) =>
          each.arm === score.arm && each.projection === score.projection,
      );
      if (!was || score.mode !== "ranked") continue;
      const { gained, lost, p } = compare(was, score);
      if (gained.length + lost.length > 0)
        console.log(
          `  ${score.arm}: +${gained.length} -${lost.length} (p=${p.toFixed(3)}) gained ${gained.join(",") || "-"}; lost ${lost.join(",") || "-"}`,
        );
    }
  }
  keep("retrieval", {
    configuration: config,
    at: new Date().toISOString(),
    scores,
  });
}

// ---- Answers ----------------------------------------------------------------------

const SCOPE = { ...BENCH_SCOPE, productId: "omnitech.interview" };
// [GUARD] The engine takes at most 100,000 characters in one part of a
// message. The whole material of an application with an hour's transcript is
// more, so a long prompt is given as several parts, cut between lines.
const PART_CHARS = 90_000;
function parts(text: string): { type: "text"; text: string }[] {
  const made: string[] = [];
  let held = "";
  for (const line of text.split("\n")) {
    if (held.length + line.length + 1 > PART_CHARS && held !== "") {
      made.push(held);
      held = "";
    }
    held += `${line}\n`;
  }
  if (held !== "") made.push(held);
  return made.map((each) => ({ type: "text" as const, text: each }));
}
async function answerer(model: string): Promise<{
  answerer: Answerer;
  close(): Promise<void>;
}> {
  if (model === "scripted")
    return { answerer: scriptedAnswerer(), close: async () => undefined };
  // A structured answer may take the runtime a second turn.
  const live = await liveEngine(...modelArgs(model, { maximumTurns: 3 }));
  // An agent runtime reads the pack as tools through an engine of its own,
  // whose profile may take a turn for each lookup.
  const agent = model.startsWith("agent/");
  const tooled = agent
    ? await liveEngine(...modelArgs(model, { maximumTurns: 12 }))
    : undefined;
  const ask =
    (engine: AiEngine, profile: string, options?: object) =>
    async (prompt: { system: string; user: string }) => {
      const result = await engine.generate(
        {
          profileId: profile,
          messages: [
            { role: "system", parts: [{ type: "text", text: prompt.system }] },
            { role: "user", parts: parts(prompt.user) },
          ],
          schema: ANSWER_SCHEMA,
        },
        {
          scope: SCOPE,
          signal: AbortSignal.timeout(Number(one("--timeout") ?? 600) * 1000),
          ...(live.onDevice ? { policy: "device-only" as const } : {}),
        },
        options,
      );
      return result.ok
        ? {
            ok: true,
            value: result.value,
            usage:
              result.usage.status === "unavailable"
                ? undefined
                : {
                    ...(result.usage.inputTokens !== undefined
                      ? { inputTokens: result.usage.inputTokens }
                      : {}),
                    ...(result.usage.outputTokens !== undefined
                      ? { outputTokens: result.usage.outputTokens }
                      : {}),
                  },
          }
        : {
            ok: false,
            failure: `${result.failure.code}: ${result.failure.reason}`,
          };
    };
  // What the model's window holds of records, at three characters a token,
  // less room for the instructions and the answer.
  const window = Number(
    one("--window") ?? (agent ? 180_000 : live.onDevice ? 12_000 : 100_000),
  );
  return {
    answerer: {
      model: live.profile.includes(model.split("@")[1] ?? "\u0000")
        ? live.profile
        : model.replace("agent/", "").replace("@", "-"),
      windowChars: window * 3,
      onDevice: live.onDevice,
      ask: ask(live.engine, live.profile),
      ...(tooled
        ? {
            askWithPack: (prompt, pack) =>
              ask(tooled.engine, tooled.profile, {
                pack: {
                  prepared: pack.prepared as Prepared,
                  recipe: selectingRecipe(PACK_FLAGS.coach),
                },
                maxPackReads: 8,
              })(prompt),
          }
        : {}),
    },
    close: async () => {
      await live.close();
      await tooled?.close();
    },
  };
}

type KeptAnswers = {
  configuration: ReturnType<typeof configuration>;
  model: string;
  at: string;
  scores: AnswerScore[];
};
async function answers() {
  const { set, asked } = questions();
  const faults = await check(set);
  if (faults.length > 0) {
    console.error(`${faults.length} gold fault(s): nothing was asked.`);
    process.exit(1);
  }
  const model = one("--model") ?? "scripted";
  const { answerer: who, close } = await answerer(model);
  const wanted =
    (list("--arm") as AnswerArm[] | undefined) ??
    ANSWER_ARMS.filter((arm) => arm !== "tools" || who.askWithPack);
  const picked = sample(asked, Number(one("--sample") ?? 40));
  const selectors: Partial<Record<AnswerArm, Arm>> = {
    whole: retrievalArms().find((arm) => arm.id === "everything") as Arm,
    bm25: bm25Arm(),
    "pack-before": packArm("before", "before", { flags: LEGACY_FLAGS }),
    pack: packArm("adopted", "adopted"),
  };
  let done = 0;
  const total = picked.length * wanted.length;
  try {
    const scores = await runAnswers({
      answerer: who,
      arms: wanted,
      questions: picked,
      fixtures,
      selectors,
      ...(has("--no-cache") ? {} : { cache: `${results}/answers` }),
      parallel: Number(one("--parallel") ?? 4),
      onAnswer: (kept, reused) => {
        done += 1;
        if (has("--quiet")) return;
        console.error(
          `  ${done}/${total} ${kept.arm} ${kept.id}${reused ? " (kept)" : ` ${(kept.ms / 1000).toFixed(1)}s`}${kept.answer ? "" : ` FAILED ${kept.failure ?? ""}`}`,
        );
      },
    });
    const config = configuration({
      version: set.version,
      hash: questionSetHash(set),
    });
    console.log(
      `held-out set v${set.version} (${config.questions.hash}): ${picked.length} questions sampled; model ${who.model}; prompt and harness ${HARNESS_VERSION}`,
    );
    const totals = wanted.map((arm) =>
      answerTotals(
        arm,
        scores.filter((score) => score.arm === arm),
      ),
    );
    console.log(reportAnswers(who.model, totals));
    // Each arm against the pack, question by question.
    const right = (arm: AnswerArm) =>
      new Map(
        scores
          .filter((score) => score.arm === arm && !score.failed)
          .map((score) => [score.id, verdict(score)] as const),
      );
    if (wanted.includes("pack")) {
      console.log("\nagainst (e) the pack, answered right, paired:");
      for (const arm of wanted) {
        if (arm === "pack") continue;
        const { gained, lost, p } = paired(right(arm), right("pack"));
        console.log(
          `  pack vs ${arm}: pack right where ${arm} wrong ${gained.length}; ${arm} right where pack wrong ${lost.length}; McNemar p=${p.toFixed(3)}`,
        );
      }
    }
    keep(`answers-${who.model.replace(/[^a-z0-9.-]+/gi, "_")}`, {
      configuration: config,
      model: who.model,
      at: new Date().toISOString(),
      scores,
    } satisfies KeptAnswers);
  } finally {
    await close();
  }
}

// ---- The coach on the long call ---------------------------------------------------

function coach() {
  const folder = "products/interview/fixtures/context-pack/tidewell-care";
  const expected = JSON.parse(
    readFileSync(resolve(root, `${folder}/call/expected.json`), "utf8"),
  ) as { interviewer: string[]; me: string[] };
  const passed = args.filter((each) => each !== "--coach");
  const run = spawnSync(
    "pnpm",
    [
      "--filter",
      "@omnitech/agent-worker",
      "exec",
      "tsx",
      "src/coach-replay.ts",
      "--transcript",
      `${folder}/call/transcript.txt`,
      "--expect",
      `${folder}/call/expected.json`,
      "--plan",
      `${folder}/call/plan.md`,
      "--matrix",
      `${folder}/matrix.json`,
      "--brief",
      `${folder}/employer-brief.json`,
      "--application",
      `${folder}/stages.json`,
      "--kept",
      `${folder}/kept-pack.json`,
      "--stage",
      "2",
      "--interviewer",
      expected.interviewer.join(","),
      "--me",
      expected.me.join(","),
      ...(passed.includes("--runtime") ? [] : ["--runtime", "scripted"]),
      ...(passed.includes("--speed") ? [] : ["--speed", "60"]),
      ...passed,
    ],
    { cwd: root, stdio: "inherit" },
  );
  process.exit(run.status ?? 1);
}

// ---- One question, looked at ----------------------------------------------------------

// What each arm selects for one question, beside its gold. Looking at a
// held-out question to fix it moves it to the development set (the audit's
// rule): this is for understanding a failure, and says so.
async function show(ids: readonly string[]) {
  const { set } = questions();
  const wanted = list("--arm") ?? ["before", "adopted"];
  for (const id of ids) {
    const question = set.questions.find((each) => each.id === id);
    if (!question) continue;
    const fixture = fixtureOf(question.app);
    console.log(`\n${id} [${question.category}] ${question.question}`);
    if (question.previous) console.log(`  after: ${question.previous}`);
    for (const arm of retrievalArms().filter((each) =>
      wanted.includes(each.id),
    )) {
      const pack = await arm.pack(fixture, question);
      const byId = new Map(
        pack.prepared.records.map((each) => [each.id, each]),
      );
      const gold = new Map(question.gold.map((each) => [each.id, each.grade]));
      const { chosen } = await arm.select(fixture, question, "coach");
      console.log(`  ${arm.id}:`);
      for (const each of chosen.filter((fact) => !fact.exact))
        console.log(
          `    ${gold.has(each.id) ? `GOLD${gold.get(each.id)}` : "     "} ${each.slot.padEnd(12)} ${each.score.toFixed(2)} ${each.text.slice(0, 110)}`,
        );
      for (const [goldId, grade] of gold)
        if (!chosen.some((each) => each.id === goldId)) {
          const record = byId.get(goldId);
          console.log(
            `    missed GOLD${grade} ${record?.kind ?? "NOT IN THIS PACK"} ${record?.text.slice(0, 110) ?? ""}${record?.terms ? ` | terms: ${record.terms.words.join(", ")}` : ""}`,
          );
        }
    }
  }
}

// ---- The development set ------------------------------------------------------------

// The 40 Kestrel questions under each flag set: where a mechanism is TRIED and
// tuned. Never evidence: the ranking rules were written against these.
async function dev() {
  const { material, gold } = readFixture("kestrel-freight-pay");
  console.log(
    "development set (kestrel-freight-pay): tuning only, never evidence",
  );
  console.log(
    "flags              evidence-first  in-3   prep-first  wrong-employer  nothing-when-nothing",
  );
  const base = await runPackBench(
    material,
    gold,
    undefined,
    DEV_FLAGS["before"],
  );
  for (const [name, flags] of Object.entries({
    ...DEV_FLAGS,
    adopted: undefined,
  })) {
    const result = await runPackBench(material, gold, undefined, flags);
    const coach = result.projections["coach"];
    if (!coach) continue;
    const was = new Map(
      (base.projections["coach"]?.questions ?? []).map((each) => [
        each.id,
        each,
      ]),
    );
    const moved = (pick: "evidenceFirst" | "prepFirst") => {
      const gained = coach.questions.filter(
        (each) => each[pick] === true && was.get(each.id)?.[pick] === false,
      );
      const lost = coach.questions.filter(
        (each) => each[pick] === false && was.get(each.id)?.[pick] === true,
      );
      return `+${gained.map((each) => each.id).join(",")} -${lost.map((each) => each.id).join(",")}`;
    };
    const of = (tally: { right: number; of: number }) =>
      `${tally.right}/${tally.of}`;
    console.log(
      `${name.padEnd(18)} ${of(coach.evidenceFirst).padEnd(15)} ${of(coach.evidenceInThree).padEnd(6)} ${of(coach.prepFirst).padEnd(11)} ${of(coach.wrongEmployerInThree).padEnd(15)} ${of(coach.honestNothing)}   evidence ${moved("evidenceFirst")}; prep ${moved("prepFirst")}`,
    );
  }
}

// ---- Which level ---------------------------------------------------------------------

const main = async () => {
  if (one("--freeze"))
    return freeze(
      one("--freeze") as HeldOutApplication,
      one("--model") ?? "agent/claude-code",
    );
  if (one("--catalogue"))
    return catalogue(one("--catalogue") as HeldOutApplication);
  if (has("--check")) {
    const faults = await check(readQuestions(one("--questions")));
    for (const fault of faults) console.log(`${fault.id}: ${fault.fault}`);
    console.log(`${faults.length} gold fault(s).`);
    process.exit(faults.length > 0 ? 1 : 0);
  }
  if (has("--dev")) return dev();
  if (one("--show")) return show(list("--show") ?? []);
  if (has("--coach")) return coach();
  if (has("--answers")) return answers();
  return retrieval();
};
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
