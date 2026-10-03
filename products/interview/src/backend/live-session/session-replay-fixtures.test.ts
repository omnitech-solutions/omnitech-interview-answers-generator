// E-A1: the replay fixtures are synthetic and anonymised. This scan asserts
// they hold no real names, employers, contacts or compensation figures, and
// that any proper noun comes from the placeholder-only list. It runs over
// EVERY fixture set (recruiter screen, hazards, engineering manager, live
// coding), their phase names, the synthetic matrix and the preferences text.
import { candidateMatrixSchema } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  applyVerdict,
  coalesceSegments,
  deferredTopics,
  emptyTaskState,
  openTaskSummaries,
  type Segment,
} from "./core/index.js";
import { decideBaseline, isBackchannel, isFiller } from "./interview-policy.js";
import {
  ABSENT_FRAMEWORK,
  CANDIDATE_PREFERENCES,
  CANDIDATE_PREFERENCES_NONE,
  SYNTHETIC_MATRIX,
} from "./replay-fixture-matrix.js";
import {
  ALL_REPLAY_SETS,
  allReplayFixtureTexts,
} from "./replay-fixture-sets.js";
import { LIVE_CODING, LIVE_CODING_EXPECT } from "./replay-fixtures-coding.js";
import { HAZARD_FIXTURES } from "./replay-fixtures-hazards.js";
import { MANAGER_FIXTURE } from "./replay-fixtures-manager.js";
import {
  allFixtureTexts,
  FIXTURE_PLACEHOLDERS,
  FIXTURE_SOURCES,
  RECRUITER_SCREEN,
  type ReplayPhase,
} from "./session-replay-fixtures.js";

const MONEY_PATTERNS: readonly RegExp[] = [
  /[$€£¥]\s?\d/,
  /\b\d[\d,.]*\s?(k|K|m|M)\b/,
  /\b\d{1,3}(,\d{3})+\b/,
  /\b\d+\s?(usd|cad|eur|gbp|dollars?|euros?|pounds?|bucks)\b/i,
  /\b(salary|base pay|per (year|hour)|annually|a year)\b.*\d/i,
];
const CONTACT_PATTERNS: readonly RegExp[] = [
  /[\w.+-]+@[\w-]+\.[\w.]+/,
  /\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/,
  /https?:\/\//i,
  /\bwww\./i,
];
const REAL_EMPLOYERS = [
  "google",
  "amazon",
  "microsoft",
  "meta",
  "apple",
  "netflix",
  "shopify",
  "stripe",
  "uber",
  "airbnb",
  "salesforce",
  "oracle",
  "ibm",
  "linkedin",
  "twitter",
  "spotify",
  "atlassian",
  "deloitte",
  "accenture",
];

