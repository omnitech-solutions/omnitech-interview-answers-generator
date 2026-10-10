import type { DynamicFormProps } from "@oc-tech/omni-ui-components/dynamic-form";
import type {
  DocumentField,
  DocumentFieldError,
} from "@omnitech/interview-contracts";
import { groupFields, groupIdOf } from "./documents-model";

// PROBLEM: the editor drew every field by hand and kept its own layout.
// STRATEGY: the template's fields are the only description of the form. This
// module turns them into what the library's DynamicForm reads (a JSON schema
// and a uiSchema) and maps the stored flat values to the form's grouped ones
// and back. It is pure: no React, no requests, no state.
// COMPLEXITY: O(fields) for the configuration and for either projection.

type AnyForm = DynamicFormProps<Record<string, unknown>, unknown>;
export type DocumentFormSchema = AnyForm["schema"];
export type DocumentFormUiSchema = NonNullable<AnyForm["uiSchema"]>;

/** The widget a document field is drawn with, by its registry name. */
export const DOCUMENT_FIELD_WIDGET = "documentField";

export const OPTIONAL_PLACEHOLDER = "Optional — leave empty to omit";
export const SOURCE_BOUND_NOTE = "Filled from the application.";

/** What the document is tied to: those sources state their own fields. */
export type DocumentBinding = { candidacy: boolean; interview: boolean };

/** One collapsible section of the form: a group of the template's fields. */
export type DocumentFormSection = {
  // The section's property name in the grouped values ("s0", "s1", …).
  name: string;
  // The group it draws (`groupIdOf`): the template's heading, or the source.
  id: string;
  title: string;
  // Every field of the group, in template order, drawn or not.
  keys: string[];
};

export type DocumentFormConfig = {
  schema: DocumentFormSchema;
  uiSchema: DocumentFormUiSchema;
  sections: DocumentFormSection[];
};

export type GroupedValues = Record<string, Record<string, string>>;

export type DocumentFormOptions = {
  binding: DocumentBinding;
  // A revision that is only being read: nothing says "filled from…".
  readOnly?: boolean;
  // Fields left out of the form: a block that does not apply, or a field the
  // filter hides. Their section keeps its name, so shown fields keep theirs.
  hidden?: ReadonlySet<string>;
  // Sections drawn closed until opened, by group id.
  collapsed?: ReadonlySet<string>;
};

/**
 * [DOMAIN] A field whose value an authoritative source states (the
 * application, the interview) is read-only while the document is tied to that
 * source. This is read from the field's `source`, never from its label; the
 * server refuses a change to such a field whatever the form allows.
 */
export function isSourceBound(
  field: DocumentField,
  binding: DocumentBinding,
): boolean {
  return (
    (field.source === "candidacy" && binding.candidacy) ||
    (field.source === "interview" && binding.interview)
  );
}

/**
 * The widget a field is drawn with, from its metadata. A template's fields
 * are all prose today (`documentFieldSchema` has no other kind), and prose
 * may hold line breaks, so each one is the multi-line document field.
 */
export function widgetFor(_field: DocumentField): string {
  return DOCUMENT_FIELD_WIDGET;
}

/** The form's sections for these fields: `groupFields`, with stable names. */
export function documentFormSections(
  fields: readonly DocumentField[],
): DocumentFormSection[] {
  return groupFields(fields).map((group, index) => ({
    name: `s${index}`,
    id: group.id,
    title: group.title,
    keys: group.fields.map((field) => field.key),
  }));
}

