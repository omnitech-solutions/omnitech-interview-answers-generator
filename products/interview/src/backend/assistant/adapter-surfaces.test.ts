import { describe, expect, it } from "vitest";
import { describeChanges, pickSurfaces } from "./adapter.js";

type Draft = Parameters<typeof describeChanges>[0];
type Patch = Parameters<typeof describeChanges>[1];

const answer = {
  title: "Two sum",
  language: "typescript",
  answerMarkdown: "Use a map.",
  code: "const a = 1;",
  usageCode: "console.log(a);",
  testCode: "",
} as NonNullable<Draft["answer"]>;
const current = { question: "Find two", notes: "", answer } as Draft;
const claims = [{ field: "answerMarkdown" }] as unknown as Patch["claims"];

describe("describeChanges", () => {
  it("lists only the changed surfaces, in surface order", () => {
    const changes = describeChanges(current, {
      notes: "Mention hashing.",
      question: "Find two numbers",
      answer: { ...answer, code: "const a = 1;\nconst b = 2;", testCode: "t" },
    } as Patch);
    expect(changes.map((change) => change.id)).toEqual([
      "question",
      "code",
      "testCode",
      "notes",
    ]);
    expect(changes.find((c) => c.id === "code")).toMatchObject({
      language: "typescript",
      description: "Change and add 1 line",
    });
    expect(changes.find((c) => c.id === "testCode")?.description).toBe(
      "Add 1 line",
    );
    expect(changes.find((c) => c.id === "notes")?.language).toBe("markdown");
    expect(changes.find((c) => c.id === "question")).not.toHaveProperty(
      "language",
    );
  });

  it("describes in-place edits, plural additions and prose languages", () => {
    const changes = describeChanges({ ...current, answer: null }, {
      answer: { ...answer, usageCode: "a\nb" },
    } as Patch);
    expect(changes.find((c) => c.id === "title")?.language).toBe("text");
    expect(changes.find((c) => c.id === "answerMarkdown")?.language).toBe(
      "markdown",
    );
    expect(changes.find((c) => c.id === "usageCode")?.description).toBe(
      "Add 2 lines",
    );
    const inPlace = describeChanges(current, {
      answer: { ...answer, code: "const a = 2;", usageCode: "x\ny\nz" },
    } as Patch);
    expect(inPlace.find((c) => c.id === "code")?.description).toBe(
      "Change in place",
    );
    expect(inPlace.find((c) => c.id === "usageCode")?.description).toBe(
      "Change and add 2 lines",
    );
  });

  it("ignores fields the patch leaves as they are", () => {
    expect(
      describeChanges(current, {
        question: "Find two",
        notes: "",
        answer,
      } as Patch),
    ).toEqual([]);
  });
});

describe("pickSurfaces", () => {
  const patch = {
    question: "New question",
    notes: "New notes",
    answer: {
      ...answer,
      language: "php",
      code: "<?php echo 1;",
      answerMarkdown: "New prose.",
    },
    claims,
  } as Patch;

  it("merges only the picked answer fields into the current answer", () => {
    expect(pickSurfaces(patch, current, ["answerMarkdown"])).toEqual({
      answer: { ...answer, answerMarkdown: "New prose." },
      claims,
    });
    // The language travels with the code.
    expect(pickSurfaces(patch, current, ["code"])).toEqual({
      answer: { ...answer, code: "<?php echo 1;", language: "php" },
    });
  });

  it("takes question and notes on their own", () => {
    expect(pickSurfaces(patch, current, ["question", "notes"])).toEqual({
      question: "New question",
      notes: "New notes",
    });
  });

  it("takes the whole answer when there is none yet", () => {
    expect(pickSurfaces(patch, { ...current, answer: null }, ["code"])).toEqual(
      { answer: patch.answer },
    );
  });

  it("refuses an empty pick", () => {
    const invalid = expect.objectContaining({ code: "proposal-invalid" });
    expect(() => pickSurfaces(patch, current, [])).toThrow(invalid);
    expect(() =>
      pickSurfaces({ answer } as Patch, current, ["question"]),
    ).toThrow(invalid);
  });
});

describe("the guide as one reviewable surface", () => {
  const guide = {
    version: 1 as const,
    understand: {
      prompt: "Two sum.",
      examples: [],
      constraints: [],
      clarify: [],
    },
    plan: {
      steps: ["Hash seen values."],
      complexity: { time: "O(n)", space: "O(n)" },
    },
    edgeCases: [{ name: "No pair", test: "returns null" }],
    explain: [{ heading: "Idea", body: "One pass." }],
    talkingPoints: ["a", "b", "c"],
  };
  const guided = { ...current, answer: { ...answer, guide } } as Draft;
  const next = {
    ...guide,
    plan: { ...guide.plan, steps: ["Hash seen values.", "Return early."] },
  };
  const patch = {
    answer: { ...answer, guide: next, answerMarkdown: "rendered", code: "new" },
    claims,
  } as Patch;

  it("shows a guide change once, not again as its Markdown", () => {
    const changes = describeChanges(guided, patch);
    expect(changes.map((change) => change.id)).toEqual(["guide", "code"]);
    const change = changes.find((c) => c.id === "guide")!;
    expect(change.after).toContain("Step 2: Return early.");
    expect(change.language).toBe("text");
    // Removing a guide is a change too.
    expect(
      describeChanges(guided, { answer: { ...answer } } as Patch).map(
        (c) => c.id,
      ),
    ).toContain("guide");
  });

  it("takes the guide with its Markdown and claims, and leaves it when not picked", () => {
    expect(pickSurfaces(patch, guided, ["guide"])).toEqual({
      answer: { ...answer, guide: next, answerMarkdown: "rendered" },
      claims,
    });
    const codeOnly = pickSurfaces(patch, guided, ["code"]);
    expect(codeOnly.answer?.guide).toEqual(guide);
    expect(codeOnly.answer?.code).toBe("new");
    expect(codeOnly).not.toHaveProperty("claims");
    const removal = pickSurfaces({ answer: { ...answer } } as Patch, guided, [
      "guide",
    ]);
    expect(removal.answer).not.toHaveProperty("guide");
  });
});
