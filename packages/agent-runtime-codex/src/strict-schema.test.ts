import { describe, expect, it } from "vitest";
import { restoreOptional, strictSchema } from "./strict-schema";

// biome-ignore lint/suspicious/noExplicitAny: JSON read back from the code under test; each assertion names the fields it checks
type Json = any;

const product = {
  type: "object",
  properties: {
    language: { type: "string" },
    code: { type: "string" },
    usageCode: { type: "string" },
    coverage: {
      type: "object",
      properties: {
        cases: { type: "array", items: { type: "string" } },
        note: { type: "string" },
      },
      required: ["cases"],
    },
    tests: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, skip: { type: "boolean" } },
        required: ["name"],
      },
    },
  },
  required: ["language", "code", "coverage", "tests"],
} as const;

describe("strictSchema", () => {
  const strict = strictSchema(product) as Json;

  it("requires every property and forbids extra keys at every object", () => {
    expect(strict.required).toEqual([
      "language",
      "code",
      "usageCode",
      "coverage",
      "tests",
    ]);
    expect(strict.additionalProperties).toBe(false);
    expect(strict.properties.coverage.required).toEqual(["cases", "note"]);
    expect(strict.properties.coverage.additionalProperties).toBe(false);
    expect(strict.properties.tests.items.required).toEqual(["name", "skip"]);
  });

  it("makes only the originally optional properties nullable", () => {
    expect(strict.properties.usageCode.type).toEqual(["string", "null"]);
    expect(strict.properties.coverage.properties.note.type).toEqual([
      "string",
      "null",
    ]);
    expect(strict.properties.language.type).toBe("string");
    expect(strict.properties.coverage.properties.cases.type).toBe("array");
  });

  it("does not change the schema it was given", () => {
    expect((product as Json).required).toHaveLength(4);
    expect((product.properties as Json).usageCode.type).toBe("string");
  });

  it("wraps an untyped optional property in a null union", () => {
    const wrapped = strictSchema({
      type: "object",
      properties: { any: { description: "anything" } },
      required: [],
    }) as Json;
    expect(wrapped.properties.any.anyOf).toEqual([
      { description: "anything" },
      { type: "null" },
    ]);
  });
});

describe("restoreOptional", () => {
  it("drops a null for an optional property, at any depth", () => {
    expect(
      restoreOptional(
        {
          language: "typescript",
          code: "x",
          usageCode: null,
          coverage: { cases: ["a"], note: null },
          tests: [{ name: "t", skip: null }],
        },
        product as Json,
      ),
    ).toEqual({
      language: "typescript",
      code: "x",
      coverage: { cases: ["a"] },
      tests: [{ name: "t" }],
    });
  });

  it("keeps values, and keeps a null the product schema required", () => {
    expect(
      restoreOptional(
        {
          language: "ts",
          code: null,
          usageCode: "u",
          coverage: { cases: [] },
          tests: [],
        },
        product as Json,
      ),
    ).toEqual({
      language: "ts",
      code: null,
      usageCode: "u",
      coverage: { cases: [] },
      tests: [],
    });
  });
});

describe("strict schema edge cases", () => {
  it("admits null in an optional enum or const so the model need not invent a member", () => {
    const strict = strictSchema({
      type: "object",
      properties: {
        level: { type: "string", enum: ["a", "b"] },
        fixed: { type: "string", const: "x" },
      },
      required: [],
    }) as Json;
    expect(strict.properties.level.enum).toEqual(["a", "b", null]);
    expect(strict.properties.fixed).toEqual({
      type: "string",
      enum: ["x", null],
    });
  });

  it("restores through unions and local $refs", () => {
    const schema = {
      type: "object",
      properties: {
        item: { $ref: "#/$defs/item" },
        either: {
          anyOf: [
            {
              type: "object",
              properties: { a: { type: "string" }, b: { type: "string" } },
              required: ["a"],
            },
            { type: "string" },
          ],
        },
      },
      required: ["item", "either"],
      $defs: {
        item: {
          type: "object",
          properties: { name: { type: "string" }, note: { type: "string" } },
          required: ["name"],
        },
      },
    } as Json;
    expect(
      restoreOptional(
        { item: { name: "n", note: null }, either: { a: "x", b: null } },
        schema,
      ),
    ).toEqual({ item: { name: "n" }, either: { a: "x" } });
  });

  it("keeps a null the product schema itself allows", () => {
    expect(
      restoreOptional({ maybe: null }, {
        type: "object",
        properties: { maybe: { type: ["string", "null"] } },
        required: [],
      } as Json),
    ).toEqual({ maybe: null });
  });
});
