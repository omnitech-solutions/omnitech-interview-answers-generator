import { describe, expect, it } from "vitest";
import { structuredOutput } from "./agent-models";

describe("structuredOutput", () => {
  it("parses plain and fenced JSON", () => {
    expect(structuredOutput('{"a":"b"}')).toEqual({ a: "b" });
    expect(structuredOutput('```json\n{"a":"b"}\n```')).toEqual({ a: "b" });
  });

  it("rejects prose instead of guessing", () => {
    expect(() => structuredOutput("Sure! Here you go.")).toThrow(
      "did not return structured JSON",
    );
  });
});
