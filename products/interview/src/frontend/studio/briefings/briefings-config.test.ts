import { expect, it } from "vitest";
import { contractFormSchema } from "../shared/contract-form";
import { briefActions, briefColumns, newBriefForm } from "./briefings-config";

it("keeps brief form and list configuration tied to contracts", () => {
  expect(newBriefForm.schema).toEqual(
    contractFormSchema(newBriefForm.contract),
  );
  expect(
    newBriefForm.contract.parse({ kind: "concept", topic: " React " }),
  ).toEqual({ kind: "concept", topic: "React" });
  expect(
    newBriefForm.contract.safeParse({ kind: "behavioural", topic: "React" })
      .success,
  ).toBe(false);
  expect(briefColumns.rowKey).toBe("id");
  expect(briefColumns.empty.actionId).toBe("new");
});
it("disables an empty or busy build, shows delete only for a brief, and gates explanations", () => {
  const context = { busy: false, topic: "", selected: null, explanations: 0 };
  expect(
    briefActions.find((item) => item.id === "build")?.disabledReason?.(context),
  ).toBe("Enter a topic");
  expect(
    briefActions
      .find((item) => item.id === "build")
      ?.disabledReason?.({ ...context, topic: "React", busy: true }),
  ).toBe("Building…");
  expect(
    briefActions.find((item) => item.id === "remove")?.available?.(context),
  ).toBe(false);
  expect(
    briefActions
      .find((item) => item.id === "explanations")
      ?.available?.({ ...context, explanations: 1 }),
  ).toBe(true);
});
