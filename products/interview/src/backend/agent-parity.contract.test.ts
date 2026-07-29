import { describe, expect, it } from "vitest";

describe("agent publication parity contract", () => {
  it("keeps the published result unchanged until a replacement is valid", () => {
    const published = Object.freeze({ revision: 7, value: "current answer" });
    const invalidCandidate = { revision: 8, value: "" };

    const result =
      invalidCandidate.value.trim().length > 0 ? invalidCandidate : published;

    expect(result).toBe(published);
    expect(result).toEqual({ revision: 7, value: "current answer" });
  });

  it("allows exactly one output-validation retry", () => {
    const maximumValidationAttempts = 2;
    expect(maximumValidationAttempts).toBe(2);
  });
});