/** Template fields as the schema and uiSchema DynamicForm renders. */
export function documentFormConfig(
  fields: readonly DocumentField[],
  options: DocumentFormOptions,
): DocumentFormConfig {
  // [GUARD] Field keys are unique in a template (`documentFieldsSchema`); a
  // repeated key would make two controls write one value.
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const sections = documentFormSections(fields);
  const properties: Record<string, DocumentFormSchema> = {};
  const uiSchema: Record<string, unknown> = {};
  const rows: string[][] = [];

  // [STRATEGY] One object per section, one string per field. A section with
  // nothing to draw is left out, and so is its heading.
  for (const section of sections) {
    const shown = section.keys
      .filter((key) => !options.hidden?.has(key))
      .flatMap((key) => byKey.get(key) ?? []);
    if (!shown.length) continue;
    properties[section.name] = {
      type: "object",
      title: section.title,
      // Drawn as required only: whether a required field may be empty is
      // conditional (an optional block that does not apply asks for
      // nothing), and `validateDocumentValues` decides it, here and on the
      // server.
      required: shown.filter((field) => field.required).map((f) => f.key),
      properties: Object.fromEntries(
        shown.map((field) => [
          field.key,
          {
            type: "string",
            title: field.label,
            ...(field.maxLength === null ? {} : { maxLength: field.maxLength }),
          },
        ]),
      ),
    };
    uiSchema[section.name] = {
      "ui:options": {
        collapsible: {
          title: section.title,
          defaultOpen: !options.collapsed?.has(section.id),
        },
      },
      // One field per row, in template order.
      "ui:rows": shown.map((field) => [field.key]),
      ...Object.fromEntries(
        shown.map((field) => {
          const bound = isSourceBound(field, options.binding);
          return [
            field.key,
            {
              "ui:widget": widgetFor(field),
              ...(bound ? { "ui:readonly": true } : {}),
              ...(bound && !options.readOnly
                ? { "ui:help": SOURCE_BOUND_NOTE }
                : {}),
              ...(field.required
                ? {}
                : { "ui:placeholder": OPTIONAL_PLACEHOLDER }),
            },
          ];
        }),
      ),
    };
    rows.push([section.name]);
  }

  // Result: the sections that have something to draw, in template order.
  return {
    schema: { type: "object", properties },
    uiSchema: {
      ...uiSchema,
      "ui:rows": rows,
    } as unknown as DocumentFormUiSchema,
    sections,
  };
}

/** Flat stored values as the form's grouped ones: every declared field. */
export function toGroupedValues(
  sections: readonly DocumentFormSection[],
  flat: Readonly<Record<string, string>>,
): GroupedValues {
  return Object.fromEntries(
    sections.map((section) => [
      section.name,
      Object.fromEntries(section.keys.map((key) => [key, flat[key] ?? ""])),
    ]),
  );
}

/**
 * The form's grouped values as flat stored ones. A field the form does not
 * hold (its section was not drawn) is not in the result: the caller keeps its
 * stored value.
 */
export function toFlatValues(
  sections: readonly DocumentFormSection[],
  grouped: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const section of sections) {
    const held = grouped[section.name];
    if (typeof held !== "object" || held === null) continue;
    for (const key of section.keys) {
      if (!Object.hasOwn(held, key)) continue;
      const value = (held as Record<string, unknown>)[key];
      flat[key] = typeof value === "string" ? value : "";
    }
  }
  return flat;
}

/** The id the form gives a field's control, or null for a field it has not. */
export function fieldControlId(
  sections: readonly DocumentFormSection[],
  key: string,
): string | null {
  const section = sections.find((item) => item.keys.includes(key));
  return section ? `root_${section.name}_${key}` : null;
}

/** The section (group id) a field is drawn in. */
export function sectionIdOf(
  fields: readonly DocumentField[],
  key: string,
): string | null {
  const field = fields.find((item) => item.key === key);
  return field ? groupIdOf(field) : null;
}

/**
 * [DOMAIN] A long template opens on what needs doing: the first section and
 * every section with a problem; the rest start closed. A short one opens
 * whole.
 */
export function initiallyCollapsed(
  fields: readonly DocumentField[],
  validation: readonly DocumentFieldError[],
): Set<string> {
  if (fields.length <= 24) return new Set();
  const failing = new Set(validation.map((issue) => issue.key));
  const open = new Set(
    fields.filter((field) => failing.has(field.key)).map(groupIdOf),
  );
  return new Set(
    groupFields(fields)
      .filter((group, index) => index !== 0 && !open.has(group.id))
      .map((group) => group.id),
  );
}
