// The call fixtures (fixtures/calls/): each is well formed, a scripted one's
// transcript is what its script makes, and the coach's decisions on it, with
// no model, stay within what the fixture expects. The live runs, with a model
// writing notes, are the `pnpm coach:bench:*` commands.
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  castBlocks,
  readTranscript,
  rosterOf,
  speakersOf,
} from "@omnitech/product-interview/session-worker";
import { afterAll, describe, expect, it } from "vitest";
import { type CallScript, transcriptOf, utterancesOf } from "./call-script";

const WORKER = fileURLToPath(new URL("..", import.meta.url));
const CALLS = join(WORKER, "fixtures", "calls");
const names = readdirSync(CALLS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

type Expected = {
  interviewer: string[];
  me: string[];
  questions: {
    id: string;
    optional?: boolean;
    completeWhenSaid: string;
    // In a panel: the interviewer who asks it.
    from?: string;
  }[];
  quiet?: { id: string; said: string }[];
  budget: { actsOnPart: number; actsOnQuiet: number };
};
type Result = {
  benchmark: string;
  failed: number;
  // Whether the coach was told which interviewer spoke each line.
  names: boolean;
  askers: { of: number; right: number; wrong: number; unnamed: number };
  questions: {
    id: string;
    optional: boolean;
    askedBy: string | null;
    notedFrom: string | null;
    answeredWhole: boolean;
    prematureActs: number;
    toActS: number | null;
  }[];
  quiet: { id: string; acts: number }[];
};

const kept = mkdtempSync(join(tmpdir(), "call-fixtures-"));
afterAll(() => rmSync(kept, { recursive: true, force: true }));

const timing = (name: string, ...flags: string[]) =>
  new Promise<Result>((resolve, reject) => {
    const results = join(kept, [name, ...flags].join(""));
    execFile(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/coach-replay.ts",
        "--bench",
        name,
        "--timing",
        "--results",
        results,
        ...flags,
      ],
      { cwd: WORKER, timeout: 50_000 },
      (error, _stdout, stderr) => {
        if (error) return reject(new Error(`${error.message}\n${stderr}`));
        const file = readdirSync(results)[0] as string;
        resolve(JSON.parse(readFileSync(join(results, file), "utf8")));
      },
    );
  });

it("there are fixtures, and the panel is among them", () => {
  expect(names).toContain("screening-services");
  expect(names).toContain("panel-round");
});

describe.each(names)("call fixture %s", (name) => {
  const at = (part: string) => join(CALLS, name, part);
  const source = readFileSync(at("transcript.txt"), "utf8");
  const expected = JSON.parse(
    readFileSync(at("expected.json"), "utf8"),
  ) as Expected;
  const blocks = readTranscript(source);

  it("names a part for everyone the recorder named, and one person coached", () => {
    const cast = new Set([...expected.interviewer, ...expected.me]);
    const labels = speakersOf(blocks)
      .map((each) => each.label)
      .filter((label) => label !== "Unknown");
    expect(labels.filter((label) => !cast.has(label))).toEqual([]);
    expect([...cast].filter((label) => !labels.includes(label))).toEqual([]);
    expect(expected.me).toHaveLength(1);
    expect(expected.interviewer.length).toBeGreaterThanOrEqual(1);
    expect(expected.interviewer.length).toBeLessThanOrEqual(5);
  });

  it("holds every question and every quiet stretch it expects, said by an interviewer, in order", () => {
    const theirs = blocks.filter((block) =>
      expected.interviewer.includes(block.label),
    );
    const where = (phrase: string) =>
      theirs.findIndex((block) =>
        block.text.toLowerCase().includes(phrase.toLowerCase()),
      );
    const asked = expected.questions.map((question) =>
      where(question.completeWhenSaid),
    );
    expect(asked.every((index) => index >= 0)).toBe(true);
    expect(asked).toEqual([...asked].sort((a, b) => a - b));
    expect(new Set(expected.questions.map((q) => q.id)).size).toBe(
      expected.questions.length,
    );
    for (const stretch of expected.quiet ?? [])
      expect(where(stretch.said), stretch.id).toBeGreaterThanOrEqual(0);
  });

  it("says who asks each question when there is more than one interviewer, and nobody when there is one", () => {
    const panel = expected.interviewer.length > 1;
    for (const question of expected.questions) {
      if (!panel) {
        expect(question.from, question.id).toBeUndefined();
        continue;
      }
      expect(expected.interviewer, question.id).toContain(question.from);
      // The words that complete the question are said by that person.
      const completes = blocks.find(
        (block) =>
          expected.interviewer.includes(block.label) &&
          block.text
            .toLowerCase()
            .includes(question.completeWhenSaid.toLowerCase()),
      );
      expect(completes?.label, question.id).toBe(question.from);
    }
  });

  it("gives the coach each interviewer's name in a panel, and no name at all with one interviewer", () => {
    const cast = Object.fromEntries([
      ...expected.interviewer.map((label) => [label, "interviewer"] as const),
      ...expected.me.map((label) => [label, "me"] as const),
    ]);
    const heard = castBlocks(blocks, cast);
    const named = [
      ...new Set(heard.flatMap((each) => (each.name ? [each.name] : []))),
    ];
    if (expected.interviewer.length > 1) {
      expect(named.sort()).toEqual([...expected.interviewer].sort());
      expect(
        heard.every(
          (each) =>
            (each.speaker === "interviewer") === (each.name !== undefined),
        ),
      ).toBe(true);
    } else expect(named).toEqual([]);
    expect(
      castBlocks(blocks, cast, { names: false }).some((each) => "name" in each),
    ).toBe(false);
  });

  it.runIf(existsSync(at("plan.md")))(
    "has a plan whose roster is the fixture's interviewers when it is a panel, and none otherwise",
    () => {
      const roster = rosterOf(readFileSync(at("plan.md"), "utf8"));
      if (expected.interviewer.length > 1) {
        expect(roster.map((panelist) => panelist.name)).toEqual(
          expected.interviewer,
        );
        // Each is said to judge something: that is what an answer is aimed at.
        expect(roster.every((panelist) => panelist.judges)).toBe(true);
      } else expect(roster).toEqual([]);
    },
  );

  it.runIf(existsSync(at("script.json")))(
    "has the transcript its script makes (pnpm coach:fixture on drift)",
    () => {
      const script = JSON.parse(
        readFileSync(at("script.json"), "utf8"),
      ) as CallScript;
      const opening = script.opening
        ? readFileSync(at(script.opening.file), "utf8")
        : "";
      expect(source).toBe(transcriptOf(script, opening));
      // Everyone scripted has a part, and the parts are the fixture's.
      const said = utterancesOf(script);
      expect(
        [...new Set(said.map((each) => each.who))].filter(
          (who) => !(who in script.people),
        ),
      ).toEqual([]);
      expect(
        Object.entries(script.people)
          .filter(([, person]) => person.part === "me")
          .map(([who]) => who),
      ).toEqual(expected.me);
      // No piece ends before it begins, and a piece is heard when it ends.
      expect(said.every((each) => each.endMs > each.startMs)).toBe(true);
      expect(said.map((each) => each.endMs)).toEqual(
        said.map((each) => each.endMs).sort((a, b) => a - b),
      );
    },
  );

  it("is acted on question by question, within its budget of early and wasted acts", async () => {
    const result = await timing(name);
    expect(result.failed).toBe(0);
    expect(
      result.questions
        .filter((question) => !question.optional && !question.answeredWhole)
        .map((question) => question.id),
    ).toEqual([]);
    expect(
      result.questions.reduce((sum, each) => sum + each.prematureActs, 0),
    ).toBeLessThanOrEqual(expected.budget.actsOnPart);
    expect(
      result.quiet.reduce((sum, each) => sum + each.acts, 0),
    ).toBeLessThanOrEqual(expected.budget.actsOnQuiet);
  }, 60_000);
});

