// The interview's context form, declared: its schema is the contract's
// (candidacyContextInputSchema), its words and layout are data, and its
// values go in and out through two pure adapters. The library's DynamicForm
// draws it. A field added to the contract appears here with no markup: give
// it words below, or it is shown under its own name.
import {
  type CandidacyContext,
  type CandidacyContextInput,
  candidacyContextInputSchema,
} from "@omnitech/interview-contracts";
import {
  contractFormSchema,
  type FormSchema,
  type FormUiSchema,
  formProperties,
} from "../../../shared/contract-form";

export const contextFormSchema: FormSchema = contractFormSchema(
  candidacyContextInputSchema,
);

// What each field is called and what stands under it.
const WORDS: Partial<
  Record<keyof CandidacyContextInput, { title: string; description?: string }>
> = {
  companyName: { title: "Company" },
  title: { title: "Role" },
  notes: {
    title: "Your notes",
    description:
      "What you know about the team and the process. Notes for one round belong to its stage, below.",
  },
  jobDescription: {
    title: "Job spec (the raw posting)",
    description:
      "Paste the posting as it is; the clean-up reads it, you do not have to tidy it.",
  },
};

// A field the contract bounds above one line's worth is a text area on a row
// of its own; shorter ones sit two to a row.
const LONG_TEXT = 1_000;
const isLong = (maxLength: number | undefined) =>
  maxLength !== undefined && maxLength > LONG_TEXT;

/**
 * How the form is drawn. The company names the candidacy, so it is fixed once
 * the candidacy exists.
 */
export function contextUiSchema(options: {
  companyFixed: boolean;
}): FormUiSchema {
  const fields = formProperties(contextFormSchema);
  const short = fields.filter(([, field]) => !isLong(field.maxLength));
  const long = fields.filter(([, field]) => isLong(field.maxLength));
  const rows: (string | { value: string; span: number })[][] = [];
  for (let at = 0; at < short.length; at += 2)
    rows.push(short.slice(at, at + 2).map(([name]) => name));
  for (const [name] of long) rows.push([{ value: name, span: 2 }]);
  const ui: Record<string, unknown> = { "ui:rows": rows };
  for (const [name, field] of fields) {
    const words = WORDS[name as keyof CandidacyContextInput];
    ui[name] = {
      "ui:title": words?.title ?? name,
      ...(words?.description ? { "ui:description": words.description } : {}),
      ...(isLong(field.maxLength)
        ? { "ui:widget": "textarea", "ui:options": { rows: 4 } }
        : {}),
      ...(name === "companyName" && options.companyFixed
        ? { "ui:disabled": true }
        : {}),
    };
  }
  return ui as FormUiSchema;
}

/** What the form starts with: the stored context, or nothing for a new one. */
export function toContextFormData(
  context: CandidacyContext | null,
): Record<string, unknown> {
  const stored: Record<string, unknown> = context ?? {};
  return Object.fromEntries(
    formProperties(contextFormSchema).map(([name]) => [
      name,
      stored[name] ?? "",
    ]),
  );
}

/**
 * What the form holds, as the contract reads it (trimmed and bounded), or
 * null while it would be refused: the same check that lets Save be pressed.
 */
export function toContextInput(values: unknown): CandidacyContextInput | null {
  const parsed = candidacyContextInputSchema.safeParse(values);
  return parsed.success ? parsed.data : null;
}
