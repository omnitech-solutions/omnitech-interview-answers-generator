import {
  type DocumentField,
  documentFieldsSchema,
  documentLayout,
  validateDocumentValues,
  withFieldGroups,
} from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_FIELD_WIDGET,
  documentFormConfig,
  documentFormSections,
  fieldControlId,
  initiallyCollapsed,
  isSourceBound,
  OPTIONAL_PLACEHOLDER,
  SOURCE_BOUND_NOTE,
  sectionIdOf,
  toFlatValues,
  toGroupedValues,
} from "./document-form-config";
import { groupFields } from "./documents-model";

const field = (
  key: string,
  over: Partial<DocumentField> = {},
): DocumentField => ({
  key,
  label: key.replaceAll("_", " "),
  source: "candidate-profile",
  required: true,
  maxLength: null,
  ...over,
});

const resume: DocumentField[] = withFieldGroups([
  field("full_name"),
  field("company_name", { source: "candidacy" }),
  field("interview_stage", { source: "interview", required: false }),
  field("summary", { maxLength: 400 }),
  field("my_company_name"),
  field("my_company_role"),
  field("experience_1_company"),
  field("experience_1_bullet_1"),
  field("experience_2_company"),
  field("experience_2_bullet_1", { required: false }),
  field("note", { source: "manual", required: false }),
]);

// A small seeded generator: the same templates and values on every run.
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
const SOURCES = [
  "candidate-profile",
  "candidacy",
  "interview",
  "manual",
] as const;
const SECTIONS = [undefined, "Summary", "Work Experience", "Skills & tools"];
function template(random: () => number, withSections: boolean) {
  const count = 1 + Math.floor(random() * 40);
  return documentFieldsSchema.parse(
    Array.from({ length: count }, (_, index) => ({
      key: `f${index}_${Math.floor(random() * 1000)}`,
      label: `Field ${index}`,
      source: SOURCES[Math.floor(random() * SOURCES.length)],
      required: random() < 0.6,
      maxLength: random() < 0.3 ? 1 + Math.floor(random() * 500) : null,
      ...(withSections && random() < 0.7
        ? { section: SECTIONS[1 + Math.floor(random() * 3)] }
        : {}),
    })),
  );
}
const TEXTS = [
  "",
  " ",
  "Ada",
  "two\nlines",
  "tab\tand “quotes”",
  "x".repeat(300),
];

