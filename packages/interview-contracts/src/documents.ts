import { z } from "zod";

export const documentTemplateKindSchema = z.enum([
  "resume",
  "cover_letter",
  "interview_prep",
  "custom",
]);
export const documentFormatSchema = z.enum(["docx", "md"]);
const documentFieldSourceSchema = z.enum([
  "candidate-profile",
  "candidacy",
  "interview",
  "manual",
]);

// [DOMAIN] A repeating block of a template: one employer with its role, dates
// and bullets. `id` names the block ("contract-2"), `kind` says which part of a
// career it holds, `part` what this field is inside it, and `optional` that the
// whole block may not apply to a person (no consultancy, fewer employers).
export const documentFieldGroupSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .max(40),
  kind: z.enum([
    "current",
    "consultancy",
    "contract",
    "prior",
    "earlier",
    "experience",
  ]),
  part: z.enum(["company", "title", "from", "to", "dates", "bullet", "skills"]),
  optional: z.boolean().optional(),
});

export const documentFieldSchema = z.strictObject({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(80),
  label: z.string().trim().min(1).max(120),
  source: documentFieldSourceSchema,
  required: z.boolean(),
  maxLength: z.number().int().min(1).max(20_000).nullable(),
  // The template's own heading the field sits under, when it has headings.
  section: z.string().trim().min(1).max(80).optional(),
  // The repeating block the field belongs to, when it belongs to one.
  group: documentFieldGroupSchema.optional(),
});

export const documentFieldsSchema = z
  .array(documentFieldSchema)
  .min(1)
  .max(250)
  .superRefine((fields, context) => {
    const keys = new Set<string>();
    for (const [index, field] of fields.entries()) {
      if (keys.has(field.key)) {
        context.addIssue({
          code: "custom",
          path: [index, "key"],
          message: "Duplicate field key",
        });
      }
      keys.add(field.key);
    }
  });

export const documentValuesSchema = z.record(
  z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(80),
  z.string().max(20_000),
);

export const documentTemplateCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  kind: documentTemplateKindSchema,
  format: documentFormatSchema,
  instructions: z.string().max(16_000),
});

// What a new document is made from; the same whoever writes its fields.
const documentSelection = {
  title: z.string().trim().min(1).max(200),
  templateId: z.uuid(),
  templateRevision: z.number().int().positive(),
  profileId: z.string().trim().min(1).max(256),
  profileRevision: z.number().int().positive(),
  candidacyId: z.uuid().nullable(),
  interviewId: z.uuid().nullable(),
};

// [DOMAIN] A document is written by a model (`aiTargetId` names it) or made by
// hand (`mode: "manual"`): no model is named because none is called. The two
// never mix, so a manual request cannot carry a model and a request with
// neither is refused.
export const documentCreateSchema = z.union([
  z.strictObject({
    ...documentSelection,
    aiTargetId: z.string().trim().min(1).max(256),
  }),
  z.strictObject({ ...documentSelection, mode: z.literal("manual") }),
]);

export const documentEditSchema = z.strictObject({
  baseRevision: z.number().int().positive(),
  values: documentValuesSchema,
  // Fields the person vouches for as written ("confirmed by me"): the person
  // is the authority on their own history, so a confirmed field's text is not
  // held against the matrix until it changes.
  confirm: z.array(documentFieldSchema.shape.key).max(250).optional(),
});

export const documentRegenerateSchema = z.strictObject({
  baseRevision: z.number().int().positive(),
  fieldKey: documentFieldSchema.shape.key,
});

export const documentExportSchema = z.strictObject({
  revision: z.number().int().positive(),
  format: documentFormatSchema,
});

export type DocumentField = z.infer<typeof documentFieldSchema>;
export type DocumentFormat = z.infer<typeof documentFormatSchema>;
export type DocumentTemplateKind = z.infer<typeof documentTemplateKindSchema>;
export type DocumentValues = z.infer<typeof documentValuesSchema>;

export type DocumentFieldGroup = z.infer<typeof documentFieldGroupSchema>;

// What a claim in a field could not be traced to: a figure or a name, and the
// employer it does belong to when the matrix has it under another one.
export type UnsupportedClaim = {
  text: string;
  kind: "figure" | "name";
  foundIn?: string;
};

export type DocumentFieldError = {
  key: string;
  // "unsupported": the text names a figure or a proper noun that is not in the
  // evidence for this field (`against` says which evidence, `missing` what).
  code: "missing" | "too-long" | "unexpected" | "unsupported";
  against?: string;
  missing?: UnsupportedClaim[];
};

const GROUP_PATTERNS: ReadonlyArray<
  [RegExp, (match: RegExpExecArray) => DocumentFieldGroup | null]
