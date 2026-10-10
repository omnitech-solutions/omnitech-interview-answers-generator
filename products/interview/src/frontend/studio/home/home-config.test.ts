import type { PlanItem } from "@omnitech/interview-contracts";
import { expect, it } from "vitest";
import { contractFormSchema } from "../shared/contract-form";
import { interviewForm, planItemActions, planItemForm } from "./home-config";

it("derives schema from contracts and configures nullable fields without losing constraints", () => {
  expect(interviewForm.schema).toEqual(
    contractFormSchema(interviewForm.contract),
  );
  expect(interviewForm.uiSchema["ui:rows"]).toEqual([
    ["company", "role"],
    ["scheduledAt", "durationMinutes"],
    ["format"],
    ["topics"],
  ]);
  expect(interviewForm.uiSchema["scheduledAt"]).toMatchObject({
    "ui:widget": "dateTime",
  });
  expect(interviewForm.uiSchema["durationMinutes"]).toMatchObject({
    "ui:widget": "numberInput",
  });
  expect(interviewForm.uiSchema["topics"]).toMatchObject({
    "ui:widget": "tagInput",
  });
  const valid = {
    ...interviewForm.defaults,
    company: "Acme",
    role: "Engineer",
  };
  expect(interviewForm.contract.safeParse(valid).success).toBe(true);
  expect(
    interviewForm.contract.safeParse({ ...valid, durationMinutes: 4 }).success,
  ).toBe(false);
  expect(
    planItemForm.contract.parse({
      ...planItemForm.defaults,
      title: " Read docs ",
    }).title,
  ).toBe("Read docs");
});
it("limits actions by kind and completion, and confirms removal", () => {
  const task: PlanItem = {
    id: "x",
    kind: "task",
    ref: null,
    title: "Read docs",
    done: false,
    position: 0,
    status: null,
  };
  expect(planItemActions.find((a) => a.id === "open")?.available?.(task)).toBe(
    false,
  );
  expect(
    planItemActions.find((a) => a.id === "complete")?.available?.(task),
  ).toBe(true);
  expect(
    planItemActions.find((a) => a.id === "reopen")?.available?.(task),
  ).toBe(false);
  expect(
    planItemActions.find((a) => a.id === "remove")?.confirm?.confirmLabel,
  ).toBe("Remove");
});
