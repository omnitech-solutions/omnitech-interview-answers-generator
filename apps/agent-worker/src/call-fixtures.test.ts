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
  readTranscript,
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
  questions: { id: string; optional?: boolean; completeWhenSaid: string }[];
  quiet?: { id: string; said: string }[];
  budget: { actsOnPart: number; actsOnQuiet: number };
};
type Result = {
  failed: number;
  questions: {
    id: string;
    optional: boolean;
    answeredWhole: boolean;
    prematureActs: number;
  }[];
  quiet: { id: string; acts: number }[];
};

const kept = mkdtempSync(join(tmpdir(), "call-fixtures-"));
afterAll(() => rmSync(kept, { recursive: true, force: true }));

const timing = (name: string) =>
  new Promise<Result>((resolve, reject) => {
    const results = join(kept, name);
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
