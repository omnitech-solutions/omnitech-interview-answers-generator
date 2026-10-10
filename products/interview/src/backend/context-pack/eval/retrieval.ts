// The retrieval level of the context pack's evaluation: for every question,
// what each arm selects, scored against gold records.
//
// PROBLEM: "the right fact came first" on the questions the rules were tuned
// on says little. STRATEGY: the held-out questions carry gold RECORDS with
// grades, so the standard measures apply: right-first (Success@1), MRR,
// Recall@1/3/5, nDCG@10; beside them what this product must never do (hand a
// wrong employer's work over, leak a device-only source, read a stale
// requirement) and what it should do when nothing answers (give nothing).
// Every share has a Wilson interval, and two arms are compared question by
// question (McNemar's exact test).
// COMPLEXITY: arms x questions resolves; milliseconds each.
import type { ContextRecord } from "@omnitech/ai-engine";
import { CODE_ONLY_RECIPE, KINDS, type ProjectionId } from "../recipe";
import type { Arm, Chosen } from "./arms";
import {
  type Category,
  type EvalFixture,
  NOTHING,
  plain,
  type Question,
} from "./fixture";
import {
  bootstrap,
  type Interval,
  mean,
  ndcg,
  type Paired,
  paired,
  percentile,
  type Share,
  wilson,
} from "./stats";

// Bumped when a score's definition changes: a number is a number of THIS
// harness.
export const HARNESS_VERSION = "1";

export type Mark = {
  id: string;
  app: string;
  category: Category;
  // Whether the record that leads the question's own slot is a gold one.
  // null: the question has no gold record (its right result is nothing, or
  // it only asks that something be absent).
  first: boolean | null;
  // 1 / the place of the first gold record in that slot; 0 when not offered.
  rr: number | null;
  // The share of the gold records within the first k of their own slots.
  recall1: number | null;
  recall3: number | null;
  recall5: number | null;
  ndcg: number | null;
  // A wrong employer's achievement among the first three of evidence.
  wrongEmployer: boolean | null;
  // Nothing was offered that matched the question at all.
  nothing: boolean;
  // "Absent" phrases found in what was handed over.
  leaked: number;
  // The best score of anything offered, and of the best gold record offered.
  top: number;
  goldTop: number | null;
  records: number;
  chars: number;
  ms: number;
};

// "ranked": the projection resolved for the question, as the coach reads it.
// "coverage": the projection resolved with NO question, as a briefing and a
// document read theirs: the gold records are scored for being there at all.
export type Mode = "ranked" | "coverage";

const slotFor = (projection: ProjectionId, record: ContextRecord) =>
  (
    CODE_ONLY_RECIPE.projections.find((each) => each.id === projection)
      ?.slots ?? []
  ).find(
    (slot) =>
      slot.mode === "ranked" &&
      slot.kind === record.kind &&
      (slot.where ?? []).every(
        (condition) =>
          condition.op !== "equals" ||
          record.fields?.[condition.field] === condition.value,
      ),
  )?.id;

