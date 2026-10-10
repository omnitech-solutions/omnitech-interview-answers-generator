import {
  type RehearsalReveal,
  rehearsalFormatSchema,
} from "@omnitech/interview-contracts";
import { z } from "zod";
import type { ActionDescriptor, FormConfig } from "../config/page-config";
import { contractFormSchema } from "../shared/contract-form";
import type { StudioLists } from "../use-studio-lists";
import { FORMATS, LOCKED_UNTIL_COMPLEXITY, REVEALS } from "./config";
import { choiceKey, codingChoices, conceptChoices } from "./material";

export const rehearsalSetupSchema = z.strictObject({
  format: rehearsalFormatSchema,
  conceptKey: z.string(),
  codingKey: z.string(),
  followUps: z.boolean(),
  strict: z.boolean(),
});
export type RehearsalSetup = z.infer<typeof rehearsalSetupSchema>;
export const rehearsalSetupForm: FormConfig<typeof rehearsalSetupSchema> = {
  contract: rehearsalSetupSchema,
  schema: contractFormSchema(rehearsalSetupSchema),
  uiSchema: {
    format: {
      "ui:widget": "radio",
      "ui:options": { appearance: "card", optionSetKey: "formats" },
    },
    conceptKey: {
      "ui:title": "Concept",
      "ui:widget": "select",
      "ui:options": { optionSetKey: "concepts" },
    },
    codingKey: {
      "ui:title": "Coding",
      "ui:widget": "select",
      "ui:options": { optionSetKey: "codings" },
    },
    followUps: { "ui:title": "Interviewer follow-ups", "ui:widget": "switch" },
    strict: { "ui:title": "Strict mode", "ui:widget": "switch" },
  },
  defaults: {
    format: "full",
    conceptKey: "",
    codingKey: "",
    followUps: true,
    strict: false,
  },
};
export function rehearsalOptionSets(lists: StudioLists) {
  const options = (choices: ReturnType<typeof conceptChoices>) =>
    choices.map((choice) => ({
      value: choiceKey(choice),
      label: choice.title,
    }));
  return {
    formats: FORMATS.map((format) => ({
      value: format.id,
      label: format.title,
      description: format.description,
    })),
    concepts: options(conceptChoices(lists)),
    codings: options(codingChoices(lists)),
  };
}
export type HintContext = {
  revealed: readonly RehearsalReveal[];
  remaining: Partial<Record<RehearsalReveal, string>>;
  complexity: string;
};
export const hintActions: ActionDescriptor<HintContext>[] = REVEALS.map(
  (reveal) => ({
    id: reveal.id,
    label: reveal.label,
    available: (context) => Boolean(context.remaining[reveal.id]),
    disabledReason: (context) =>
      context.revealed.includes(reveal.id)
        ? "Already revealed"
        : LOCKED_UNTIL_COMPLEXITY.includes(reveal.id) &&
            !context.complexity.trim()
          ? "State the complexity first"
          : null,
    confirm: {
      title: "Open this hint?",
      description: "Each hint costs 3 points.",
      confirmLabel: "Open hint",
    },
  }),
);
