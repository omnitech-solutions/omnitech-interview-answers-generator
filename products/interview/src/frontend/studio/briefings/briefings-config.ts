import {
  type BriefSummary,
  briefRequestSchema,
} from "@omnitech/interview-contracts";
import type {
  ActionDescriptor,
  FormConfig,
  TableConfig,
} from "../config/page-config";
import { contractFormSchema } from "../shared/contract-form";

export const briefKinds = [
  { value: "concept", label: "Concept" },
  { value: "system-design", label: "System design" },
  { value: "behavioural", label: "Behavioural" },
] as const;
export const newBriefForm: FormConfig<typeof briefRequestSchema> = {
  contract: briefRequestSchema,
  schema: contractFormSchema(briefRequestSchema),
  uiSchema: {
    kind: {
      "ui:widget": "segmented",
      "ui:options": { optionSetKey: "briefKinds" },
    },
    topic: { "ui:title": "Topic", "ui:widget": "textarea" },
  },
  defaults: { kind: "concept", topic: "" },
};
export type BriefActionContext = {
  busy: boolean;
  topic: string;
  selected: string | null;
  explanations: number;
};
export const briefActions: ActionDescriptor<BriefActionContext>[] = [
  { id: "new", label: "New briefing", icon: "add" },
  {
    id: "build",
    label: "Build briefing",
    tone: "primary",
    disabledReason: (context) =>
      context.busy
        ? "Building…"
        : !context.topic.trim()
          ? "Enter a topic"
          : null,
  },
  {
    id: "remove",
    label: "Delete brief",
    tone: "danger",
    available: (context) => context.selected !== null,
    confirm: { title: "Delete this brief?", confirmLabel: "Delete" },
  },
  {
    id: "explanations",
    label: "Concept explanations",
    available: (context) => context.explanations > 0,
  },
];
export const briefColumns: TableConfig<BriefSummary> = {
  rowKey: "id",
  columns: [
    { key: "title", dataIndex: "title", title: "Title" },
    { key: "kind", dataIndex: "kind", title: "Kind" },
    { key: "updatedAt", dataIndex: "updatedAt", title: "Updated" },
  ],
  rowActions: [{ id: "open", label: "Open" }],
  toolbar: [],
  empty: {
    title: "No briefings yet",
    description: "Your briefings will appear here.",
    actionId: "new",
  },
};