describe("document form configuration", () => {
  it("draws one collapsible section per group and one string per field, in template order", () => {
    const config = documentFormConfig(resume, {
      binding: { candidacy: true, interview: true },
    });
    const groups = groupFields(resume);
    expect(config.sections.map((section) => section.title)).toEqual(
      groups.map((group) => group.title),
    );
    expect(config.sections.map((section) => section.keys)).toEqual(
      groups.map((group) => group.fields.map((item) => item.key)),
    );
    const properties = config.schema.properties as Record<
      string,
      { title: string; required: string[]; properties: Record<string, unknown> }
    >;
    expect(Object.keys(properties)).toEqual(["s0", "s1", "s2", "s3"]);
    expect(properties["s2"]).toMatchObject({
      type: "object",
      title: "Written from your experience",
    });
    expect(Object.keys(properties["s2"]!.properties)).toEqual(
      groups[2]!.fields.map((item) => item.key),
    );
    expect(properties["s2"]!.properties["summary"]).toEqual({
      type: "string",
      title: "summary",
      maxLength: 400,
    });
    expect(properties["s2"]!.properties["full_name"]).toEqual({
      type: "string",
      title: "full name",
    });
    // Drawn as required from the field; the conditional rule is not here.
    expect(properties["s2"]!.required).not.toContain("experience_2_bullet_1");
    expect(properties["s2"]!.required).toContain("experience_2_company");
    expect(config.uiSchema["ui:rows"]).toEqual([
      ["s0"],
      ["s1"],
      ["s2"],
      ["s3"],
    ]);
    expect(config.uiSchema["s2"]).toMatchObject({
      "ui:options": {
        collapsible: {
          title: "Written from your experience",
          defaultOpen: true,
        },
      },
      "ui:rows": groups[2]!.fields.map((item) => [item.key]),
      summary: { "ui:widget": DOCUMENT_FIELD_WIDGET },
    });
  });

  it("uses the template's own headings as sections when it has them", () => {
    const fields = [
      field("full_name", { section: "Header" }),
      field("summary", { section: "Summary" }),
      field("email", { section: "Header" }),
      field("note", { source: "manual" }),
    ];
    const config = documentFormConfig(fields, {
      binding: { candidacy: false, interview: false },
    });
    expect(config.sections).toEqual([
      {
        name: "s0",
        id: "section:Header",
        title: "Header",
        keys: ["full_name", "email"],
      },
      {
        name: "s1",
        id: "section:Summary",
        title: "Summary",
        keys: ["summary"],
      },
      { name: "s2", id: "manual", title: "Your input", keys: ["note"] },
    ]);
    expect(fieldControlId(config.sections, "email")).toBe("root_s0_email");
    expect(fieldControlId(config.sections, "nowhere")).toBeNull();
    expect(sectionIdOf(fields, "email")).toBe("section:Header");
    expect(sectionIdOf(fields, "nowhere")).toBeNull();
  });

  it("makes a field read-only from its source and the document's links, never from its label", () => {
    const fields = [
      field("company_name", { source: "candidacy", label: "Anything" }),
      field("interview_stage", { source: "interview", required: false }),
      field("from_the_application", {
        label: "Filled from the application",
      }),
    ];
    const ui = (binding: { candidacy: boolean; interview: boolean }) =>
      documentFormConfig(fields, { binding }).uiSchema;
    const both = ui({ candidacy: true, interview: true });
    expect(both["s0"]).toMatchObject({
      company_name: { "ui:readonly": true, "ui:help": SOURCE_BOUND_NOTE },
    });
    expect(both["s1"]).toMatchObject({
      interview_stage: {
        "ui:readonly": true,
        "ui:placeholder": OPTIONAL_PLACEHOLDER,
      },
    });
    // A label that says so changes nothing.
    expect(both["s2"]?.["from_the_application"]).toEqual({
      "ui:widget": DOCUMENT_FIELD_WIDGET,
    });
    // A general document is tied to no application: its fields are typed.
    const neither = ui({ candidacy: false, interview: false });
    expect(neither["s0"]?.["company_name"]).toEqual({
      "ui:widget": DOCUMENT_FIELD_WIDGET,
    });
    expect(neither["s1"]?.["interview_stage"]).toEqual({
      "ui:widget": DOCUMENT_FIELD_WIDGET,
      "ui:placeholder": OPTIONAL_PLACEHOLDER,
    });
    // An interview-only link locks the interview's fields alone.
    const interview = ui({ candidacy: false, interview: true });
    expect(interview["s0"]?.["company_name"]?.["ui:readonly"]).toBeUndefined();
    expect(interview["s1"]?.["interview_stage"]?.["ui:readonly"]).toBe(true);
    expect(
      isSourceBound(fields[2]!, { candidacy: true, interview: true }),
    ).toBe(false);
    // A revision only being read says nothing about where a value is from.
    const reading = documentFormConfig(fields, {
      binding: { candidacy: true, interview: true },
      readOnly: true,
    }).uiSchema;
    expect(reading["s0"]?.["company_name"]).toEqual({
      "ui:widget": DOCUMENT_FIELD_WIDGET,
      "ui:readonly": true,
    });
  });

  it("leaves hidden fields and emptied sections out without renaming the rest", () => {
    const { absent } = documentLayout(resume, {
      experience_1_company: "Plotline",
    });
    // The consultancy and the second employer do not apply.
    expect([...absent]).toEqual([
      "my_company_name",
      "my_company_role",
      "experience_2_company",
      "experience_2_bullet_1",
    ]);
    const whole = documentFormConfig(resume, {
      binding: { candidacy: true, interview: true },
    });
    const config = documentFormConfig(resume, {
      binding: { candidacy: true, interview: true },
      hidden: new Set([...absent, "company_name", "note"]),
      collapsed: new Set(["candidate-profile"]),
    });
    expect(config.sections).toEqual(whole.sections);
    expect(Object.keys(config.schema.properties ?? {})).toEqual(["s1", "s2"]);
    expect(config.uiSchema["ui:rows"]).toEqual([["s1"], ["s2"]]);
    expect(
      Object.keys(
        (config.schema.properties as Record<string, { properties: object }>)[
          "s2"
        ]?.properties ?? {},
      ),
    ).toEqual([
      "full_name",
      "summary",
      "experience_1_company",
      "experience_1_bullet_1",
    ]);
    expect(config.uiSchema["s2"]).toMatchObject({
      "ui:options": { collapsible: { defaultOpen: false } },
    });
    expect(config.uiSchema["s1"]).toMatchObject({
      "ui:options": { collapsible: { defaultOpen: true } },
    });
    // Required stays conditional: the absent block asks for nothing.
    expect(
      validateDocumentValues(resume, {
        full_name: "Ada",
        company_name: "Northwind",
        summary: "S",
        experience_1_company: "Plotline",
        experience_1_bullet_1: "Did it",
      }),
    ).toEqual([]);
  });

  it("opens a long template on its first section and the ones with a problem", () => {
    const long = Array.from({ length: 30 }, (_, index) =>
      field(`f${index}`, { section: `Section ${Math.floor(index / 10)}` }),
    );
    expect([...initiallyCollapsed(long, [])]).toEqual([
      "section:Section 1",
      "section:Section 2",
    ]);
    expect([
      ...initiallyCollapsed(long, [{ key: "f25", code: "missing" }]),
    ]).toEqual(["section:Section 1"]);
    expect(
      initiallyCollapsed(long.slice(0, 24), [{ key: "f1", code: "missing" }])
        .size,
    ).toBe(0);
  });
});

