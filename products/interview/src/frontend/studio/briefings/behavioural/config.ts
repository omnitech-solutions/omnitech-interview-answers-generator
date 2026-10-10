import type { BriefingProfileSummary } from "@omnitech/interview-api-client";
import {
  type BriefingContext,
  type BriefingQuestion,
  briefingContextSchema,
  briefingProfileImportSchema,
} from "@omnitech/interview-contracts";
import type {
  ActionDescriptor,
  FormConfig,
  TableConfig,
} from "../../config/page-config";
import type { IconName } from "../../icon";
import { contractFormSchema } from "../../shared/contract-form";

// Behavioural briefings are driven by this data: the screens render it.

type Stage = BriefingContext["stage"];

export const STAGES: readonly { id: Stage; label: string; note: string }[] = [
  {
    id: "recruiter",
    label: "Recruiter screen",
    note: "A conversation, not an exam: career story, motivation, one or two leadership examples, compensation and logistics.",
  },
  {
    id: "hiring-manager",
    label: "Hiring manager",
    note: "Depth on your most relevant role and how you work day to day.",
  },
  {
    id: "behavioural",
    label: "Behavioural panel",
    note: "STAR stories, about 90 seconds each.",
  },
  {
    id: "leadership",
    label: "Final round",
    note: "Motivation, fit and your closing questions.",
  },
];

export const CATEGORY_LABELS: Record<BriefingQuestion["category"], string> = {
  background: "Background",
  motivation: "Motivation",
  leadership: "Leadership",
  delivery: "Story",
  collaboration: "Collaboration",
  logistics: "Logistics",
  "questions-to-ask": "Closing",
};

// The questions each stage nearly always asks. `{company}` is filled in.
export const SUGGESTED_QUESTIONS: Record<Stage, readonly string[]> = {
  recruiter: [
    "Tell me about yourself and your background.",
    "Why {company}?",
    "Why are you interested in this role?",
    "Tell me about your leadership and mentoring experience.",
    "Tell me about a project you’re proud of.",
    "How do you work with Product?",
    "How do you handle competing priorities?",
    "What are you looking for in your next role?",
    "What are your salary expectations?",
    "Where are you based, and when could you start?",
  ],
  "hiring-manager": [
    "Walk me through your most relevant role.",
    "Tell me about a technical decision you’d make differently now.",
    "How do you work with product managers?",
    "Tell me about a production incident you led.",
    "How do you mentor other engineers?",
  ],
  behavioural: [
    "Tell me about a disagreement with a teammate.",
    "Tell me about a time you failed.",
    "Tell me about influencing without authority.",
    "Tell me about delivering under a tight deadline.",
    "Tell me about pushing back on a manager.",
  ],
  leadership: [
    "Why should we hire you?",
    "Where do you want to be in three years?",
    "What questions do you have for us?",
  ],
};

export function suggestedFor(stage: Stage, company: string): string[] {
  return SUGGESTED_QUESTIONS[stage].map((question) =>
    question.replace("{company}", company.trim() || "this company"),
  );
}

// The pack's tabs: answers, then the prepared briefing's cards.
export type PackTab = "overview" | "answers" | "stories" | "ask" | "watch";
export const PACK_TABS: readonly {
  id: PackTab;
  label: string;
  icon: IconName;
}[] = [
  { id: "overview", label: "Overview", icon: "lightbulb" },
  { id: "answers", label: "Answers", icon: "record_voice_over" },
  { id: "stories", label: "Stories", icon: "menu_book" },
  { id: "ask", label: "Ask them", icon: "help" },
  { id: "watch", label: "Watch-outs", icon: "warning" },
];

// About 150 words a minute, spoken.
export const spokenSeconds = (markdown: string) =>
  Math.round((markdown.split(/\s+/).filter(Boolean).length / 150) * 60);

// The matrix a pack starts from when the person has not chosen a default.
export const DEFAULT_PROFILE_ID = "local-experience-matrix";