> = (() => {
  const part = (word: string): DocumentFieldGroup["part"] | null =>
    /^(?:company|name|employer)$/.test(word)
      ? "company"
      : /^(?:role|title|position)$/.test(word)
        ? "title"
        : /^(?:from|start)$/.test(word)
          ? "from"
          : /^(?:to|end)$/.test(word)
            ? "to"
            : /^(?:dates|period)$/.test(word)
              ? "dates"
              : /^(?:experience_)?bullet_?\d+$/.test(word)
                ? "bullet"
                : /^acquired_skills?$|^skills$/.test(word)
                  ? "skills"
                  : null;
  const of = (
    id: string,
    kind: DocumentFieldGroup["kind"],
    word: string,
    optional: boolean,
  ): DocumentFieldGroup | null => {
    const found = part(word);
    return found
      ? { id, kind, part: found, ...(optional ? { optional: true } : {}) }
      : null;
  };
  return [
    [/^current_(.+)$/, (m) => of("current", "current", m[1] ?? "", false)],
    [
      /^my_company_(.+)$/,
      (m) => of("consultancy", "consultancy", m[1] ?? "", true),
    ],
    [
      /^contracts_(acquired_skills?)$/,
      (m) => of("consultancy", "consultancy", m[1] ?? "", true),
    ],
    [
      /^contract_(company|role|title)_?(\d+)$/,
      (m) => of(`contract-${m[2]}`, "contract", m[1] ?? "", true),
    ],
    [
      /^contract_?(\d+)_(.+)$/,
      (m) => of(`contract-${m[1]}`, "contract", m[2] ?? "", true),
    ],
    [
      /^prior_my_company_?(\d+)$/,
      (m) => of(`prior-${m[1]}`, "prior", "company", true),
    ],
    [
      /^prior_my_company_?(\d+)_(.+)$/,
      (m) => of(`prior-${m[1]}`, "prior", m[2] ?? "", true),
    ],
    [/^earlier_exp_(.+)$/, (m) => of("earlier", "earlier", m[1] ?? "", true)],
    [
      /^(?:experience|job|employer|position)_?(\d+)_(.+)$/,
      (m) =>
        of(`experience-${m[1]}`, "experience", m[2] ?? "", Number(m[1]) > 1),
    ],
  ];
})();

/** The block a field key names by its pattern, when the pattern is one we know. */
export function deriveFieldGroup(key: string): DocumentFieldGroup | null {
  for (const [pattern, group] of GROUP_PATTERNS) {
    const match = pattern.exec(key);
    if (match) return group(match);
  }
  return null;
}

/**
 * Fields with their block made explicit. A field that states its group keeps
 * it; one that does not gets the group its key pattern names. A derived block
 * is kept only when it is unambiguous: it has its employer's name (earlier
 * experience has none and needs none).
 */
export function withFieldGroups(
  fields: readonly DocumentField[],
): DocumentField[] {
  const grouped = fields.map((field) => {
    if (field.group) return field;
    const group = deriveFieldGroup(field.key);
    return group ? { ...field, group } : field;
  });
  const anchored = new Set(
    grouped
      .filter((field) => field.group?.part === "company")
      .map((field) => field.group?.id),
  );
  return grouped.map((field, index) => {
    const original = fields[index];
    if (!field.group || original?.group) return field;
    if (field.group.kind === "earlier" || anchored.has(field.group.id))
      return field;
    return original ?? field;
  });
}

export type DocumentBlock = {
  id: string;
  kind: DocumentFieldGroup["kind"];
  optional: boolean;
  // The field that holds the employer's name, when the block has one.
  anchor: string | null;
  fields: DocumentField[];
};

/** A template's blocks, in template order. */
export function documentBlocks(
  fields: readonly DocumentField[],
): DocumentBlock[] {
  const blocks = new Map<string, DocumentBlock>();
  for (const field of fields) {
    const group = field.group;
    if (!group) continue;
    const block = blocks.get(group.id) ?? {
      id: group.id,
      kind: group.kind,
      optional: false,
      anchor: null,
      fields: [],
    };
    block.fields.push(field);
    if (group.optional) block.optional = true;
    if (group.part === "company" && !block.anchor) block.anchor = field.key;
    blocks.set(group.id, block);
  }
  return [...blocks.values()];
}

/**
 * How a document's blocks stand with these values. `absent` are the fields of
 * an optional block that does not apply (its employer's name is empty, or all
 * of it is empty when it has no name): they are neither required nor drawn.
 * `header` are the fields that decorate a block that does apply (name, title,
 * dates), which a renderer keeps a line for even when one of them is empty.
 */
export function documentLayout(
  fields: readonly DocumentField[],
  values: Readonly<Record<string, string>>,
): { absent: Set<string>; header: Set<string> } {
  const absent = new Set<string>();
  const header = new Set<string>();
  const empty = (key: string) => !(values[key] ?? "").trim();
  for (const block of documentBlocks(fields)) {
    const gone =
      block.optional &&
      (block.anchor
        ? empty(block.anchor)
        : block.fields.every((field) => empty(field.key)));
    for (const field of block.fields) {
      if (gone) absent.add(field.key);
      else if (
        field.group &&
        field.group.part !== "bullet" &&
        field.group.part !== "skills"
      )
        header.add(field.key);
    }
  }
  return { absent, header };
}

/** Validate a complete flat snapshot against the pinned template field contract. */
export function validateDocumentValues(
  fields: readonly DocumentField[],
  values: Record<string, string>,
): DocumentFieldError[] {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const errors: DocumentFieldError[] = [];
  // A block that does not apply to this person asks for nothing.
  const { absent } = documentLayout(fields, values);
  for (const field of fields) {
    const value = values[field.key] ?? "";
    if (field.required && !value.trim() && !absent.has(field.key))
      errors.push({ key: field.key, code: "missing" });
    if (field.maxLength !== null && value.length > field.maxLength)
      errors.push({ key: field.key, code: "too-long" });
  }
  for (const key of Object.keys(values)) {
    if (!byKey.has(key)) errors.push({ key, code: "unexpected" });
  }
  return errors;
}
