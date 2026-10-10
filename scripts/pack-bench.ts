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
// The kept result holds scores and pointers, never the text of a fact.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
  readStageFixture,
  reportStageBench,
  runStageBench,
} from "../products/interview/src/backend/context-pack/bench-stages";

const args = process.argv.slice(2);
const one = (flag: string): string | undefined => {
  const at = args.lastIndexOf(flag);
  return at === -1 ? undefined : args[at + 1];
};
// `pnpm --filter … exec` runs in the package's folder, so a path that is
// neither absolute nor under the home folder is read from the repository's
// root, wherever the command was typed.
const root = fileURLToPath(new URL("../", import.meta.url));
const path = (given: string) =>
  resolve(root, given.replace(/^~(?=\/)/, homedir()));

const matrix = one("--matrix");
const brief = one("--brief");
const gold = one("--gold");
const preferences = one("--preferences");
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
    : readFixture(one("--fixture") ?? "kestrel-freight-pay");

if (args.includes("--stages")) {
  const fixture = readStageFixture(one("--fixture") ?? "kestrel-freight-pay");
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

const shown = one("--show");
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

const kept = one("--results");
const folder = kept
  ? pathToFileURL(`${path(kept).replace(/\/$/, "")}/`)
  : new URL("../.dev-local/benchmarks/", import.meta.url);
const prefix = `pack-${result.benchmark}-`;
const store = !args.includes("--no-store");
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