// [DOMAIN] A panel replayed with nobody named is how it is heard live: one
// stream of call audio. When the coach acts must not depend on the names.
it("the panel round, replayed with nobody named, is acted on exactly as it is with names, as a benchmark of its own", async () => {
  const [named, unnamed] = await Promise.all([
    timing("panel-round", "--retain"),
    timing("panel-round", "--no-names"),
  ]);
  expect(named.benchmark).toBe("panel-round");
  expect(named.names).toBe(true);
  expect(unnamed.benchmark).toBe("panel-round-unnamed");
  expect(unnamed.names).toBe(false);
  const decisions = (result: Result) =>
    result.questions.map(({ id, answeredWhole, prematureActs, toActS }) => ({
      id,
      answeredWhole,
      prematureActs,
      toActS,
    }));
  expect(decisions(unnamed)).toEqual(decisions(named));
  expect(unnamed.quiet).toEqual(named.quiet);
  expect(unnamed.failed).toBe(0);
  // Who asked is in the result; who a note named is scored only when a model
  // wrote notes, which no test does.
  expect(named.questions.map((question) => question.askedBy)).toEqual([
    "Priya",
    "Priya",
    "Marcus",
    "Tom",
    "Tom",
    "Marcus",
    "Elena",
    "Tom",
    "Elena",
    "Marcus",
    "Marcus",
    "Priya",
    "Aisha",
    "Aisha",
    "Priya",
  ]);
  expect(named.questions.every((question) => question.notedFrom === null)).toBe(
    true,
  );
  for (const result of [named, unnamed])
    expect(result.askers).toEqual({ of: 0, right: 0, wrong: 0, unnamed: 0 });
}, 60_000);

it("the two-person call names nobody: its result says so", async () => {
  const result = await timing("screening-services", "--no-activity");
  expect(result.names).toBe(false);
  expect(result.benchmark).toBe("screening-services");
  expect(result.questions.map((question) => question.askedBy)).toEqual([
    null,
    null,
  ]);
}, 60_000);

it("the panel round is ten minutes of five interviewers and one candidate", () => {
  const blocks = readTranscript(
    readFileSync(join(CALLS, "panel-round", "transcript.txt"), "utf8"),
  );
  const minutes =
    ((blocks.at(-1)?.endMs ?? 0) - (blocks[0]?.startMs ?? 0)) / 60_000;
  expect(minutes).toBeGreaterThan(9.5);
  expect(minutes).toBeLessThan(10.5);
  const expected = JSON.parse(
    readFileSync(join(CALLS, "panel-round", "expected.json"), "utf8"),
  ) as Expected;
  expect(expected.interviewer).toHaveLength(5);
});