export function mark(
  question: Question,
  chosen: readonly Chosen[],
  records: ReadonlyMap<string, ContextRecord>,
  projection: ProjectionId,
  mode: Mode,
  ms: number,
  // Records that must not be handed over whatever they say: what was
  // prepared from a source as it was before its edit (the stale case).
  barred: ReadonlySet<string> = new Set(),
): Mark {
  const grade = new Map(question.gold.map((gold) => [gold.id, gold.grade]));
  // Whether the arm keeps the projection's slots (the pack and BM25 do;
  // "everything" has no order to score).
  const slotted = chosen.some((each) => each.slot !== "everything");
  const ranked = chosen.filter((each) => !each.exact);
  const inSlot = (slot: string | undefined) =>
    slotted ? ranked.filter((each) => each.slot === slot) : ranked;
  const placeOf = (id: string): number => {
    const record = records.get(id);
    const list = inSlot(record && slotFor(projection, record));
    return list.findIndex((each) => each.id === id);
  };
  const within = (k: number) =>
    question.gold.length === 0
      ? null
      : question.gold.filter((gold) => {
          const at = placeOf(gold.id);
          return at >= 0 && (mode === "coverage" || !slotted || at < k);
        }).length / question.gold.length;

  // The question's own slot: where its best gold record belongs.
  const best = [...question.gold].sort((a, b) => b.grade - a.grade)[0];
  const bestRecord = best && records.get(best.id);
  const own = inSlot(bestRecord && slotFor(projection, bestRecord));
  const firstGold = own.findIndex((each) => grade.has(each.id));
  const scorable = question.gold.length > 0 && slotted && mode === "ranked";

  const accepted = new Set(
    (question.employers ?? []).map((employer) => employer.toLowerCase()),
  );
  const company = (id: string) =>
    String(records.get(id)?.fields?.["company"] ?? "").toLowerCase();
  const leading = ranked
    .filter((each) => each.kind === KINDS.achievement)
    .slice(0, 3);
  const given = plain(chosen.map((each) => each.text).join("\n"));
  const goldScores = ranked
    .filter((each) => grade.has(each.id))
    .map((each) => each.score);
  return {
    id: question.id,
    app: question.app,
    category: question.category,
    first: scorable ? firstGold === 0 : null,
    rr: scorable ? (firstGold < 0 ? 0 : 1 / (firstGold + 1)) : null,
    recall1: within(1),
    recall3: within(3),
    recall5: within(5),
    ndcg: scorable
      ? ndcg(
          own.map((each) => grade.get(each.id) ?? 0),
          question.gold
            .filter((gold) => {
              const record = records.get(gold.id);
              return (
                record &&
                bestRecord &&
                slotFor(projection, record) === slotFor(projection, bestRecord)
              );
            })
            .map((gold) => gold.grade),
        )
      : null,
    wrongEmployer:
      accepted.size > 0 && slotted && mode === "ranked"
        ? leading.some((each) => !accepted.has(company(each.id)))
        : null,
    nothing: ranked.every((each) => each.score === 0),
    leaked:
      (question.absent ?? []).filter((phrase) => given.includes(plain(phrase)))
        .length + chosen.filter((each) => barred.has(each.id)).length,
    top: Math.max(0, ...ranked.map((each) => each.score)),
    goldTop: goldScores.length > 0 ? Math.max(...goldScores) : null,
    records: ranked.length,
    chars: chosen.reduce((sum, each) => sum + each.text.length, 0),
    ms,
  };
}

export type Totals = {
  questions: number;
  first: Share;
  mrr: { mean: number; interval: Interval };
  recall1: number;
  recall3: number;
  recall5: number;
  ndcg: { mean: number; interval: Interval };
  wrongEmployer: Share;
  // On the questions nothing answers: nothing was offered.
  abstained: Share;
  // On the questions something answers: nothing was offered (a false empty).
  falseEmpty: Share;
  // Device-only questions with none of their phrases handed over; and their
  // pairs, for the person's own screen, with the gold found.
  deviceOnlyKept: Share;
  devicePairFound: Share;
  staleKept: Share;
  // The lowest score that led a right selection, less the highest score
  // offered for a question nothing answers. Above zero: a threshold exists.
  separation: number | null;
  records: { median: number; p95: number };
  chars: { median: number; p95: number };
  ms: { p50: number; p95: number };
};
export type ArmScore = {
  arm: string;
  label: string;
  projection: ProjectionId;
  mode: Mode;
  totals: Totals;
  categories: Partial<
    Record<Category, { of: number; first: Share; recall3: number | null }>
  >;
  marks: Mark[];
};

const share = (values: readonly (boolean | null)[]): Share => ({
  right: values.filter((value) => value === true).length,
  of: values.filter((value) => value !== null).length,
});
const known = (values: readonly (number | null)[]): number[] =>
  values.filter((value): value is number => value !== null);