export const behaviouralSetupForm: FormConfig<typeof briefingContextSchema> = {
  contract: briefingContextSchema,
  schema: contractFormSchema(briefingContextSchema),
  // The vendored ObjectFieldTemplate reads layout rows, but the shared
  // alias still inherits RJSF's numeric textarea `ui:rows` declaration.
  uiSchema: {
    "ui:rows": [
      ["company", "role"],
      ["interviewer", "interviewerTitle"],
      ["durationMinutes", "stage"],
      ["profile"],
      ["jobDescription"],
      ["employerSaid"],
      ["research"],
    ],
    company: { "ui:title": "Company", "ui:widget": "text" },
    role: { "ui:title": "Role", "ui:widget": "text" },
    interviewer: { "ui:title": "Interviewer", "ui:widget": "text" },
    interviewerTitle: { "ui:title": "Interviewer title", "ui:widget": "text" },
    durationMinutes: { "ui:title": "Minutes", "ui:widget": "numberInput" },
    stage: {
      "ui:widget": "segmented",
      "ui:options": { optionSetKey: "stages" },
    },
    profile: {
      "ui:title": "Experience matrix",
      "ui:options": { collapsible: { defaultOpen: true } },
      id: { "ui:widget": "select", "ui:options": { optionSetKey: "profiles" } },
      revision: { "ui:widget": "numberInput" },
    },
    jobDescription: { "ui:widget": "textarea" },
    research: { "ui:widget": "textarea" },
    request: { "ui:widget": "textarea" },
    candidatePreferences: { "ui:widget": "textarea" },
    employerNotes: { "ui:widget": "hidden" },
    condensed: { "ui:widget": "hidden" },
  } as unknown as FormConfig<typeof briefingContextSchema>["uiSchema"],
  defaults: {
    company: "",
    role: "",
    stage: "recruiter",
    durationMinutes: 30,
    profile: { id: "", revision: 0 },
  },
};
export const matrixImportForm: FormConfig<typeof briefingProfileImportSchema> =
  {
    contract: briefingProfileImportSchema,
    schema: contractFormSchema(briefingProfileImportSchema),
    uiSchema: {
      name: { "ui:title": "Matrix name" },
      matrix: {
        "ui:widget": "file",
        "ui:options": { mode: "file", accept: ".json" },
      },
      profileId: { "ui:widget": "hidden" },
      expectedRevision: { "ui:widget": "hidden" },
    },
    defaults: { name: "", matrix: { candidate: { name: "" }, roles: [] } },
  };
export const matrixColumns: TableConfig<BriefingProfileSummary> = {
  rowKey: "id",
  columns: [
    { key: "name", dataIndex: "name", title: "Matrix" },
    { key: "revision", dataIndex: "revision", title: "Revision" },
    { key: "updatedAt", dataIndex: "updatedAt", title: "Updated" },
  ],
  rowActions: [
    { id: "choose", label: "Use matrix" },
    { id: "default", label: "Make default" },
  ],
  toolbar: [],
  empty: {
    title: "No experience matrices",
    description: "Import a matrix to ground your answers.",
    actionId: "import",
  },
};
export type PackActionContext = {
  artifactId: string | null;
  context: BriefingContext | null;
  drafting: boolean;
  isSaved: boolean;
  condensing: boolean;
  expected: readonly string[];
  askNext: string;
  answers: number;
};
export const packActions: ActionDescriptor<PackActionContext>[] = [
  {
    id: "start",
    label: "Draft answers",
    tone: "primary",
    disabledReason: (state) =>
      !state.context
        ? "Choose a matrix and add the company and role first"
        : !state.expected.some((question) => question.trim())
          ? "Add at least one question"
          : state.drafting
            ? "Drafting…"
            : null,
  },
  {
    id: "save",
    label: "Save pack",
    available: (state) => state.artifactId !== null,
    disabledReason: (state) =>
      state.isSaved ? "Saved" : state.drafting ? "Drafting…" : null,
  },
  {
    id: "condense",
    label: "Condense setup",
    available: (state) => state.artifactId !== null,
    disabledReason: (state) => (state.condensing ? "Condensing…" : null),
  },
  {
    id: "ask",
    label: "Answer it",
    disabledReason: (state) =>
      state.answers >= 20
        ? "A pack holds 20 answers"
        : !state.askNext.trim()
          ? "Enter a question"
          : state.drafting
            ? "Drafting…"
            : null,
  },
  { id: "resetQuestions", label: "Reset questions" },
  {
    id: "acceptAll",
    label: "Accept all",
    available: (state) => state.answers > 0,
  },
  {
    id: "editSetup",
    label: "Edit setup",
    available: (state) => state.artifactId !== null,
  },
];
