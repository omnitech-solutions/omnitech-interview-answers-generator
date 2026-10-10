// The arithmetic the context pack's evaluation reports with.
//
// PROBLEM: a bare count ("31 of 36") cannot say whether a change helped or a
// different question set would say the opposite. STRATEGY: every share comes
// with a Wilson interval, every mean with a bootstrap interval over the
// questions, and every comparison of two arms is PAIRED (the same questions
// scored twice): the questions gained and lost, and McNemar's exact p for
// them. COMPLEXITY: O(questions) each; the bootstrap is O(rounds x questions).
//
// Nothing here knows what a question or a record is.

export type Share = { right: number; of: number };
export type Interval = { low: number; high: number };

// [DOMAIN] The Wilson score interval at 95%: sound for a small count and for
// a share near 0 or 1, where "share plus or minus two standard errors" is not.
export function wilson({ right, of }: Share): Interval {
  if (of === 0) return { low: 0, high: 1 };
  const z = 1.959964;
  const share = right / of;
  const denominator = 1 + (z * z) / of;
  const centre = share + (z * z) / (2 * of);
  const spread =
    z * Math.sqrt((share * (1 - share)) / of + (z * z) / (4 * of * of));
  return {
    low: Math.max(0, (centre - spread) / denominator),
    high: Math.min(1, (centre + spread) / denominator),
  };
}

// The share of a binomial(n, 1/2) at or below k, summed exactly.
function binomialTail(k: number, n: number): number {
  let term = 0.5 ** n;
  let sum = term;
  for (let at = 0; at < k; at += 1) {
    term = (term * (n - at)) / (at + 1);
    sum += term;
  }
  return Math.min(1, sum);
}

// [DOMAIN] McNemar's exact test for a paired yes-or-no outcome: of the
// questions on which two arms disagree, how surprising is this split if
// neither arm were better? Two-sided. Questions both got right, or both got
// wrong, say nothing and are not counted.
export function mcnemar(gained: number, lost: number): number {
  const disagree = gained + lost;
  if (disagree === 0) return 1;
  return Math.min(1, 2 * binomialTail(Math.min(gained, lost), disagree));
}

export type Paired = {
  gained: string[];
  lost: string[];
  p: number;
};
// Two arms on the same questions: which were gained, which lost.
export function paired(
  before: ReadonlyMap<string, boolean>,
  after: ReadonlyMap<string, boolean>,
): Paired {
  const gained: string[] = [];
  const lost: string[] = [];
  for (const [id, was] of before) {
    const is = after.get(id);
    if (is === undefined || is === was) continue;
    (is ? gained : lost).push(id);
  }
  return { gained, lost, p: mcnemar(gained.length, lost.length) };
}

// A small seeded generator (mulberry32): the bootstrap gives the same interval
// run after run.
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export const mean = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

// [DOMAIN] A 95% interval for a mean score (MRR, nDCG) by resampling the
// questions with replacement: the percentile bootstrap.
export function bootstrap(
  values: readonly number[],
  rounds = 2000,
  seed = 20261010,
): Interval {
  if (values.length === 0) return { low: 0, high: 0 };
  const random = seeded(seed);
  const means: number[] = [];
  for (let round = 0; round < rounds; round += 1) {
    let sum = 0;
    for (let at = 0; at < values.length; at += 1)
      sum += values[Math.floor(random() * values.length)] ?? 0;
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return {
    low: means[Math.floor(rounds * 0.025)] ?? 0,
    high: means[Math.min(rounds - 1, Math.floor(rounds * 0.975))] ?? 0,
  };
}

// [DOMAIN] nDCG at k with graded relevance: a gain of 2^grade - 1 discounted
// by the logarithm of the place, over the best order the gold allows.
export function ndcg(
  grades: readonly number[],
  ideal: readonly number[],
  k = 10,
): number {
  const dcg = (list: readonly number[]) =>
    list
      .slice(0, k)
      .reduce(
        (sum, grade, at) => sum + (2 ** grade - 1) / Math.log2(at + 2),
        0,
      );
  const best = dcg([...ideal].sort((a, b) => b - a));
  return best === 0 ? 0 : dcg(grades) / best;
}

export function percentile(values: readonly number[], share: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0
  );
}

// Holm's step-down correction for several comparisons against one baseline.
export function holm(ps: readonly number[]): number[] {
  const order = ps.map((p, at) => ({ p, at })).sort((a, b) => a.p - b.p);
  const adjusted = new Array<number>(ps.length).fill(1);
  let running = 0;
  for (const [rank, { p, at }] of order.entries()) {
    running = Math.max(running, Math.min(1, p * (ps.length - rank)));
    adjusted[at] = running;
  }
  return adjusted;
}

export const pct = (share: Share): string =>
  share.of === 0 ? "n/a" : `${Math.round((share.right / share.of) * 100)}%`;
export const withInterval = (share: Share): string => {
  if (share.of === 0) return "0 of 0";
  const { low, high } = wilson(share);
  return `${share.right} of ${share.of} (${pct(share)}, ${Math.round(low * 100)} to ${Math.round(high * 100)})`;
};