export function totalsOf(marks: readonly Mark[]): Totals {
  const answerable = marks.filter((each) => !NOTHING.has(each.category));
  const nothing = marks.filter((each) => NOTHING.has(each.category));
  const rightTops = answerable
    .filter((each) => each.first === true)
    .map((each) => each.goldTop ?? each.top);
  const wrongTops = nothing.map((each) => each.top);
  const rr = known(marks.map((each) => each.rr));
  const gains = known(marks.map((each) => each.ndcg));
  const of = (category: Category) =>
    marks.filter((each) => each.category === category);
  return {
    questions: marks.length,
    first: share(marks.map((each) => each.first)),
    mrr: { mean: mean(rr), interval: bootstrap(rr) },
    recall1: mean(known(marks.map((each) => each.recall1))),
    recall3: mean(known(marks.map((each) => each.recall3))),
    recall5: mean(known(marks.map((each) => each.recall5))),
    ndcg: { mean: mean(gains), interval: bootstrap(gains) },
    wrongEmployer: share(marks.map((each) => each.wrongEmployer)),
    abstained: share(nothing.map((each) => each.nothing)),
    falseEmpty: share(
      answerable
        .filter((each) => each.first !== null)
        .map((each) => each.nothing),
    ),
    deviceOnlyKept: share(of("device-only").map((each) => each.leaked === 0)),
    devicePairFound: share(
      of("device-only-paired").map((each) =>
        each.recall5 === null ? null : each.recall5 > 0,
      ),
    ),
    staleKept: share(of("stale").map((each) => each.leaked === 0)),
    separation:
      rightTops.length > 0 && wrongTops.length > 0
        ? Math.min(...rightTops) - Math.max(...wrongTops)
        : null,
    records: {
      median: percentile(
        marks.map((each) => each.records),
        0.5,
      ),
      p95: percentile(
        marks.map((each) => each.records),
        0.95,
      ),
    },
    chars: {
      median: percentile(
        marks.map((each) => each.chars),
        0.5,
      ),
      p95: percentile(
        marks.map((each) => each.chars),
        0.95,
      ),
    },
    ms: {
      p50: percentile(
        marks.map((each) => each.ms),
        0.5,
      ),
      p95: percentile(
        marks.map((each) => each.ms),
        0.95,
      ),
    },
  };
}

export async function scoreArm(
  arm: Arm,
  fixtures: ReadonlyMap<string, EvalFixture>,
  questions: readonly Question[],
  projection: ProjectionId,
  mode: Mode = "ranked",
): Promise<ArmScore> {
  const marks: Mark[] = [];
  for (const question of questions) {
    const fixture = fixtures.get(question.app);
    if (!fixture) throw new Error(`No fixture ${question.app}.`);
    const pack = await arm.pack(fixture, question);
    const records = new Map(
      pack.prepared.records.map((record) => [record.id, record]),
    );
    const asked =
      mode === "coverage"
        ? { ...question, question: "", previous: "" }
        : question;
    const { chosen, ms } = await arm.select(fixture, asked, projection);
    // [DOMAIN] After the posting is edited, what a model read from the OLD
    // posting is stale: none of it may be handed over until the pack is
    // prepared again. (The employer brief may still say the old requirement:
    // it is the person's own material as it stands, and is not judged here.)
    const barred =
      question.variant === "stale"
        ? new Set(
            (fixture.kept?.records ?? [])
              .filter(
                (record) =>
                  record.by === "model" &&
                  record.source.id.startsWith("posting:"),
              )
              .map((record) => record.id),
          )
        : undefined;
    marks.push(mark(question, chosen, records, projection, mode, ms, barred));
  }
  const categories: ArmScore["categories"] = {};
  for (const each of marks) {
    const held = categories[each.category] ?? {
      of: 0,
      first: { right: 0, of: 0 },
      recall3: null,
    };
    held.of += 1;
    if (each.first !== null) {
      held.first.of += 1;
      if (each.first) held.first.right += 1;
    }
    categories[each.category] = held;
  }
  for (const category of Object.keys(categories) as Category[]) {
    const recalls = known(
      marks
        .filter((each) => each.category === category)
        .map((each) => each.recall3),
    );
    const held = categories[category];
    if (held) held.recall3 = recalls.length > 0 ? mean(recalls) : null;
  }
  return {
    arm: arm.id,
    label: arm.label,
    projection,
    mode,
    totals: totalsOf(marks),
    categories,
    marks,
  };
}

// Two arms on the same questions: what was gained and what was lost.
export function compare(before: ArmScore, after: ArmScore): Paired {
  const firsts = (score: ArmScore) =>
    new Map(
      score.marks.flatMap((each) =>
        each.first === null ? [] : [[each.id, each.first] as const],
      ),
    );
  return paired(firsts(before), firsts(after));
}

// ---- The gate ---------------------------------------------------------------

