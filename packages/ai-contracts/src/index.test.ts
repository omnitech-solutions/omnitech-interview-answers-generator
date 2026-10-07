import { describe, expect, it } from "vitest";
import {
  AiPolicyRefusedError,
  parseStructuredOutput,
  refusedStream,
} from "./index";

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

describe("refusedStream", () => {
  it("rejects on first read and not before, like a throw-only generator", async () => {
    const stream = refusedStream("No model is configured.");
    // Creating the stream and asking for its iterator never throws...
    const iterator = stream[Symbol.asyncIterator]();
    // ...the refusal arrives on the first read.
    await expect(iterator.next()).rejects.toThrow("No model is configured.");
    await expect(
      (async () => {
        for await (const _part of refusedStream("closed")) {
          // never reached
        }
      })(),
    ).rejects.toThrow("closed");
  });
});
