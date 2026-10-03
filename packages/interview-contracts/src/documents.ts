import { z } from "zod";

export const documentTemplateKindSchema = z.enum([
  "resume",
  "cover_letter",
  "interview_prep",
  "custom",
]);
export const documentFormatSchema = z.enum(["docx", "md"]);
export const documentFieldSourceSchema = z.enum([
  "candidate-profile",
  "candidacy",
  "interview",
  "manual",
]);

export const documentFieldSchema = z.strictObject({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(80),
  label: z.string().trim().min(1).max(120),
  source: documentFieldSourceSchema,
  required: z.boolean(),
  maxLength: z.number().int().min(1).max(20_000).nullable(),
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

export const documentCreateSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  templateId: z.uuid(),
  templateRevision: z.number().int().positive(),
  profileId: z.string().trim().min(1).max(256),
  profileRevision: z.number().int().positive(),
  candidacyId: z.uuid().nullable(),
  interviewId: z.uuid().nullable(),
  aiTargetId: z.string().trim().min(1).max(256),
});

export const documentEditSchema = z.strictObject({
  baseRevision: z.number().int().positive(),
  values: documentValuesSchema,
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

export type DocumentFieldError = {
  key: string;
  code: "missing" | "too-long" | "unexpected";
};

/** Validate a complete flat snapshot against the pinned template field contract. */
export function validateDocumentValues(
  fields: readonly DocumentField[],
  values: Record<string, string>,
): DocumentFieldError[] {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const errors: DocumentFieldError[] = [];
  for (const field of fields) {
    const value = values[field.key] ?? "";
    if (field.required && !value.trim())
      errors.push({ key: field.key, code: "missing" });
    if (field.maxLength !== null && value.length > field.maxLength)
      errors.push({ key: field.key, code: "too-long" });
  }
  for (const key of Object.keys(values)) {
    if (!byKey.has(key)) errors.push({ key, code: "unexpected" });
  }
  return errors;
}
