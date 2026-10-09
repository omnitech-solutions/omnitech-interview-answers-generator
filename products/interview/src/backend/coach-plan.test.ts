// The plan for a call, kept in one file: what is set is what is read, here
// and by a new instance over the same file; it holds a page at most; and a
// file that cannot be written still leaves the plan held for this process.
// Every file is under a temporary directory, never the data directory.
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { COACH_PLAN_LENGTH, createCoachPlan } from "./coach-plan";

const directory = mkdtempSync(join(tmpdir(), "coach-plan-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
let made = 0;
const fresh = () => {
  made += 1;
  return join(directory, `plan-${made}`, "coach-plan.md");
};
const PLAN = "mode: system-design\nLand the ledger migration story.";

describe("the plan for a call", () => {
  it("is empty until one is set, and reading it writes nothing", () => {
    const file = fresh();
    expect(createCoachPlan(file).get()).toEqual({ text: "" });
    expect(existsSync(file)).toBe(false);
  });

  it("is what was last set, answered by set and by get", () => {
    const plan = createCoachPlan(fresh());
    expect(plan.set(PLAN)).toEqual({ text: PLAN });
    expect(plan.get()).toEqual({ text: PLAN });
    expect(plan.set("Ask about on-call.")).toEqual({
      text: "Ask about on-call.",
    });
    expect(plan.get()).toEqual({ text: "Ask about on-call." });
  });

  it("is written to its file as it is, in a folder made for it, and nothing else is left beside it", () => {
    const file = fresh();
    createCoachPlan(file).set(PLAN);
    expect(readFileSync(file, "utf8")).toBe(PLAN);
    expect(readdirSync(join(file, ".."))).toEqual(["coach-plan.md"]);
  });

  it("survives a new instance reading the file", () => {
    const file = fresh();
    createCoachPlan(file).set(PLAN);
    expect(createCoachPlan(file).get()).toEqual({ text: PLAN });
  });

  it("is cleared by setting nothing, here and for a new instance", () => {
    const file = fresh();
    const plan = createCoachPlan(file);
    plan.set(PLAN);
    expect(plan.set("")).toEqual({ text: "" });
    expect(createCoachPlan(file).get()).toEqual({ text: "" });
  });

  it("holds a page at most: a longer plan is cut to it, set or read from a file", () => {
    expect(COACH_PLAN_LENGTH).toBe(8_000);
    const file = fresh();
    const plan = createCoachPlan(file);
    expect(plan.set("a".repeat(8_000)).text).toHaveLength(8_000);
    const long = `${"b".repeat(8_000)}surplus`;
    expect(plan.set(long)).toEqual({ text: "b".repeat(8_000) });
    expect(readFileSync(file, "utf8")).toBe("b".repeat(8_000));
    // A file somebody made longer by hand is read to the same length.
    writeFileSync(file, long);
    expect(createCoachPlan(file).get()).toEqual({ text: "b".repeat(8_000) });
  });

  it("reads its file once: an instance holds what it read or was given", () => {
    const file = fresh();
    const plan = createCoachPlan(file);
    plan.set(PLAN);
    writeFileSync(file, "changed on disk");
    expect(plan.get()).toEqual({ text: PLAN });
  });

  it("still holds the plan in memory when its file cannot be written", () => {
    // The folder it wants is a file, so nothing can be made under it.
    const blocker = join(directory, "not-a-folder");
    writeFileSync(blocker, "in the way");
    const file = join(blocker, "coach-plan.md");
    const plan = createCoachPlan(file);
    expect(plan.get()).toEqual({ text: "" });
    expect(() => plan.set(PLAN)).not.toThrow();
    expect(plan.set(PLAN)).toEqual({ text: PLAN });
    expect(plan.get()).toEqual({ text: PLAN });
    expect(readFileSync(blocker, "utf8")).toBe("in the way");
    // It was held by that process only.
    expect(createCoachPlan(file).get()).toEqual({ text: "" });
  });
});
