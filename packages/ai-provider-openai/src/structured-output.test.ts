import { describe, expect, it } from "vitest";
import { parseStructuredOutput } from "./structured-output";

describe("independent host schema compilation", () => {
  it("accepts repeated fresh schemas with the same ID and still rejects invalid output", () => {
    const schema = {
      $id: "urn:task2:host:repeat",
      type: "object",
      properties: { value: { enum: [0, false, null] } },
      required: ["value"],
      additionalProperties: false,
    };
    expect(
      parseStructuredOutput('{"value":0}', structuredClone(schema)),
    ).toEqual({ value: 0 });
    expect(
      parseStructuredOutput('{"value":false}', structuredClone(schema)),
    ).toEqual({ value: false });
    expect(
      parseStructuredOutput('{"value":null}', structuredClone(schema)),
    ).toEqual({ value: null });
    expect(() =>
      parseStructuredOutput('{"value":1}', structuredClone(schema)),
    ).toThrow(/validation failed/);
  });
  it("does not reuse another definition sharing the same ID", () => {
    const a = {
      $id: "urn:task2:host:contexts",
      type: "object",
      properties: { a: { type: "boolean" } },
      required: ["a"],
    };
    const b = {
      $id: "urn:task2:host:contexts",
      type: "object",
      properties: { b: { type: "integer", minimum: 0 } },
      required: ["b"],
    };
    expect(parseStructuredOutput('{"a":false}', a)).toEqual({ a: false });
    expect(parseStructuredOutput('{"b":0}', b)).toEqual({ b: 0 });
    expect(() => parseStructuredOutput('{"b":-1}', structuredClone(b))).toThrow(
      /validation failed/,
    );
  });
});

describe("host declared dialect semantics", () => {
  it("preserves repeated-ID 2020 tuple and unevaluated property validation", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:task2:host:2020",
      type: "object",
      properties: {
        items: {
          type: "array",
          prefixItems: [{ const: 0 }, { type: "boolean" }],
          minItems: 2,
          maxItems: 2,
          items: false,
        },
      },
      required: ["items"],
      unevaluatedProperties: false,
    };
    for (let i = 0; i < 2; i++)
      expect(
        parseStructuredOutput('{"items":[0,false]}', structuredClone(schema)),
      ).toEqual({ items: [0, false] });
    for (const output of [
      '{"items":[false,0]}',
      '{"items":[0,false,null]}',
      '{"items":[0,false],"extra":true}',
    ])
      expect(() =>
        parseStructuredOutput(output, structuredClone(schema)),
      ).toThrow(/validation failed/);
  });
  it("rejects other declared dialects explicitly", () => {
    expect(() =>
      parseStructuredOutput("{}", {
        $schema: "https://example.com/unsupported",
        type: "object",
      }),
    ).toThrow(/Unsupported JSON Schema dialect/);
  });
});