describe("synthetic replay fixtures", () => {
  // Every set: names, phases, segments, the synthetic matrix and preferences.
  const texts = allReplayFixtureTexts();

  it("scans every fixture set, the matrix and both preference variants", () => {
    expect(Object.keys(ALL_REPLAY_SETS).sort()).toEqual(
      [
        "recruiter-screen",
        ...Object.keys(HAZARD_FIXTURES),
        "engineering-manager",
        "live-coding",
      ].sort(),
    );
    for (const text of allFixtureTexts()) expect(texts).toContain(text);
    for (const set of Object.values(ALL_REPLAY_SETS))
      for (const phase of set.phases) {
        expect(texts).toContain(phase.name);
        for (const segment of phase.segments)
          expect(texts).toContain(segment.text);
      }
    expect(texts).toContain(CANDIDATE_PREFERENCES);
    expect(texts).toContain(CANDIDATE_PREFERENCES_NONE);
    expect(texts).toContain(SYNTHETIC_MATRIX.roles[0]?.company);
  });

  it("hold no currency amounts or compensation figures", () => {
    for (const text of texts)
      for (const pattern of MONEY_PATTERNS)
        expect({
          text,
          pattern: String(pattern),
          hit: pattern.test(text),
        }).toMatchObject({ hit: false });
  });

  it("scan patterns are not vacuous: they catch representative violations", () => {
    for (const bad of [
      "I was on $120 an hour",
      "around 150k base",
      "about 100,000 a year",
      "wanting 90 usd",
      "salary was 85",
    ])
      expect(MONEY_PATTERNS.some((pattern) => pattern.test(bad))).toBe(true);
    for (const bad of ["mail me at jo@example.org", "call 555-123-4567"])
      expect(CONTACT_PATTERNS.some((pattern) => pattern.test(bad))).toBe(true);
  });

  it("hold no contact details", () => {
    for (const text of texts)
      for (const pattern of CONTACT_PATTERNS)
        expect(pattern.test(text)).toBe(false);
  });

  it("name no real employer", () => {
    for (const text of texts) {
      const lower = text.toLowerCase();
      for (const employer of REAL_EMPLOYERS)
        expect(new RegExp(`\\b${employer}\\b`).test(lower)).toBe(false);
    }
  });

  it("use only placeholder proper nouns", () => {
    const allowed = new Set<string>([
      "I",
      ...[
        ...FIXTURE_PLACEHOLDERS.people,
        ...FIXTURE_PLACEHOLDERS.companies,
        ...FIXTURE_PLACEHOLDERS.technologies,
      ].flatMap((name) => name.split(" ")),
    ]);
    const unexpected: string[] = [];
    for (const text of texts) {
      // A capitalised word that does not start a sentence is a proper noun.
      for (const match of text.matchAll(/(?<![.!?]\s)(?<!^)\b[A-Z][a-z]+\b/g)) {
        if (!allowed.has(match[0])) unexpected.push(match[0]);
      }
    }
    expect(unexpected).toEqual([]);
  });

  it("proper-noun scan is not vacuous", () => {
    const bad = "We talked with Jordan about Initech";
    const found = [...bad.matchAll(/(?<![.!?]\s)(?<!^)\b[A-Z][a-z]+\b/g)].map(
      (m) => m[0],
    );
    expect(found).toEqual(["Jordan", "Initech"]);
  });

  it("carries the E-A1 structure of a recruiter screen", () => {
    const flat = RECRUITER_SCREEN.flatMap((phase) => phase.segments);
    expect(flat.some((s) => /^mm-hm$/.test(s.text))).toBe(true);
    expect(flat.some((s) => s.supersedes !== undefined)).toBe(true);
    expect(flat.some((s) => /part two/i.test(s.text))).toBe(true);
    expect(flat.some((s) => /circle back/i.test(s.text))).toBe(true);
    expect(flat.some((s) => s.text.split(" ").length > 40)).toBe(true);
    expect(flat.every((s) => s.endMs > s.startMs)).toBe(true);
  });
});

// ---- structure of every set -------------------------------------------------
const sets = Object.entries(ALL_REPLAY_SETS);
const flatten = (phases: readonly ReplayPhase[]) =>
  phases.flatMap((phase) => phase.segments);
const wordCount = (text: string) => text.split(/\s+/).length;

describe("every replay set is well formed", () => {
  it.each(sets)("%s: timed segments, increasing unique event ids", (_, set) => {
    const flat = flatten(set.phases);
    expect(flat.length).toBeGreaterThan(0);
    expect(flat.every((s) => s.endMs > s.startMs)).toBe(true);
    const ids = flat.map((s) => s.eventId);
    expect(new Set(ids).size).toBe(ids.length);
    // The recruiter screen is hand-written and reuses start times for its
    // correction; ids still increase in arrival order for every set.
    expect([...ids].sort()).toEqual(ids);
    for (const s of flat)
      if (s.supersedes !== undefined) expect(ids).toContain(s.supersedes);
    for (const phase of set.phases)
      expect(phase.segments.length).toBeGreaterThan(0);
  });

  it("event ids are not reused across sets", () => {
    const all = sets.flatMap(([, set]) =>
      flatten(set.phases).map((s) => s.eventId),
    );
    expect(all.length - new Set(all).size).toBe(0);
  });

  it("carries the named structure of each set", () => {
    const has = (name: string, test: (text: string) => boolean) =>
      flatten(ALL_REPLAY_SETS[name]?.phases ?? []).some((s) => test(s.text));
    // Backchannels and a monologue.
    expect(has("backchannel-and-monologue-only", (t) => isBackchannel(t))).toBe(
      true,
    );
    expect(
      has("backchannel-and-monologue-only", (t) => wordCount(t) > 40),
    ).toBe(true);
    // Supersedes: the ASR set has three corrections.
    const asr = flatten(
      ALL_REPLAY_SETS["asr-error-and-correction"]?.phases ?? [],
    );
    expect(asr.filter((s) => s.supersedes !== undefined)).toHaveLength(3);
    expect(has("asr-error-and-correction", (t) => /and PM audit/.test(t))).toBe(
      true,
    );
    expect(has("asr-error-and-correction", (t) => /\bcuba\b/.test(t))).toBe(
      true,
    );
    expect(has("asr-error-and-correction", (t) => /nest j s/.test(t))).toBe(
      true,
    );
    // Part two, circle back and put a pin.
    expect(
      has("compound-question-with-part-two", (t) => /part two/i.test(t)),
    ).toBe(true);
    expect(has("engineering-manager", (t) => /part two/i.test(t))).toBe(true);
    expect(has("deferred-topic", (t) => /put a pin/i.test(t))).toBe(true);
    expect(has("recruiter-screen", (t) => /circle back/i.test(t))).toBe(true);
    // Disfluency.
    expect(has("disfluency-heavy-answer", (t) => isFiller(t))).toBe(true);
    expect(
      has("disfluency-heavy-answer", (t) => /\buh\b.*\bum\b/i.test(t)),
    ).toBe(true);
    // Source labels are fixed (not verified identities).
    expect(Object.keys(FIXTURE_SOURCES)).toEqual(["interviewer", "candidate"]);
  });

  it("covers every engineering-manager theme", () => {
    const names = MANAGER_FIXTURE.phases.map((p) => p.name).join("|");
    for (const theme of [
      "mentoring",
      "code review",
      "technical direction",
      "security and scalability",
      "product managers",
      "hiring and performance",
      "conflict",
      "delivery under pressure",
      "document-database to PostgreSQL",
    ])
      expect(names).toContain(theme);
  });
});