export type Thresholds = {
  // The least share of right-first, as a count's lower bound is not used: the
  // gate is a floor under the measured value, to catch a regression.
  first: number;
  recall3: number;
  // The most questions with a wrong employer in the first three.
  wrongEmployer: number;
};
export type Failure = { metric: string; said: string };
// [GUARD] What must hold for any selector that ships. The three safety counts
// are absolute: one leak fails.
export function gate(score: ArmScore, thresholds: Thresholds): Failure[] {
  const { totals } = score;
  const failures: Failure[] = [];
  const fail = (metric: string, said: string) =>
    failures.push({ metric, said });
  const firstShare = totals.first.of ? totals.first.right / totals.first.of : 0;
  if (firstShare < thresholds.first)
    fail("right-first", `${firstShare.toFixed(3)} < ${thresholds.first}`);
  if (totals.recall3 < thresholds.recall3)
    fail("recall@3", `${totals.recall3.toFixed(3)} < ${thresholds.recall3}`);
  const wrong = totals.wrongEmployer.of
    ? totals.wrongEmployer.right / totals.wrongEmployer.of
    : 0;
  if (wrong > thresholds.wrongEmployer)
    fail("wrong-employer", `${wrong.toFixed(3)} > ${thresholds.wrongEmployer}`);
  if (totals.deviceOnlyKept.right < totals.deviceOnlyKept.of)
    fail(
      "device-only",
      `${totals.deviceOnlyKept.of - totals.deviceOnlyKept.right} question(s) leaked a device-only source to a remote reader`,
    );
  if (totals.devicePairFound.of > 0 && totals.devicePairFound.right === 0)
    fail("device-pair", "the person's own screen is given none of it either");
  if (totals.staleKept.right < totals.staleKept.of)
    fail(
      "stale",
      `${totals.staleKept.of - totals.staleKept.right} question(s) read a source as it was before its edit`,
    );
  return failures;
}

// ---- The report -------------------------------------------------------------

const ofShare = (value: Share): string => {
  if (value.of === 0) return "n/a";
  const { low, high } = wilson(value);
  return `${value.right}/${value.of} ${Math.round((value.right / value.of) * 100)}% [${Math.round(low * 100)}-${Math.round(high * 100)}]`;
};
const three = (value: number) => value.toFixed(3);

export function reportRetrieval(
  scores: readonly ArmScore[],
  baseline?: string,
): string {
  const lines: string[] = [];
  const projections = [...new Set(scores.map((each) => each.projection))];
  for (const projection of projections) {
    const of = scores.filter((each) => each.projection === projection);
    const base = of.find((each) => each.arm === baseline);
    lines.push(
      "",
      `## ${projection} (${of[0]?.mode === "coverage" ? "no question: what the reader is given" : "resolved for each question"}; ${of[0]?.totals.questions ?? 0} questions)`,
      "",
      "| Arm | Right first | MRR | R@1 | R@3 | R@5 | nDCG@10 | Wrong employer in 3 | Gives nothing when nothing answers | False empty | Device-only kept | Pair found | Stale kept | Separation | Records | Chars (median, p95) | ms (p50, p95) | vs baseline |",
      "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    );
    for (const score of of) {
      const { totals } = score;
      const versus =
        base && base !== score
          ? (() => {
              const { gained, lost, p } = compare(base, score);
              return `+${gained.length} -${lost.length}, p=${p.toFixed(3)}`;
            })()
          : "";
      lines.push(
        `| ${score.label} | ${ofShare(totals.first)} | ${three(totals.mrr.mean)} [${three(totals.mrr.interval.low)}-${three(totals.mrr.interval.high)}] | ${three(totals.recall1)} | ${three(totals.recall3)} | ${three(totals.recall5)} | ${three(totals.ndcg.mean)} | ${ofShare(totals.wrongEmployer)} | ${ofShare(totals.abstained)} | ${ofShare(totals.falseEmpty)} | ${ofShare(totals.deviceOnlyKept)} | ${ofShare(totals.devicePairFound)} | ${ofShare(totals.staleKept)} | ${totals.separation === null ? "n/a" : totals.separation.toFixed(2)} | ${totals.records.median} | ${totals.chars.median}, ${totals.chars.p95} | ${totals.ms.p50.toFixed(1)}, ${totals.ms.p95.toFixed(1)} | ${versus} |`,
      );
    }
  }
  return lines.join("\n");
}

export function reportCategories(scores: readonly ArmScore[]): string {
  const categories = [
    ...new Set(scores.flatMap((each) => Object.keys(each.categories))),
  ] as Category[];
  const lines = [
    `| Category (right first; counts, not rates) | ${scores.map((each) => each.arm).join(" | ")} |`,
    `|---|${scores.map(() => "---").join("|")}|`,
  ];
  for (const category of categories)
    lines.push(
      `| ${category} | ${scores
        .map((score) => {
          const held = score.categories[category];
          return held
            ? held.first.of > 0
              ? `${held.first.right}/${held.first.of}`
              : `(${held.of})`
            : "";
        })
        .join(" | ")} |`,
    );
  return lines.join("\n");
}
