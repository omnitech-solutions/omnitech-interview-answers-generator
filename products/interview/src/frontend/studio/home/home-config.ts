import {
  interviewPlanInputSchema,
  type PlanItem,
  planItemInputSchema,
} from "@omnitech/interview-contracts";
import type { ActionDescriptor, FormConfig } from "../config/page-config";
import { contractFormSchema } from "../shared/contract-form";

export const interviewForm: FormConfig<typeof interviewPlanInputSchema> = {
  contract: interviewPlanInputSchema,
  schema: contractFormSchema(interviewPlanInputSchema),
  // The vendored ObjectFieldTemplate reads layout rows, but the shared
  // alias still inherits RJSF's numeric textarea `ui:rows` declaration.
  uiSchema: {
    "ui:rows": [
      ["company", "role"],
      ["scheduledAt", "durationMinutes"],
      ["format"],
      ["topics"],
    ],
    company: { "ui:title": "Company" },
    role: { "ui:title": "Role" },
    scheduledAt: { "ui:title": "When", "ui:widget": "dateTime" },
    durationMinutes: { "ui:title": "Minutes", "ui:widget": "numberInput" },
    topics: { "ui:widget": "tagInput" },
  } as unknown as FormConfig<typeof interviewPlanInputSchema>["uiSchema"],
  defaults: {
    company: "",
    role: "",
    scheduledAt: null,
    durationMinutes: 60,
    format: "",
    topics: [],
  },
};
export const planItemForm: FormConfig<typeof planItemInputSchema> = {
  contract: planItemInputSchema,
  schema: contractFormSchema(planItemInputSchema),
  uiSchema: {
    kind: { "ui:widget": "hidden" },
    ref: { "ui:widget": "hidden" },
    title: { "ui:title": "New task" },
  },
  defaults: { kind: "task", ref: null, title: "" },
};
export const planItemActions: ActionDescriptor<PlanItem>[] = [
  {
    id: "open",
    label: "Open",
    available: (item) => item.kind !== "task",
    disabledReason: (item) =>
      item.kind !== "rehearsal" && !item.ref ? "No linked work" : null,
  },
  { id: "complete", label: "Complete", available: (item) => !item.done },
  { id: "reopen", label: "Mark incomplete", available: (item) => item.done },
  {
    id: "remove",
    label: "Remove",
    tone: "danger",
    confirm: { title: "Remove this plan item?", confirmLabel: "Remove" },
  },
];