// ---- the synthetic matrix and preferences -----------------------------------
describe("synthetic candidate matrix", () => {
  const json = JSON.stringify(SYNTHETIC_MATRIX);

  it("is valid against the candidate matrix schema with three roles", () => {
    expect(candidateMatrixSchema.safeParse(SYNTHETIC_MATRIX).success).toBe(
      true,
    );
    expect(SYNTHETIC_MATRIX.roles).toHaveLength(3);
    for (const role of SYNTHETIC_MATRIX.roles) {
      expect(role.period).toBeTruthy();
      expect(role.technologies?.length).toBeGreaterThan(0);
      expect(role.responsibilities?.length).toBeGreaterThan(0);
      expect(role.metrics?.length).toBeGreaterThan(0);
    }
    expect(
      SYNTHETIC_MATRIX.roles.some(
        (r) => (r.leadership_signals?.length ?? 0) > 0,
      ),
    ).toBe(true);
  });

  it("holds the migration story, mentoring and the stack, but not the 7a framework", () => {
    expect(json).toMatch(/document database to PostgreSQL/);
    expect(json).toMatch(/40% lower/);
    expect(json).toMatch(/Mentored (three )?junior developers/);
    for (const stack of ["TypeScript", "Node", "React"])
      expect(json).toContain(stack);
    expect(json.toLowerCase()).not.toContain(ABSENT_FRAMEWORK.toLowerCase());
  });

  it("anchors hazards 7a and 7b: the framework and the figure are absent from the matrix", () => {
    const h7a = flatten(
      HAZARD_FIXTURES["hazard-7a-unsupported-framework"]?.phases ?? [],
    );
    expect(
      h7a.some(
        (s) =>
          s.text.includes(ABSENT_FRAMEWORK) &&
          /two or three projects/.test(s.text),
      ),
    ).toBe(true);
    const h7b = flatten(
      HAZARD_FIXTURES["hazard-7b-unsupported-metric"]?.phases ?? [],
    );
    const spoken = h7b
      .filter((s) => s.role === "candidate")
      .map((s) => s.text)
      .join(" ");
    expect(spoken).toMatch(/70 percent/);
    expect(json).not.toMatch(/70/);
  });

  it("gives notice period and compensation as preferences without any figure", () => {
    expect(CANDIDATE_PREFERENCES).toMatch(/Notice period:/);
    expect(CANDIDATE_PREFERENCES).toMatch(/Compensation:/);
    expect(CANDIDATE_PREFERENCES).not.toMatch(/\d/);
    expect(CANDIDATE_PREFERENCES_NONE).toBe("");
  });
});

// ---- the baseline policy really produces each set's `expect` ----------------
type Replayed = {
  opened: number;
  revisions: number[];
  deferred: number;
  outcomeOf: (eventId: string) => string;
};

