// pnpm pack:bench: the context pack's benchmark (no model, a second or two).
//
// It prepares the pack from a brief, resolves every gold question for the
// `coach` and `answer` projections, prints the scores beside the last run and
// keeps the result in .dev-local/benchmarks/ (as `coach:bench` does).
//
//   pnpm pack:bench                        the fixture kept with the product
//   pnpm pack:bench --fixture NAME         another fixture folder
//   pnpm pack:bench --matrix FILE --brief FILE --gold FILE [--preferences FILE]
//                                          a brief kept OUTSIDE the repository
//                                          (a person's own material is never
//                                          committed; a path is absolute, or
//                                          under ~, or from the repository's
//                                          root); --brief is an employer
//                                          brief, or an application row that
//                                          holds one under `employer_brief`
//   --results DIR                          where results are kept and the last
//                                          one looked for
//   --no-store                             score and print, keep nothing
//   --stages                               the fixture WITH its stage material
//                                          (people, per-stage notes, a
//                                          transcript, employer-said, research):
//                                          the stage gold scored per stage, and
//                                          the first gold scored again beside
//                                          it; prints and stops (nothing kept)
//   --show ID[,ID]                         print what the coach projection
//                                          selects for those questions, slot
//                                          by slot, and stop (nothing is kept)
//
//   --prepared                             the fixture's whole application
//                                          PREPARED BY A MODEL and scored: the
//                                          posting, the research, what the
//                                          employer said and the transcript
//                                          read by a SCRIPTED model built from
//                                          the fixture's gold (deterministic,
//                                          no network), at a large and a small
//                                          window, beside the same questions
//                                          on the pack code alone prepares.
//                                          Stage carry-forward is said twice,
//                                          each for a REMOTE reader (the
//                                          coach, a briefing): with the
//                                          transcript as recorded (the
//                                          fixture's is device-only: 0 of 3,
//                                          "withheld: device-only", which is
//                                          the rule kept and no failure) and
//                                          with it permitted remote (3 of 3)
//   --live --profile ID                    the same, by a REAL profile:
//                                          agent/claude-code, agent/codex,
//                                          openrouter (the first model of
//                                          PACK_BENCH_OPENROUTER_MODELS that
//                                          answers) or openrouter/<model>,
//                                          lm-studio or lm-studio/<model>.
//                                          Each run has its own engine, store
//                                          and pack and writes its own result
//                                          (pack-live-<profile>-<time>.json),
//                                          so several run side by side; the
//                                          last line is the run in short
//   --all                                  the four live profiles at once,
//                                          then one line each
//   --application FILE [--posting FILE] [--extraction FILE] [--links FILE]
//                                          with --matrix, --brief and --gold:
//                                          an application kept OUTSIDE the
//                                          repository, for --live
//   --concurrency N                        pieces read at once (default 2)
//
// The kept result holds scores and pointers, never the text of a fact.
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LIVE_PROFILES, liveEngine } from "../apps/agent-worker/src/pack-live";
import {
  type PackBenchResult,
  preparePackForBench,
  readBenchMaterial,
  readFixture,
  readGold,
  reportPackBench,
  runPackBench,
} from "../products/interview/src/backend/context-pack/bench";
import {
  applicationOf,
  BENCH_PROFILE,
  BENCH_WINDOWS,
  type PreparedBenchResult,
  type PreparedFixture,
  readPreparedFixture,
  readPreparedMaterial,
  reportPreparedBench,
  runPreparedBench,
  scriptedEngine,
  scriptedModel,
  summaryLine,
} from "../products/interview/src/backend/context-pack/bench-prepared";
import {
  readStageFixture,
  reportStageBench,
  runStageBench,
} from "../products/interview/src/backend/context-pack/bench-stages";
import {
  applicationSources,
  createMemoryPackStore,
} from "../products/interview/src/backend/context-pack/prepare";

import { scriptArgs } from "./script-flags.mjs";

const { values: flags, args } = scriptArgs({
  application: { type: "string" },
  brief: { type: "string" },
  concurrency: { type: "string" },
  extraction: { type: "string" },
  fixture: { type: "string" },
  gold: { type: "string" },
  links: { type: "string" },
  matrix: { type: "string" },
  posting: { type: "string" },
  preferences: { type: "string" },
  profile: { type: "string" },
  results: { type: "string" },
  show: { type: "string" },
  all: { type: "boolean" },
  live: { type: "boolean" },
  "no-store": { type: "boolean" },
  prepared: { type: "boolean" },
  stages: { type: "boolean" },
});
// `pnpm --filter … exec` runs in the package's folder, so a path that is
// neither absolute nor under the home folder is read from the repository's
// root, wherever the command was typed.
const root = fileURLToPath(new URL("../", import.meta.url));
const path = (given: string) =>
  resolve(root, given.replace(/^~(?=\/)/, homedir()));

