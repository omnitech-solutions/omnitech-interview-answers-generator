import { describe, expect, it } from "vitest";
import { parseStructuredOutput } from "./index.js";

describe("structured output contract", () => {
  const schema = {
    type: "object",
    required: ["title", "outline"],
    properties: {
      title: { type: "string" },
      outline: { type: "array", items: { type: "string" } },
    },
  } as const;

  it("accepts valid JSON matching the schema", () => {
    expect(
      parseStructuredOutput('{"title":"Roadmap","outline":[]}', schema),
    ).toEqual({ title: "Roadmap", outline: [] });
  });

  it("rejects valid JSON with an invalid shape", () => {
    expect(() =>
      parseStructuredOutput('{"title":4,"outline":[]}', schema),
    ).toThrow("Structured output validation failed");
  });
});
