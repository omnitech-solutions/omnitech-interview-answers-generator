import { expect, it } from "vitest";
import { answerIntent, controlsFrom, readsJsonPatch } from "./playground-patch";

it("reads a JSON patch from --file, or from a pipe when no option names a control", () => {
  expect(readsJsonPatch({ file: "patch.json", question: "Q" }, true)).toBe(
    true,
  );
  expect(readsJsonPatch({}, false)).toBe(true);
  expect(readsJsonPatch({ quiet: true }, false)).toBe(true);
  expect(readsJsonPatch({}, true)).toBe(false);
  expect(readsJsonPatch({ notes: "" }, false)).toBe(false);
  expect(readsJsonPatch({ clearAnswer: true }, false)).toBe(false);
  expect(readsJsonPatch({ clearAnswer: false }, false)).toBe(true);
  expect(readsJsonPatch({ codeFile: "a.ts" }, false)).toBe(false);
});

it("sets only the controls an option named", () => {
  expect(controlsFrom({})).toEqual({});
  expect(
    controlsFrom({ question: "Q", notes: "", view: "playground", title: "T" }),
  ).toEqual({ question: "Q", notes: "", view: "playground" });
});

it("keeps, clears or replaces the answer whole", () => {
  expect(answerIntent({ question: "Q" })).toEqual({ kind: "keep" });
  expect(answerIntent({ clearAnswer: true })).toEqual({ kind: "clear" });
  expect(() => answerIntent({ clearAnswer: true, title: "T" })).toThrow(
    "--clear-answer cannot be combined with answer field options.",
  );
  const complete = {
    title: "Two Sum",
    guideFile: "guide.json",
    codeFile: "solution.ts",
    language: "typescript",
  };
  expect(answerIntent(complete)).toEqual({ kind: "replace", ...complete });
  expect(answerIntent({ ...complete, testCodeFile: "t.ts" })).toEqual({
    kind: "replace",
    ...complete,
    testCodeFile: "t.ts",
  });
  for (const partial of [
    { ...complete, language: "auto" },
    { title: "T", guideFile: "g.json", codeFile: "c.ts" },
    { ...complete, title: "" },
    { usageCodeFile: "usage.ts" },
  ])
    expect(() => answerIntent(partial)).toThrow(
      "An answer requires --title, --guide-file, --code-file, and a non-auto --language.",
    );
});