const matrix = flags["matrix"];
const brief = flags["brief"];
const gold = flags["gold"];
const preferences = flags["preferences"];
const outside = matrix ?? brief ?? gold;
if (outside && !(matrix && brief && gold)) {
  console.error(
    "A brief from files needs --matrix, --brief and --gold together.",
  );
  process.exit(2);
}
const { material, gold: questions } =
  matrix && brief && gold
    ? {
        material: readBenchMaterial({
          matrix: path(matrix),
          brief: path(brief),
          ...(preferences ? { preferences: path(preferences) } : {}),
        }),
        gold: readGold(path(gold)),
      }
    : readFixture(flags["fixture"] ?? "kestrel-freight-pay");

const resultsFolder = () => {
  const kept = flags["results"];
  return kept
    ? pathToFileURL(`${path(kept).replace(/\/$/, "")}/`)
    : new URL("../.dev-local/benchmarks/", import.meta.url);
};
const keep = (name: string, result: unknown) => {
  if (flags["no-store"]) return;
  const folder = resultsFolder();
  mkdirSync(folder, { recursive: true });
  const file = new URL(name, folder);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`kept: ${fileURLToPath(file)}`);
};
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
// What a kept result holds: the scores, never what a record says.
const scores = ({
  prepared: _prepared,
  ...result
}: PreparedBenchResult & { prepared?: unknown }) => result;
const preparedFixture = (): PreparedFixture => {
  const application = flags["application"];
  if (!application)
    return readPreparedFixture(flags["fixture"] ?? "kestrel-freight-pay");
  if (!(matrix && brief && gold)) {
    console.error("--application needs --matrix, --brief and --gold with it.");
    process.exit(2);
  }
  const optional = (given: string | undefined, key: string) => {
    return given ? { [key]: path(given) } : {};
  };
  return readPreparedMaterial({
    matrix: path(matrix),
    brief: path(brief),
    gold: path(gold),
    application: path(application),
    ...optional(flags["preferences"], "preferences"),
    ...optional(flags["posting"], "posting"),
    ...optional(flags["extraction"], "extraction"),
    ...optional(flags["links"], "links"),
  });
};

if (flags["all"]) {
  // Four runs at once, each its own process, engine, store and result file.
  const script = fileURLToPath(import.meta.url);
  const passed = args.filter((each) => each !== "--all");
  const runs = LIVE_PROFILES.map(
    (profile) =>
      new Promise<string>((done) => {
        const child = spawn(
          process.execPath,
          [
            ...process.execArgv,
            script,
            ...passed,
            "--live",
            "--profile",
            profile,
          ],
          { stdio: ["ignore", "pipe", "pipe"], env: process.env },
        );
        let out = "";
        let err = "";
        child.stdout.on("data", (chunk) => {
          out += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
          err += String(chunk);
        });
        child.on("close", (code) =>
          done(
            code === 0
              ? (out.trim().split("\n").at(-1) ?? profile)
              : `${profile} | did not run: ${err.trim().split("\n").at(-1) ?? `exit ${code}`}`,
          ),
        );
      }),
  );
  console.log(`pack:bench:all: ${LIVE_PROFILES.join(", ")}, side by side`);
  for (const line of await Promise.all(runs)) console.log(line);
  process.exit(0);
}

if (flags["live"]) {
  const asked = flags["profile"];
  if (!asked) {
    console.error(`--live needs --profile: ${LIVE_PROFILES.join(", ")}.`);
    process.exit(2);
  }
  const fixture = preparedFixture();
  const live = await liveEngine(asked);
  const stop = new AbortController();
  process.once("SIGINT", () => stop.abort());
  try {
    const result = await runPreparedBench(fixture, {
      engine: live.engine,
      profile: live.profile,
      onDevice: live.onDevice,
      concurrency: Number(flags["concurrency"] ?? 2),
      signal: stop.signal,
      onProgress: (progress) =>
        console.error(
          `${live.profile}: ${progress.done}/${progress.total} sources, ${progress.calls} calls`,
        ),
    });
    const stageFixture = flags["application"]
      ? undefined
      : readStageFixture(flags["fixture"] ?? "kestrel-freight-pay");
    const before = stageFixture
      ? (
          await runStageBench(
            stageFixture.material,
            stageFixture.brief,
            stageFixture.gold,
            stageFixture.stageGold,
          )
        ).base
      : undefined;
    console.log(reportPreparedBench(result, before));
    keep(
      `pack-live-${live.profile.replace(/[^a-z0-9.-]+/gi, "_")}-${stamp()}.json`,
      scores(result),
    );
    // The run in short, last: what `--all` prints for each.
    console.log(summaryLine(result));
  } finally {
    await live.close();
  }
  process.exit(0);
}