describe("grouped and flat values", () => {
  it("projects flat values into their sections and back", () => {
    const sections = documentFormSections(resume);
    const flat = Object.fromEntries(
      resume.map((item, index) => [item.key, `value ${index}`]),
    );
    const grouped = toGroupedValues(sections, flat);
    expect(grouped["s0"]).toEqual({ company_name: "value 1" });
    expect(grouped["s1"]).toEqual({ interview_stage: "value 2" });
    expect(toFlatValues(sections, grouped)).toEqual(flat);
  });

  it("gives every declared field a string, and reads back only what the form holds", () => {
    const sections = documentFormSections(resume);
    const grouped = toGroupedValues(sections, { full_name: "Ada" });
    expect(Object.values(grouped).flatMap(Object.keys).sort()).toEqual(
      resume.map((item) => item.key).sort(),
    );
    expect(grouped["s2"]?.["summary"]).toBe("");
    // A form that drew one section says nothing about the others.
    expect(
      toFlatValues(sections, {
        s2: { full_name: "Ada L", summary: undefined },
      }),
    ).toEqual({ full_name: "Ada L", summary: "" });
    expect(toFlatValues(sections, { s2: null, other: { x: "y" } })).toEqual({});
  });

  it("round-trips every declared field for any template, with or without headings", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = seeded(seed);
      const fields = template(random, seed % 2 === 0);
      const sections = documentFormSections(fields);
      const flat = Object.fromEntries(
        fields.map((item) => [
          item.key,
          TEXTS[Math.floor(random() * TEXTS.length)]!,
        ]),
      );

      // Unique keys: each field is in exactly one section, once.
      const placed = sections.flatMap((section) => section.keys);
      expect(placed.slice().sort()).toEqual(
        fields.map((item) => item.key).sort(),
      );
      expect(new Set(placed).size).toBe(placed.length);
      expect(new Set(sections.map((section) => section.name)).size).toBe(
        sections.length,
      );

      // Flat -> grouped -> flat loses nothing and invents nothing.
      const grouped = toGroupedValues(sections, flat);
      expect(toFlatValues(sections, grouped)).toEqual(flat);
      // Grouped -> flat -> grouped is the identity too.
      expect(
        toGroupedValues(sections, toFlatValues(sections, grouped)),
      ).toEqual(grouped);

      // Order inside a section is template order.
      const order = new Map(fields.map((item, index) => [item.key, index]));
      for (const section of sections)
        expect(section.keys).toEqual(
          section.keys.slice().sort((a, b) => order.get(a)! - order.get(b)!),
        );

      // The schema draws exactly the fields that are not hidden, and a
      // hidden field's value is the caller's to keep.
      const hidden = new Set(
        fields.filter(() => random() < 0.3).map((item) => item.key),
      );
      const config = documentFormConfig(fields, {
        binding: { candidacy: random() < 0.5, interview: random() < 0.5 },
        hidden,
      });
      const drawn = Object.values(config.schema.properties ?? {}).flatMap(
        (section) =>
          Object.keys((section as { properties: object }).properties),
      );
      expect(drawn.slice().sort()).toEqual(
        fields
          .filter((item) => !hidden.has(item.key))
          .map((item) => item.key)
          .sort(),
      );
      expect(config.sections).toEqual(sections);
    }
  });
});
