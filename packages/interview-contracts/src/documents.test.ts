import { describe, expect, it } from "vitest";
import {
  type DocumentField,
  deriveFieldGroup,
  documentBlocks,
  documentCreateSchema,
  documentEditSchema,
  documentFieldsSchema,
  documentLayout,
  validateDocumentValues,
  withFieldGroups,
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

describe("blocks of a template", () => {
  const plain = (key: string, required = true): DocumentField => ({
    key,
    label: key,
    source: "candidate-profile",
    required,
    maxLength: null,
  });

  it("names the block a field key belongs to, for the patterns it knows", () => {
    expect(deriveFieldGroup("current_company")).toEqual({
      id: "current",
      kind: "current",
      part: "company",
    });
    expect(deriveFieldGroup("current_experience_bullet3")).toMatchObject({
      id: "current",
      part: "bullet",
    });
    expect(deriveFieldGroup("my_company_name")).toEqual({
      id: "consultancy",
      kind: "consultancy",
      part: "company",
      optional: true,
    });
    expect(deriveFieldGroup("contracts_acquired_skills")).toMatchObject({
      id: "consultancy",
      part: "skills",
    });
    expect(deriveFieldGroup("contract_company2")).toMatchObject({
      id: "contract-2",
      kind: "contract",
      part: "company",
      optional: true,
    });
    expect(deriveFieldGroup("contract_role2")).toMatchObject({
      id: "contract-2",
      part: "title",
    });
    expect(deriveFieldGroup("contract2_bullet1")).toMatchObject({
      id: "contract-2",
      part: "bullet",
    });
    expect(deriveFieldGroup("prior_my_company1")).toMatchObject({
      id: "prior-1",
      kind: "prior",
      part: "company",
    });
    expect(deriveFieldGroup("prior_my_company1_acquired_skills")).toMatchObject(
      {
        id: "prior-1",
        part: "skills",
      },
    );
    expect(deriveFieldGroup("earlier_exp_from")).toMatchObject({
      id: "earlier",
      kind: "earlier",
      part: "from",
    });
    // The first generic experience is always there; later ones may not be.
    expect(deriveFieldGroup("experience_1_company")).toEqual({
      id: "experience-1",
      kind: "experience",
      part: "company",
    });
    expect(deriveFieldGroup("experience_2_bullet_1")).toMatchObject({
      id: "experience-2",
      part: "bullet",
      optional: true,
    });
    for (const key of [
      "summary_paragraph1",
      "company_name",
      "current_mood",
      "contract_length",
      "heading_role",
    ])
      expect(deriveFieldGroup(key), key).toBeNull();
  });

  it("makes a block explicit only when it is unambiguous, and keeps one a template states", () => {
    const grouped = withFieldGroups([
      plain("summary"),
      plain("contract_company1"),
      plain("contract1_bullet1"),
      // Bullets with no employer field: not a block.
      plain("contract2_bullet1"),
      // Earlier experience has no employer and needs none.
      plain("earlier_exp_bullet1"),
      {
        ...plain("contract3_bullet1"),
        group: { id: "side-work", kind: "prior", part: "bullet" },
      },
    ]);
    expect(grouped.map((field) => field.group?.id)).toEqual([
      undefined,
      "contract-1",
      "contract-1",
      undefined,
      "earlier",
      "side-work",
    ]);
    expect(documentFieldsSchema.safeParse(grouped).success).toBe(true);
    expect(
      documentBlocks(grouped).map(({ id, kind, optional, anchor }) => ({
        id,
        kind,
        optional,
        anchor,
      })),
    ).toEqual([
      {
        id: "contract-1",
        kind: "contract",
        optional: true,
        anchor: "contract_company1",
      },
      { id: "earlier", kind: "earlier", optional: true, anchor: null },
      { id: "side-work", kind: "prior", optional: false, anchor: null },
    ]);
  });

  const fields = withFieldGroups([
    plain("current_company"),
    plain("current_role"),
    plain("current_experience_bullet1"),
    plain("my_company_name"),
    plain("my_company_from"),
    plain("contracts_acquired_skills"),
    plain("contract_company1"),
    plain("contract_role1"),
    plain("contract1_bullet1"),
    plain("earlier_exp_from"),
    plain("earlier_exp_bullet1"),
    plain("email_address"),
  ]);

  it("says which blocks do not apply and which fields head one that does", () => {
    const layout = documentLayout(fields, {
      current_company: "Northbeam",
      current_role: "",
      my_company_name: "",
      contracts_acquired_skills: "left over",
      contract_company1: "Plotline",
      earlier_exp_from: "",
      earlier_exp_bullet1: "",
    });
    expect([...layout.absent].sort()).toEqual([
      "contracts_acquired_skills",
      "earlier_exp_bullet1",
      "earlier_exp_from",
      "my_company_from",
      "my_company_name",
    ]);
    expect([...layout.header].sort()).toEqual([
      "contract_company1",
      "contract_role1",
      "current_company",
      "current_role",
    ]);
    // A block with no employer field applies as soon as anything in it is written.
    expect(
      documentLayout(fields, { earlier_exp_bullet1: "Shipped it" }).absent.has(
        "earlier_exp_from",
      ),
    ).toBe(false);
  });

  it("requires nothing of a block that does not apply, and everything of one that does", () => {
    const values = {
      current_company: "Northbeam",
      current_role: "Lead",
      current_experience_bullet1: "",
      my_company_name: "",
      my_company_from: "",
      contracts_acquired_skills: "",
      contract_company1: "Plotline",
      contract_role1: "Lead",
      contract1_bullet1: "",
      earlier_exp_from: "",
      earlier_exp_bullet1: "",
      email_address: "",
    };
    expect(validateDocumentValues(fields, values)).toEqual([
      { key: "current_experience_bullet1", code: "missing" },
      { key: "contract1_bullet1", code: "missing" },
      { key: "email_address", code: "missing" },
    ]);
  });

  it("accepts an edit that marks fields confirmed by the person, and only field keys", () => {
    expect(
      documentEditSchema.parse({
        baseRevision: 2,
        values: { about: "Ada" },
        confirm: ["about"],
      }).confirm,
    ).toEqual(["about"]);
    expect(
      documentEditSchema.parse({ baseRevision: 2, values: {} }).confirm,
    ).toBeUndefined();
    expect(
      documentEditSchema.safeParse({
        baseRevision: 2,
        values: {},
        confirm: ["Not A Key"],
      }).success,
    ).toBe(false);
  });
});
