import { describe, expect, it } from "vitest";
import {
  type DocumentField,
  documentCreateSchema,
  documentFieldsSchema,
  validateDocumentValues,
} from "./documents";

const fields: DocumentField[] = [
  {
    key: "company_name",
    label: "Company name",
    source: "candidacy",
    required: true,
    maxLength: 40,
  },
  {
    key: "phone",
    label: "Phone",
    source: "candidate-profile",
    required: true,
    maxLength: null,
  },
];

describe("document field contract", () => {
  it("rejects duplicate keys so generated values have one meaning", () => {
    expect(documentFieldsSchema.safeParse([fields[0], fields[0]]).success).toBe(
      false,
    );
  });

  it("reports missing, overlong and unknown values without changing source data", () => {
    const values = {
      company_name: "A".repeat(41),
      phone: "   ",
      model_invented: "unsafe",
    };
    expect(validateDocumentValues(fields, values)).toEqual([
      { key: "company_name", code: "too-long" },
      { key: "phone", code: "missing" },
      { key: "model_invented", code: "unexpected" },
    ]);
    expect(values.company_name).toHaveLength(41);
  });
});

describe("document create contract", () => {
  const selection = {
    title: "General resume",
    templateId: "11111111-1111-4111-8111-111111111111",
    templateRevision: 1,
    profileId: "profile",
    profileRevision: 1,
    candidacyId: null,
    interviewId: null,
  };

  it("accepts a document written by a named model, and keeps the request as it was sent", () => {
    const parsed = documentCreateSchema.parse({
      ...selection,
      aiTargetId: "test-model",
    });
    expect(parsed).toEqual({ ...selection, aiTargetId: "test-model" });
    expect(parsed).not.toHaveProperty("mode");
  });

  it("accepts a document made by hand, which names no model", () => {
    expect(
      documentCreateSchema.parse({ ...selection, mode: "manual" }),
    ).toEqual({ ...selection, mode: "manual" });
  });

  it("refuses a request that names neither, both, or another mode", () => {
    for (const body of [
      selection,
      { ...selection, mode: "manual", aiTargetId: "test-model" },
      { ...selection, mode: "ai" },
      { ...selection, mode: "automatic" },
      { ...selection, aiTargetId: "" },
      { ...selection, mode: "manual", values: { about: "Ada" } },
    ])
      expect(documentCreateSchema.safeParse(body).success).toBe(false);
  });
});
