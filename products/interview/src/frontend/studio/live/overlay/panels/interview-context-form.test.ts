// The context form's declaration: its schema is the contract's, its layout
// follows the contract's bounds, and its two adapters lose nothing.
import {
  type CandidacyContext,
  candidacyContextInputSchema,
} from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  contextFormSchema,
  contextUiSchema,
  toContextFormData,
  toContextInput,
} from "./interview-context-form";

const STORED: CandidacyContext = {
  id: "22222222-2222-4222-8222-222222222222",
  companyName: "Example Corp",
  title: "Staff Engineer",
  jobDescription: "Posting text\nsecond line  ",
  notes: null,
  brief: null,
};

describe("the context form's schema", () => {
  it("has exactly the contract's fields, in the contract's order", () => {
    expect(Object.keys(contextFormSchema.properties ?? {})).toEqual(
      Object.keys(candidacyContextInputSchema.shape),
    );
  });

  it("requires what the contract requires and bounds what it bounds", () => {
    expect(contextFormSchema.required).toEqual(["companyName", "title"]);
    expect(contextFormSchema.properties).toMatchObject({
      companyName: { type: "string", minLength: 1, maxLength: 200 },
      jobDescription: { type: "string", maxLength: 20_000 },
    });
  });
});

describe("the context form's layout", () => {
  it("puts one-line fields two to a row and each long text on a row of its own", () => {
    const ui = contextUiSchema({ companyFixed: false }) as Record<
      string,
      Record<string, unknown>
    >;
    expect(ui["ui:rows"]).toEqual([
      ["companyName", "title"],
      [{ value: "notes", span: 2 }],
      [{ value: "jobDescription", span: 2 }],
    ]);
    expect(ui["notes"]?.["ui:widget"]).toBe("textarea");
    expect(ui["title"]?.["ui:widget"]).toBeUndefined();
    expect(ui["title"]?.["ui:title"]).toBe("Role");
  });

  it("fixes the company only once the candidacy exists", () => {
    const fixed = (companyFixed: boolean) =>
      (contextUiSchema({ companyFixed }) as Record<string, object>)[
        "companyName"
      ];
    expect(fixed(false)).not.toHaveProperty("ui:disabled");
    expect(fixed(true)).toHaveProperty("ui:disabled", true);
  });

  it("gives every field of the schema an entry, so none is left to chance", () => {
    const ui = contextUiSchema({ companyFixed: false });
    for (const name of Object.keys(contextFormSchema.properties ?? {}))
      expect(ui).toHaveProperty(name);
  });
});

describe("the context form's values", () => {
  it("starts a new interview with every field empty", () => {
    expect(toContextFormData(null)).toEqual({
      companyName: "",
      title: "",
      notes: "",
      jobDescription: "",
    });
  });

  it("round-trips a stored context: nothing typed is lost, an absent text is empty", () => {
    const values = toContextFormData(STORED);
    expect(values).toEqual({
      companyName: "Example Corp",
      title: "Staff Engineer",
      notes: "",
      jobDescription: "Posting text\nsecond line  ",
    });
    // Out again as the contract reads it: the long texts are kept as typed.
    expect(toContextInput(values)).toEqual(values);
    // And never the fields a person does not type.
    expect(values).not.toHaveProperty("id");
    expect(values).not.toHaveProperty("brief");
  });

  it("reads what is typed as the contract does: a company and a role are trimmed", () => {
    expect(
      toContextInput({
        ...toContextFormData(STORED),
        companyName: "  Example Corp ",
        title: " Staff Engineer ",
      }),
    ).toMatchObject({ companyName: "Example Corp", title: "Staff Engineer" });
  });

  it("refuses what the contract refuses", () => {
    const values = toContextFormData(STORED);
    expect(toContextInput({ ...values, title: "   " })).toBeNull();
    expect(toContextInput({ ...values, companyName: "" })).toBeNull();
    expect(toContextInput({ ...values, notes: "x".repeat(20_001) })).toBeNull();
    expect(toContextInput({ ...values, extra: "field" })).toBeNull();
    expect(toContextInput(null)).toBeNull();
  });

  it("fills in a long text the form left out", () => {
    expect(toContextInput({ companyName: "A", title: "B" })).toEqual({
      companyName: "A",
      title: "B",
      notes: "",
      jobDescription: "",
    });
  });
});
