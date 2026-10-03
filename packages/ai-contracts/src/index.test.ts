import { describe, expect, it } from "vitest";
import { AiPolicyRefusedError, parseStructuredOutput } from "./index.js";

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

describe("policy refusal", () => {
  it("is non-retryable and names ids only", () => {
    const error = new AiPolicyRefusedError("document-fast", "device-only");

    expect(error.toFailure()).toEqual({
      code: "policy-refused",
      message:
        "Refused by processing policy device-only for AI profile document-fast.",
      retryable: false,
    });
    expect(error).toMatchObject({
      profileId: "document-fast",
      policy: "device-only",
      retryable: false,
    });
  });
});