if (flags["prepared"]) {
  const fixture = preparedFixture();
  const stageFixture = readStageFixture(
    flags["fixture"] ?? "kestrel-freight-pay",
  );
  const before = (
    await runStageBench(
      stageFixture.material,
      stageFixture.brief,
      stageFixture.gold,
      stageFixture.stageGold,
    )
  ).base;
  const results: Record<string, PreparedBenchResult> = {};
  for (const [name, window] of Object.entries(BENCH_WINDOWS)) {
    const store = createMemoryPackStore();
    const model = scriptedModel(fixture, { misbehave: true });
    const engine = scriptedEngine(model, { window, onDevice: true, store });
    const result = await runPreparedBench(fixture, {
      engine,
      profile: BENCH_PROFILE,
      onDevice: true,
      packs: store,
    });
    results[name] = scores(result);
    console.log(
      `\n${name} (${window.contextTokens} tokens in, ${window.outputTokens} out)`,
    );
    console.log(reportPreparedBench(result, before));
    // One source changes: only it is read again.
    const [first] = fixture.brief.research;
    const changed: PreparedFixture = {
      ...fixture,
      brief: {
        ...fixture.brief,
        research: fixture.brief.research.map((document) =>
          document === first
            ? {
                ...document,
                text: `${document.text}\nA second region is planned.`,
              }
            : document,
        ),
      },
    };
    const calls = model.calls.length;
    const again = await runPreparedBench(changed, {
      engine,
      profile: BENCH_PROFILE,
      onDevice: true,
      kept: result.prepared,
      packs: store,
      sources: applicationSources(applicationOf(changed)),
    });
    console.log(
      `  ${"model calls after one source changes".padEnd(46)}${model.calls.length - calls} (${again.stats.extracted} source read again, ${again.stats.reused} reused)`,
    );
  }
  keep(`pack-prepared-${fixture.extraction.name}-${stamp()}.json`, results);
  process.exit(0);
}

if (flags["stages"]) {
  const fixture = readStageFixture(flags["fixture"] ?? "kestrel-freight-pay");
  console.log(
    reportStageBench(
      await runStageBench(
        fixture.material,
        fixture.brief,
        fixture.gold,
        fixture.stageGold,
      ),
    ),
  );
  process.exit(0);
}

const shown = flags["show"];
if (shown) {
  const pack = await preparePackForBench(material);
  for (const id of shown.split(",")) {
    const asked = questions.questions.find((each) => each.id === id);
    if (!asked) continue;
    console.log(`\n${asked.id}: ${asked.question}`);
    const view = pack.view("coach", asked.question);
    console.log(`  terms: ${view.terms}`);
    for (const fact of view.selected.filter((each) => !each.exact))
      console.log(`  ${fact.slot.padEnd(13)}${fact.text.slice(0, 150)}`);
  }
  process.exit(0);
}

const result = await runPackBench(material, questions);

const kept = flags["results"];
const folder = kept
  ? pathToFileURL(`${path(kept).replace(/\/$/, "")}/`)
  : new URL("../.dev-local/benchmarks/", import.meta.url);
const prefix = `pack-${result.benchmark}-`;
const store = !flags["no-store"];
if (store) mkdirSync(folder, { recursive: true });
const earlier = (() => {
  try {
    return readdirSync(folder)
      .filter((file) => file.startsWith(prefix))
      .sort()
      .at(-1);
  } catch {
    return undefined;
  }
})();
const previous = earlier
  ? (JSON.parse(
      readFileSync(new URL(earlier, folder), "utf8"),
    ) as PackBenchResult)
  : undefined;
console.log(reportPackBench(result, previous));
if (store) {
  const file = new URL(
    `${prefix}${result.at.replace(/[:.]/g, "-")}.json`,
    folder,
  );
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`\nkept: ${fileURLToPath(file)}`);
}
