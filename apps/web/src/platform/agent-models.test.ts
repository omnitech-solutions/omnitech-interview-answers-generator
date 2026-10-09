import { describe, expect, it } from "vitest";
import { unfenced } from "./agent-models";

describe("unfenced", () => {
  it("returns JSON as it is, plain or fenced as Markdown", () => {
    expect(unfenced('{"a":"b"}')).toBe('{"a":"b"}');
    expect(unfenced('```json\n{"a":"b"}\n```')).toBe('{"a":"b"}');
    expect(unfenced('```\n{"a":"b"}\n```')).toBe('{"a":"b"}');
  });

  it("leaves prose for the engine to reject instead of guessing", () => {
    expect(unfenced("Sure! Here you go.")).toBe("Sure! Here you go.");
  });
});
