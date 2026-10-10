import { expect, it } from "vitest";
import { contractFormSchema } from "../../shared/contract-form";
import {
  behaviouralSetupForm,
  matrixColumns,
  matrixImportForm,
  packActions,
  suggestedFor,
} from "./config";

it("uses the context contract, stage data, and matrix import contract", () => {
  expect(behaviouralSetupForm.schema).toEqual(
    contractFormSchema(behaviouralSetupForm.contract),
  );
  const input = {
    ...behaviouralSetupForm.defaults,
    company: "Acme",
    role: "Engineer",
    profile: { id: "matrix", revision: 1 },
  };
  expect(behaviouralSetupForm.contract.safeParse(input).success).toBe(true);
  expect(
    behaviouralSetupForm.contract.safeParse({ ...input, durationMinutes: 4 })
      .success,
  ).toBe(false);
  expect(matrixImportForm.schema).toEqual(
    contractFormSchema(matrixImportForm.contract),
  );
  expect(matrixColumns.rowKey).toBe("id");
  expect(suggestedFor("recruiter", "Acme")).toContain("Why Acme?");
});
it("requires setup and a question for drafting and prevents asks beyond pack capacity", () => {
  const context = {
    artifactId: null,
    context: null,
    drafting: false,
    isSaved: false,
    condensing: false,
    expected: [],
    askNext: "Question",
    answers: 20,
  };
  expect(
    packActions.find((item) => item.id === "start")?.disabledReason?.(context),
  ).toBe("Choose a matrix and add the company and role first");
  expect(
    packActions.find((item) => item.id === "save")?.available?.(context),
  ).toBe(false);
  expect(
    packActions.find((item) => item.id === "ask")?.disabledReason?.(context),
  ).toBe("A pack holds 20 answers");
});
