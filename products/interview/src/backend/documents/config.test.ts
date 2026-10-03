import { describe, expect, it } from "vitest";
import { builtInTemplates } from "./built-in-templates";
import { DEFAULT_DOCUMENTS_CONFIG, resolveDocumentsConfig } from "./config";
import { planBatches } from "./generate";

describe("resolveDocumentsConfig", () => {
  it("uses the defaults when nothing is set, including blank values", () => {
    expect(resolveDocumentsConfig({})).toEqual(DEFAULT_DOCUMENTS_CONFIG);
    expect(resolveDocumentsConfig({ DOCUMENTS_FIELDS_PER_CALL: "  " })).toEqual(
      DEFAULT_DOCUMENTS_CONFIG,
    );
  });

  it("reads every setting from its environment variable", () => {
    expect(
      resolveDocumentsConfig({
        DOCUMENTS_MAX_PARALLEL_CALLS: "6",
        DOCUMENTS_FIELDS_PER_CALL: "40",
        DOCUMENTS_CALL_ATTEMPTS: "1",
        DOCUMENTS_FIELD_WORDS: "18",
        DOCUMENTS_LIST_ITEM_WORDS: "10",
        DOCUMENTS_SUMMARY_WORDS: "50",
        DOCUMENTS_SKILL_ITEMS: "8",
      }),
    ).toEqual({
      generation: { maxCalls: 6, fieldsPerCall: 40, attempts: 1 },
      brevity: {
        fieldWords: 18,
        listItemWords: 10,
        summaryWords: 50,
        skillItems: 8,
      },
    });
  });

  it.each([
    ["DOCUMENTS_MAX_PARALLEL_CALLS", "0"],
    ["DOCUMENTS_MAX_PARALLEL_CALLS", "9"],
    ["DOCUMENTS_FIELDS_PER_CALL", "2.5"],
    ["DOCUMENTS_CALL_ATTEMPTS", "many"],
    ["DOCUMENTS_FIELD_WORDS", "-1"],
  ])("names the setting when %s is %s", (name, value) => {
    expect(() => resolveDocumentsConfig({ [name]: value })).toThrow(
      new RegExp(`^${name} must be a whole number`),
    );
  });
});

describe("settings take effect", () => {
  const fields = Array.from({ length: 60 }, (_, index) => ({
    key: `field_${index}`,
    label: `Field ${index}`,
    source: "candidate-profile" as const,
    required: false,
    maxLength: null,
  }));

  it("shares fields over the calls the settings allow", () => {
    const sizes = (settings: { maxCalls: number; fieldsPerCall: number }) =>
      planBatches(fields, { ...settings, attempts: 2 }).map(
        (batch) => batch.fields.length,
      );
    expect(sizes({ maxCalls: 4, fieldsPerCall: 24 })).toEqual([20, 20, 20]);
    expect(sizes({ maxCalls: 2, fieldsPerCall: 24 })).toEqual([30, 30]);
    expect(sizes({ maxCalls: 8, fieldsPerCall: 10 })).toHaveLength(6);
    expect(sizes({ maxCalls: 8, fieldsPerCall: 100 })).toEqual([60]);
  });

  it("puts the configured limits into the built-in instructions", () => {
    const brevity = {
      fieldWords: 11,
      listItemWords: 7,
      summaryWords: 33,
      skillItems: 5,
    };
    const text = (kind: string) =>
      builtInTemplates(brevity).find((template) => template.key === kind)
        ?.instructions ?? "";
    expect(text("interview-prep")).toContain("at most 11 words");
    expect(text("interview-prep")).toContain("at most 7");
    expect(text("resume")).toContain("at most 33 words");
    expect(text("resume")).toContain("at most 5 items");
    // Defaults still read as the original rule.
    expect(
      builtInTemplates().find((template) => template.key === "interview-prep")
        ?.instructions,
    ).toContain("at most 25 words");
  });
});