// Runs the real coalescing, the real baseline policy and the real task
// mechanics over a set. A correcting segment (supersedes) is applied after the
// original it corrects: it raises that utterance's task by one revision, which
// is what the processor replay (E-A2) shows with the full core.
function replay(phases: readonly ReplayPhase[]): Replayed {
  const flat = flatten(phases);
  const segments: Segment[] = flat
    .filter((s) => s.supersedes === undefined)
    .map((s, seq) => ({
      eventId: s.eventId,
      sourceId: FIXTURE_SOURCES[s.role].sourceId,
      speaker: FIXTURE_SOURCES[s.role].speaker,
      startMs: s.startMs,
      endMs: s.endMs,
      text: s.text,
      seq,
      supersededBy: null,
      originId: s.eventId,
    }));
  const utterances = coalesceSegments(
    segments,
    (segment) => isBackchannel(segment.text) || isFiller(segment.text),
  );
  let state = emptyTaskState();
  let counter = 0;
  const taskOfUtterance = new Map<string, string>();
  const outcomes = new Map<string, string>();
  for (const utterance of utterances) {
    const verdict = decideBaseline({
      utterance,
      openTasks: openTaskSummaries(state),
      deferredTopics: deferredTopics(state),
    });
    const step = applyVerdict(
      state,
      utterance,
      verdict.segmentClass,
      verdict.decision,
      { next: (prefix) => `${prefix}-${(counter += 1)}` },
    );
    state = step.state;
    for (const id of utterance.segmentIds) outcomes.set(id, step.outcome.kind);
    if (step.outcome.kind === "opened" || step.outcome.kind === "revised")
      taskOfUtterance.set(utterance.id, step.outcome.taskId);
  }
  const bump = new Map<string, number>();
  for (const correction of flat.filter((s) => s.supersedes !== undefined)) {
    const target = utterances.find((u) =>
      u.segmentIds.includes(correction.supersedes ?? ""),
    );
    const taskId = target ? taskOfUtterance.get(target.id) : undefined;
    if (taskId) bump.set(taskId, (bump.get(taskId) ?? 0) + 1);
  }
  const tasks = Object.values(state.tasks);
  return {
    opened: tasks.length,
    revisions: tasks.map((t) => t.revision + (bump.get(t.taskId) ?? 0)),
    deferred: deferredTopics(state).length,
    outcomeOf: (eventId) => outcomes.get(eventId) ?? "missing",
  };
}

describe("fixture expectations are what the baseline policy produces", () => {
  const expected = [
    ...Object.entries(HAZARD_FIXTURES),
    ["engineering-manager", MANAGER_FIXTURE] as const,
    ["live-coding", LIVE_CODING] as const,
  ];

  it.each(expected)("%s", (_, set) => {
    const result = replay(set.phases);
    expect(result.opened).toBe(set.expect.opensTasks);
    expect(result.revisions).toEqual(set.expect.revisions);
    expect(result.deferred).toBe(set.expect.deferredTopics);
    for (const id of set.expect.inertEventIds)
      expect({ id, outcome: result.outcomeOf(id) }).toEqual({
        id,
        outcome: "ignored",
      });
    if (set.expect.hazardEventId !== undefined)
      expect(flatten(set.phases).map((s) => s.eventId)).toContain(
        set.expect.hazardEventId,
      );
    expect(set.expect.description.length).toBeGreaterThan(10);
  });

  it("the live-coding expectation matches the replayed revisions", () => {
    const result = replay(LIVE_CODING.phases);
    expect(LIVE_CODING_EXPECT.taskCount).toBe(result.opened);
    expect(LIVE_CODING_EXPECT.finalRevision).toBe(result.revisions[0]);
    expect(LIVE_CODING_EXPECT.finalRevision).toBeGreaterThanOrEqual(3);
    expect(LIVE_CODING_EXPECT.revisions.map((r) => r.revision)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(
      LIVE_CODING_EXPECT.revisions.filter((r) => r.invalidatesEarlierSolution),
    ).toHaveLength(1);
    for (const r of LIVE_CODING_EXPECT.revisions)
      expect(r.constraints.length).toBeGreaterThan(0);
    // The invalidating change is the interviewer's "instead" line.
    expect(
      flatten(LIVE_CODING.phases).some((s) => /^Instead,/.test(s.text)),
    ).toBe(true);
  });

  it("hazard sets carry the 7a to 7d labels once each", () => {
    const labels = Object.values(HAZARD_FIXTURES)
      .map((s) => s.expect.hazard)
      .filter(Boolean);
    expect(labels.sort()).toEqual(["7a", "7b", "7c", "7d"]);
  });
});
