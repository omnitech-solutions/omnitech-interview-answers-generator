import { expect, it } from "vitest";
import { contractFormSchema } from "../shared/contract-form";
import {
  hintActions,
  rehearsalOptionSets,
  rehearsalSetupForm,
} from "./setup-config";

it("builds the form from the format contract and options from studio lists", () => {
  expect(rehearsalSetupForm.schema).toEqual(
    contractFormSchema(rehearsalSetupForm.contract),
  );
  expect(
    rehearsalSetupForm.contract.safeParse(rehearsalSetupForm.defaults).success,
  ).toBe(true);
  expect(
    rehearsalSetupForm.contract.safeParse({
      ...rehearsalSetupForm.defaults,
      format: "unknown",
    }).success,
  ).toBe(false);
  const options = rehearsalOptionSets({
    questions: [
      {
        artifactId: "q",
        title: "Solve",
        kind: "coding",
        language: null,
        updatedAt: "",
      },
    ],
    briefs: [],
    briefings: [],
    status: "ready",
    refresh() {},
  });
  expect(options.formats.map((item) => item.value)).toEqual([
    "full",
    "coding",
    "concept",
  ]);
  expect(options.concepts.length).toBeGreaterThan(0);
  expect(options.codings).toEqual([{ value: "question:q", label: "Solve" }]);
});
it("locks reference hints until complexity is stated and hides unavailable hints", () => {
  const solution = hintActions.find((item) => item.id === "solution")!;
  const context = {
    revealed: [],
    remaining: { solution: "code" },
    complexity: "",
  };
  expect(solution.available?.(context)).toBe(true);
  expect(solution.disabledReason?.(context)).toBe("State the complexity first");
  expect(
    solution.disabledReason?.({ ...context, complexity: "O(n)" }),
  ).toBeNull();
  expect(solution.available?.({ ...context, remaining: {} })).toBe(false);
  expect(
    solution.disabledReason?.({ ...context, revealed: ["solution"] }),
  ).toBe("Already revealed");
});
