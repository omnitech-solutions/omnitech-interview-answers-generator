// A form's JSON Schema, read from the contract that validates what the form
// saves. A form is declared (a schema, a uiSchema and two value adapters) and
// drawn by the library's DynamicForm; its field list is never written twice:
// the contract's own object is the list, in the contract's own order.
import type { DynamicFormProps } from "@oc-tech/omni-ui-components/dynamic-form";
import { z } from "zod";

type AnyForm = DynamicFormProps<Record<string, unknown>, unknown>;
export type FormSchema = AnyForm["schema"];
export type FormUiSchema = NonNullable<AnyForm["uiSchema"]>;

/**
 * A contract as the form's parser.
 * [SAFETY] The vendored library resolves its own copy of zod (4.6.5; this
 * repository pins 4.4.3), so the two `ZodType`s are different types to the
 * compiler although one works as the other at run time. This is the one place
 * that says so, until the library takes zod as a peer dependency.
 */
export const formParser = (contract: z.ZodType): AnyForm["zodSchema"] =>
  contract as unknown as AnyForm["zodSchema"];

// One property of a form schema, as far as a form's own rules read it.
export type FormProperty = { maxLength?: number; enum?: readonly unknown[] };

/**
 * The JSON Schema of what a person types into a contract: its input side, so
 * a field the contract fills in by default is not asked for. `fields` narrows
 * the form to those properties, in that order.
 */
export function contractFormSchema(
  contract: z.ZodType,
  fields?: readonly string[],
): FormSchema {
  // [STRATEGY] Draft 7 is the dialect the form's validator reads; what JSON
  // Schema cannot say (a refinement) stays the contract's to enforce on save.
  const schema = z.toJSONSchema(contract, {
    io: "input",
    target: "draft-7",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete schema["$schema"];
  if (!fields) return schema as FormSchema;
  const properties = (schema["properties"] ?? {}) as Record<string, unknown>;
  // [GUARD] A field the contract does not have is a mistake in the form.
  const unknown = fields.filter((field) => !(field in properties));
  if (unknown.length)
    throw new Error(`Not in the contract: ${unknown.join(", ")}`);
  const required = (schema["required"] ?? []) as string[];
  return {
    ...schema,
    properties: Object.fromEntries(
      fields.map((field) => [field, properties[field]]),
    ),
    required: required.filter((field) => fields.includes(field)),
  } as FormSchema;
}

/** The properties of a form schema, in the order the form shows them. */
export function formProperties(schema: FormSchema): [string, FormProperty][] {
  return Object.entries(
    (schema.properties ?? {}) as Record<string, FormProperty>,
  );
}
