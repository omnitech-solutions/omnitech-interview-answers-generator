import { describe, expect, it } from "vitest";
import {
  documentFieldsSchema,
  type DocumentField,
  validateDocumentValues,
} from "./documents.js";

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
