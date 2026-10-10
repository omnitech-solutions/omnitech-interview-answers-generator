// The "Employer said" entry form, declared: its fields, order and bounds are
// the contract's (employerSaidInputSchema); its words and layout are data;
// its values go out through one pure adapter. The library's DynamicForm draws
// it, in the Interview form and in the Briefings setup alike.
import {
  type EMPLOYER_SAID_CHANNELS,
  type EmployerSaidInput,
  employerSaidInputSchema,
} from "@omnitech/interview-contracts";
import {
  contractFormSchema,
  type FormSchema,
  type FormUiSchema,
  formProperties,
} from "../shared/contract-form";

const CHANNEL_LABEL: Record<(typeof EMPLOYER_SAID_CHANNELS)[number], string> = {
  email: "Email",
  call: "Call",
  message: "Message",
  other: "Other",
};
// A choice the contract leaves optional is offered with "not said" first: an
// empty value in the form, an absent field in what is saved.
const NOT_SAID = { const: "", title: "Not said" };

const contract = contractFormSchema(employerSaidInputSchema);

export const employerSaidFormSchema: FormSchema = {
  ...contract,
  properties: Object.fromEntries(
    formProperties(contract).map(([name, field]) => [
      name,
      field.enum
        ? {
            type: "string",
            oneOf: [
              NOT_SAID,
              ...field.enum.map((value) => ({
                const: value,
                title:
                  CHANNEL_LABEL[value as keyof typeof CHANNEL_LABEL] ??
                  String(value),
              })),
            ],
          }
        : field,
    ]),
  ),
} as FormSchema;

// (`ui:rows` is the library's own layout key, which the upstream type does
// not know: hence the widening.)
export const employerSaidUiSchema = {
  "ui:rows": [[{ value: "said", span: 3 }], ["saidBy", "channel", "saidOn"]],
  said: {
    "ui:title": "What was said",
    "ui:widget": "textarea",
    "ui:options": { rows: 3 },
  },
  saidBy: { "ui:title": "Who said it" },
  channel: { "ui:title": "How", "ui:widget": "select" },
  saidOn: { "ui:title": "When", "ui:options": { inputType: "date" } },
} as Record<string, unknown> as FormUiSchema;

/** An entry not yet typed: every field of the contract, empty. */
export function emptyEmployerSaid(): Record<string, unknown> {
  return Object.fromEntries(
    formProperties(employerSaidFormSchema).map(([name]) => [name, ""]),
  );
}

/**
 * What the form holds, as the contract reads it: a field left empty is
 * absent, what was said loses the space around it. Null while the contract
 * would refuse it (nothing said yet), which is when Add cannot be pressed.
 */
export function toEmployerSaidInput(values: unknown): EmployerSaidInput | null {
  if (typeof values !== "object" || values === null) return null;
  const typed = Object.fromEntries(
    Object.entries(values)
      .map(([name, value]) => [
        name,
        typeof value === "string" ? value.trim() : value,
      ])
      .filter(([, value]) => value !== "" && value !== undefined),
  );
  const parsed = employerSaidInputSchema.safeParse(typed);
  return parsed.success ? parsed.data : null;
}
